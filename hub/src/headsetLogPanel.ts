/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * HeadsetLogPanel — shared log panel used by both the main hub page and
 * the standalone ``logs.html`` page.
 *
 * Features: level-filter checkboxes, live text search with match highlight,
 * headset source dropdown, JSON and plain-text download, clear, and entry count.
 */

/** LogLevel numeric values from the CloudXR SDK. */
const LEVEL_NAMES: Record<number, string> = { 1: 'Error', 2: 'Warning', 3: 'Info', 4: 'Debug' };

/** CSS badge-class suffix for each level. */
const LEVEL_CSS: Record<number, string> = { 1: 'error', 2: 'warning', 3: 'info', 4: 'debug' };

/**
 * In-memory record for one log entry.
 * Kept in {@link HeadsetLogPanel.records} for download and re-render.
 */
export interface LogRecord {
  seq: number;
  headsetId: string;
  /** deviceLabel when available; falls back to headsetId. */
  source: string;
  level: number;
  message: string;
  /** Locale time string at ingestion (for display). */
  wallTime: string;
  /** ISO 8601 timestamp at ingestion (for download). */
  isoTime: string;
}

/** One entry from a ``headsetLogs`` hub broadcast. */
export interface RawLogEntry {
  timestamp: number;
  level: number;
  message: string;
}

/** Options for {@link HeadsetLogPanel}. */
export interface HeadsetLogPanelOptions {
  /**
   * Maximum records before oldest are evicted. Default 5000.
   */
  maxRecords?: number;
  /**
   * Show Info entries by default.
   * Match the SDK's configured minimum log level. Default true.
   */
  defaultInfoEnabled?: boolean;
  /**
   * Show Debug entries by default. Default false.
   */
  defaultDebugEnabled?: boolean;
  /**
   * Apply ``hsl-panel--tall`` so the log fills the page rather than a fixed panel height.
   * Use on the dedicated logs page; omit for the compact inline panel.
   */
  tall?: boolean;
}

/**
 * Escape HTML special characters for safe ``innerHTML`` assignment.
 * @internal Exported for unit testing.
 */
export function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Wrap all regex matches in ``<mark class="hsl-hi">`` tags.
 *
 * Escapes the raw text first, then locates matches in the original string so
 * special characters (``<``, ``>``, ``&``) are handled without double-escaping.
 *
 * @param text Raw message text.
 * @param re Regex with global flag, or null.
 * @returns HTML-safe string for ``innerHTML``.
 * @internal Exported for unit testing.
 */
export function highlightHtml(text: string, re: RegExp | null): string {
  if (!re) return escHtml(text);

  re.lastIndex = 0;
  const out: string[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push(escHtml(text.slice(last, m.index)));
    out.push(`<mark class="hsl-hi">${escHtml(m[0])}</mark>`);
    last = m.index + m[0].length;
    if (m[0].length === 0) re.lastIndex++;
  }
  out.push(escHtml(text.slice(last)));
  return out.join('');
}

/**
 * Self-contained headset log panel component.
 *
 * Injects a toolbar and scrollable log list into ``container``.
 * Callers need only provide the container element and call {@link append}
 * when new entries arrive from the hub.
 */
export class HeadsetLogPanel {
  /** All records since the last clear, used for downloads and re-renders. */
  private records: LogRecord[] = [];

  /** Monotonic sequence counter. */
  private seq = 0;

  /** Debounce timer for the search input. */
  private searchTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly maxRecords: number;

  // --- DOM references ---
  private logEl!: HTMLDivElement;
  private levelCbs!: Record<number, HTMLInputElement>;
  private searchInput!: HTMLInputElement;
  private matchCountEl!: HTMLSpanElement;
  private sourceSelect!: HTMLSelectElement;
  private countEl!: HTMLSpanElement;

