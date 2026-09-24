/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * CloudXR.js Metrics Hub — browser operator UI.
 *
 * Connects to the local hub WebSocket as ``role=operator``, receives headset snapshots
 * and live ``clientMetrics``, and renders rolling uPlot time-series charts.
 *
 * Key flow:
 * 1. Parse URL params (host, port, controlToken, autoconnect)
 * 2. ``connect()`` — open WebSocket and send ``register``
 * 3. ``handleMessage()`` — apply snapshot / headset / metrics events
 * 4. ``renderMetrics()`` — align series and update uPlot charts
 */

import uPlot from 'uplot';

import 'uplot/dist/uPlot.min.css';
import './hub.css';

import { HeadsetLogPanel, type RawLogEntry } from './headsetLogPanel';
import {
  METRICS_TIMESTAMP_KEY,
  applyClientMetrics,
  importMetricSeries,
  appendBatchedSeries,
  latestFromBatch,
  type MetricSeries,
} from './shared/metrics';
import {
  analyzeOperatorPageHubMode,
  type ConnectivityIssue,
  type HubConnectivityMeta,
} from './shared/oobConnectivityDiagnostics.ts';

/** Display metadata for known metric keys (aligned with {@link CloudXR.MetricsName}). */
const METRIC_META: Record<string, { label: string; unit: string; decimals: number }> = {
  /** CloudXR.MetricsName.RenderFramerate */
  'render.framerate': { label: 'Render FPS', unit: 'fps', decimals: 1 },
  /** CloudXR.MetricsName.RenderPoseToRenderTime */
  'render.pose_to_render_time': { label: 'Pose → render', unit: 'ms', decimals: 1 },
  /** CloudXR.MetricsName.StreamingFramerate */
  'streaming.framerate': { label: 'Stream FPS', unit: 'fps', decimals: 1 },
  /** CloudXR.MetricsName.StreamingFrameCount */
  'streaming.frame_count': { label: 'Stream frames', unit: 'frames', decimals: 0 },
  /** CloudXR.MetricsName.LatencyPoseUploadMs */
  'latency.pose_upload_ms': { label: 'Pose upload', unit: 'ms', decimals: 1 },
  /** CloudXR.MetricsName.LatencyPoseToFrameReceivedMs */
  'latency.pose_to_frame_received_ms': { label: 'Pose → frame', unit: 'ms', decimals: 1 },
  /** CloudXR.MetricsName.LatencyXrPoseAgeMs */
  'latency.xr_pose_age_ms': { label: 'XR pose age', unit: 'ms', decimals: 1 },
  /** CloudXR.MetricsName.NetworkStreamingRateMbps */
  'network.streaming_rate_mbps': { label: 'Stream rate', unit: 'Mbps', decimals: 1 },
  /** CloudXR.MetricsName.NetworkAvailableBandwidthMbps */
  'network.available_bandwidth_mbps': { label: 'Bandwidth', unit: 'Mbps', decimals: 1 },
  /** CloudXR.MetricsName.NetworkRttMs */
  'network.rtt_ms': { label: 'RTT', unit: 'ms', decimals: 1 },
  /** CloudXR.MetricsName.NetworkPacketLoss */
  'network.packet_loss': { label: 'Packet loss', unit: 'count', decimals: 0 },
  /** CloudXR.MetricsName.NetworkAvgDecodeTimeMs */
  'network.avg_decode_time_ms': { label: 'Decode time', unit: 'ms', decimals: 1 },
  /** CloudXR.MetricsName.NetworkQualityScore */
  'network.quality_score': { label: 'Quality score', unit: 'score', decimals: 0 },
  /** CloudXR.MetricsName.NetworkBandwidthScore */
  'network.bandwidth_score': { label: 'Bandwidth score', unit: 'score', decimals: 0 },
  /** CloudXR.MetricsName.NetworkLossScore */
  'network.network_loss_score': { label: 'Loss score', unit: 'score', decimals: 0 },
  /** CloudXR.MetricsName.NetworkLatencyScore */
  'network.latency_score': { label: 'Latency score', unit: 'score', decimals: 0 },
  /** CloudXR.MetricsName.FramePipelineCompositorSkippedPercent */
  'frame_pipeline.compositor_skipped_percent': {
    label: 'Compositor skipped',
    unit: '%',
    decimals: 1,
  },
  /** CloudXR.MetricsName.FramePipelineOutOfOrderPercent */
  'frame_pipeline.out_of_order_percent': {
    label: 'Out-of-order frames',
    unit: '%',
    decimals: 1,
  },
  /** CloudXR.MetricsName.FramePipelineMismatchedPercent */
  'frame_pipeline.mismatched_percent': { label: 'Mismatched frames', unit: '%', decimals: 1 },
  [METRICS_TIMESTAMP_KEY]: { label: 't', unit: 's', decimals: 3 },
};

/** Metric groups for the plot picker UI. */
const METRIC_GROUPS: Array<{ id: string; label: string; keys: string[] }> = [
  {
    id: 'render',
    label: 'Render',
    keys: ['render.framerate', 'render.pose_to_render_time'],
  },
  {
    id: 'streaming',
    label: 'Streaming',
    keys: [
      'streaming.framerate',
      'streaming.frame_count',
      'frame_pipeline.compositor_skipped_percent',
      'frame_pipeline.out_of_order_percent',
      'frame_pipeline.mismatched_percent',
    ],
  },
  {
    id: 'latency',
    label: 'Latency',
    keys: ['latency.pose_upload_ms', 'latency.pose_to_frame_received_ms', 'latency.xr_pose_age_ms'],
  },
  {
    id: 'network',
    label: 'Network',
    keys: [
      'network.streaming_rate_mbps',
      'network.available_bandwidth_mbps',
      'network.rtt_ms',
      'network.packet_loss',
      'network.avg_decode_time_ms',
      'network.quality_score',
      'network.bandwidth_score',
      'network.network_loss_score',
      'network.latency_score',
    ],
  },
];

/** All plot metric keys flattened from {@link METRIC_GROUPS}, in group order. */
const ALL_PLOT_METRIC_KEYS = METRIC_GROUPS.flatMap(g => g.keys);

/** Metric keys enabled in charts on first load when localStorage has no prior selection. */
const DEFAULT_SELECTED_METRICS = [
  'render.framerate',
  'streaming.framerate',
  'render.pose_to_render_time',
  'latency.pose_to_frame_received_ms',
  'network.rtt_ms',
  'network.streaming_rate_mbps',
];

