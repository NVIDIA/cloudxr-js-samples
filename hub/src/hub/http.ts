/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * HTTP(S) server for the metrics hub: REST API, CORS, and static files from ``build/``.
 */

import { readFile, realpath } from 'node:fs/promises';
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse,
} from 'node:http';
import { createServer as createHttpsServer, type Server as HttpsServer } from 'node:https';
import { extname, resolve, sep } from 'node:path';

import { streamConfigFromQuery } from './config';
import {
  corsHeadersForRequest,
  parseExtraCorsOrigins,
  respondToApiCorsPreflight,
  writeJsonApiResponse,
} from './cors';
import type { Hub } from './Hub';
import { loadOrCreateDevTlsCredentials } from './tls';

/** WebSocket upgrade path shared with CloudXR metrics hub clients. */
export const WS_PATH = '/oob/v1/ws';

/** Neutral base for parsing request URLs (path/query only; avoids hard-coding ``http://``). */
const REQUEST_URL_BASE = 'https://localhost';

/** MIME types for static assets served from {@link Hub.options.buildDir}. */
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
};

/** HTTP or HTTPS server returned by {@link createHubServer}. */
export type HubListenServer = HttpServer | HttpsServer;

/** Options for {@link createHubServer}. */
export interface HubServerOptions {
  /**
   * When true (default), listen with HTTPS/WSS using dev TLS credentials.
   * Set false for plaintext HTTP/WS (``--http`` / ``HUB_HTTP=1``).
   */
  tls?: boolean;
  /** Directory for cached self-signed PEM files when {@link HubServerOptions.tls} is true. */
  tlsCertDir?: string;
}

/**
 * Parse the request URL path and query without embedding an insecure protocol in source.
 * @param req Incoming HTTP(S) request.
 */
export function parseRequestUrl(req: IncomingMessage): URL {
  return new URL(req.url ?? '/', REQUEST_URL_BASE);
}

/**
 * True when the path should receive restricted CORS handling.
 * @param pathname URL pathname.
 * @returns True for ``/api/…`` hub REST routes.
 */
function isApiPath(pathname: string) {
  return pathname.startsWith('/api/');
}

/**
 * Extract control token from header or query string.
 * @param url Request URL (may include ``?token=``).
 * @param headers Incoming request headers.
 * @returns Token string when present.
 */
function tokenFromRequest(url: URL, headers: IncomingMessage['headers']) {
  const h = headers['x-control-token'];

  // Prefer header token; fall back to ?token= for bookmarkable REST URLs.
  if (h) return Array.isArray(h) ? h[0] : h;

  return url.searchParams.get('token') || undefined;
}

/**
 * Write a JSON HTTP response with optional CORS headers for API routes.
 * @param res Node HTTP response.
 * @param status HTTP status code.
 * @param body Serializable response body.
 * @param corsHeaders CORS headers from {@link corsHeadersForRequest}.
 */
function jsonResponse(
  res: ServerResponse,
  status: number,
  body: unknown,
  corsHeaders: Record<string, string>
) {
  writeJsonApiResponse(res, status, body, corsHeaders);
}

/**
 * Read and parse a JSON request body for hub REST POST routes.
 * @param req Incoming HTTP request.
 * @returns Parsed JSON value, null when the body is empty or invalid, or
 *   {@link JSON_BODY_TOO_LARGE} when the body exceeds {@link MAX_JSON_BODY_BYTES}.
 */
const MAX_JSON_BODY_BYTES = 256 * 1024;
const JSON_BODY_TOO_LARGE = Symbol('JSON_BODY_TOO_LARGE');

async function readJsonBody(
  req: IncomingMessage
): Promise<unknown | null | typeof JSON_BODY_TOO_LARGE> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  // Accumulate the full request body before parsing.
  for await (const chunk of req) {
    const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
    totalBytes += buf.length;
    if (totalBytes > MAX_JSON_BODY_BYTES) return JSON_BODY_TOO_LARGE;
    chunks.push(buf);
  }
  const text = Buffer.concat(chunks).toString('utf8').trim();
  // Empty body is treated as an empty object for optional-field POST routes.
  if (!text) {
    return {};
  }
  try {
    return JSON.parse(text);
  } catch {
    // Malformed JSON — caller returns 400.
    return null;
  }
}

