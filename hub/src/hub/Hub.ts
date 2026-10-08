/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Core metrics hub state: headset registry, operator fan-out, and stream config.
 */

import { randomUUID } from 'node:crypto';

import type { WebSocket } from 'ws';

import { applyClientMetrics, latestMetricsAt } from '../shared/metrics';
import {
  analyzeHeadsetHubConnectivity,
  type HeadsetConnectionFailureContext,
} from '../shared/oobConnectivityDiagnostics.ts';

import { configsEqual, defaultStreamConfig } from './config';
import type { Connection } from './Connection';
import { createLogger, type HubLogger } from './log';
import { OPERATOR_ROLES, send } from './messages';
import type {
  HeadsetRecord,
  HeadsetSnapshot,
  HubConnectivityMeta,
  HubMessage,
  HubOptions,
  HubSnapshot,
  MergeOutcome,
  StreamConfig,
} from './types';

/**
 * In-memory metrics hub coordinating headsets and operator clients.
 */
export class Hub {
  /** Structured logger for this process. */
  readonly log: HubLogger;

  /** Connected headsets keyed by hub-assigned id. */
  readonly headsets = new Map<string, HeadsetRecord>();

  /** WebSockets registered as operator / viewer roles. */
  readonly operators = new Set<WebSocket>();

  /** Current stream configuration broadcast to headsets. */
  streamConfig: StreamConfig;

  /** Monotonic revision incremented on global config changes. */
  configVersion = 0;

  /** Bootstrap options (build dir, token, defaults). */
  readonly options: HubOptions;

  /** Optional shared secret; empty string disables auth. */
  private readonly token: string;

  /** Counter for generating sequential headset ids. */
  private nextHeadsetId = 1;

  /** Bound TCP port (set in {@link logStartup}). */
  listenPort = 8787;

  /**
   * Create a hub instance with default stream config from options and environment.
   * @param options Hub bootstrap options.
   */
  constructor(options: HubOptions) {
    this.options = options;
    this.log = createLogger(options.debug ?? false);
    this.token = options.token ?? '';

    const envPort = parseInt(process.env.HUB_DEFAULT_PORT ?? '', 10);

    // Seed stream defaults from constructor options, then HUB_DEFAULT_* env overrides.
    this.streamConfig = defaultStreamConfig({
      defaultServerIp: options.defaultServerIp ?? process.env.HUB_DEFAULT_SERVER_IP,
      defaultSignalingPort: Number.isFinite(envPort) ? envPort : options.defaultSignalingPort,
    });
  }

  /**
   * Validate an optional control token from register or REST requests.
   * @param token Token from client payload or header.
   * @returns True when auth is disabled or the token matches {@link Hub.token}.
   */
  authOk(token: unknown) {
    // Empty token disables auth so local dev hubs work without HUB_TOKEN.
    if (!this.token) return true;

    return typeof token === 'string' && token === this.token;
  }

  /**
   * Fan out a typed message to all connected operators.
   * @param type Message type discriminator.
   * @param payload Serializable payload.
   */
  broadcastOperators(type: string, payload: unknown) {
    this.log.debug(
      `broadcast ${type} → ${this.operators.size} operator(s), headsets=${this.headsets.size}`
    );

    // Fan out independently — one slow operator must not block others.
    for (const ws of this.operators) send(ws, type, payload);
  }

  /**
   * Build a full hub snapshot for REST and operator ``snapshot`` messages.
   * @returns JSON-safe hub state for operators and REST ``/state``.
   */
  snapshot(): HubSnapshot {
    return {
      updatedAt: Date.now(),
      configVersion: this.configVersion,
      config: { ...this.streamConfig },
      headsets: this.headsetSnapshots(),
      connectivity: this.connectivityMeta(),
    };
  }

  /**
   * Describe how this hub process expects clients to connect (ws/wss, port).
   * @returns Metadata for operator UI mismatch checks.
   */
  connectivityMeta(): HubConnectivityMeta {
    // Default hub start uses TLS; --http / start:http sets secure: false.
    const listensSecure = this.options.secure !== false;
    return {
      listensSecure,
      webSocketScheme: listensSecure ? 'wss' : 'ws',
      httpScheme: listensSecure ? 'https' : 'http',
      listenPort: this.listenPort,
    };
  }

