/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Restricted CORS for hub REST API routes (local dev and explicit allowlist only).
 */

import type { IncomingMessage, ServerResponse } from 'node:http';

/** Headers clients may send on cross-origin hub API requests. */
const ALLOWED_REQUEST_HEADERS = 'X-Control-Token';

/** Methods exposed on hub REST routes. */
const ALLOWED_METHODS = 'GET, POST, OPTIONS';

/** Header names set by {@link corsHeadersForRequest} (restricted allowlist; never ``*``). */
const CORS_RESPONSE_HEADER_NAMES = [
  'Access-Control-Allow-Origin',
  'Access-Control-Allow-Methods',
  'Access-Control-Allow-Headers',
  'Vary',
] as const;

/**
 * Parse optional extra allowed origins from ``HUB_CORS_ORIGINS`` (comma-separated full origins).
 * Accepts any HTTPS origin, or loopback HTTP for local dev.
 * @param envValue Raw environment variable value.
 */
export function parseExtraCorsOrigins(envValue: string | undefined): Set<string> {
  const extra = new Set<string>();
  if (!envValue) return extra;
  // Split comma-separated origins and store normalized values for exact Set lookup at request time.
  for (const part of envValue.split(',')) {
    const normalized = normalizeConfiguredCorsOrigin(part.trim());
    if (normalized) extra.add(normalized);
  }
  return extra;
}

/**
 * True for localhost / loopback hostnames used during local development.
 * @param hostname Parsed URL hostname.
 */
function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === 'localhost') return true;
  // Full 127.0.0.0/8 range (e.g. 127.0.0.2), not only 127.0.0.1.
  const match = /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  return match !== null && match.slice(1).every(octet => Number(octet) <= 255);
}

/**
 * Validate and normalize one configured origin from ``HUB_CORS_ORIGINS``.
 * @param origin Full origin string.
 */
function normalizeConfiguredCorsOrigin(origin: string): string | null {
  if (!origin) return null;
  try {
    const url = new URL(origin);
    // Origins must be host-only; reject path/query/hash so Set keys match request Origin headers.
    if (url.pathname !== '/' || url.search || url.hash) return null;
    if (url.protocol === 'https:') return url.origin;
    // Loopback HTTP is allowed for local dev only.
    if (url.protocol === 'http:' && isLoopbackHost(url.hostname)) return url.origin;
    return null;
  } catch {
    return null;
  }
}

/**
 * True when the origin is safe to reflect for local hub API access.
 * @param origin Request ``Origin`` header value.
 * @param extraOrigins Additional origins from {@link parseExtraCorsOrigins}.
 */
export function isAllowedCorsOrigin(origin: string, extraOrigins: ReadonlySet<string>): boolean {
  try {
    const url = new URL(origin);
    // Explicit allowlist from HUB_CORS_ORIGINS (stored as normalized url.origin).
    if (extraOrigins.has(url.origin)) return true;
    // Default: loopback hosts only, still requiring http: or https:.
    if (!isLoopbackHost(url.hostname)) {
      return false;
    }
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * CORS response headers for a hub API request, or an empty object when CORS must not apply.
 *
 * Safe for this hub because:
 * - CORS is applied only to read-only GET/OPTIONS on `/api/oob/v1/*` (see `http.ts`).
 * - Origins are never wildcarded; we reflect a single validated Origin or send no CORS headers.
 * - Loopback HTTP is allowed only for local dev; extra HTTPS origins require `HUB_CORS_ORIGINS`.
 * - API routes still require the optional hub control token when `HUB_TOKEN` is set.
 *
 * @param req Incoming HTTP request.
 * @param extraOrigins Additional allowed origins.
 */
export function corsHeadersForRequest(
  req: IncomingMessage,
  extraOrigins: ReadonlySet<string>
): Record<string, string> {
  const origin = req.headers.origin;
  // Same-origin or non-browser callers: no CORS headers.
  if (!origin || typeof origin !== 'string') return {};
  if (!isAllowedCorsOrigin(origin, extraOrigins)) return {};
  // Reflect the validated Origin (never ``*``).
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': ALLOWED_METHODS,
    'Access-Control-Allow-Headers': ALLOWED_REQUEST_HEADERS,
    Vary: 'Origin',
  };
}

/**
 * Respond to a CORS preflight for an allowed hub API origin.
 * @param res HTTP response.
 * @param corsHeaders Headers from {@link corsHeadersForRequest}.
 * @returns True when a 204 preflight response was sent.
 */
export function respondToApiCorsPreflight(
  res: ServerResponse,
  corsHeaders: Record<string, string>
): boolean {
  if (Object.keys(corsHeaders).length === 0) return false;
  res.writeHead(204, pickCorsResponseHeaders(corsHeaders));
  res.end();
  return true;
}

/**
 * Write a JSON hub API response, attaching validated CORS headers when present.
 * @param res HTTP response.
 * @param status HTTP status code.
 * @param body Serializable JSON body.
 * @param corsHeaders Headers from {@link corsHeadersForRequest}.
 */
export function writeJsonApiResponse(
  res: ServerResponse,
  status: number,
  body: unknown,
  corsHeaders: Record<string, string>
) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    ...pickCorsResponseHeaders(corsHeaders),
  });
  res.end(JSON.stringify(body));
}

/**
 * Copy only the CORS headers produced by this module onto an HTTP response.
 * @param corsHeaders Headers from {@link corsHeadersForRequest}.
 */
function pickCorsResponseHeaders(corsHeaders: Record<string, string>): Record<string, string> {
  const picked: Record<string, string> = {};

  for (const name of CORS_RESPONSE_HEADER_NAMES) {
    const value = corsHeaders[name];
    if (value) picked[name] = value;
  }
  return picked;
}