/** localStorage key that persists the operator's plot-picker selection across page loads. */
const METRIC_SELECTION_STORAGE_KEY = 'cloudxr-hub-selected-metrics';

/** uPlot series stroke colors (NVIDIA green first). */
const SERIES_COLORS = ['#76b900', '#4fc3f7', '#f0a020', '#e879f9', '#f87171', '#38bdf8'];

/**
 * Resolve a required ``input`` element by id.
 * @param id DOM element id.
 * @returns The matching input element.
 */
function requireInput(id: string): HTMLInputElement {
  const el = document.getElementById(id);

  // Fail fast when index.html is missing a required form control.
  if (!(el instanceof HTMLInputElement)) throw new Error(`Missing #${id}`);

  return el;
}

/**
 * Resolve a required ``button`` element by id.
 * @param id DOM element id.
 * @returns The matching button element.
 */
function requireButton(id: string): HTMLButtonElement {
  const el = document.getElementById(id);

  // Fail fast when index.html is missing a required control.
  if (!(el instanceof HTMLButtonElement)) throw new Error(`Missing #${id}`);

  return el;
}

/**
 * Resolve a required HTMLElement by id.
 * @param id DOM element id.
 * @returns The matching element cast to the expected subtype.
 */
function requireEl<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);

  // Fail fast when index.html is missing a required shell node.
  if (!el) throw new Error(`Missing #${id}`);

  return el as T;
}

/** Cached references to shell elements from ``index.html``. */
const els = {
  host: requireInput('host'),
  port: requireInput('port'),
  token: requireInput('token'),
  connectBtn: requireButton('connectBtn'),
  statusBox: requireEl<HTMLDivElement>('statusMessageBox'),
  wsStatus: requireEl<HTMLSpanElement>('wsStatus'),
  connectivityAlerts: requireEl<HTMLDivElement>('connectivityAlerts'),
  headsets: requireEl<HTMLDivElement>('headsets'),
  metricsRoot: requireEl<HTMLDivElement>('metricsRoot'),
  metricPicker: requireEl<HTMLDivElement>('metricPicker'),
  log: requireEl<HTMLDivElement>('log'),
  headsetLogPanel: requireEl<HTMLDivElement>('headsetLogPanel'),
};

/** Page URL query params (host, port, debug, autoconnect). */
const params = new URLSearchParams(window.location.search);

/** When ``?debug=1``, mirror log lines to the browser console. */
const HUB_PAGE_DEBUG = params.get('debug') === '1';

/**
 * Verbose console logging gated by {@link HUB_PAGE_DEBUG}.
 * @param args Values to log.
 */
function hubPageDebug(...args: unknown[]) {
  // Avoid console noise unless the operator explicitly opts in via ?debug=1.
  if (HUB_PAGE_DEBUG) console.info('[HubPage]', ...args);
}

// Seed connection form from URL params
els.host.value = params.get('host') ?? window.location.hostname ?? '';
els.port.value = params.get('port') ?? (window.location.port || '8787');
els.token.value = params.get('controlToken') ?? '';

/**
 * Shared headset log panel instance — injects its own toolbar and log div
 * into the container element from ``index.html``.
 */
const logPanel = new HeadsetLogPanel(els.headsetLogPanel, { defaultInfoEnabled: true });

/** Hub listen metadata from the latest operator snapshot. */
let hubConnectivityMeta: HubConnectivityMeta | null = null;

/** Dedupe connectivity banners by code+message. */
const shownConnectivityKeys = new Set<string>();

/**
 * Render connectivity issues in the sidebar alert stack.
 * @param issues Diagnostics to show.
 * @param replace When true, replace existing alerts; otherwise append new ones.
 */
function renderConnectivityIssues(issues: ConnectivityIssue[], replace = false): void {
  const container = els.connectivityAlerts;

  // Snapshot-driven hints replace the stack; headset POST alerts append without clearing page-mode hints.
  if (replace) {
    container.replaceChildren();
    // Reset dedup set so headsets retrying the same mismatch after a snapshot refresh are shown again.
    shownConnectivityKeys.clear();
  }

  const toShow = replace
    ? issues
    : issues.filter(issue => {
        const key = `${issue.code}:${issue.message}`;
        // Suppress duplicate headset failure reports in the activity log and sidebar.
        if (shownConnectivityKeys.has(key)) {
          return false;
        }
        shownConnectivityKeys.add(key);
        return true;
      });

  if (toShow.length === 0 && replace) {
    container.hidden = true;
    return;
  }

  if (toShow.length === 0) {
    return;
  }

  for (const issue of toShow) {
    if (replace) {
      shownConnectivityKeys.add(`${issue.code}:${issue.message}`);
    }

    const card = document.createElement('div');
    card.className =
      issue.severity === 'warning'
        ? 'connectivity-alert connectivity-alert--warning'
        : 'connectivity-alert';
    card.innerHTML = `<strong>${escapeHtml(issue.title)}</strong>${escapeHtml(issue.message)}`;
    container.appendChild(card);
    logLine(`Connectivity: ${issue.title} — ${issue.message}`, 'error');
  }

  container.hidden = false;
}

/**
 * Build operator-side hints when the roster is empty but the hub is otherwise healthy.
 * @param meta Hub listen metadata from the latest snapshot.
 */
function buildZeroHeadsetHints(meta: HubConnectivityMeta): ConnectivityIssue[] {
  const hubHost = els.host.value.trim() || window.location.hostname || '127.0.0.1';
  // Flag http/https page vs hub listen mode before the generic waiting hint.
  const pageIssues = analyzeOperatorPageHubMode(window.location.protocol, meta);
  const waiting: ConnectivityIssue = {
    code: 'CONNECTION_FAILED',
    severity: 'warning',
    title: 'No headset registered with this hub',
    message:
      `Open the React sample with ?oobEnable=1&hubPort=${meta.listenPort} and set CloudXR Server IP to ${hubHost} ` +
      `(hub uses the stream server; expects ${meta.webSocketScheme}://<server-ip>:${meta.listenPort}/oob/v1/ws).`,
  };
  return [...pageIssues, waiting];
}

/** Client-side state for one connected headset. */
interface HeadsetState {
  /** Hub-assigned headset id. */
  id: string;
  /** Opaque client id from hub, or null before first event. */
  clientId: string | null;
  /** Human-readable device label, when provided. */
  deviceLabel: string | null;
  /** Streaming flag; null until first ``streamStatus``. */
  streaming: boolean | null;
  /** Latest scalar metrics per cadence. */
  metricsByCadence: Record<string, { at: number; metrics: Record<string, number> }>;
  /** Rolling chart series per cadence and metric key. */
  metricSeries: Record<string, Record<string, MetricSeries>>;
  /** Most recent metrics timestamp in ms. */
  lastMetricsAt: number | null;
}

