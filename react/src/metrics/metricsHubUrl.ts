/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/** WebSocket path for the CloudXR metrics hub. */
export const METRICS_HUB_WS_PATH = '/oob/v1/ws';

/** Query keys that seed stream / WebRTC settings (bookmark-friendly). */
export const STREAM_URL_SEED_KEYS = ['serverIP', 'port', 'codec', 'headless'] as const;

export type StreamUrlSeedKey = (typeof STREAM_URL_SEED_KEYS)[number];

/**
 * True when the page should connect to the CloudXR metrics hub WebSocket.
 * @param searchParams Page URL query string.
 */
export function isMetricsHubEnabled(searchParams: URLSearchParams): boolean {
  const v = searchParams.get('oobEnable');
  return v === '1' || v?.toLowerCase() === 'true';
}

/** @deprecated Use :func:`isMetricsHubEnabled`. */
export const isOobEnabled = isMetricsHubEnabled;

/**
 * Page protocol used to pick ``ws`` vs ``wss`` for the hub.
 *
 * Production code omits this and uses ``window.location``. Browser tests pass a mock
 * because ``window.location`` cannot be redefined in headless Chromium.
 */
export type PageProtocolSource = Pick<Location, 'protocol'>;

const DEFAULT_PAGE_PROTOCOL: PageProtocolSource = { protocol: 'https:' };

/**
 * Resolve the page protocol used for direct-hub WebSocket scheme selection.
 * @param location Test override; production callers omit this.
 * @returns Page protocol source for scheme selection.
 */
function resolvePageProtocol(location?: PageProtocolSource): PageProtocolSource {
  return location ?? (typeof window !== 'undefined' ? window.location : DEFAULT_PAGE_PROTOCOL);
}

/**
 * WebSocket scheme for the CloudXR metrics hub. The hub is reached directly
 * (no proxy), so the scheme matches the page transport to avoid mixed-content
 * blocks: HTTPS page → ``wss``, HTTP page → ``ws``.
 *
 * @param location Optional page protocol for tests (see {@link PageProtocolSource}).
 * @returns ``ws`` or ``wss`` for the hub WebSocket URL.
 */
export function metricsHubWebSocketScheme(location?: PageProtocolSource): 'ws' | 'wss' {
  return resolvePageProtocol(location).protocol === 'https:' ? 'wss' : 'ws';
}

/** Metrics hub default port when ``hubPort`` is omitted from the URL. */
export const LOCAL_METRICS_HUB_PORT = '8787';

/**
 * Build ``{ws|wss}://{hubServerIP}:{hubPort}/oob/v1/ws`` when ``oobEnable=1``.
 *
 * Hub host is the CloudXR **stream** server address (same as signaling), not a
 * separate query param. ``hubPort`` is the metrics hub port (default
 * {@link LOCAL_METRICS_HUB_PORT}) and is distinct from ``port`` (CloudXR
 * signaling); {@link metricsHubWebSocketScheme} picks ``ws``/``wss`` from the
 * page transport.
 *
 * @param searchParams Page URL query string.
 * @param hubServerIP CloudXR stream server host (same as signaling), not a separate query param.
 * @param location Optional page protocol override for tests; defaults to ``window.location``.
 * @returns Hub WebSocket URL, or ``null`` when OOB is disabled or inputs are invalid.
 */
export function buildMetricsHubWsUrl(
  searchParams: URLSearchParams,
  hubServerIP: string,
  location?: PageProtocolSource
): string | null {
  // OOB disabled — no hub WebSocket URL.
  if (!isMetricsHubEnabled(searchParams)) return null;

  const host = hubServerIP.trim();
  if (!host) return null;

  // Direct hub: `hubPort` is the hub port, defaulting to the local metrics port.
  // `port` is left to seed CloudXR signaling and is not used here.
  const portStr = searchParams.get('hubPort')?.trim() || LOCAL_METRICS_HUB_PORT;

  // Reject out-of-range ports.
  if (!/^\d{1,5}$/.test(portStr)) return null;
  const port = parseInt(portStr, 10);
  if (port < 1 || port > 65535) return null;

  // Bracket bare IPv6 literals for URL construction.
  const bracketed = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
  const scheme = metricsHubWebSocketScheme(location);
  return `${scheme}://${bracketed}:${port}${METRICS_HUB_WS_PATH}`;
}

/**
 * Collect stream/WebRTC seed params from the page URL.
 *
 * ``port`` always seeds the CloudXR signaling port. The metrics hub uses its
 * own ``hubPort`` param (see {@link buildMetricsHubWsUrl}), so the two never
 * collide regardless of ``oobEnable``.
 *
 * @param searchParams Page URL query string; defaults to ``window.location.search``.
 * @returns Bookmark-friendly stream/WebRTC seed key/value pairs.
 */
export function parseStreamUrlSeeds(
  searchParams: URLSearchParams = new URLSearchParams(
    typeof window !== 'undefined' ? window.location.search : ''
  )
): Record<string, string> {
  const seeds: Record<string, string> = {};
  for (const key of STREAM_URL_SEED_KEYS) {
    const v = searchParams.get(key);
    if (v !== null) seeds[key] = v;
  }
  return seeds;
}
