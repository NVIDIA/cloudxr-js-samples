/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Stream configuration defaults and query-string parsing for the metrics hub REST API.
 */

import type { StreamConfig } from './types';

/** Options used to seed {@link defaultStreamConfig}. */
export interface DefaultStreamConfigOptions {
  /** Fallback CloudXR server IP. */
  defaultServerIp?: string;
  /** Fallback CloudXR signaling port. */
  defaultSignalingPort?: number;
}

/**
 * Build the hub's initial {@link StreamConfig} from options and environment defaults.
 * @param options Optional overrides for server IP and signaling port.
 * @returns Default stream configuration pushed to headsets on hello.
 */
export function defaultStreamConfig(options: DefaultStreamConfigOptions): StreamConfig {
  return {
    serverIP: options.defaultServerIp ?? '127.0.0.1',
    port: options.defaultSignalingPort ?? 49100,
  };
}

/**
 * Parse partial stream config keys from URL search params (``GET /api/oob/v1/config``).
 * @param searchParams Query string from the incoming HTTP request.
 * @returns Parsed partial config, or an object with an ``error`` message on validation failure.
 */
export function streamConfigFromQuery(searchParams: URLSearchParams) {
  const cfg: Partial<StreamConfig> = {};

  // serverIP — optional string override
  const serverIP = searchParams.get('serverIP');
  if (serverIP !== null) cfg.serverIP = serverIP;

  // port — optional integer, validated to 1–65535
  const port = searchParams.get('port');
  if (port !== null && port !== '') {
    const n = Number(port);
    if (!Number.isInteger(n)) return { error: 'port must be an integer' as const };
    if (n < 1 || n > 65535) return { error: 'port out of range (1–65535)' as const };
    cfg.port = n;
  }

  // panelHiddenAtStart — boolean-like tokens
  if (searchParams.has('panelHiddenAtStart')) {
    const s = (searchParams.get('panelHiddenAtStart') ?? '').trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(s)) cfg.panelHiddenAtStart = true;
    else if (['0', 'false', 'no', 'off'].includes(s)) cfg.panelHiddenAtStart = false;
    else return { error: 'panelHiddenAtStart must be true or false' as const };
  }

  // codec — optional non-empty string
  const codec = searchParams.get('codec');
  if (codec !== null && codec !== '') cfg.codec = codec;

  return { config: cfg };
}

/**
 * Deep equality check for stream configs (JSON serialization).
 * @param a First config.
 * @param b Second config.
 * @returns True when serialized configs match.
 */
export function configsEqual(a: StreamConfig, b: StreamConfig) {
  return JSON.stringify(a) === JSON.stringify(b);
}
