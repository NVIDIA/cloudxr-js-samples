/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * MetricsHubChannel — WebSocket client for a CloudXR metrics hub.
 *
 * Protocol (hub on ``/oob/v1/ws``): register as ``headset``, optional ``clientMetrics`` and
 * ``streamStatus``, receive ``hello`` / ``config``. Any server implementing the same JSON
 * message types can be used.
 *
 * Enable from the page URL with ``oobEnable=1``; hub host comes from the stream server IP — see
 * ``metricsHubUrl.ts`` and ``useMetricsHubChannel``.
 *
 * Metric batching types and buffers live in {@link ./metricsSnapshotBuffers.ts}.
 */

import type { MetricsSnapshot } from './metricsSnapshotBuffers';
import {
  hubHttpOriginsForConnectivityReport,
  type HeadsetConnectionFailureContext,
} from './oobConnectivityDiagnostics';

export {
  METRICS_TIMESTAMP_KEY,
  createMetricsSnapshotBuffers,
  type MetricsCadenceBucket,
  type MetricsSnapshot,
  type MetricsSnapshotBuffers,
} from './metricsSnapshotBuffers';

/** Fields the hub merges into ``config`` on ``hello`` / ``config`` pushes. */
export interface StreamConfig {
  /** CloudXR stream server IP pushed from the operator hub. */
  serverIP?: string;
  /** CloudXR signaling port pushed from the operator hub. */
  port?: number;
  /** When true, hide the connection panel on session start. */
  panelHiddenAtStart?: boolean;
  /** Preferred video codec identifier (hub-specific). */
  codec?: string;
}

/** Options for {@link MetricsHubChannel}. */
export interface MetricsHubChannelOptions {
  /** Full WebSocket URL of the hub, e.g. ws://host:8787/oob/v1/ws */
  url: string;
  /** Sent in the register message when the hub requires a token. */
  token?: string;
  /** Human-readable label in hub snapshots (optional). */
  deviceLabel?: string;
  /** CloudXR Server IP from the sample panel; included in failure reports for hub diagnostics. */
  signalingServerIp?: string;
  /**
   * Called on hello (initial config) and on config push.
   * Apply the config to connection settings before connect when implementing remote config.
   */
  onConfig: (config: StreamConfig, configVersion: number) => void;
  /** Called when the WebSocket connection state changes. */
  onConnectionChange?: (connected: boolean) => void;
  /**
   * Optional: called periodically to get the latest metrics to report.
   * Return null/undefined or an empty object to skip a tick.
   */
  getMetricsSnapshot?: () => MetricsSnapshot | null | undefined;
  /** How often to report metrics (ms). Default: 500. */
  metricsIntervalMs?: number;
}

/** Delay between automatic WebSocket reconnect attempts (ms). */
const RECONNECT_DELAY_MS = 3000;
/** Default cadence at which metrics snapshots are reported to the hub (ms). */
const DEFAULT_METRICS_INTERVAL_MS = 500;

/** WebSocket client for headset role on the metrics hub. */
export class MetricsHubChannel {
  private ws: WebSocket | null = null;
  private disposed = false;
  private metricsTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  // Last value passed to sendStreamStatus; replayed on every (re)connect so
  // the hub stays in sync after a WS drop and so we don't lose an event
  // fired before the WS finished its handshake.
  private lastStreamStatus: boolean | null = null;

  /** True after the hub sends ``hello`` (registration complete). */
  private registeredWithHub = false;

  constructor(private readonly opts: MetricsHubChannelOptions) {}

  /** Open the WebSocket and start the reconnection loop. */
  connect(): void {
    // No-op after dispose; avoids opening sockets on torn-down channels.
    if (this.disposed) return;

    this._openWebSocket();
  }