/** Live uPlot chart instance and DOM wrappers for one headset panel. */
interface ChartEntry {
  /** uPlot instance. */
  u: uPlot;
  /** Panel wrapper element (legend + plot). */
  wrap: HTMLElement;
  /** Observes plot width for responsive resize. */
  resizeObserver: ResizeObserver;
  /** Joined metric keys — used to detect series set changes. */
  signature: string;
  /** Ordered metric keys displayed in this chart. */
  metricKeys: string[];
}

/** Active operator WebSocket, or null when disconnected. */
let ws: WebSocket | null = null;

/** Headset id → client state for the sidebar and charts. */
const headsetState = new Map<string, HeadsetState>();

/** Maximum log lines retained in the activity panel. */
const maxLogLines = 80;

/** Headset id → live chart entry. */
const charts = new Map<string, ChartEntry>();

/** Metrics currently shown in charts (display filter only; does not affect ingestion). */
let selectedMetrics = loadSelectedMetrics();

/**
 * Load selected metric keys from localStorage, falling back to defaults.
 * @returns Metric keys enabled in the plot picker.
 */
function loadSelectedMetrics(): Set<string> {
  try {
    // Read the operator's last picker selection from persistent storage.
    const raw = localStorage.getItem(METRIC_SELECTION_STORAGE_KEY);

    if (raw) {
      // Deserialize — corrupted JSON or unexpected shapes fall through to defaults.
      const parsed = JSON.parse(raw) as unknown;

      // Accept only string keys that match known plot metrics.
      if (Array.isArray(parsed)) {
        // Strip unknown keys introduced by SDK version changes so stale entries don't persist.
        const keys = parsed.filter(k => typeof k === 'string' && ALL_PLOT_METRIC_KEYS.includes(k));

        // Only restore if at least one valid key survived filtering.
        if (keys.length > 0) return new Set(keys);
      }
    }
  } catch {
    // Corrupt storage must not block the operator UI — fall through to defaults.
  }

  // Fresh session or unrecoverable storage: start with the curated default set.
  return new Set(DEFAULT_SELECTED_METRICS);
}

/**
 * Persist {@link selectedMetrics} to localStorage.
 */
function saveSelectedMetrics() {
  // Stable sort keeps diff-friendly storage and predictable picker order on reload.
  try {
    localStorage.setItem(METRIC_SELECTION_STORAGE_KEY, JSON.stringify([...selectedMetrics].sort()));
  } catch {
    // Persistence is optional; keep the UI responsive when storage is unavailable (privacy mode / quota).
  }
}

/**
 * True when a metric key is enabled in the plot picker.
 * @param key Metric identifier.
 * @returns Whether the key is included in the display filter.
 */
function isMetricSelected(key: string) {
  // Delegate to the current display filter set (mutated by picker toggle and bulk actions).
  return selectedMetrics.has(key);
}

/**
 * Update the "N shown" count span to reflect the current {@link selectedMetrics} size.
 */
function updatePickerCount() {
  // Cheap text-only update — no DOM rebuild needed.
  const countEl = els.metricPicker.querySelector<HTMLElement>('.metric-picker-count');
  if (countEl) countEl.textContent = `${selectedMetrics.size} shown`;
}

/**
 * Sync all picker checkbox `checked` states to {@link selectedMetrics} and refresh the count.
 * Used by bulk-action buttons so they can update the existing DOM without a full rebuild.
 */
function syncPickerCheckboxes() {
  // Walk existing inputs and flip their checked state without touching event listeners.
  els.metricPicker.querySelectorAll<HTMLInputElement>('input[data-metric-key]').forEach(input => {
    input.checked = selectedMetrics.has(input.dataset.metricKey!);
  });

  // Refresh the count badge to reflect the new selection size.
  updatePickerCount();
}

/**
 * Build the metric picker DOM once; subsequent selection changes use
 * {@link updatePickerCount} or {@link syncPickerCheckboxes} to avoid O(n) churn.
 */
function renderMetricPicker() {
  // Full rebuild only runs once (or after a hard reset). Listeners are registered here
  // and never re-registered on subsequent selection changes.
  els.metricPicker.innerHTML = `
    <div class="metric-picker-toolbar">
      <button type="button" data-action="select-default">Defaults</button>
      <button type="button" data-action="select-all">All</button>
      <button type="button" data-action="select-none">None</button>
      <span class="muted metric-picker-count">${selectedMetrics.size} shown</span>
    </div>
    <div class="metric-picker-groups"></div>
  `;

  // Resolve the groups container injected by the innerHTML template above.
  const groupsRoot = els.metricPicker.querySelector('.metric-picker-groups')!;

  // One checkbox per known metric, grouped for operator scanning.
  for (const group of METRIC_GROUPS) {
    // Build a labelled section div for this metric group.
    const groupEl = document.createElement('div');
    groupEl.className = 'metric-picker-group';
    groupEl.innerHTML = `<h4>${escapeHtml(group.label)}</h4>`;

    for (const key of group.keys) {
      const meta = metricMeta(key);

      // Create a label+checkbox row for this metric key.
      const label = document.createElement('label');
      label.className = 'metric-picker-option';
      label.innerHTML = `
        <input type="checkbox" data-metric-key="${escapeHtml(key)}" />
        <span>${escapeHtml(meta.label)} <span class="metric-picker-unit">(${escapeHtml(meta.unit || key)})</span></span>
      `;

      // Grab the input element injected by innerHTML so initial state and the listener can be set.
      const input = label.querySelector('input') as HTMLInputElement;

      // Reflect the current selection — checked when this key is in the display filter.
      input.checked = selectedMetrics.has(key);

      // Persist selection and refresh charts; update only the count span, not the whole picker.
      input.addEventListener('change', () => {
        // Toggle this key in the display filter set based on the new checkbox state.
        if (input.checked) selectedMetrics.add(key);
        else selectedMetrics.delete(key);

        // Write the updated selection to localStorage for the next page load.
        saveSelectedMetrics();

        // Update only the count badge — a full DOM rebuild would re-register all listeners.
        updatePickerCount();

        // Redraw charts to reflect the changed display filter.
        renderMetrics();
      });

      // Attach the completed row to its group section.
      groupEl.appendChild(label);
    }

    // Attach the complete group section to the picker container.
    groupsRoot.appendChild(groupEl);
  }

  // Bulk actions reset the display filter only — incoming metrics are unchanged.
  els.metricPicker
    .querySelector('[data-action="select-default"]')
    ?.addEventListener('click', () => {
      selectedMetrics = new Set(DEFAULT_SELECTED_METRICS);
      saveSelectedMetrics();
      syncPickerCheckboxes();
      renderMetrics();
    });
  els.metricPicker.querySelector('[data-action="select-all"]')?.addEventListener('click', () => {
    selectedMetrics = new Set(ALL_PLOT_METRIC_KEYS);
    saveSelectedMetrics();
    syncPickerCheckboxes();
    renderMetrics();
  });
  els.metricPicker.querySelector('[data-action="select-none"]')?.addEventListener('click', () => {
    selectedMetrics.clear();
    saveSelectedMetrics();
    syncPickerCheckboxes();
    renderMetrics();
  });
}