/**
 * Serve one file from the hub build directory with path traversal protection.
 * @param hub Hub instance (provides {@link Hub.options.buildDir}).
 * @param res HTTP response to write.
 * @param urlPath URL pathname (e.g. ``/bundle.js``).
 * @returns True when a file was served or access was denied; false when file missing.
 */
async function serveBuildFile(hub: Hub, res: ServerResponse, urlPath: string) {
  const buildRoot = resolve(hub.options.buildDir);
  const rel = urlPath.replace(/^\/+/, '') || 'index.html';
  const filePath = resolve(buildRoot, rel);

  // Reject paths that escape the build root (resolve symlinks to close symlink escape)
  let canonicalPath: string;
  try {
    canonicalPath = await realpath(filePath);
  } catch {
    return false;
  }
  if (canonicalPath !== buildRoot && !canonicalPath.startsWith(buildRoot + sep)) {
    res.writeHead(403);
    res.end('Forbidden');
    return true;
  }

  try {
    const data = await readFile(canonicalPath);
    const ext = extname(filePath);

    // Serve with a MIME map fallback for unknown extensions.
    res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'application/octet-stream' });
    res.end(data);
    return true;
  } catch {
    // Missing file — let the caller fall through to 404.
    return false;
  }
}

/** Handler signature for explicit HTTP routes. */
type RouteHandler = (
  hub: Hub,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  corsHeaders: Record<string, string>
) => Promise<void> | void;

/**
 * Wrap a route handler with optional-token auth (same rules as WebSocket register).
 * @param handler Inner handler invoked when auth succeeds.
 */
function withAuth(handler: RouteHandler): RouteHandler {
  return (hub, req, res, url, corsHeaders) => {
    // Mirror WebSocket register auth for REST config/state routes.
    if (!hub.authOk(tokenFromRequest(url, req.headers))) {
      jsonResponse(res, 401, { error: 'Unauthorized' }, corsHeaders);
      return;
    }
    return handler(hub, req, res, url, corsHeaders);
  };
}

/** Explicit route table keyed by ``METHOD pathname``. */
const routes: Record<string, RouteHandler> = {
  'GET /api/oob/v1/state': withAuth((hub, _req, res, _url, corsHeaders) => {
    jsonResponse(res, 200, hub.snapshot(), corsHeaders);
  }),

  'GET /api/oob/v1/config': withAuth(async (hub, _req, res, url, corsHeaders) => {
    const parsed = streamConfigFromQuery(url.searchParams);

    if ('error' in parsed) {
      jsonResponse(res, 400, { error: parsed.error }, corsHeaders);
      return;
    }

    // Require at least one config key so accidental empty GETs do not no-op silently.
    if (Object.keys(parsed.config).length === 0) {
      jsonResponse(res, 400, { error: 'No config keys in query' }, corsHeaders);
      return;
    }

    const targetClientId = url.searchParams.get('targetClientId') || undefined;
    const outcome = hub.mergeStreamConfig(parsed.config, targetClientId);

    if ('error' in outcome) {
      jsonResponse(res, outcome.status ?? 404, { error: outcome.error }, corsHeaders);
      return;
    }

    // Echo merge outcome so REST callers know whether headsets were updated.
    jsonResponse(
      res,
      200,
      {
        ok: true,
        changed: outcome.changed,
        configVersion: outcome.configVersion,
        ...('targetCount' in outcome && { targetCount: outcome.targetCount }),
      },
      corsHeaders
    );
  }),

  'POST /api/oob/v1/connectivity-report': async (hub, req, res, _url, corsHeaders) => {
    const body = await readJsonBody(req);
    if (body === JSON_BODY_TOO_LARGE) {
      jsonResponse(res, 413, { error: 'Request body too large' }, corsHeaders);
      return;
    }
    if (body === null || typeof body !== 'object') {
      jsonResponse(res, 400, { error: 'Invalid JSON body' }, corsHeaders);
      return;
    }
    const record = body as Record<string, unknown>;
    const attemptedHubWsUrl =
      typeof record.attemptedHubWsUrl === 'string' ? record.attemptedHubWsUrl : '';
    if (!attemptedHubWsUrl) {
      jsonResponse(res, 400, { error: 'attemptedHubWsUrl is required' }, corsHeaders);
      return;
    }
    // Host header identifies where this hub process is reachable (for Server IP mismatch checks).
    const hostHeader = req.headers.host;
    const authority = typeof hostHeader === 'string' ? hostHeader : hostHeader?.[0];
    let hubHost = '127.0.0.1';
    if (authority) {
      try {
        hubHost = new URL(`http://${authority}`).hostname;
      } catch {
        hubHost = '127.0.0.1';
      }
    }
    const issues = hub.processConnectivityReport(
      {
        attemptedHubWsUrl,
        signalingServerIp:
          typeof record.signalingServerIp === 'string' ? record.signalingServerIp : undefined,
        closeCode: typeof record.closeCode === 'number' ? record.closeCode : undefined,
        closeReason: typeof record.closeReason === 'string' ? record.closeReason : undefined,
      },
      hubHost
    );
    // Return parsed issues for headset-side logging; operators receive connectivityAlert separately.
    jsonResponse(res, 200, { ok: true, issues }, corsHeaders);
  },

  'GET /': async (hub, _req, res) => {
    // Hub UI entry — serve built index.html from the hub build directory.
    if (await serveBuildFile(hub, res, 'index.html')) return;

    res.writeHead(500);
    res.end('Hub page missing — run npm run build');
  },

  'GET /index.html': async (hub, _req, res) => {
    // Explicit index route mirrors GET / for bookmarked URLs.
    if (await serveBuildFile(hub, res, 'index.html')) return;

    res.writeHead(500);
    res.end('Hub page missing — run npm run build');
  },
};

