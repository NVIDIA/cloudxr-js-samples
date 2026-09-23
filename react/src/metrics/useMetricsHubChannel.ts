/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * React hook that opens a {@link MetricsHubChannel} when OOB is enabled in the page URL.
 */

import { useEffect, useRef, type MutableRefObject } from 'react';

import {
  MetricsHubChannel,
  type MetricsHubChannelOptions,
  type StreamConfig,
} from './metricsHubChannel';
import { buildMetricsHubWsUrl } from './metricsHubUrl';

export interface UseMetricsHubChannelOptions {
  /** When false, no WebSocket is opened (e.g. until 2D UI is initialized). */
  enabled: boolean;
  /** Apply hub-pushed stream config (server IP, port, codec) to the sample panel. */
  onConfig?: (config: StreamConfig, configVersion: number) => void;
  /** Notify when the hub WebSocket connects or disconnects. */
  onConnectionChange?: (connected: boolean) => void;
  /** Snapshot provider for periodic ``clientMetrics`` reports to the hub. */
  getMetricsSnapshot?: () => import('./metricsHubChannel').MetricsSnapshot | null | undefined;
  /** Metrics send interval; read only when the channel is created (reconnect to apply changes). */
  metricsIntervalMs?: number;
  /** Human-readable label shown in hub headset snapshots. */
  deviceLabel?: string;
  /** Hub WebSocket host — same IP as CloudXR signaling / Server IP in the panel. */
  hubServerIP?: string;
}

/**
 * Opt-in CloudXR metrics hub WebSocket (``oobEnable=1``; hub host = ``hubServerIP``;
 * ``hubPort`` for the local hub, default 8787). Returns a ref to the channel for
 * forwarding ``streamStatus`` from CloudXR status callbacks.
 *
 * @param options Hook options; {@link UseMetricsHubChannelOptions.enabled} gates the WebSocket.
 * @returns Ref to the live {@link MetricsHubChannel}, or null before connect / after dispose.
 */
export function useMetricsHubChannel(
  options: UseMetricsHubChannelOptions
): MutableRefObject<MetricsHubChannel | null> {
  const channelRef = useRef<MetricsHubChannel | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    // Wait until the caller enables OOB (e.g. after React UI mounts).
    if (!optionsRef.current.enabled) return;

    const p = new URLSearchParams(window.location.search);
    const hubServerIP = optionsRef.current.hubServerIP?.trim() ?? '';
    const hubWsUrl = buildMetricsHubWsUrl(p, hubServerIP);
    // oobEnable off, missing Server IP, or invalid port — no channel to open.
    if (!hubWsUrl) return;

    console.info('[MetricsHub] Hub WebSocket:', hubWsUrl);

    // Mixed-content guard: an HTTPS sample cannot dial ws:// even when the hub is plaintext-only.
    if (window.location.protocol === 'https:' && hubWsUrl.startsWith('ws://')) {
      console.warn(
        '[MetricsHub] Page is HTTPS but hub URL is ws:// — browser will block (mixed content). Use the HTTP sample dev server or a WSS hub.'
      );
    }

    const channelOpts: MetricsHubChannelOptions = {
      url: hubWsUrl,
      token: p.get('controlToken') ?? undefined,
      onConfig: (config, configVersion) => {
        optionsRef.current.onConfig?.(config, configVersion);
      },
      onConnectionChange: connected => {
        optionsRef.current.onConnectionChange?.(connected);
      },
      getMetricsSnapshot: () => optionsRef.current.getMetricsSnapshot?.() ?? null,
      metricsIntervalMs: optionsRef.current.metricsIntervalMs,
      deviceLabel: optionsRef.current.deviceLabel,
      // Hub compares this against its Host header when registration fails before hello.
      signalingServerIp: hubServerIP || undefined,
    };

    const channel = new MetricsHubChannel(channelOpts);
    channel.connect();
    channelRef.current = channel;

    // Tear down the WebSocket when enabled flips off or hubServerIP changes.
    return () => {
      channelRef.current = null;
      channel.dispose();
    };
  }, [options.enabled, options.hubServerIP]);

  // Expose the live channel for sendStreamStatus / sendLogs from CloudXR callbacks.
  return channelRef;
}
