/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * WebSocket message helpers for the metrics hub JSON protocol.
 */

import type { WebSocket } from 'ws';

/**
 * Send a typed JSON envelope on an open WebSocket.
 * @param ws Target WebSocket.
 * @param type Message type discriminator.
 * @param payload Serializable payload object.
 */
export function send(ws: WebSocket, type: string, payload: unknown) {
  // Drop sends that race with a close or failed upgrade.
  if (ws.readyState !== ws.OPEN) return;

  ws.send(JSON.stringify({ type, payload }));
}

/** Roles accepted for operator-side hub connections (browser UI, tooling). */
export const OPERATOR_ROLES = new Set(['operator', 'hub', 'viewer']);
