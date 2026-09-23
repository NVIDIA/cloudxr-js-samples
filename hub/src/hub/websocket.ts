/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * WebSocket upgrade handling and message routing for the metrics hub.
 */

import { WebSocketServer } from 'ws';

import { bindConnection, connectionRoleLabel } from './Connection';
import { type HubListenServer, parseRequestUrl, WS_PATH } from './http';
import type { Hub } from './Hub';
import { send } from './messages';
import type { HubMessage } from './types';

/**
 * Format peer address for upgrade logs (includes X-Forwarded-For when present).
 * @param request Raw Node HTTP upgrade request.
 * @returns Peer string suitable for hub logs.
 */
function upgradePeer(request: {
  headers: Record<string, string | string[] | undefined>;
  socket: { remoteAddress?: string | null };
}) {
  const fwd = request.headers['x-forwarded-for'];
  const peer = request.socket.remoteAddress ?? '?';
  return fwd ? `${peer} (xff ${fwd})` : peer;
}

/**
 * Attach WebSocket handling to an existing HTTP server.
 * @param httpServer HTTP server that will receive upgrade requests.
 * @param hub Shared hub state instance.
 */
export function attachWebSocket(httpServer: HubListenServer, hub: Hub) {
  const wss = new WebSocketServer({ noServer: true });

  wss.on('connection', (ws, request) => {
    const peer = request.socket?.remoteAddress ?? 'unknown';
    const origin = request.headers.origin ?? '(no Origin)';
    const conn = bindConnection(ws);

    hub.log.info('peer connected %s from %s', conn.id, peer);
    hub.log.debug('ws open', { connId: conn.id, peer, origin });

    ws.on('message', data => {
      // Hub protocol uses UTF-8 text frames only.
      if (typeof data !== 'string' && !(data instanceof Buffer)) return;

      const text = typeof data === 'string' ? data : data.toString('utf8');
      let msg: HubMessage;
      try {
        msg = JSON.parse(text);
      } catch {
        hub.log.debug('invalid JSON', { connId: conn.id, preview: text.slice(0, 120) });
        return;
      }

      hub.log.debug('message', {
        connId: conn.id,
        type: msg.type,
        role: conn.role,
        headsetId: conn.headsetId,
      });

      // First message must be register while role is pending.
      if (conn.role === 'pending') {
        if (msg.type !== 'register') {
          send(ws, 'error', { code: 'BAD_REQUEST', message: 'First message must be register' });
          ws.close(1008, 'Bad Request');
          return;
        }
        hub.register(conn, msg.payload);
        return;
      }

      // Route post-register traffic by role.
      if (conn.role === 'headset') {
        hub.handleHeadsetMessage(conn, msg);
      } else if (conn.role === 'operator') {
        hub.log.debug('ignored post-register message from operator', msg.type);
      }
    });

    ws.on('close', (code, reason) => {
      hub.log.info(
        'peer closed conn=%s role=%s code=%s reason=%s headsets=%d operators=%d',
        conn.id,
        connectionRoleLabel(conn),
        code,
        reason?.toString() || '',
        hub.headsets.size,
        hub.operators.size
      );

      // Tear down registry entries so snapshots stop listing disconnected peers.
      if (conn.role === 'headset') hub.removeHeadset(ws);
      if (conn.role === 'operator') hub.removeOperator(ws);
    });
  });

  httpServer.on('upgrade', (request, socket, head) => {
    const url = parseRequestUrl(request);
    const peer = upgradePeer(request);
    const origin = request.headers.origin ?? '(no Origin)';
    hub.log.info('WS upgrade %s from %s origin=%s', url.pathname, peer, origin);

    // Only accept the metrics hub WebSocket path.
    if (url.pathname !== WS_PATH) {
      hub.log.warn('upgrade rejected wrong path=%s from %s', url.pathname, peer);
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, ws => {
      wss.emit('connection', ws, request);
    });
  });
}