  /**
   * Analyze a headset connectivity report and fan issues out to operators.
   * @param report Headset-reported URL and optional close metadata.
   * @param hubHost Hostname clients used to reach this hub (HTTP Host header).
   * @returns Parsed issues (also broadcast when non-empty).
   */
  processConnectivityReport(
    report: HeadsetConnectionFailureContext,
    hubHost: string
  ): ReturnType<typeof analyzeHeadsetHubConnectivity> {
    const issues = analyzeHeadsetHubConnectivity(
      this.connectivityMeta(),
      {
        attemptedHubWsUrl: report.attemptedHubWsUrl,
        signalingServerIp: report.signalingServerIp,
      },
      hubHost || '127.0.0.1',
      report
    );
    // Fan out to every connected operator so the sidebar shows actionable banners.
    if (issues.length > 0) {
      this.broadcastOperators('connectivityAlert', {
        issues,
        receivedAt: Date.now(),
      });
    }
    return issues;
  }

  /**
   * JSON-safe snapshots for all connected headsets.
   * @returns One snapshot per live headset record.
   */
  headsetSnapshots(): HeadsetSnapshot[] {
    return [...this.headsets.values()].map(h => this.toSnapshot(h));
  }

  /**
   * Convert an internal headset record to a public snapshot shape.
   * @param h Live headset record.
   */
  private toSnapshot(h: HeadsetRecord): HeadsetSnapshot {
    return {
      id: h.id,
      clientId: h.clientId,
      connected: true,
      deviceLabel: h.deviceLabel ?? null,
      streaming: h.streaming,
      streamingSince: h.streamingSince !== null ? Math.round(h.streamingSince * 1000) : null,
      connectedAt: h.connectedAt,
      metricsByCadence: h.metricsByCadence,
      metricSeries: h.metricSeries,
      lastMetricsAt: latestMetricsAt(h.metricsByCadence),
    };
  }

  /**
   * Merge partial stream config and push updates to headsets.
   * @param newConfig Partial config from REST query params.
   * @param targetClientId When set, push only to the matching headset client id.
   * @returns Merge outcome (changed flag, version, or error).
   */
  mergeStreamConfig(newConfig: Partial<StreamConfig>, targetClientId?: string): MergeOutcome {
    const merged = { ...this.streamConfig, ...newConfig };

    // No-op when nothing changed
    if (configsEqual(merged, this.streamConfig)) {
      return { changed: false, configVersion: this.configVersion };
    }

    // Targeted update — do not bump global configVersion
    if (targetClientId) {
      const targets = [...this.headsets.values()].filter(h => h.clientId === targetClientId);
      if (targets.length === 0) {
        return { error: `Headset '${targetClientId}' not connected`, status: 404 };
      }
      this.pushConfigToHeadsets(targets, this.configVersion, merged);
      return { changed: true, configVersion: this.configVersion, targetCount: targets.length };
    }

    // Global update — persist, bump version, notify all headsets
    this.streamConfig = merged;
    this.configVersion += 1;
    this.pushConfigToHeadsets([...this.headsets.values()], this.configVersion, this.streamConfig);
    return { changed: true, configVersion: this.configVersion, targetCount: this.headsets.size };
  }

  /**
   * Send ``config`` messages to one or more headsets.
   * @param targets Headset records to update.
   * @param version Config revision to include.
   * @param config Stream settings payload.
   */
  private pushConfigToHeadsets(targets: HeadsetRecord[], version: number, config: StreamConfig) {
    const payload = { configVersion: version, config };

    // Push the same revision to each targeted headset WebSocket.
    for (const h of targets) send(h.ws, 'config', payload);
  }

