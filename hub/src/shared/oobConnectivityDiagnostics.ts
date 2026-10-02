/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * OOB operator-control connectivity diagnostics used by the metrics hub server and browser UI.
 *
 * Pure functions classify common setup mistakes (ws/wss mismatch, wrong Server IP, HTTP vs HTTPS
 * hub page) so the operator UI can show actionable banners instead of a silent zero-headset roster.
 */

/** Machine-readable issue id for hub UI and logs. */
export type ConnectivityIssueCode =
  | 'WS_WSS_MISMATCH_HUB_SECURE'
  | 'WS_WSS_MISMATCH_HUB_PLAINTEXT'
  | 'SIGNALING_IP_NOT_HUB_HOST'
  | 'OPERATOR_PAGE_HUB_MODE_MISMATCH'
  | 'CONNECTION_FAILED';

/** One actionable connectivity problem surfaced on the hub operator page. */
export interface ConnectivityIssue {
  /** Stable id for deduplication and hub UI styling. */
  code: ConnectivityIssueCode;
  /** Visual severity for operator banners. */
  severity: 'error' | 'warning';
  /** Short headline shown in the connectivity alert card. */
  title: string;
  /** Actionable detail text for the operator. */
  message: string;
}

/** Hub listen-mode metadata included in operator snapshots. */
export interface HubConnectivityMeta {
  /** True when the hub process serves HTTPS/WSS (default npm start). */
  listensSecure: boolean;
  /** WebSocket scheme headsets should use for this hub process. */
  webSocketScheme: 'ws' | 'wss';
  /** HTTP scheme for the hub REST API and operator page. */
  httpScheme: 'http' | 'https';
  /** Bound TCP port (included in zero-headset setup hints). */
  listenPort: number;
}

/** Headset-reported context from a connectivity failure POST. */
export interface HeadsetConnectivityContext {
  /** Full WebSocket URL the headset attempted before registration failed. */
  attemptedHubWsUrl: string;
  /** CloudXR Server IP from the sample panel (used to build the hub URL). */
  signalingServerIp?: string;
}

/** Optional close metadata when a headset WebSocket never registers. */
export interface HeadsetConnectionFailureContext extends HeadsetConnectivityContext {
  /** WebSocket close code when registration failed before ``hello``. */
  closeCode?: number;
  /** WebSocket close reason string from the browser or hub. */
  closeReason?: string;
}

/**
 * Normalize loopback hostnames so ``localhost`` and ``127.0.0.1`` compare equal.
 *
 * @param host Hostname from a URL or panel field.
 * @returns Lowercase host, with loopback aliases collapsed to ``127.0.0.1``.
 */
export function normalizeOobHost(host: string): string {
  const trimmed = host.trim().toLowerCase();

  // Collapse common loopback spellings before host equality checks.
  if (trimmed === 'localhost' || trimmed === '[::1]' || trimmed === '::1') {
    return '127.0.0.1';
  }

  // Strip IPv6 bracket notation so ``[::1]`` and ``::1`` normalize the same way.
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed.slice(1, -1).toLowerCase();
  }

  // Non-loopback hosts: return normalized lowercase host as-is.
  return trimmed;
}

/**
 * Parse a hub WebSocket URL into scheme and host parts.
 *
 * @param wsUrl Full ``ws://`` or ``wss://`` URL.
 * @returns Parsed parts, or null when the URL is invalid.
 */
export function parseHubWebSocketUrl(
  wsUrl: string
): { scheme: 'ws' | 'wss'; host: string; port: string } | null {
  try {
    const url = new URL(wsUrl);

    // Reject http(s) and other schemes — diagnostics only apply to hub WebSocket URLs.
    if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
      return null;
    }

    return {
      scheme: url.protocol === 'wss:' ? 'wss' : 'ws',
      host: url.hostname,
      // Default ports when omitted from the URL string.
      port: url.port || (url.protocol === 'wss:' ? '443' : '80'),
    };
  } catch {
    // Malformed URL strings fail closed so callers can surface a single invalid-URL issue.
    return null;
  }
}

