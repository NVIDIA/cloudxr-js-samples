/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shared metrics parsing and rolling-series storage used by the hub server and browser UI.
 */

import type { CadenceMetrics, MetricSeries } from '../hub/types';

export type { MetricSeries, CadenceMetrics };

/**
 * Wall-clock history retained per metric series (server and client), regardless of
 * sample rate. A fixed point count would let high-frequency series (e.g. per-frame
 * pipeline stats) cover only seconds while slow cadences cover minutes, leaving
 * charts with mismatched x-axis coverage across series.
 */
export const MAX_METRIC_WINDOW_MS = 5 * 60 * 1000;

/**
 * Hard cap on points per series, guarding against malformed/non-advancing timestamps.
 * Sized above the worst-case in-window sample count so it stays a safety valve rather
 * than the primary trimmer: a 90 Hz series over {@link MAX_METRIC_WINDOW_MS} accumulates
 * ~27 000 points (90 × 300 s), so 30 000 leaves headroom for the time-window loop to drive
 * eviction. Only truly non-advancing/degenerate timestamps hit this cap.
 */
const MAX_METRIC_POINTS_HARD_CAP = 30000;

/** Timestamp column key in batched CloudXR metric payloads. */
export const METRICS_TIMESTAMP_KEY = 't';

/** Nested store: cadence → metric key → {@link MetricSeries}. */
export type MetricSeriesStore = Record<string, Record<string, MetricSeries>>;

/** Latest scalar metrics keyed by cadence name. */
export type MetricsByCadenceStore = Record<string, CadenceMetrics>;

/**
 * Coerce an arbitrary object to a flat string-key → number map.
 * @param raw Unknown payload fragment.
 * @returns Finite numeric entries keyed by string.
 */
export function coerceMetrics(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!raw || typeof raw !== 'object') return out;

  // Keep only finite numbers so chart code never sees NaN holes.
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === 'number' && Number.isFinite(v)) out[String(k)] = v;
  }
  return out;
}

/**
 * True when the payload matches the Teleop ``{ cadence, metrics, t? }`` shape.
 * @param payload Raw ``clientMetrics`` payload.
 */
export function isTeleopMetricsPayload(payload: unknown): boolean {
  return (
    payload !== null &&
    typeof payload === 'object' &&
    typeof (payload as Record<string, unknown>).cadence === 'string' &&
    (payload as Record<string, unknown>).metrics != null &&
    typeof (payload as Record<string, unknown>).metrics === 'object' &&
    !Array.isArray((payload as Record<string, unknown>).metrics)
  );
}

/**
 * True when the payload matches CloudXR batched cadence buckets (``render``, ``frame``, …).
 * @param payload Raw ``clientMetrics`` payload.
 */
export function isBatchedMetricsPayload(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') return false;
  return (
    Object.prototype.hasOwnProperty.call(payload, 'render') ||
    Object.prototype.hasOwnProperty.call(payload, 'frame') ||
    Object.prototype.hasOwnProperty.call(payload, 'network')
  );
}

/**
 * Append one sample to a series, trimming to {@link MAX_METRIC_WINDOW_MS} of history.
 * @param series Target series.
 * @param timeMs Sample timestamp in milliseconds.
 * @param value Numeric sample value.
 */
export function pushMetricPoint(series: MetricSeries, timeMs: number, value: number) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return;

  const t = typeof timeMs === 'number' && Number.isFinite(timeMs) ? timeMs : Date.now();

  series.times.push(t);
  series.values.push(value);

  // Drop points older than the retention window so all cadences cover comparable
  // wall-clock history, regardless of how frequently each one samples.
  while (series.times.length > 1 && t - series.times[0] > MAX_METRIC_WINDOW_MS) {
    series.times.shift();
    series.values.shift();
  }

  // Safety valve for malformed/non-advancing timestamps that would never expire above.
  while (series.times.length > MAX_METRIC_POINTS_HARD_CAP) {
    series.times.shift();
    series.values.shift();
  }
}

/** Keys that would mutate Object prototypes if used as dynamic property names. */
const UNSAFE_STORE_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

/**
 * True when a string is safe to use as a dynamic key on a plain-object store.
 * Rejects prototype-polluting names derived from untrusted payloads.
 * @param key Candidate key from a raw metrics payload.
 */
function isSafeStoreKey(key: string): boolean {
  return !UNSAFE_STORE_KEYS.has(key);
}

/**
 * Get or create a metric series in the nested store.
 * @param store Cadence → metric key store.
 * @param cadence Cadence bucket name.
 * @param metricKey Metric identifier within the cadence.
 * @returns Live series array pair for the cadence/metric key.
 */
export function ensureMetricSeries(
  store: MetricSeriesStore,
  cadence: string,
  metricKey: string
): MetricSeries {
  // Lazily allocate cadence and metric buckets on first sample.
  if (!store[cadence]) store[cadence] = {};

  if (!store[cadence][metricKey]) {
    store[cadence][metricKey] = { times: [], values: [] };
  }

  return store[cadence][metricKey];
}

/**
 * Extract the latest scalar values and timestamp from one batched cadence bucket.
 * @param bucket One cadence object from a batched metrics payload.
 * @returns Latest metric scalars and a wall-clock-ish ``at`` timestamp in ms.
 */
export function latestFromBatch(bucket: Record<string, unknown>) {
  const metrics: Record<string, number> = {};
  let at = Date.now();

  for (const [key, values] of Object.entries(bucket)) {
    if (!Array.isArray(values) || values.length === 0) continue;
    const v = values[values.length - 1];

    // ``t`` arrays carry elapsed seconds; convert to ms for operator UI storage.
    if (key === 't' && typeof v === 'number' && Number.isFinite(v)) {
      at = v < 1e12 ? Math.round(v * 1000) : Math.round(v);
      continue;
    }
    if (typeof v === 'number' && Number.isFinite(v)) metrics[key] = v;
  }
  return { metrics, at };
}

