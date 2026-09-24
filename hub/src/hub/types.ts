/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shared TypeScript types for the CloudXR.js Metrics Hub server and browser client.
 */

import type { WebSocket } from 'ws';

import type { HubConnectivityMeta } from '../shared/oobConnectivityDiagnostics.ts';

export type { HubConnectivityMeta };

/** CloudXR stream / signaling settings pushed to connected headsets. */
export interface StreamConfig {
  /** CloudXR server IP address (signaling). */
  serverIP: string;
  /** CloudXR signaling port (typically 49100). */
  port: number;
  /** Whether the in-headset debug panel starts hidden. */
  panelHiddenAtStart?: boolean;
  /** Preferred video codec identifier, when set. */
  codec?: string;
}

/** Rolling time-series for one metric key within a cadence bucket. */
export interface MetricSeries {
  /** Sample timestamps in milliseconds (or seconds before normalization). */
  times: number[];
  /** Sample values aligned with {@link MetricSeries.times}. */
  values: number[];
}

/** Latest scalar metrics for one cadence (e.g. ``render``, ``frame``). */
export interface CadenceMetrics {
  /** Timestamp of the latest sample in milliseconds. */
  at: number;
  /** Metric key → numeric value for the latest sample. */
  metrics: Record<string, number>;
}

/** In-memory headset record maintained by {@link Hub}. */
export interface HeadsetRecord {
  /** Hub-assigned headset id (e.g. ``headset-1``). */
  id: string;
  /** Opaque client id sent to the headset on ``hello``. */
  clientId: string;
  /** Live WebSocket for this headset. */
  ws: WebSocket;
  /** Optional human-readable device label from registration. */
  deviceLabel?: string;
  /** Whether the headset is actively streaming video. */
  streaming: boolean;
  /** Unix seconds when streaming started, or null when idle. */
  streamingSince: number | null;
  /** Latest metrics per cadence name. */
  metricsByCadence: Record<string, CadenceMetrics>;
  /** Rolling chart series per cadence and metric key. */
  metricSeries: Record<string, Record<string, MetricSeries>>;
  /** Wall-clock ms when the headset registered. */
  connectedAt: number;
}

/** JSON-safe headset view included in hub snapshots and operator events. */
export interface HeadsetSnapshot {
  /** Hub-assigned headset id. */
  id: string;
  /** Opaque client id. */
  clientId: string;
  /** Always ``true`` while present in a snapshot. */
  connected: true;
  /** Device label or null when unset. */
  deviceLabel: string | null;
  /** Whether the headset is actively streaming. */
  streaming: boolean;
  /** Streaming start time in ms, or null when idle. */
  streamingSince: number | null;
  /** Registration time in ms. */
  connectedAt: number;
  /** Latest metrics per cadence name. */
  metricsByCadence: Record<string, CadenceMetrics>;
  /** Rolling chart series per cadence and metric key. */
  metricSeries: Record<string, Record<string, MetricSeries>>;
  /** Most recent metrics timestamp across cadences, or null. */
  lastMetricsAt: number | null;
}

/** Full hub state sent to operators on connect and via REST. */
export interface HubSnapshot {
  /** Snapshot generation time in ms. */
  updatedAt: number;
  /** Monotonic config revision; increments on global config changes. */
  configVersion: number;
  /** Current stream configuration. */
  config: StreamConfig;
  /** Connected headset snapshots. */
  headsets: HeadsetSnapshot[];
  /** Listen mode for ws/wss and operator-page mismatch checks. */
  connectivity: HubConnectivityMeta;
}

/** Result of merging a partial {@link StreamConfig}. */
export type MergeOutcome =
  | { changed: false; configVersion: number }
  | { changed: true; configVersion: number; targetCount: number }
  | { error: string; status?: number };

/** Constructor options for {@link Hub}. */
export interface HubOptions {
  /** Directory containing built browser assets (``index.html``, ``bundle.js``). */
  buildDir: string;
  /** Optional shared secret required on register and REST calls. */
  token?: string;
  /** When true, emit verbose debug logs (default false; set ``HUB_DEBUG=1`` to enable). */
  debug?: boolean;
  /** Default CloudXR server IP when env is unset. */
  defaultServerIp?: string;
  /** Default CloudXR signaling port when env is unset. */
  defaultSignalingPort?: number;
  /** When true, the process serves HTTPS/WSS; when false, HTTP/WS only. */
  secure?: boolean;
}

/** Parsed WebSocket JSON envelope from hub clients. */
export interface HubMessage {
  /** Message type discriminator (e.g. ``register``, ``clientMetrics``). */
  type?: string;
  /** Type-specific payload object. */
  payload?: Record<string, unknown>;
}