/**
 * Construct an HTTP(S) origin from parsed hub WebSocket fields.
 *
 * @param parsed Parsed hub WebSocket URL fields.
 * @param httpScheme HTTP transport to use for the origin.
 * @returns HTTP(S) origin with normalized host and port syntax.
 */
function hubHttpOriginFromParsedWebSocketUrl(
  parsed: { scheme: 'ws' | 'wss'; host: string; port: string },
  httpScheme: 'http' | 'https'
): string {
  // Bracket bare IPv6 literals for valid origin strings.
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
 * Derive the hub HTTP(S) origin used for REST connectivity reports from a WebSocket URL.
 *
 * @param wsUrl Hub WebSocket URL.
 * @returns ``http://host:port`` or ``https://host:port``, or null when invalid.
 */
export function hubHttpOriginFromWebSocketUrl(wsUrl: string): string | null {
  // Parse once before deriving the matching REST transport.
  const parsed = parseHubWebSocketUrl(wsUrl);

  // Invalid WebSocket URL — nothing to POST.
  if (!parsed) {
    return null;
  }

  // Map WebSocket scheme to the matching HTTP(S) origin for REST POST.
  const httpScheme = parsed.scheme === 'wss' ? 'https' : 'http';

  return hubHttpOriginFromParsedWebSocketUrl(parsed, httpScheme);
}

/**
 * HTTP(S) origins to try when POSTing headset connectivity failures.
 *
 * When a client chose the wrong WebSocket scheme, the derived REST origin may not match the
 * running hub process — try both plaintext and TLS origins on the same host/port.
 *
 * @param wsUrl Hub WebSocket URL the headset attempted.
 * @returns Unique origin URLs in try order.
 */
export function hubHttpOriginsForConnectivityReport(wsUrl: string): string[] {
  // Parse once so both candidate origins use identical host and port fields.
  const parsed = parseHubWebSocketUrl(wsUrl);

  // Invalid WebSocket URL — nothing to POST.
  if (!parsed) {
    return [];
  }

  // Derive both candidates through the shared origin assembly path.
  const primaryScheme = parsed.scheme === 'wss' ? 'https' : 'http';
  const primary = hubHttpOriginFromParsedWebSocketUrl(parsed, primaryScheme);

  // Flip HTTP scheme so a ws:// attempt still reaches an https:// hub REST listener.
  const alternateScheme = parsed.scheme === 'wss' ? 'http' : 'https';
  const alternate = hubHttpOriginFromParsedWebSocketUrl(parsed, alternateScheme);

  // Deduplicate when primary and alternate resolve to the same origin string.
  return alternate === primary ? [primary] : [primary, alternate];
}

/**
 * Compare the operator hub page scheme with how the hub process is listening.
 *
 * @param pageProtocol ``window.location.protocol`` (``http:`` or ``https:``).
 * @param hubMeta Hub listen metadata from a snapshot.
 * @returns Issues to show on the hub operator page.
 */
export function analyzeOperatorPageHubMode(
  pageProtocol: string,
  hubMeta: HubConnectivityMeta
): ConnectivityIssue[] {
  const pageHttps = pageProtocol === 'https:';

  // Operator opened https:// but hub only serves plain HTTP/WS (npm run start:http).
  if (pageHttps && !hubMeta.listensSecure) {
    return [
      {
        code: 'OPERATOR_PAGE_HUB_MODE_MISMATCH',
        severity: 'error',
        title: 'Hub page uses HTTPS but the hub is HTTP/WS only',
        message:
          'You opened the hub UI over HTTPS, but this hub was started with npm run start:http (plain WS). ' +
          'Open http://127.0.0.1:' +
          hubMeta.listenPort +
          '/ instead, or restart the hub without --http.',
      },
    ];
  }

  // Operator opened http:// but hub expects TLS/WSS (default npm start).
  if (!pageHttps && hubMeta.listensSecure) {
    return [
      {
        code: 'OPERATOR_PAGE_HUB_MODE_MISMATCH',
        severity: 'error',
        title: 'Hub page uses HTTP but the hub is HTTPS/WSS only',
        message:
          'You opened the hub UI over HTTP, but this hub uses TLS (default npm start). ' +
          'Open https://127.0.0.1:' +
          hubMeta.listenPort +
          '/ and accept the dev certificate, or restart with npm run start:http for a plain HTTP sample.',
      },
    ];
  }

  // No http/https vs hub listen-mode mismatch — operator page matches this hub process.
  return [];
}

/**
 * Analyze a headset's attempted hub WebSocket URL against hub listen mode and panel IP.
 *
 * @param hubMeta How this hub process is listening.
 * @param context Headset-reported URL and CloudXR Server IP.
 * @param hubOperatorHost Host shown in the hub operator "Hub host" field (where this hub runs).
 * @param failure Optional WebSocket close metadata when registration never completed.
 * @returns Actionable issues to broadcast to operators.
 */
export function analyzeHeadsetHubConnectivity(
  hubMeta: HubConnectivityMeta,
  context: HeadsetConnectivityContext,
  hubOperatorHost: string,
  failure?: Pick<HeadsetConnectionFailureContext, 'closeCode' | 'closeReason'>
): ConnectivityIssue[] {
  const issues: ConnectivityIssue[] = [];
  const parsed = parseHubWebSocketUrl(context.attemptedHubWsUrl);

  // Cannot classify mismatches when the headset URL is not a valid ws/wss URL.
  if (!parsed) {
    issues.push({
      code: 'CONNECTION_FAILED',
      severity: 'error',
      title: 'Invalid hub WebSocket URL on headset',
      message: `The sample built an invalid hub URL: ${context.attemptedHubWsUrl}`,
    });
    return issues;
  }

  // Scheme must match how this hub process is listening.
  if (hubMeta.listensSecure && parsed.scheme === 'ws') {
    issues.push({
      code: 'WS_WSS_MISMATCH_HUB_SECURE',
      severity: 'error',
      title: 'Sample used ws:// but this hub requires wss://',
      message:
        `Headset tried ${context.attemptedHubWsUrl}. This hub listens for WSS (default npm start). ` +
        'Use the HTTPS sample (wss) or run the hub with npm run start:http and open the hub UI over http://.',
    });
  } else if (!hubMeta.listensSecure && parsed.scheme === 'wss') {
    issues.push({
      code: 'WS_WSS_MISMATCH_HUB_PLAINTEXT',
      severity: 'error',
      title: 'Sample used wss:// but this hub is HTTP/WS only',
      message:
        `Headset tried ${context.attemptedHubWsUrl}. This hub was started with npm run start:http. ` +
        'Use the HTTP sample (?oobEnable=1) so the client dials ws://, or restart the hub without --http.',
    });
  }

  // Hub URL host comes from CloudXR Server IP; compare against where this hub actually runs.
  const attemptedHost = normalizeOobHost(parsed.host);
  const hubHost = normalizeOobHost(hubOperatorHost);
  const signalingHost = context.signalingServerIp
    ? normalizeOobHost(context.signalingServerIp)
    : '';

  if (signalingHost && attemptedHost !== hubHost) {
    issues.push({
      code: 'SIGNALING_IP_NOT_HUB_HOST',
      severity: 'error',
      title: 'CloudXR Server IP does not match this hub host',
      message:
        `The sample uses CloudXR Server IP "${context.signalingServerIp}" for the hub WebSocket, so it dials ` +
        `${context.attemptedHubWsUrl}. This hub is on "${hubOperatorHost}" (port ${hubMeta.listenPort}). ` +
        `Set CloudXR Server IP to ${hubOperatorHost} or add serverIP=${hubOperatorHost} to the sample URL.`,
    });
  }

  // No specific mismatch — fall back to raw WebSocket close metadata from the headset POST.
  if (failure && issues.length === 0) {
    const code = failure.closeCode ?? 0;
    const reason = failure.closeReason?.trim() || '(none)';
    issues.push({
      code: 'CONNECTION_FAILED',
      severity: 'error',
      title: 'Headset could not register with this hub',
      message:
        `WebSocket closed (code=${code}, reason=${reason}) before headset registration. ` +
        `Attempted ${context.attemptedHubWsUrl}. ` +
        'Confirm oobEnable=1, hubPort matches this hub, and CloudXR Server IP matches Hub host.',
    });
  }

  return issues;
}
