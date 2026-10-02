/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Connection context reported when the sample cannot register with the metrics hub.
 */
export interface HeadsetConnectionFailureContext {
  /** Full WebSocket URL attempted by the sample. */
  attemptedHubWsUrl: string;
  /** CloudXR Server IP used to derive the metrics hub host. */
  signalingServerIp?: string;
  /** WebSocket close code when registration failed before ``hello``. */
  closeCode?: number;
  /** WebSocket close reason from the browser or hub. */
  closeReason?: string;
}

/** Parsed fields needed to map a WebSocket URL to candidate REST origins. */
interface ParsedHubWebSocketUrl {
  /** Normalized WebSocket scheme. */
  scheme: 'ws' | 'wss';
  /** Hostname without URL syntax. */
  host: string;
  /** Explicit or scheme-default port. */
  port: string;
}

/**
 * Parse a metrics hub WebSocket URL.
 * @param wsUrl - Full ``ws://`` or ``wss://`` URL.
 * @returns Parsed URL fields, or null for malformed and non-WebSocket URLs.
 */
function parseHubWebSocketUrl(wsUrl: string): ParsedHubWebSocketUrl | null {
  try {
    const url = new URL(wsUrl);

    // Connectivity reports only apply to the hub's WebSocket endpoint.
    if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
      return null;
    }

    return {
      scheme: url.protocol === 'wss:' ? 'wss' : 'ws',
      host: url.hostname,
      port: url.port || (url.protocol === 'wss:' ? '443' : '80'),
    };
  } catch {
    // Invalid URLs cannot produce a safe REST target.
    return null;
  }
}

/**
 * Construct an HTTP(S) origin from parsed metrics hub WebSocket fields.
 * @param parsed - Parsed metrics hub WebSocket URL fields.
 * @param httpScheme - HTTP transport to use for the origin.
 * @returns HTTP(S) origin with normalized host and port syntax.
 */
function hubHttpOriginFromParsedWebSocketUrl(
  parsed: ParsedHubWebSocketUrl,
  httpScheme: 'http' | 'https'
): string {
  // IPv6 literals require brackets when included in an origin.
  const host =
    parsed.host.includes(':') && !parsed.host.startsWith('[') ? `[${parsed.host}]` : parsed.host;

  // Preserve the WebSocket URL's effective port while omitting its scheme default.
  const portSuffix =
    (parsed.scheme === 'wss' && parsed.port === '443') ||
    (parsed.scheme === 'ws' && parsed.port === '80')
      ? ''
      : `:${parsed.port}`;

  return `${httpScheme}://${host}${portSuffix}`;
}

/**
 * Build the HTTP origins to try when reporting a failed metrics hub connection.
 * @param wsUrl - Metrics hub WebSocket URL attempted by the sample.
 * @returns Unique HTTP(S) origins in preferred order.
 */
export function hubHttpOriginsForConnectivityReport(wsUrl: string): string[] {
  // Parse once so both candidate origins use identical host and port fields.
  const parsed = parseHubWebSocketUrl(wsUrl);

  // An invalid WebSocket URL has no safe reporting destination.
  if (!parsed) {
    return [];
  }

  // Derive both candidates through the shared origin assembly path.
  const primaryScheme = parsed.scheme === 'wss' ? 'https' : 'http';
  const primary = hubHttpOriginFromParsedWebSocketUrl(parsed, primaryScheme);

  // Wrong-scheme failures may still reach the hub over the opposite REST transport.
  const alternateScheme = parsed.scheme === 'wss' ? 'http' : 'https';
  const alternate = hubHttpOriginFromParsedWebSocketUrl(parsed, alternateScheme);

  // Avoid duplicate attempts if URL normalization ever produces matching candidates.
  return alternate === primary ? [primary] : [primary, alternate];
}