  /**
   * Handle the first ``register`` message on a WebSocket.
   * @param conn Connection metadata for the peer.
   * @param payload Register payload (role, token, deviceLabel, …).
   */
  register(conn: Connection, payload: Record<string, unknown> | undefined) {
    const role = payload?.role;
    const token = payload?.token;

    // Reject peers with a missing or wrong control token
    if (!this.authOk(token)) {
      this.log.warn('register rejected (bad token) role=%s conn=%s', role, conn.id);
      send(conn.ws, 'error', { code: 'UNAUTHORIZED', message: 'Invalid or missing control token' });
      conn.ws.close(1008, 'Unauthorized');
      return;
    }

    this.log.info('register role=%s conn=%s', role, conn.id);

    // Promote connection by role — headset vs operator/viewer tooling.
    if (role === 'headset') {
      this.registerHeadset(conn, payload ?? {});
      return;
    }

    if (typeof role === 'string' && OPERATOR_ROLES.has(role)) {
      this.registerOperator(conn);
      return;
    }

    // Unknown role — close with policy violation
    this.log.warn('register rejected unknown role=%s conn=%s', role, conn.id);
    send(conn.ws, 'error', { code: 'BAD_REQUEST', message: `Unknown role: ${role}` });
    conn.ws.close(1008, 'Bad Request');
  }

  /**
   * Register a CloudXR headset peer and notify operators.
   * @param conn Connection being promoted to headset role.
   * @param payload Register payload (optional ``deviceLabel``).
   */
  private registerHeadset(conn: Connection, payload: Record<string, unknown>) {
    const id = `headset-${this.nextHeadsetId++}`;
    const clientId = randomUUID();

    // Persist live headset state before hello so operators can query immediately.
    const record: HeadsetRecord = {
      id,
      clientId,
      ws: conn.ws,
      deviceLabel: typeof payload.deviceLabel === 'string' ? payload.deviceLabel : undefined,
      streaming: false,
      streamingSince: null,
      metricsByCadence: {},
      metricSeries: {},
      connectedAt: Date.now(),
    };

    this.headsets.set(id, record);
    conn.role = 'headset';
    conn.headsetId = id;

    // Send hello with client id and current config
    send(conn.ws, 'hello', {
      clientId,
      configVersion: this.configVersion,
      config: { ...this.streamConfig },
    });

    this.log.info(
      'headset online id=%s clientId=%s label=%s operators=%d headsets=%d',
      id,
      clientId,
      record.deviceLabel ?? '(none)',
      this.operators.size,
      this.headsets.size
    );

    this.broadcastOperators('headsetConnected', {
      headset: {
        id: record.id,
        clientId: record.clientId,
        deviceLabel: record.deviceLabel ?? null,
        streaming: record.streaming,
        connectedAt: record.connectedAt,
        metricsByCadence: record.metricsByCadence,
      },
      headsets: this.headsetSnapshots(),
    });
  }

  /**
   * Register a browser operator and send an initial snapshot.
   * @param conn Connection being promoted to operator role.
   */
  private registerOperator(conn: Connection) {
    this.operators.add(conn.ws);
    conn.role = 'operator';
    this.log.info(
      'operator registered conn=%s headsets=%d operators=%d',
      conn.id,
      this.headsets.size,
      this.operators.size
    );

    // Send full snapshot immediately so the UI can render connected headsets.
    send(conn.ws, 'snapshot', this.snapshot());
  }

  /**
   * Remove a headset when its WebSocket closes.
   * @param ws WebSocket belonging to the disconnected headset.
   */
  removeHeadset(ws: WebSocket) {
    const entry = [...this.headsets.entries()].find(([, h]) => h.ws === ws);
    if (!entry) return;
    const [id, record] = entry;

    this.log.info('headset offline id=%s clientId=%s', id, record.clientId);

    // Drop registry entry before notifying operators so snapshots stay consistent.
    this.headsets.delete(id);

    this.broadcastOperators('headsetDisconnected', {
      id,
      clientId: record.clientId,
      headsets: this.headsetSnapshots(),
    });
  }

  /**
   * Remove an operator when its WebSocket closes.
   * @param ws Operator WebSocket.
   */
  removeOperator(ws: WebSocket) {
    // Set delete is idempotent — safe if close races with duplicate events.
    this.operators.delete(ws);
  }

