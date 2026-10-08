/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * CloudXR.js Metrics Hub — standalone headset log viewer page (logs.html).
 *
 * Connects to the hub as ``role=operator``, receives ``headsetLogs`` broadcasts,
 * and renders them in a filterable scrollable panel.
 *
 * Key flow:
 * 1. Parse URL params (host, port, controlToken, autoconnect).
 * 2. ``connect()`` — open WebSocket and send ``register``.
 * 3. ``handleMessage()`` — route snapshot / headset / headsetLogs events.
 * 4. ``appendHeadsetLogs()`` — prepend rows; ``refilterLogs()`` on checkbox change.
 */

import './hub.css';
import { HeadsetLogPanel, type RawLogEntry } from './headsetLogPanel';

/**
 * Resolve a required ``input`` element by id.
 * @param id DOM element id.
 * @returns The matching input element.
 * @throws {Error} When the element is absent or is not an HTMLInputElement.
 */
function requireInput(id: string): HTMLInputElement {
  const el = document.getElementById(id);

  // Fail fast when logs.html is missing a required form control.
  if (!(el instanceof HTMLInputElement)) throw new Error(`Missing #${id}`);

  return el;
}

/**
 * Resolve a required ``button`` element by id.
 * @param id DOM element id.
 * @returns The matching button element.
 * @throws {Error} When the element is absent or is not an HTMLButtonElement.
 */
function requireButton(id: string): HTMLButtonElement {
  const el = document.getElementById(id);

  // Fail fast when logs.html is missing a required control.
  if (!(el instanceof HTMLButtonElement)) throw new Error(`Missing #${id}`);

  return el;
}

/**
 * Resolve a required HTMLElement by id, cast to the expected subtype.
 * @param id DOM element id.
 * @returns The matching element.
 * @throws {Error} When the element is absent.
 */
function requireEl<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);

  // Fail fast when logs.html is missing a required shell node.
  if (!el) throw new Error(`Missing #${id}`);

  return el as T;
}

/** Cached references to shell elements from ``logs.html``. */
const els = {
  /** Hub host input field. */
  host: requireInput('host'),
  /** Hub port input field. */
  port: requireInput('port'),
  /** Optional control token input field. */
  token: requireInput('token'),
  /** Toggle connect / disconnect. */
  connectBtn: requireButton('connectBtn'),
  /** WebSocket status banner wrapper. */
  statusBox: requireEl<HTMLDivElement>('statusMessageBox'),
  /** Connection state text within the status banner. */
  wsStatus: requireEl<HTMLSpanElement>('wsStatus'),
  /** Sidebar headset card list. */
  headsets: requireEl<HTMLDivElement>('headsets'),
  /** Container into which {@link HeadsetLogPanel} injects its toolbar and log div. */
  headsetLogPanel: requireEl<HTMLDivElement>('headsetLogPanel'),
  /** Activity event log panel. */
  log: requireEl<HTMLDivElement>('log'),
};

/** Page URL query params (host, port, controlToken, autoconnect, debug). */
const params = new URLSearchParams(window.location.search);

/** When ``?debug=1``, mirror activity log lines to the browser console. */
const HUB_PAGE_DEBUG = params.get('debug') === '1';

// Seed connection form from URL params so deep-links pre-fill the form.
els.host.value = params.get('host') ?? window.location.hostname ?? '';
els.port.value = params.get('port') ?? (window.location.port || '8787');
els.token.value = params.get('controlToken') ?? '';

/**
 * Shared headset log panel — injects its own toolbar and log div into the
 * container element from ``logs.html``.
 */
const logPanel = new HeadsetLogPanel(els.headsetLogPanel, {
  defaultInfoEnabled: true,
  tall: true,
});

/** Active operator WebSocket, or null when disconnected. */
let ws: WebSocket | null = null;

/** Headset id → human-readable label for the sidebar card list. */
const headsetLabels = new Map<string, string | null>();

/**
 * Escape HTML special characters for safe insertion into element templates.
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
 * Append one line to the activity event log panel.
 * @param text Message text.
 * @param level Visual severity (debug lines also go to console when ``?debug=1``).
 */
function logLine(text: string, level: 'info' | 'error' | 'debug' = 'info') {
  // Mirror debug traffic to the console without cluttering the on-page log.
  if (level === 'debug' && HUB_PAGE_DEBUG) console.info('[HubLogs]', text);

  const line = document.createElement('div');
  line.className = `log-line log-${level}`;
  const ts = new Date().toLocaleTimeString();
  line.textContent = `[${ts}] ${text}`;

  // Newest events appear at the top of the activity panel.
  els.log.prepend(line);

  // Cap DOM nodes so long sessions stay responsive.
  while (els.log.children.length > 80) els.log.lastChild?.remove();
}

/**
 * Update the connection status banner and connect button label.
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
 * Rebuild the sidebar headset card list from {@link headsetLabels}.
 *
 * Full rebuild is acceptable because the headset count stays small
 * and cards change infrequently compared to log entries.
 */
function renderHeadsetSidebar() {
  // Replace all children with a placeholder when no headsets are known.
  if (headsetLabels.size === 0) {
    els.headsets.innerHTML = '<p class="muted">No headsets connected.</p>';
    return;
  }

  // Clear stale cards before re-populating.
  els.headsets.innerHTML = '';

  for (const [id, label] of headsetLabels) {
    const card = document.createElement('div');
    card.className = 'headset-card';

    // Show the human-readable label when available, fall back to the hub id.
    card.innerHTML =
      `<div class="headset-title">${escapeHtml(label || id)}</div>` +
      `<div class="headset-meta">${escapeHtml(id)}</div>`;

    els.headsets.appendChild(card);
  }

  // Keep the source filter dropdown in sync with connected headsets.
  logPanel.updateSources([...headsetLabels.entries()].map(([id, label]) => ({ id, label })));
}

