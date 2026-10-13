/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * WebSocket connection metadata for the metrics hub.
 *
 * Replaces ad-hoc ``ws._hub*`` properties with a typed {@link Connection} wrapper
 * stored in a {@link WeakMap}.
 */

import type { WebSocket } from 'ws';

/** Registration state for a hub WebSocket peer. */
export type ConnectionRole = 'pending' | 'headset' | 'operator';

/** Hub metadata associated with one WebSocket. */
export interface Connection {
  /** Short-lived connection id for log correlation. */
  id: string;
  /** Underlying WebSocket instance. */
  ws: WebSocket;
  /** Role after successful ``register``; ``pending`` until then. */
  role: ConnectionRole;
  /** Hub-assigned headset id when {@link Connection.role} is ``headset``. */
  headsetId?: string;
}

/** Maps live WebSocket instances to {@link Connection} metadata. */
const connections = new WeakMap<WebSocket, Connection>();

/**
 * Create and store {@link Connection} metadata for a newly accepted WebSocket.
 * @param ws Incoming WebSocket from the upgrade handler.
 * @returns New connection record with role ``pending``.
 */
export function bindConnection(ws: WebSocket): Connection {
  const conn: Connection = {
    id: `conn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    ws,
    role: 'pending',
  };

  // WeakMap avoids mutating ws instances and releases metadata when sockets GC.
  connections.set(ws, conn);
  return conn;
}

/**
 * Look up hub metadata for a WebSocket, if bound.
 * @param ws WebSocket to resolve.
 * @returns Connection metadata, or undefined when the socket was never bound.
 */
export function connectionFor(ws: WebSocket): Connection | undefined {
  return connections.get(ws);
}

/**
 * Human-readable role label for log lines.
 * @param conn Connection whose role to describe.
 * @returns Short label such as ``headset headset-1`` or ``operator``.
 */
export function connectionRoleLabel(conn: Connection): string {
  // Include headset id in logs so multi-headset sessions are easy to correlate.
  if (conn.role === 'headset' && conn.headsetId) return `headset ${conn.headsetId}`;
  if (conn.role === 'operator') return 'operator';

  return 'unregistered';
}