/**
 * Build the hub WebSocket URL from form fields.
 * Supports IPv6 host bracket notation and ws/wss from page protocol.
 * @returns WebSocket URL for ``/oob/v1/ws``.
 */
function hubWsUrl() {
  const host = els.host.value.trim() || window.location.hostname;
  const port = els.port.value.trim() || '8787';

  // Bracket bare IPv6 literals so ``host:port`` parsing stays unambiguous.
  const bracketed = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;

  // Match page scheme so mixed-content rules allow WSS when the hub page is HTTPS.
  const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';

  return `${scheme}://${bracketed}:${port}/oob/v1/ws`;
}

/**
 * Log a hint when the snapshot reports zero headsets (event log only; banners use {@link buildZeroHeadsetHints}).
 */
function logEmptyHeadsetHint() {
  const hubHost = els.host.value.trim() || window.location.hostname;
  const hubPort = els.port.value.trim() || '8787';

  // Event-log fallback when snapshot metadata is not yet available.
  logLine(
    '0 headsets — open the sample client with oobEnable=1&hubPort=' +
      hubPort +
      ' and set CloudXR Server IP to ' +
      hubHost +
      ' (the hub uses the stream server)',
    'warn'
  );
}

/**
 * Append one line to the activity log panel.
 * @param text Message text.
 * @param level Visual severity (debug lines also go to console when debug=1).
 */
function logLine(text: string, level: 'info' | 'warn' | 'error' | 'debug' = 'info') {
  // Mirror debug traffic to the console without cluttering the on-page log.
  if (level === 'debug') hubPageDebug(text);

  const line = document.createElement('div');
  line.className = `log-line log-${level}`;
  const ts = new Date().toLocaleTimeString();
  line.textContent = `[${ts}] ${text}`;

  // Newest events appear at the top of the activity panel.
  els.log.prepend(line);

  // Cap DOM nodes so long sessions stay responsive.
  while (els.log.children.length > maxLogLines) {
    els.log.lastChild?.remove();
  }
}

/**
 * Update connection status banner and connect button label.
 * @param connected True when the WebSocket is open.
 */
function setWsStatus(connected: boolean) {
  els.wsStatus.textContent = connected ? 'Connected' : 'Disconnected';

  // CSS classes drive the green/red status banner styling.
  els.statusBox.classList.toggle('status-on', connected);
  els.statusBox.classList.toggle('status-off', !connected);

  // Single button toggles connect vs disconnect based on socket state.
  els.connectBtn.textContent = connected ? 'DISCONNECT' : 'CONNECT';
}

/**
 * Escape HTML special characters for safe insertion into templates.
 * @param s Raw string or value coerced to string.
 * @returns HTML-safe string for text nodes and attribute values.
 */
function escapeHtml(s: unknown) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Resolve display metadata for a metric key.
 * @param key Metric identifier (falls back to a shortened key name).
 * @returns Label, unit, and decimal precision for charts and picker.
 */
function metricMeta(key: string) {
  return (
    METRIC_META[key] ?? {
      label: key.replace(/^(render|streaming|latency|network)\./, ''),
      unit: key.startsWith('network.') && key.endsWith('_score') ? 'score' : '',
      decimals: 2,
    }
  );
}

/**
 * Map metric unit to uPlot scale id (ms on a secondary axis when mixed with rates/scores).
 * @param unit Unit string from {@link metricMeta}.
 * @returns uPlot scale key for the series.
 */
function yScaleForUnit(unit: string) {
  return unit === 'ms' ? 'y2' : 'y';
}

/**
 * Summarize units on the primary (left) y-axis.
 * @param metricKeys Metric keys assigned to the primary scale.
 * @returns Short axis label, or empty when units are heterogeneous.
 */
function primaryAxisLabel(metricKeys: string[]) {
  const units = new Set(metricKeys.map(k => metricMeta(k).unit).filter(Boolean));

  // Single-unit charts get a concise axis title.
  if (units.size === 1) {
    const [only] = [...units];
    if (only === 'fps') return 'FPS';
    if (only === 'Mbps') return 'Mbps';
    if (only === 'score') return 'score';
    if (only === 'count') return 'count';
    if (only === 'frames') return 'frames';
  }

  // Combined rate charts need a composite label when units differ on one axis.
  if (units.has('fps') && units.has('Mbps')) return 'FPS / Mbps';
  if (units.has('score')) return 'score / rate';

  return '';
}

/**
 * Map headset id to chart map key (one combined chart per headset).
 * @param headsetId Hub headset id.
 * @returns Chart registry key.
 */
function chartKey(headsetId: string) {
  return headsetId;
}

/**
 * Tear down one chart and remove its DOM nodes.
 * @param key Chart map key ({@link chartKey}).
 */
function destroyChart(key: string) {
  const chart = charts.get(key);

  if (!chart) return;

  // Release observers and uPlot resources before removing DOM.
  chart.resizeObserver.disconnect();
  chart.u.destroy();
  chart.wrap.remove();
  charts.delete(key);
}

/**
 * Destroy all live charts (e.g. on snapshot reset).
 */
function destroyAllCharts() {
  // Copy keys first — destroyChart mutates the map during iteration.
  for (const key of [...charts.keys()]) {
    destroyChart(key);
  }
}

/**
 * Merge metrics from a hub event into headset client state.
 * @param headset Target headset state (mutated in place).
 * @param info Event payload fragment (metricSeries, metricsByCadence, …).
 */