/**
 * Create the hub HTTP(S) server (does not call ``listen``).
 * HTTPS/WSS is the default; pass ``{ tls: false }`` for plaintext HTTP/WS.
 * @param hub Shared hub state instance.
 * @param options Transport options.
 */
export async function createHubServer(
  hub: Hub,
  options: HubServerOptions = {}
): Promise<HubListenServer> {
  const extraOrigins = parseExtraCorsOrigins(process.env.HUB_CORS_ORIGINS);
  const useTls = options.tls !== false;

  const requestListener = async (req: IncomingMessage, res: ServerResponse) => {
    const url = parseRequestUrl(req);
    // CORS applies only to hub REST API routes, not static assets.
    const corsHeaders = isApiPath(url.pathname) ? corsHeadersForRequest(req, extraOrigins) : {};

    // CORS preflight — only for hub API routes and allowed origins (see cors.ts)
    if (req.method === 'OPTIONS') {
      if (isApiPath(url.pathname) && respondToApiCorsPreflight(res, corsHeaders)) {
        return;
      }
      res.writeHead(405);
      res.end('Method Not Allowed');
      return;
    }

    const key = `${req.method ?? 'GET'} ${url.pathname}`;
    const handler = routes[key];

    if (handler) {
      await handler(hub, req, res, url, corsHeaders);
      return;
    }

    // No explicit route — try static files from the hub build directory.
    if (req.method === 'GET' && url.pathname.startsWith('/')) {
      if (await serveBuildFile(hub, res, url.pathname)) return;
    }

    res.writeHead(404);
    res.end('Not found');
  };

  if (!useTls) {
    // Opt-in plaintext HTTP/WS for local dev (`--http` / `HUB_HTTP=1`).
    return createHttpServer(requestListener);
  }

  // Default: HTTPS/WSS with cached self-signed dev credentials.
  const certDir = options.tlsCertDir ?? resolve(hub.options.buildDir, '..', '.dev-certs');
  const credentials = await loadOrCreateDevTlsCredentials(certDir);
  return createHttpsServer(credentials, requestListener);
}

/**
 * @deprecated Use {@link createHubServer}.
 * @param hub Shared hub state instance.
 * @returns HTTP(S) server (not listening until ``listen`` is called).
 */
export async function attachHttp(hub: Hub) {
  return createHubServer(hub);
}