  /**
   * Forward CloudXR SDK log entries to the hub as a ``clientLogs`` message.
   *
   * Silently dropped when the channel is disposed, the socket is not yet open,
   * or ``entries`` is empty — callers do not need to guard these cases.
   *
   * @param entries Batched log entries from {@link SessionDelegates.onLog}.
   */
  sendLogs(entries: Array<{ timestamp: number; level: number; message: string }>): void {
    // No-op after dispose or before the socket finishes its handshake.
    if (this.disposed || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    // Skip empty batches so the hub is not flooded with no-op payloads.
    if (entries.length === 0) return;

    this.ws.send(JSON.stringify({ type: 'clientLogs', payload: { entries } }));
  }

  /** Forward CloudXR streaming state to the hub; cached so reconnect re-syncs. */
  sendStreamStatus(streaming: boolean): void {
    // Ignore late status updates once the channel has been torn down.
    if (this.disposed) return;

    // Cache latest value so a reconnect can replay it before the next CloudXR status event.
    this.lastStreamStatus = streaming;

    // Status is only sent on the wire when the socket is fully open.
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    this.ws.send(JSON.stringify({ type: 'streamStatus', payload: { streaming } }));
  }

  /** Close the channel permanently. Safe to call multiple times. */
  dispose(): void {
    // Mark disposed first so in-flight handlers and timers bail out cleanly.
    this.disposed = true;

    this._clearTimers();

    if (this.ws) {
      // Prevent the intentional close from scheduling a reconnect.
      this.ws.onclose = null;

      // Close the socket and drop the reference so callers see a disconnected channel.
      this.ws.close();
      this.ws = null;
    }
  }

  /** Create the WebSocket and wire hub protocol handlers. */
  private _openWebSocket(): void {
    // Channel may have been disposed while a reconnect timer was pending.
    if (this.disposed) return;

    let ws: WebSocket;

    // Browser may throw synchronously when the URL is malformed.
    try {
      ws = new WebSocket(this.opts.url);
    } catch (err) {
      // Constructor can throw on invalid URLs; treat like a failed open and retry.
      if (this.disposed) return;

      console.warn('[MetricsHub] WebSocket constructor failed for', this.opts.url, err);

      void this._postConnectivityFailure({
        closeCode: 0,
        closeReason: err instanceof Error ? err.message : 'WebSocket constructor failed',
      });

      this.ws = null;
      this._afterSocketClosed();
      return;
    }

    // Store the live socket so sendStreamStatus and the metrics timer can use it.
    this.ws = ws;

    ws.onopen = () => {
      // Reset until ``hello`` confirms the hub accepted registration.
      this.registeredWithHub = false;

      // First message on the wire: identify as a headset client.
      ws.send(
        JSON.stringify({
          type: 'register',
          payload: {
            role: 'headset',
            ...(this.opts.token ? { token: this.opts.token } : {}),
            ...(this.opts.deviceLabel ? { deviceLabel: this.opts.deviceLabel } : {}),
          },
        })
      );

      // Replay cached streaming state if CloudXR connected before the socket opened.
      if (this.lastStreamStatus !== null) {
        this.sendStreamStatus(this.lastStreamStatus);
      }

      // Notify the app that the hub link is live.
      this.opts.onConnectionChange?.(true);

      this._startMetricsTimer();
    };

    ws.onmessage = ev => {
      // Hub protocol uses JSON text frames only.
      if (typeof ev.data !== 'string') return;

      let msg: { type?: string; payload?: unknown };

      // Malformed frames are ignored; the hub should always send valid JSON.
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }

      this._handleMessage(msg);
    };

    ws.onclose = (ev: CloseEvent) => {
      // Log abnormal closes; 1000 is a normal client/server shutdown.
      if (ev.code !== 1000 && !this.disposed) {
        console.warn(
          `[MetricsHub] WebSocket closed (code=${ev.code}, reason=${ev.reason || '(none)'})`
        );
      }

      if (!this.registeredWithHub && !this.disposed) {
        // Headset never received ``hello`` — POST diagnostics so the operator page can explain why.
        void this._postConnectivityFailure({
          closeCode: ev.code,
          closeReason: ev.reason,
        });
      }

      this.ws = null;

      // Shared close path: notify UI, then reconnect unless terminal or disposed.
      this._afterSocketClosed(ev.code);
    };

    ws.onerror = () => {
      // onclose fires next; reconnect logic lives there
    };
  }