function mergeMetricSeries(headset: HeadsetState, info: Record<string, unknown>) {
  // Rolling chart buffers arrive as nested cadence → metric series maps.
  if (info.metricSeries && typeof info.metricSeries === 'object') {
    importMetricSeries(
      headset.metricSeries,
      info.metricSeries as Record<string, Record<string, MetricSeries>>
    );
  }

  const byCadence = info.metricsByCadence ?? info.lastMetrics ?? info.metrics;

  if (byCadence && typeof byCadence === 'object' && !Array.isArray(byCadence)) {
    const receivedAt = (info.lastMetricsAt as number | undefined) ?? Date.now();

    for (const [cadence, entry] of Object.entries(byCadence as Record<string, unknown>)) {
      if (!entry || typeof entry !== 'object') continue;
      const bucket = entry as Record<string, unknown>;

      // Pre-merged cadence entry with scalar metrics
      if (bucket.metrics && typeof bucket.metrics === 'object') {
        headset.metricsByCadence[cadence] = {
          at: typeof bucket.at === 'number' ? bucket.at : receivedAt,
          metrics: bucket.metrics as Record<string, number>,
        };
        continue;
      }

      // Raw batched bucket — append to series and derive latest scalars
      appendBatchedSeries(headset.metricSeries, cadence, bucket, receivedAt);
      const { metrics, at } = latestFromBatch(bucket);
      if (Object.keys(metrics).length) headset.metricsByCadence[cadence] = { at, metrics };
    }

    return;
  }

  // Legacy flat clientMetrics payloads without cadence nesting.
  applyClientMetrics(headset.metricsByCadence, headset.metricSeries, info);
}

/**
 * True when the headset has at least one non-empty metric series.
 * @param h Headset client state.
 * @returns Whether chart rendering should proceed for this headset.
 */
function hasMetricSeries(h: HeadsetState) {
  const root = h.metricSeries;

  if (!root) return false;

  for (const byMetric of Object.values(root)) {
    if (!byMetric || typeof byMetric !== 'object') continue;

    for (const [metricKey, series] of Object.entries(byMetric)) {
      // Timestamp-only buckets are alignment metadata, not plottable metrics.
      if (metricKey === METRICS_TIMESTAMP_KEY) continue;
      if (series?.times?.length) return true;
    }
  }

  return false;
}

/**
 * Flatten all cadence buckets into one metric map for chart alignment.
 * Includes every received metric key — plot filtering happens at display time only.
 * @param metricSeries Nested cadence → metric series store.
 * @returns Input for {@link alignMetricSeries}, or null when no samples exist.
 */
function alignHeadsetSeries(metricSeries: HeadsetState['metricSeries']) {
  const combined: Record<string, MetricSeries> = {};

  for (const byMetric of Object.values(metricSeries ?? {})) {
    if (!byMetric || typeof byMetric !== 'object') continue;

    for (const [metricKey, series] of Object.entries(byMetric)) {
      if (metricKey === METRICS_TIMESTAMP_KEY) continue;
      if (!series?.times?.length) continue;

      // Later cadence buckets overwrite same key — values are equivalent samples.
      combined[metricKey] = series;
    }
  }

  return alignMetricSeries(combined);
}

/**
 * Restrict aligned chart data to metrics checked in the plot picker (display only).
 * @param aligned Full aligned series from {@link alignHeadsetSeries}.
 * @returns Filtered alignment, or null when nothing is selected or sampled.
 */
function filterAlignedForDisplay(
  aligned: NonNullable<ReturnType<typeof alignMetricSeries>>
): NonNullable<ReturnType<typeof alignMetricSeries>> | null {
  // Remove series whose keys are not currently checked in the plot picker.
  const metrics = aligned.metrics.filter(m => isMetricSelected(m.key));

  // Return null so callers can render guidance text instead of an empty chart.
  if (metrics.length === 0) return null;

  // Preserve the shared x-axis (timestamps); only the y-series list is narrowed.
  return { xs: aligned.xs, metrics };
}

/**
 * Normalize a timestamp to integer milliseconds.
 * @param t Seconds or milliseconds since epoch.
 * @returns Unix time in milliseconds.
 */
function normalizeTimeMs(t: number) {
  // Hub payloads may use seconds (CloudXR) or ms (browser Date.now).
  return t >= 1e12 ? Math.round(t) : Math.round(t * 1000);
}

/**
 * Replace null gaps with the last known finite value (for uPlot ``spanGaps``).
 * @param values Per-timestamp values with possible null holes.
 * @returns Forward-filled series safe for uPlot rendering.
 */
function forwardFill(values: (number | null)[]) {
  let last: number | null = null;

  return values.map(v => {
    if (v != null && Number.isFinite(v)) {
      last = v;
      return v;
    }

    // Carry last good sample across missing cadence ticks.
    return last;
  });
}

/**
 * Align multiple metric series onto a shared time axis for uPlot.
 * @param byMetric Metric key → series map.
 * @returns Shared x values (seconds) and per-metric y arrays, or null when empty.
 */
function alignMetricSeries(byMetric: Record<string, MetricSeries>) {
  const keys: string[] = [];

  // Collect plottable keys in stable sorted order for consistent legend colors.
  for (const [metricKey, series] of Object.entries(byMetric)) {
    if (metricKey === METRICS_TIMESTAMP_KEY) continue;
    if (!series?.times?.length) continue;
    keys.push(metricKey);
  }

  keys.sort();

  if (keys.length === 0) return null;

  // Union of all sample timestamps (normalized to ms)
  const timeSet = new Set<number>();
  for (const key of keys) {
    for (const t of byMetric[key].times) timeSet.add(normalizeTimeMs(t));
  }
  const times = [...timeSet].sort((a, b) => a - b);

  // uPlot expects epoch seconds on the shared x axis.
  const xs = times.map(t => t / 1000);

  const metrics = keys.map(key => {
    const s = byMetric[key];
    const lookup = new Map(
      s.times.map((t: number, i: number) => [normalizeTimeMs(t), s.values[i]])
    );

    // Resample each series onto the shared timestamp grid (null where cadence missed a tick).
    const raw: (number | null)[] = times.map(t => {
      const v = lookup.get(t);
      return v === undefined ? null : v;
    });

    return { key, values: forwardFill(raw) as number[] };
  });

  return { xs, metrics };
}

/**
 * Format the latest value for legend display.
 * @param key Metric key.
 * @param value Latest sample value.
 * @returns Human-readable value with unit suffix when applicable.
 */