  /**
   * Build the panel inside ``container``.
   * @param container Host element for the toolbar and log div.
   * @param opts Panel options.
   */
  constructor(
    private readonly container: HTMLElement,
    opts: HeadsetLogPanelOptions = {}
  ) {
    this.maxRecords = opts.maxRecords ?? 5000;
    this._build(opts);
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Append entries from a ``headsetLogs`` hub broadcast.
   *
   * Entries are stored in memory for download and re-filter.
   * Rows not matching the current filter are hidden so they can be revealed
   * by adjusting filters without a hub round-trip.
   *
   * @param headsetId Hub-assigned headset id.
   * @param deviceLabel Human-readable label or null.
   * @param entries Raw entries from the hub payload.
   */
  append(headsetId: string, deviceLabel: string | null, entries: RawLogEntry[]): void {
    // Nothing to do for empty batches; avoid touching the DOM unnecessarily.
    if (entries.length === 0) return;

    // Remove the "No headset logs yet" placeholder on first entry.
    const placeholder = this.logEl.querySelector<HTMLElement>('p.muted');
    if (placeholder) placeholder.remove();

    // Derive a human-readable source label; fall back to the hub headset id.
    const source = deviceLabel || headsetId;

    // Compile regexes once per batch so each row doesn't recompile from scratch.
    const highlightRe = this._buildRegex(true);
    const filterRe = this._buildRegex(false);
    const srcFilter = this.sourceSelect.value;

    // Render each entry as a DOM row and prepend so newest appears at the top.
    for (const entry of entries) {
      // Use the SDK's per-entry timestamp so displayed times reflect when the
      // event actually occurred, not when the batch was received by the hub.
      const t = new Date(entry.timestamp);
      const record: LogRecord = {
        seq: ++this.seq,
        headsetId,
        source,
        level: entry.level,
        message: entry.message,
        wallTime: t.toLocaleTimeString(),
        isoTime: t.toISOString(),
      };
      // Store the record for download and re-filter operations.
      this.records.push(record);

      // Build and insert the row with initial filter visibility applied.
      const row = this._buildRow(record, highlightRe, filterRe, srcFilter);
      this.logEl.prepend(row);
    }

    // Evict oldest records and their rows when the cap is exceeded.
    while (this.records.length > this.maxRecords) {
      this.records.shift();
      this.logEl.lastElementChild?.remove();
    }

    // Refresh the N / M count badge.
    this._updateCount();
  }

  /**
   * Clear all records and reset the panel to the empty placeholder.
   */
  clear(): void {
    // Discard all in-memory records and reset the sequence counter.
    this.records = [];
    this.seq = 0;

    // Replace the log div contents with the empty-state placeholder.
    this.logEl.innerHTML = '<p class="muted">No headset logs yet.</p>';

    // Remove all headset-specific options from the source dropdown, leaving
    // only the "All headsets" sentinel at index 0.
    while (this.sourceSelect.options.length > 1) this.sourceSelect.remove(1);
    this.sourceSelect.value = '';

    // Reset the count badge.
    this._updateCount();
  }

  /**
   * Rebuild the source filter dropdown from the current headset list.
   *
   * Previously seen headsets are kept until the next {@link clear} so the
   * operator can still filter historical entries after a headset disconnects.
   *
   * @param sources Array of ``{ id, label }`` pairs.
   */
  updateSources(sources: Array<{ id: string; label: string | null }>): void {
    const current = this.sourceSelect.value;
    const existing = new Set(
      Array.from(this.sourceSelect.options)
        .map(o => o.value)
        .filter(Boolean)
    );
    for (const { id, label } of sources) {
      if (!existing.has(id)) {
        const opt = document.createElement('option');
        opt.value = id;
        opt.textContent = label || id;
        this.sourceSelect.appendChild(opt);
        existing.add(id);
      }
    }
    if (current) this.sourceSelect.value = current;
  }

  // ---------------------------------------------------------------------------
  // DOM construction
  // ---------------------------------------------------------------------------

  /**
   * Inject the toolbar and log panel into {@link container}.
   * @param opts Initial option values.
   */
  private _build(opts: HeadsetLogPanelOptions): void {
    const wrap = document.createElement('div');
    wrap.className = opts.tall ? 'hsl-panel hsl-panel--tall' : 'hsl-panel';

    // --- Toolbar ---
    const tb = document.createElement('div');
    tb.className = 'hsl-toolbar';
    tb.setAttribute('role', 'toolbar');
    tb.setAttribute('aria-label', 'Log filter toolbar');

    // Level filter checkboxes.
    const levelGroup = document.createElement('div');
    levelGroup.className = 'hsl-group';
    this.levelCbs = {} as Record<number, HTMLInputElement>;

    const levelDefs: Array<[number, boolean]> = [
      [1, true],
      [2, true],
      [3, opts.defaultInfoEnabled ?? true],
      [4, opts.defaultDebugEnabled ?? false],
    ];
    for (const [lvl, defaultOn] of levelDefs) {
      const name = LEVEL_NAMES[lvl]!;
      const css = LEVEL_CSS[lvl]!;
      const lbl = document.createElement('label');
      lbl.className = 'hsl-level-label';
      lbl.title = `Show ${name} log entries`;
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = defaultOn;
      cb.setAttribute('aria-label', `Show ${name}`);
      this.levelCbs[lvl] = cb;
      cb.addEventListener('change', () => this._applyFilters());
      const badge = document.createElement('span');
      badge.className = `log-badge log-badge-${css}`;
      badge.textContent = name;
      lbl.append(cb, ' ', badge);
      levelGroup.appendChild(lbl);
    }
    tb.appendChild(levelGroup);
    tb.appendChild(this._sep());

    // Live search input and match count.
    const searchWrap = document.createElement('div');
    searchWrap.className = 'hsl-search-wrap';

    this.searchInput = document.createElement('input');
    this.searchInput.type = 'search';
    this.searchInput.className = 'hsl-search';
    this.searchInput.placeholder = 'Search';
    this.searchInput.setAttribute('aria-label', 'Search log messages');
    this.searchInput.addEventListener('input', () => this._scheduleSearch());
    this.searchInput.addEventListener('keydown', e => {
      // Escape clears the search and shows all level-passing rows again.
      if (e.key === 'Escape') {
        this.searchInput.value = '';
        this._applyFilters();
      }
    });

    this.matchCountEl = document.createElement('span');
    this.matchCountEl.className = 'hsl-match-count muted';
    this.matchCountEl.setAttribute('aria-live', 'polite');

    searchWrap.append(this.searchInput, this.matchCountEl);
    tb.appendChild(searchWrap);
    tb.appendChild(this._sep());

    // Source (headset) dropdown.
    this.sourceSelect = document.createElement('select');
    this.sourceSelect.className = 'hsl-source-select';
    this.sourceSelect.setAttribute('aria-label', 'Filter by headset');
    const allOpt = document.createElement('option');
    allOpt.value = '';
    allOpt.textContent = 'All headsets';
    this.sourceSelect.appendChild(allOpt);
    this.sourceSelect.addEventListener('change', () => this._applyFilters());
    tb.appendChild(this.sourceSelect);
    tb.appendChild(this._sep());

    // Download and clear buttons.
    const actGroup = document.createElement('div');
    actGroup.className = 'hsl-group';
    this._btn(actGroup, '⬇ JSON', 'Download all records as JSON', () => this._downloadJson());
    this._btn(actGroup, '⬇ .log', 'Download all records as plain text', () => this._downloadText());
    this._btn(actGroup, 'Clear', 'Clear all log records', () => this.clear());
    tb.appendChild(actGroup);

    // Entry count badge (right-aligned via margin-left: auto).
    this.countEl = document.createElement('span');
    this.countEl.className = 'hsl-count muted';
    tb.appendChild(this.countEl);

    // --- Scrollable log panel ---
    this.logEl = document.createElement('div');
    this.logEl.className = 'hsl-log';
    this.logEl.setAttribute('role', 'log');
    this.logEl.setAttribute('aria-live', 'polite');
    this.logEl.innerHTML = '<p class="muted">No headset logs yet.</p>';

    wrap.append(tb, this.logEl);
    this.container.appendChild(wrap);
  }

  /**
   * Create a visual separator between toolbar groups.
   */
  private _sep(): HTMLElement {
    const s = document.createElement('div');
    s.className = 'hsl-sep';
    s.setAttribute('aria-hidden', 'true');
    return s;
  }

  /**
   * Append an action button to ``group``.
   */
  private _btn(group: HTMLElement, text: string, title: string, onClick: () => void): void {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'hsl-btn';
    btn.textContent = text;
    btn.title = title;
    btn.addEventListener('click', onClick);
    group.appendChild(btn);
  }

  // ---------------------------------------------------------------------------
  // Row rendering
  // ---------------------------------------------------------------------------

  /**
   * Build one DOM row for a record, applying initial filter visibility.
   *
   * @param record Record to render.
   * @param highlightRe Regex with global flag for highlight, or null.
   * @param filterRe Stateless regex (no global flag) for visibility testing, or null.
   * @param srcFilter Currently selected source filter value (empty = all).
   */
  private _buildRow(
    record: LogRecord,
    highlightRe: RegExp | null,
    filterRe: RegExp | null,
    srcFilter: string
  ): HTMLElement {
    const cssLevel = LEVEL_CSS[record.level] ?? 'info';
    const levelName = LEVEL_NAMES[record.level] ?? `L${record.level}`;

    const row = document.createElement('div');
    row.className = `hsl-row hsl-row-${cssLevel}`;
    row.dataset.level = String(record.level);
    row.dataset.source = record.headsetId;
    row.dataset.seq = String(record.seq);
    // Store raw message so search can re-evaluate without touching the records array.
    row.dataset.rawMsg = record.message;

    if (!this._visible(record.level, record.headsetId, record.message, filterRe, srcFilter)) {
      row.style.display = 'none';
    }

    // Timestamp.
    const tsEl = document.createElement('span');
    tsEl.className = 'hsl-ts muted';
    tsEl.textContent = record.wallTime;

    // Level badge.
    const badge = document.createElement('span');
    badge.className = `hsl-badge log-badge log-badge-${cssLevel}`;
    badge.textContent = levelName;

    // Source label.
    const srcEl = document.createElement('span');
    srcEl.className = 'hsl-source';
    srcEl.textContent = record.source;

    // Message with optional search highlight.
    const msgEl = document.createElement('span');
    msgEl.className = 'hsl-msg';
    msgEl.innerHTML = this._highlightHtml(record.message, highlightRe);

    row.append(tsEl, badge, srcEl, msgEl);
    return row;
  }

  // ---------------------------------------------------------------------------
  // Filtering
  // ---------------------------------------------------------------------------

  /**
   * True when a row should be visible given the current filter state.
   *
   * @param level Numeric LogLevel.
   * @param headsetId Hub headset id.
   * @param message Raw message text.
   * @param re Stateless regex (no global flag), or null when search is empty.
   * @param srcFilter Active source dropdown value (empty = all).
   */
  private _visible(
    level: number,
    headsetId: string,
    message: string,
    re: RegExp | null,
    srcFilter: string
  ): boolean {
    if (!this.levelCbs[level]?.checked) return false;
    if (srcFilter && headsetId !== srcFilter) return false;
    if (re && !re.test(message) && !re.test(headsetId)) return false;
    return true;
  }

  /**
   * Re-evaluate all rows after any filter change and refresh the count display.
   *
   * Rebuilds highlights in each message span so the current search term is
   * always reflected in the DOM.
   */
  private _applyFilters(): void {
    const filterRe = this._buildRegex(false);
    const highlightRe = this._buildRegex(true);
    const srcFilter = this.sourceSelect.value;
    let visible = 0;
    let matchCount = 0;

    for (const row of Array.from(this.logEl.querySelectorAll<HTMLElement>('.hsl-row'))) {
      const level = parseInt(row.dataset.level ?? '0', 10);
      const src = row.dataset.source ?? '';
      const rawMsg = row.dataset.rawMsg ?? '';

      const show = this._visible(level, src, rawMsg, filterRe, srcFilter);
      row.style.display = show ? '' : 'none';

      // Update highlight in the message span regardless of visibility so it
      // is correct when the row is later revealed by a filter change.
      const msgEl = row.querySelector<HTMLElement>('.hsl-msg');
      if (msgEl) msgEl.innerHTML = this._highlightHtml(rawMsg, highlightRe);

      if (show) {
        visible++;
        // Only count as a search match when the search regex was the deciding factor.
        if (filterRe && (filterRe.test(rawMsg) || filterRe.test(src))) matchCount++;
      }
    }

    // Show match count label only while a search is active.
    const hasSearch = this.searchInput.value.length > 0;
    if (!hasSearch) {
      this.matchCountEl.textContent = '';
      this.searchInput.classList.remove('hsl-search-no-match');
    } else if (matchCount === 0) {
      this.matchCountEl.textContent = 'No matches';
      this.searchInput.classList.add('hsl-search-no-match');
    } else {
      this.matchCountEl.textContent = `${matchCount.toLocaleString()} match${matchCount === 1 ? '' : 'es'}`;
      this.searchInput.classList.remove('hsl-search-no-match');
    }

    this._updateCount();
  }

  /**
   * Schedule a debounced filter refresh (250 ms) to avoid per-keystroke DOM churn.
   */
  private _scheduleSearch(): void {
    if (this.searchTimer !== null) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => {
      this.searchTimer = null;
      this._applyFilters();
    }, 250);
  }