  /**
   * Handle post-register messages from a headset connection.
   * @param conn Headset connection metadata.
   * @param msg Parsed JSON envelope.
   */
  handleHeadsetMessage(conn: Connection, msg: HubMessage) {
    const id = conn.headsetId;
    if (!id) return;
    const record = this.headsets.get(id);
    if (!record) return;

    const { type, payload = {} } = msg;

    // Streaming flag toggles — track start time for operator UI duration hints.
    if (type === 'streamStatus') {
      const streaming = payload.streaming === true;
      // Track streaming start time in seconds for internal storage
      if (streaming && !record.streaming) record.streamingSince = Date.now() / 1000;
      else if (!streaming) record.streamingSince = null;
      record.streaming = streaming;
      this.broadcastOperators('streamStatus', {
        headsetId: id,
        clientId: record.clientId,
        deviceLabel: record.deviceLabel ?? null,
        streaming: record.streaming,
        streamingSince: record.streamingSince ? Math.round(record.streamingSince * 1000) : null,
        receivedAt: Date.now(),
      });
      return;
    }

    // Batched or Teleop metrics — merge into rolling series then fan out to operators.
    if (type === 'clientMetrics') {
      // Ignore unknown payload shapes so a bad headset build cannot corrupt operator state.
      if (!applyClientMetrics(record.metricsByCadence, record.metricSeries, payload)) return;

      this.broadcastOperators('clientMetrics', {
        headsetId: id,
        clientId: record.clientId,
        deviceLabel: record.deviceLabel ?? null,
        receivedAt: latestMetricsAt(record.metricsByCadence) ?? Date.now(),
        metricsByCadence: record.metricsByCadence,
        metricSeries: record.metricSeries,
        metrics: record.metricsByCadence,
      });
      return;
    }

    // SDK log entries forwarded from the headset to the operator UI.
    if (type === 'clientLogs') {
      const MAX_LOG_BATCH = 500;
      const raw = Array.isArray(payload.entries) ? payload.entries : [];
      // Validate each entry and cap the batch to prevent oversized fan-outs.
      const entries = raw
        .slice(0, MAX_LOG_BATCH)
        .filter(
          (e): e is { level: number; message: string; timestamp: number } =>
            e !== null &&
            typeof e === 'object' &&
            typeof (e as Record<string, unknown>).level === 'number' &&
            typeof (e as Record<string, unknown>).message === 'string' &&
            typeof (e as Record<string, unknown>).timestamp === 'number'
        );
      if (entries.length === 0) return;

      this.broadcastOperators('headsetLogs', {
        headsetId: id,
        clientId: record.clientId,
        deviceLabel: record.deviceLabel ?? null,
        receivedAt: Date.now(),
        entries,
      });
    }
  }

  /**
   * Log startup URLs and environment hints after the HTTP server listens.
   * @param port Bound TCP port.
   */
  logStartup(port: number) {
    const host = '127.0.0.1';
    const secure = this.options.secure !== false;

    // Expose bound port in operator snapshots for zero-headset setup hints.
    this.listenPort = port;

    this.log.info(
      `listening on *:${port} (all interfaces, ${secure ? 'HTTPS' : 'plaintext HTTP'})`
    );

    if (secure) {
      this.log.info(`https://${host}:${port}/`);
      this.log.info(`WebSocket wss://${host}:${port}/oob/v1/ws`);
      this.log.info(`State API https://${host}:${port}/api/oob/v1/state`);
      this.log.info(
        'Using a self-signed dev certificate — accept the browser warning once for the hub page and API'
      );
    } else {
      this.log.info(`Hub UI at ${host}:${port}/ (--http plaintext mode)`);
      this.log.info(`WebSocket endpoint ${host}:${port}/oob/v1/ws (plaintext)`);
      this.log.info(`State API ${host}:${port}/api/oob/v1/state (plaintext)`);
      this.log.warn(
        'Plaintext mode (--http) — for local dev only; use the default HTTPS hub with HTTPS clients'
      );
    }

    this.log.info(
      `Sample client: ?oobEnable=1&hubPort=${port} — set CloudXR Server IP to the hub host`
    );
    if (this.token) {
      this.log.info('HUB_TOKEN is set — clients must pass controlToken on register');
    }
    if (this.options.debug) {
      this.log.info('Debug logging on (set HUB_DEBUG=0 to disable)');
    }
  }
}