function formatLatest(key: string, value: number) {
  const meta = metricMeta(key);
  const text = value.toFixed(meta.decimals);

  return meta.unit ? `${text} ${meta.unit}` : text;
}

/**
 * Build legend HTML for the given metric keys.
 * @param metricKeys Ordered metric keys for the chart.
 * @returns Markup for the custom legend row above each chart.
 */
function buildLegendHtml(metricKeys: string[]) {
  return metricKeys
    .map(key => {
      const meta = metricMeta(key);
      return `<span class="legend-item"><span class="legend-swatch" aria-hidden="true"></span>${escapeHtml(meta.label)}: <strong class="legend-value">—</strong></span>`;
    })
    .join('');
}

/**
 * Create or reuse a uPlot chart for the given metric key set.
 * @param key Chart map key.
 * @param hostEl Container element for the chart panel.
 * @param metricKeys Metrics to plot (determines series count and axes).
 * @returns Live chart entry (existing or newly created).
 */
function ensureCadenceChart(key: string, hostEl: HTMLElement, metricKeys: string[]) {
  const signature = metricKeys.join('\0');
  const existing = charts.get(key);

  if (existing && existing.signature === signature) {
    // Re-mount after renderMetrics cleared the host, or when the section was rebuilt.
    if (!hostEl.contains(existing.wrap)) {
      hostEl.replaceChildren(existing.wrap);
    }

    return existing;
  }

  if (existing) destroyChart(key);

  const usesMs = metricKeys.some(k => metricMeta(k).unit === 'ms');
  const usesNonMs = metricKeys.some(k => metricMeta(k).unit !== 'ms');

  // Latency (ms) shares a chart with rates/scores only when dual axes are enabled.
  const dualAxis = usesMs && usesNonMs;
  const primaryKeys = metricKeys.filter(k => metricMeta(k).unit !== 'ms');

  // Panel DOM: legend + plot container
  const wrap = document.createElement('div');
  wrap.className = 'metric-chart-panel';
  const legendEl = document.createElement('div');
  legendEl.className = 'metric-chart-legend';
  legendEl.dataset.legend = '';
  legendEl.innerHTML = buildLegendHtml(metricKeys);

  // Apply per-series stroke colours to the legend swatches rendered by buildLegendHtml.
  metricKeys.forEach((metricKey, i) => {
    const swatch = legendEl.querySelectorAll('.legend-swatch')[i] as HTMLElement | undefined;
    if (swatch) swatch.style.background = SERIES_COLORS[i % SERIES_COLORS.length];
  });
  wrap.appendChild(legendEl);

  const plotEl = document.createElement('div');
  plotEl.className = 'metric-chart-plot';
  wrap.appendChild(plotEl);

  // Replace placeholder text or stale nodes from a prior render path.
  hostEl.replaceChildren(wrap);

  const chartHeight = 220;
  const width = Math.max(hostEl.clientWidth - 8, 280);

  // uPlot series config (index 0 is shared x axis)
  const series: uPlot.Series[] = [{}];
  for (let i = 0; i < metricKeys.length; i++) {
    const meta = metricMeta(metricKeys[i]);
    series.push({
      label: meta.label,
      stroke: SERIES_COLORS[i % SERIES_COLORS.length],
      width: 2,
      scale: dualAxis ? yScaleForUnit(meta.unit) : 'y',
      spanGaps: true,
    });
  }

  const axes: uPlot.Axis[] = [
    { stroke: '#888', grid: { stroke: 'rgba(0, 0, 0, 0.08)', width: 1 } },
    {
      stroke: '#76b900',
      grid: { stroke: 'rgba(0, 0, 0, 0.06)', width: 1 },
      size: 52,
      label: dualAxis
        ? primaryAxisLabel(primaryKeys)
        : usesMs
          ? 'ms'
          : primaryAxisLabel(metricKeys),
    },
  ];

  if (dualAxis) {
    axes.push({
      side: 1,
      scale: 'y2',
      stroke: '#f0a020',
      grid: { show: false },
      size: 52,
      label: 'ms',
    });
  }

  const scales: uPlot.Scales = { x: { time: true } };
  if (dualAxis) scales.y2 = { auto: true };

  const u = new uPlot(
    {
      width,
      height: chartHeight,
      pxAlign: true,
      cursor: { drag: { x: true, y: false } },
      legend: { show: false },
      series,
      axes,
      scales,
    },
    [[]],
    plotEl
  );

  // Keep plot width in sync when the metrics panel is resized.
  const resizeObserver = new ResizeObserver(() => {
    const w = Math.max(plotEl.clientWidth, 280);
    if (w > 0) u.setSize({ width: w, height: chartHeight });
  });
  resizeObserver.observe(plotEl);

  const entry: ChartEntry = { u, wrap, resizeObserver, signature, metricKeys };
  charts.set(key, entry);

  return entry;
}

/**
 * Push aligned data into an existing chart and refresh legend values.
 * @param key Chart map key.
 * @param hostEl Chart host container.
 * @param aligned Output from {@link alignMetricSeries}.
 */
function updateCadenceChart(
  key: string,
  hostEl: HTMLElement,
  aligned: NonNullable<ReturnType<typeof alignMetricSeries>>
) {
  const metricKeys = aligned.metrics.map(m => m.key);
  const { u, wrap } = ensureCadenceChart(key, hostEl, metricKeys);

  // First array is shared x; remaining arrays are y series in metric key order.
  u.setData([aligned.xs, ...aligned.metrics.map(m => m.values)]);

  const items = wrap.querySelectorAll('.legend-item');

  aligned.metrics.forEach(({ key, values }, i) => {
    const valueEl = items[i]?.querySelector('.legend-value');
    const last = values[values.length - 1];

    if (valueEl && typeof last === 'number') {
      valueEl.textContent = formatLatest(key, last);
    }
  });
}

/**
 * Re-render the headset list sidebar from {@link headsetState}.
 */
function renderHeadsetList() {
  if (headsetState.size === 0) {
    els.headsets.innerHTML = '<p class="muted">No headsets connected.</p>';
    return;
  }

  // Full rebuild keeps sidebar markup simple — headset count stays small.
  els.headsets.innerHTML = '';

  for (const h of headsetState.values()) {
    const card = document.createElement('div');
    card.className = 'headset-card';
    const label = h.deviceLabel || h.id;
    const stream = h.streaming === null ? 'unknown' : h.streaming ? 'streaming' : 'idle';
    const updated = h.lastMetricsAt ? new Date(h.lastMetricsAt).toLocaleTimeString() : '—';

    card.innerHTML = `
      <div class="headset-title">${escapeHtml(label)}</div>
      <div class="headset-meta">${escapeHtml(h.id)} · ${stream}</div>
      <div class="headset-meta">Updated ${updated}</div>
    `;
    els.headsets.appendChild(card);
  }
}