  /**
   * Build a RegExp from the current search input.
   *
   * @param global When true, include the ``g`` flag for highlight replacement.
   *   Without ``g``, ``test()`` is stateless and safe to call multiple times.
   * @returns Compiled regex, or null when the search box is empty.
   */
  private _buildRegex(global = true): RegExp | null {
    const raw = this.searchInput.value;
    if (!raw) return null;
    const flags = global ? 'gi' : 'i';
    // Escape special regex metacharacters so plain-text searches work as expected.
    return new RegExp(raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
  }

  /**
   * Delegate to the module-level {@link highlightHtml} so the class can call
   * it with ``this._highlightHtml(...)`` while the logic stays independently
   * testable via the exported function.
   */
  private _highlightHtml(text: string, re: RegExp | null): string {
    return highlightHtml(text, re);
  }

  /**
   * Delegate to the module-level {@link escHtml} for the same reason as
   * {@link _highlightHtml}.
   */
  private _esc(s: string): string {
    return escHtml(s);
  }

  // ---------------------------------------------------------------------------
  // Counts
  // ---------------------------------------------------------------------------

  /**
   * Update the entry count badge.
   *
   * Shows ``N entries`` when all are visible, ``N / M`` when filtered.
   */
  private _updateCount(): void {
    const total = this.records.length;
    if (total === 0) {
      this.countEl.textContent = '';
      return;
    }
    let visible = 0;
    for (const row of Array.from(this.logEl.querySelectorAll<HTMLElement>('.hsl-row'))) {
      if (row.style.display !== 'none') visible++;
    }
    this.countEl.textContent =
      visible === total
        ? `${total.toLocaleString()} entries`
        : `${visible.toLocaleString()} / ${total.toLocaleString()}`;
  }

  // ---------------------------------------------------------------------------
  // Download
  // ---------------------------------------------------------------------------

  /**
   * Download all records as a JSON array (``headset-logs.json``).
   */
  private _downloadJson(): void {
    this._download(JSON.stringify(this.records, null, 2), 'headset-logs.json', 'application/json');
  }

  /**
   * Download all records as plain text (``headset-logs.log``).
   *
   * Each line: ``[isoTime] [Level  ] [source] message``
   */
  private _downloadText(): void {
    const lines = this.records.map(r => {
      const lvl = (LEVEL_NAMES[r.level] ?? `L${r.level}`).padEnd(7);
      return `[${r.isoTime}] [${lvl}] [${r.source}] ${r.message}`;
    });
    this._download(lines.join('\n'), 'headset-logs.log', 'text/plain');
  }

  /**
   * Trigger a browser file download via a temporary object URL.
   */
  private _download(content: string, filename: string, mime: string): void {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