/**
 * Append all samples from a batched cadence bucket into rolling series.
 * @param store Target series store.
 * @param cadence Cadence bucket name.
 * @param bucket Batched arrays per metric key (including optional ``t``).
 * @param receivedAtMs Wall-clock receive time used to reconstruct relative timestamps.
 */
export function appendBatchedSeries(
  store: MetricSeriesStore,
  cadence: string,
  bucket: Record<string, unknown>,
  receivedAtMs: number
) {
  const tArr = bucket.t;
  if (!Array.isArray(tArr) || tArr.length === 0) {
    // Scalar-only bucket — one point per metric at latest timestamp.
    const { metrics, at } = latestFromBatch(bucket);
    for (const [key, value] of Object.entries(metrics)) {
      pushMetricPoint(ensureMetricSeries(store, cadence, key), at, value);
    }
    return;
  }

  const tLast = tArr[tArr.length - 1] as number;

  // Reconstruct absolute ms from relative ``t`` seconds and the batch receive time.
  for (const [key, values] of Object.entries(bucket)) {
    if (key === 't' || !Array.isArray(values)) continue;
    const series = ensureMetricSeries(store, cadence, key);
    for (let i = 0; i < values.length; i++) {
      const tRel = typeof tArr[i] === 'number' ? (tArr[i] as number) : tLast;
      const timeMs = receivedAtMs - (tLast - tRel) * 1000;
      pushMetricPoint(series, timeMs, values[i] as number);
    }
  }
}

/**
 * Ingest headset ``clientMetrics`` (Teleop or CloudXR batched format).
 * @param metricsByCadence Latest-by-cadence store to update.
 * @param metricSeries Rolling series store to append.
 * @param payload Raw message payload.
 * @returns True when the payload was recognized and applied.
 */
export function applyClientMetrics(
  metricsByCadence: MetricsByCadenceStore,
  metricSeries: MetricSeriesStore,
  payload: unknown
): boolean {
  const receivedAt = Date.now();

  if (isTeleopMetricsPayload(payload)) {
    const p = payload as Record<string, unknown>;
    const cadence = String(p.cadence);
    const metrics = coerceMetrics(p.metrics);
    let at = Number(p.t) || receivedAt;

    // Teleop timestamps may be seconds — normalize to ms for operator UI storage.
    if (at < 1e12) at = Math.round(at * 1000);

    // Validate cadence before touching either store — an unsafe cadence like "__proto__"
    // would pollute object prototypes inside ensureMetricSeries before the later check ran.
    if (!isSafeStoreKey(cadence)) return true;

    for (const [key, value] of Object.entries(metrics)) {
      if (!isSafeStoreKey(key)) continue;
      pushMetricPoint(ensureMetricSeries(metricSeries, cadence, key), at, value);
    }

    metricsByCadence[cadence] = { at, metrics };
    return true;
  }

  if (isBatchedMetricsPayload(payload)) {
    // CloudXR batched payload — one object per cadence (render, frame, network).
    for (const [cadence, bucket] of Object.entries(payload as Record<string, unknown>)) {
      if (!isSafeStoreKey(cadence)) continue;
      if (!bucket || typeof bucket !== 'object' || Array.isArray(bucket)) continue;
      const b = bucket as Record<string, unknown>;

      appendBatchedSeries(metricSeries, cadence, b, receivedAt);
      const { metrics, at } = latestFromBatch(b);
      if (Object.keys(metrics).length === 0) continue;
      metricsByCadence[cadence] = { at, metrics };
    }
    return true;
  }

  return false;
}

/**
 * Copy server-provided series into a client store, capped to {@link MAX_METRIC_WINDOW_MS}.
 * @param target Destination store.
 * @param source Snapshot series from hub events.
 */
export function importMetricSeries(
  target: MetricSeriesStore,
  source: Record<string, Record<string, MetricSeries>>
) {
  for (const [cadence, byMetric] of Object.entries(source)) {
    if (!isSafeStoreKey(cadence)) continue;
    if (!byMetric || typeof byMetric !== 'object') continue;
    if (!target[cadence]) target[cadence] = {};

    for (const [metricKey, series] of Object.entries(byMetric)) {
      if (!isSafeStoreKey(metricKey)) continue;
      if (!series?.times?.length) continue;

      // Trim on import so operator UI matches server-side retention policy.
      const newest = series.times[series.times.length - 1];
      let start = 0;
      while (
        start < series.times.length - 1 &&
        newest - series.times[start] > MAX_METRIC_WINDOW_MS
      ) {
        start++;
      }
      start = Math.max(start, series.times.length - MAX_METRIC_POINTS_HARD_CAP);

      target[cadence][metricKey] = {
        times: series.times.slice(start),
        values: series.values.slice(start),
      };
    }
  }
}

/**
 * Find the newest ``at`` timestamp across all cadence entries.
 * @param metricsByCadence Latest metrics per cadence.
 * @returns Newest ``at`` in ms, or null when no cadence has data.
 */
export function latestMetricsAt(metricsByCadence: MetricsByCadenceStore): number | null {
  let max: number | null = null;

  // Scan all cadence buckets — newest ``at`` wins for lastMetricsAt on snapshots.
  for (const entry of Object.values(metricsByCadence)) {
    if (entry?.at != null && (max === null || entry.at > max)) max = entry.at;
  }

  return max;
}