/**
 * Re-render metric chart sections for all headsets with series data.
 */
function renderMetrics() {
  const activeChartKeys = new Set<string>();

  if (headsetState.size === 0) {
    destroyAllCharts();
    els.metricsRoot.innerHTML =
      '<p class="muted">Waiting for a headset (open the sample client with the metrics hub enabled).</p>';
    return;
  }

  let anyHeadsetWithData = false;

  for (const h of headsetState.values()) {
    if (!hasMetricSeries(h)) continue;
    anyHeadsetWithData = true;

    // Reuse per-headset section nodes to avoid recreating uPlot hosts unnecessarily.
    let section = els.metricsRoot.querySelector(`[data-headset-id="${CSS.escape(h.id)}"]`);

    if (!section) {
      section = document.createElement('section');
      section.className = 'metrics-headset';
      (section as HTMLElement).dataset.headsetId = h.id;
      section.innerHTML = `<h3>${escapeHtml(h.deviceLabel || h.clientId || h.id)}</h3>`;
      els.metricsRoot.appendChild(section);
    }

    const aligned = alignHeadsetSeries(h.metricSeries);
    if (!aligned) continue;

    let host = section.querySelector('.metric-chart-host');

    if (!host) {
      host = document.createElement('div');
      host.className = 'metric-chart-host';
      section.appendChild(host);
    }

    const key = chartKey(h.id);

    // Display filter cleared — keep ingesting but show guidance instead of an empty chart.
    if (selectedMetrics.size === 0) {
      destroyChart(key);
      (host as HTMLElement).innerHTML =
        '<p class="muted">Check metrics above to plot (all incoming data is still received).</p>';
      continue;
    }

    const displayAligned = filterAlignedForDisplay(aligned);

    // Selected metrics may lag behind ingestion until the next clientMetrics batch.
    if (!displayAligned) {
      destroyChart(key);
      (host as HTMLElement).innerHTML =
        '<p class="muted">Checked metrics have no samples yet — waiting for <code>clientMetrics</code>…</p>';
      continue;
    }

    activeChartKeys.add(key);
    updateCadenceChart(key, host as HTMLElement, displayAligned);
  }

  // Remove charts for disconnected or idle headsets
  for (const key of charts.keys()) {
    if (!activeChartKeys.has(key)) destroyChart(key);
  }

  // Drop section shells when the hub reports a disconnect.
  for (const section of Array.from(els.metricsRoot.querySelectorAll('.metrics-headset'))) {
    const id = (section as HTMLElement).dataset.headsetId;

    if (id && !headsetState.has(id)) section.remove();
  }

  if (!anyHeadsetWithData) {
    destroyAllCharts();
    els.metricsRoot.innerHTML =
      '<p class="muted">Headset connected — waiting for <code>clientMetrics</code>…</p>';
    return;
  }

  // Drop top-level placeholder once at least one chart section exists.
  const placeholder = els.metricsRoot.querySelector(':scope > .muted');
  if (placeholder) placeholder.remove();
}

/**
 * Extract metrics-by-cadence from heterogeneous hub payloads.
 * @param info Event payload fragment.
 * @returns Latest metrics per cadence, or undefined when absent or empty.
 */
function metricsFromPayload(info: Record<string, unknown>) {
  const raw = info.metricsByCadence ?? info.lastMetrics ?? info.metrics;

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;

  // Ignore empty maps so headsetConnected does not wipe prior latest-by-cadence values.
  if (Object.keys(raw).length === 0) return undefined;

  return raw as HeadsetState['metricsByCadence'];
}

/**
 * Insert or update one headset from a hub event and refresh UI.
 * @param info Headset fields from snapshot or live events.
 */
function upsertHeadset(info: Record<string, unknown>) {
  const id = String(info.id ?? 'unknown');

  const existing = headsetState.get(id) ?? {
    id,
    clientId: null,
    deviceLabel: null,
    streaming: null,
    metricsByCadence: {},
    metricSeries: {},
    lastMetricsAt: null,
  };

  const merged: HeadsetState = {
    ...existing,
    clientId: (info.clientId as string | undefined) ?? existing.clientId,
    deviceLabel: (info.deviceLabel as string | undefined) ?? existing.deviceLabel,
    streaming: (info.streaming as boolean | undefined) ?? existing.streaming,
    metricsByCadence: metricsFromPayload(info) ?? existing.metricsByCadence ?? {},
    lastMetricsAt: (info.lastMetricsAt as number | undefined) ?? existing.lastMetricsAt,
  };

  // Append series samples before re-rendering charts.
  mergeMetricSeries(merged, info);
  headsetState.set(id, merged);
  renderHeadsetList();
  renderMetrics();

  // Keep the source filter dropdown in sync with newly connected headsets.
  logPanel.updateSources([...headsetState.values()].map(h => ({ id: h.id, label: h.deviceLabel })));
}

/**
 * Replace all headset state from an operator ``snapshot`` message.
 * @param payload Snapshot payload from the hub.
 */
function applySnapshot(payload: Record<string, unknown>) {
  // Snapshot is authoritative — discard prior client state and charts.
  headsetState.clear();
  destroyAllCharts();
  els.metricsRoot.innerHTML = '';

  for (const h of (payload.headsets as Record<string, unknown>[] | undefined) ?? []) {
    const entry: HeadsetState = {
      id: String(h.id),
      clientId: (h.clientId as string | undefined) ?? null,
      deviceLabel: (h.deviceLabel as string | undefined) ?? null,
      streaming: (h.streaming as boolean | undefined) ?? null,
      metricsByCadence: metricsFromPayload(h) ?? {},
      metricSeries: {},
      lastMetricsAt: (h.lastMetricsAt as number | undefined) ?? null,
    };

    mergeMetricSeries(entry, h);
    headsetState.set(entry.id, entry);
  }

  renderHeadsetList();
  renderMetrics();

  // Cache listen mode from snapshots so zero-headset hints can compare page vs hub scheme.
  const connectivity = payload.connectivity as HubConnectivityMeta | undefined;
  if (connectivity && typeof connectivity.listenPort === 'number') {
    hubConnectivityMeta = connectivity;
  } else {
    hubConnectivityMeta = null;
  }

  logPanel.updateSources([...headsetState.values()].map(h => ({ id: h.id, label: h.deviceLabel })));
}

