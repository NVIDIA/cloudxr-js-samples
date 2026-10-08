/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Metrics hub process bootstrap.
 *
 * Wires HTTP(S) static serving, REST API, and WebSocket upgrade handling, then listens
 * on {@link PORT} (default 8787, override with ``HUB_PORT``).
 *
 * HTTPS/WSS is the default (self-signed dev certificate). Pass ``--http`` or set
 * ``HUB_HTTP=1`` for plaintext HTTP/WS (local dev only).
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createHubServer } from './src/hub/http';
import { Hub } from './src/hub/Hub';
import { attachWebSocket } from './src/hub/websocket';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** TCP port for HTTP(S) and WebSocket (env ``HUB_PORT``, default 8787). */
const PORT = Number(process.env.HUB_PORT ?? 8787);

/** Plaintext HTTP/WS when ``--http`` is passed or ``HUB_HTTP=1``. */
const USE_HTTP =
  process.argv.includes('--http') ||
  process.env.HUB_HTTP === '1' ||
  process.env.HUB_HTTP === 'true';

// Shared hub state for HTTP routes and WebSocket peers.
const hub = new Hub({
  buildDir: join(__dirname, 'build'),
  token: process.env.HUB_TOKEN?.trim() || undefined,
  debug: process.env.HUB_DEBUG === '1',
  secure: !USE_HTTP,
});

// REST/static server and WebSocket upgrade share one listen socket.
const httpServer = await createHubServer(hub, { tls: !USE_HTTP });

attachWebSocket(httpServer, hub);

httpServer.listen(PORT, () => {
  const addr = httpServer.address();

  // Log the bound port (may differ from PORT when the OS assigns ephemeral fallback).
  const boundPort = typeof addr === 'object' && addr ? addr.port : PORT;
  hub.logStartup(boundPort);
});