  /** Tear down timers and optionally schedule reconnect after an unexpected close. */
  private _afterSocketClosed(closeCode?: number): void {
    this._clearTimers();

    this.opts.onConnectionChange?.(false);

    // Policy/auth failures are terminal; do not spin on bad tokens or hub config.
    if (closeCode === 1008) {
      console.warn('[MetricsHub] Terminal close (1008 policy/auth); will not reconnect.');
      return;
    }

    // Back off and retry unless the channel was disposed intentionally.
    if (!this.disposed) {
      this.reconnectTimer = setTimeout(() => this._openWebSocket(), RECONNECT_DELAY_MS);
    }
  }

  /** Dispatch inbound hub messages (`hello`, `config`, `error`). */
  private _handleMessage(msg: { type?: string; payload?: unknown }): void {
    // Normalize envelope fields before branching on message type.
    const type = msg.type;
    const payload = (msg.payload ?? {}) as Record<string, unknown>;

    if (type === 'hello' || type === 'config') {
      // `hello` confirms registration; `config` may arrive again on hub-side updates.
      if (type === 'hello') {
        this.registeredWithHub = true;
        console.info('[MetricsHub] Hub hello — headset registered');
      }

      // Config pushes include a monotonic version the client can compare before applying.
      if (payload.config != null && typeof payload.configVersion === 'number') {
        this.opts.onConfig(payload.config as StreamConfig, payload.configVersion as number);
      }
    } else if (type === 'error') {
      console.warn('[MetricsHub] Hub error:', payload);
    } else {
      // Forward-compatible: log unknown types without tearing down the socket.
      console.warn('[MetricsHub] Unexpected message type:', type);
    }
  }

  /** Periodically send batched metrics as ``clientMetrics`` when a snapshot provider is set. */
  private _startMetricsTimer(): void {
    // No snapshot provider means the headset is not forwarding metrics to the hub.
    if (!this.opts.getMetricsSnapshot) return;

    const interval = this.opts.metricsIntervalMs ?? DEFAULT_METRICS_INTERVAL_MS;

    // Poll the snapshot provider on a fixed interval while the socket stays open.
    this.metricsTimer = setInterval(() => {
      // Drop ticks that race with a close or reconnect in progress.
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

      const snapshot = this.opts.getMetricsSnapshot?.();

      // Skip ticks with no new samples so the hub is not flooded with empty payloads.
      if (!snapshot || Object.keys(snapshot).length === 0) return;

      this.ws.send(
        JSON.stringify({
          type: 'clientMetrics',
          payload: snapshot,
        })
      );
    }, interval);
  }

  /** Clear metrics and reconnect timers. */
  private _clearTimers(): void {
    // Stop periodic clientMetrics reports when the socket drops or the channel is disposed.
    if (this.metricsTimer !== null) {
      clearInterval(this.metricsTimer);
      this.metricsTimer = null;
    }

    // Cancel a pending reconnect when the channel is disposed or the socket closes cleanly.
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  /**
   * POST a connectivity failure report to the hub REST API so operators see actionable errors.
   *
   * @param failure WebSocket close metadata when registration never completed.
   */
  private async _postConnectivityFailure(
    failure: Pick<HeadsetConnectionFailureContext, 'closeCode' | 'closeReason'>
  ): Promise<void> {
    const origins = hubHttpOriginsForConnectivityReport(this.opts.url);
    // Hub URL was invalid — cannot derive a REST origin to POST.
    if (origins.length === 0) {
      return;
    }

    const body: HeadsetConnectionFailureContext = {
      attemptedHubWsUrl: this.opts.url,
      ...(this.opts.signalingServerIp ? { signalingServerIp: this.opts.signalingServerIp } : {}),
      ...failure,
    };

    // Try primary then alternate HTTP(S) origin until one accepts the report.
    for (const origin of origins) {
      try {
        const res = await fetch(`${origin}/api/oob/v1/connectivity-report`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          mode: 'cors',
        });
        // First origin that accepts the report is enough; hub broadcasts to operators.
        if (res.ok) {
          return;
        }
      } catch {
        // Try alternate hub HTTP(S) origin when scheme guess was wrong.
      }
    }
  }
}