/**
 * Dispatch one parsed WebSocket message from the hub.
 * @param msg Parsed JSON envelope.
 */
function handleMessage(msg: { type?: string; payload?: Record<string, unknown> }) {
  const type = msg.type ?? '';
  const payload = msg.payload ?? {};

  hubPageDebug('←', type, payload);
  logLine(`← ${type}`, 'debug');

  switch (type) {
    case 'snapshot':
      applySnapshot(payload);
      {
        const n = (payload.headsets as unknown[] | undefined)?.length ?? 0;
        logLine(`Snapshot: ${n} headset(s)`);
        hubPageDebug('snapshot detail', {
          headsetCount: n,
          headsets: payload.headsets,
          operatorsNote:
            'This page is operator-only; headsets connect from the sample client (role=headset)',
        });

        // Operator UI cannot create headsets — surface setup and transport mismatches in the sidebar.
        if (n === 0 && hubConnectivityMeta) {
          renderConnectivityIssues(buildZeroHeadsetHints(hubConnectivityMeta), true);
        } else if (n === 0) {
          logEmptyHeadsetHint();
        } else {
          els.connectivityAlerts.hidden = true;
          els.connectivityAlerts.replaceChildren();
        }
      }
      break;
    case 'connectivityAlert':
      // Headset POSTed a connectivity failure — append banners without clearing page-mode hints.
      renderConnectivityIssues((payload.issues as ConnectivityIssue[] | undefined) ?? []);
      break;
    case 'headsetConnected':
      els.connectivityAlerts.hidden = true;
      els.connectivityAlerts.replaceChildren();
      shownConnectivityKeys.clear();
      upsertHeadset((payload.headset as Record<string, unknown>) ?? { id: 'unknown' });
      logLine(
        `Headset connected: ${(payload.headset as Record<string, unknown> | undefined)?.deviceLabel ?? (payload.headset as Record<string, unknown> | undefined)?.id}`
      );
      break;
    case 'headsetDisconnected':
      if (payload.id) headsetState.delete(String(payload.id));
      renderHeadsetList();
      renderMetrics();
      logLine(`Headset disconnected: ${payload.id}`);
      break;
    case 'streamStatus':
      if (payload.headsetId) {
        upsertHeadset({
          id: payload.headsetId,
          deviceLabel: payload.deviceLabel,
          streaming: payload.streaming,
        });
      }
      logLine(`streamStatus ${payload.headsetId}: ${payload.streaming ? 'streaming' : 'idle'}`);
      break;
    case 'clientMetrics':
      if (payload.headsetId) {
        upsertHeadset({
          id: payload.headsetId,
          clientId: payload.clientId,
          deviceLabel: payload.deviceLabel,
          metricsByCadence: payload.metricsByCadence ?? payload.metrics,
          metricSeries: payload.metricSeries,
          lastMetricsAt: payload.receivedAt ?? Date.now(),
        });
      }
      logLine(`clientMetrics from ${payload.headsetId ?? '?'}`);
      break;
    case 'headsetLogs':
      // Forward SDK log entries to the panel; skip empty or missing batches.
      if (Array.isArray(payload.entries) && payload.entries.length > 0) {
        const hId = String(payload.headsetId ?? '?');
        const hLabel = (payload.deviceLabel as string | null | undefined) ?? null;
        // Register as a source even if headsetConnected hasn't arrived yet.
        logPanel.updateSources([{ id: hId, label: hLabel }]);
        logPanel.append(hId, hLabel, payload.entries as RawLogEntry[]);
      }
      break;
    case 'error':
      logLine(`Hub error: ${payload.message ?? payload.code ?? JSON.stringify(payload)}`, 'error');
      break;
    default:
      logLine(`Message: ${type}`);
  }
}

/**
 * Open (or close) the operator WebSocket and wire event handlers.
 * Toggles disconnect when already connected or connecting.
 */
function connect() {
  // CONNECT button doubles as disconnect while a socket is open or handshaking.
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    ws.close();
    return;
  }

  const url = hubWsUrl();
  hubPageDebug('connecting', url);
  logLine(`Connecting to ${url} (role=operator)`);

  const socket = new WebSocket(url);
  ws = socket;

  socket.onopen = () => {
    // Ignore stale socket callbacks after a rapid reconnect/disconnect.
    if (ws !== socket) return;

    setWsStatus(true);

    const register = {
      type: 'register',
      payload: {
        role: 'operator',
        ...(els.token.value.trim() ? { token: els.token.value.trim() } : {}),
      },
    };
    hubPageDebug('→ register', register);
    socket.send(JSON.stringify(register));
    logLine(
      'Registered as operator — waiting for headsets (the sample client connects separately)'
    );
  };

  socket.onmessage = ev => {
    if (ws !== socket) return;

    // Hub protocol is JSON text frames only.
    if (typeof ev.data !== 'string') return;

    try {
      handleMessage(JSON.parse(ev.data));
    } catch (e) {
      logLine(`Invalid JSON from hub: ${e}`, 'error');
    }
  };

  socket.onclose = ev => {
    if (ws !== socket) return;

    setWsStatus(false);
    const detail = `code=${ev.code} reason=${ev.reason || '(none)'} clean=${ev.wasClean}`;
    hubPageDebug('closed', detail);
    let hint = '';

    // 1006 usually means TCP failure before the WebSocket handshake completed.
    if (ev.code === 1006) {
      hint = ' — hub unreachable? Run: cd examples/hub && npm start; match Hub host/port.';
    }
    logLine(`WebSocket closed (${detail})${hint}`, 'error');
    ws = null;
  };

  socket.onerror = () => {
    if (ws !== socket) return;

    // Browsers omit error details — close handler carries the actionable code.
    hubPageDebug('error event (browser gives no details — see close code)', { url });
    logLine(`WebSocket error for ${url} (see close line below)`, 'error');
  };
}

// Wire UI and initial render
els.connectBtn.addEventListener('click', connect);

setWsStatus(false);
renderMetricPicker();
renderHeadsetList();
renderMetrics();

// Always log startup to the console; detailed traffic needs ?debug=1
console.info(
  '[HubPage] loaded — connection status and events appear in the Event log panel (?debug=1 for verbose console)'
);

// Auto-connect unless ?autoconnect=0
if (params.get('autoconnect') !== '0') {
  connect();
}