/**
 * Dispatch one parsed WebSocket message from the hub.
 *
 * Only the message types relevant to this page are handled; metrics events
 * (``clientMetrics``, ``streamStatus``) are silently ignored.
 *
 * @param msg Parsed JSON envelope with optional ``type`` and ``payload``.
 */
function handleMessage(msg: { type?: string; payload?: Record<string, unknown> }) {
  const type = msg.type ?? '';
  const payload = msg.payload ?? {};

  switch (type) {
    case 'snapshot': {
      // Full snapshot resets sidebar; extract headset labels from the roster.
      headsetLabels.clear();
      for (const h of (payload.headsets as Record<string, unknown>[] | undefined) ?? []) {
        headsetLabels.set(String(h.id), (h.deviceLabel as string | null | undefined) ?? null);
      }
      renderHeadsetSidebar();
      logLine(`Snapshot: ${headsetLabels.size} headset(s)`);
      break;
    }
    case 'headsetConnected': {
      // Register the new headset so the sidebar stays up to date.
      const h = (payload.headset as Record<string, unknown> | undefined) ?? {};
      headsetLabels.set(
        String(h.id ?? 'unknown'),
        (h.deviceLabel as string | null | undefined) ?? null
      );
      renderHeadsetSidebar();
      logLine(`Headset connected: ${h.deviceLabel ?? h.id}`);
      break;
    }
    case 'headsetDisconnected':
      // Remove the departed headset from the sidebar label map.
      if (payload.id) headsetLabels.delete(String(payload.id));
      renderHeadsetSidebar();
      logLine(`Headset disconnected: ${payload.id}`);
      break;

    case 'headsetLogs':
      // Forward SDK log entries to the panel; skip empty batches.
      if (Array.isArray(payload.entries) && payload.entries.length > 0) {
        const hId = String(payload.headsetId ?? '?');
        const hLabel = (payload.deviceLabel as string | null | undefined) ?? null;
        // Register headset so source filtering works even if headsetConnected arrives late.
        if (hId !== '?' && !headsetLabels.has(hId)) {
          headsetLabels.set(hId, hLabel);
          renderHeadsetSidebar();
        }
        logPanel.append(hId, hLabel, payload.entries as RawLogEntry[]);
      }
      break;

    case 'error':
      logLine(`Hub error: ${payload.message ?? payload.code ?? JSON.stringify(payload)}`, 'error');
      break;

    default:
      // Unknown types are logged at debug severity for forward-compatibility.
      logLine(`Message: ${type}`, 'debug');
  }
}

/**
 * Build the hub WebSocket URL from the form fields.
 *
 * Supports IPv6 host bracket notation and derives ws/wss from page protocol
 * so mixed-content rules allow WSS when the hub page is served over HTTPS.
 *
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
 * Open (or close) the operator WebSocket and wire protocol event handlers.
 *
 * The CONNECT button doubles as DISCONNECT while a socket is open or
 * handshaking, so a second click tears down the active connection.
 */
function connect() {
  // CONNECT button doubles as disconnect while a socket is open or handshaking.
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    ws.close();
    return;
  }

  const url = hubWsUrl();
  logLine(`Connecting to ${url} (role=operator)`);

  const socket = new WebSocket(url);

  // Store the live socket so stale callbacks from a prior connection can bail out.
  ws = socket;

  socket.onopen = () => {
    // Ignore stale socket callbacks after a rapid reconnect/disconnect.
    if (ws !== socket) return;

    setWsStatus(true);

    // First message on the wire: identify as an operator client.
    socket.send(
      JSON.stringify({
        type: 'register',
        payload: {
          role: 'operator',
          // Include control token only when one has been provided.
          ...(els.token.value.trim() ? { token: els.token.value.trim() } : {}),
        },
      })
    );

    logLine('Registered as operator — waiting for headset logs');
  };

  socket.onmessage = ev => {
    // Ignore callbacks from a stale socket after a reconnect.
    if (ws !== socket || typeof ev.data !== 'string') return;

    // Hub protocol uses JSON text frames only; parse and dispatch.
    try {
      handleMessage(JSON.parse(ev.data));
    } catch (e) {
      logLine(`Invalid JSON from hub: ${e}`, 'error');
    }
  };

  socket.onclose = ev => {
    // Ignore stale close events that fire after a deliberate reconnect.
    if (ws !== socket) return;

    setWsStatus(false);

    // 1006 usually means TCP failure before the WebSocket handshake completed.
    let hint = '';
    if (ev.code === 1006) hint = ' — hub unreachable? Run: cd examples/hub && npm start';

    logLine(`WebSocket closed (code=${ev.code})${hint}`, 'error');
    ws = null;
  };

  socket.onerror = () => {
    // Ignore callbacks from a stale socket after a reconnect.
    if (ws !== socket) return;

    // Browsers omit error details — the close handler carries the actionable code.
    logLine(`WebSocket error for ${hubWsUrl()} (see close line below)`, 'error');
  };
}

// Wire the CONNECT / DISCONNECT button.
els.connectBtn.addEventListener('click', connect);

// Initialise the status banner to Disconnected before the socket opens.
setWsStatus(false);

// Always log startup to the console; detailed traffic needs ?debug=1.
console.info('[HubLogs] loaded — headset SDK log viewer (?debug=1 for verbose console)');

// Auto-connect unless ?autoconnect=0 is present in the URL.
if (params.get('autoconnect') !== '0') {
  connect();
}
