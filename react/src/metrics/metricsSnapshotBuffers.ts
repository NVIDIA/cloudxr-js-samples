/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Batched metric sample buffers for metrics hub ``clientMetrics`` payloads.
 *
 * Headset clients accumulate samples until {@link MetricsSnapshotBuffers.takeSnapshot}
 * produces the wire shape consumed by {@link MetricsHubChannel}.
 */

import { MetricsCadence, MetricsName } from '@nvidia/cloudxr';

/** Timestamp column key inside each cadence bucket (parallel to metric sample arrays). */
export const METRICS_TIMESTAMP_KEY = 't';

/** Metric name (or {@link METRICS_TIMESTAMP_KEY}) → samples since the last hub report. */
export type MetricsCadenceBucket = Record<string, number[]>;

/** Latest metrics grouped by {@link MetricsCadence}. */
export type MetricsSnapshot = Partial<Record<MetricsCadence, MetricsCadenceBucket>>;

/** Per-frame cadence samples forwarded from SDK {@link MetricsCadence.PerFrame} callbacks. */
export interface PerFrameMetricSamples {
  /** Streaming decode rate in frames per second. */
  framerate?: number;
  /** Total decoded frames since session start. */
  frameCount?: number;
  /** Pose send to XR render latency in milliseconds. */
  poseToRenderTimeMs?: number;
  /** Pose upload latency in milliseconds. */
  poseUploadMs?: number;
  /** Pose send to decoded frame received latency in milliseconds. */
  poseToFrameReceivedMs?: number;
  /** {@link MetricsName.FramePipelineCompositorSkippedPercent} cumulative share (0–100). */
  compositorSkippedPercent?: number;
  /** {@link MetricsName.FramePipelineOutOfOrderPercent} cumulative share (0–100). */
  outOfOrderPercent?: number;
  /** {@link MetricsName.FramePipelineMismatchedPercent} cumulative share (0–100). */
  mismatchedPercent?: number;
}

/** Accumulates metric samples until {@link MetricsSnapshotBuffers.takeSnapshot}. */
export interface MetricsSnapshotBuffers {
  /**
   * Append {@link MetricsCadence.PerRender} samples for the next hub report.
   * @param metrics - Optional per-render cadence samples (framerate, sendFramerate, xrPoseAgeMs)
   * @param timestampMs - Wall-clock sample time; defaults to `Date.now()`
   */
  recordRender(
    metrics: { framerate?: number; sendFramerate?: number; xrPoseAgeMs?: number },
    timestampMs?: number
  ): void;

  /**
   * Append {@link MetricsCadence.PerFrame} samples for the next hub report.
   * @param metrics - Optional per-frame cadence samples
   * @param timestampMs - Wall-clock sample time; defaults to `Date.now()`
   */
  recordFrame(metrics: PerFrameMetricSamples, timestampMs?: number): void;

  /** Append {@link MetricsCadence.PerNetwork} samples for the next hub report. */
  recordNetwork(
    metrics: {
      streamingRateMbps?: number;
      availableBandwidthMbps?: number;
      rttMs?: number;
      packetLoss?: number;
      avgDecodeTimeMs?: number;
      qualityScore?: number;
      bandwidthScore?: number;
      lossScore?: number;
      latencyScore?: number;
      /** {@link CloudXR.QualityScore} integer (0–4). */
      sessionQuality?: number;
    },
    timestampMs?: number
  ): void;

  /** Returns a copy of buffered samples and clears live buffers; `null` when empty. */
  takeSnapshot(): MetricsSnapshot | null;
}

/**
 * Create empty snapshot buffers for headset → hub metric forwarding.
 * @returns Mutable buffers; hub polls via {@link MetricsSnapshotBuffers.takeSnapshot}.
 */
export function createMetricsSnapshotBuffers(): MetricsSnapshotBuffers {
  const perRender: MetricsCadenceBucket = {};
  const perFrame: MetricsCadenceBucket = {};
  const perNetwork: MetricsCadenceBucket = {};

  const perRenderOrigin = { current: null as number | null };
  const perFrameOrigin = { current: null as number | null };
  const perNetworkOrigin = { current: null as number | null };

  /**
   * Map callback struct fields to hub wire keys, keeping only finite numbers.
   * @param pairs {@link MetricsName} keys with optional sample values.
   */
  const toWireRecord = (
    pairs: Array<[MetricsName, number | undefined]>
  ): Record<string, number> => {
    const out: Record<string, number> = {};

    for (const [key, value] of pairs) {
      if (typeof value === 'number' && Number.isFinite(value)) {
        out[key] = value;
      }
    }

    return out;
  };

  /**
   * Record one SDK callback as aligned parallel arrays (`t` + metric keys).
   *
   * Every series in the bucket — including `t` — always has the same length.
   * When a metric is absent from a callback, its series receives `NaN` so that
   * `appendBatchedSeries` in the hub can pair `tArr[i]` with the correct value
   * at `metricArr[i]` regardless of which keys are present in any given callback.
   * Newly-seen metrics are back-filled with `NaN` for all prior samples.
   *
   * @param bucket Cadence bucket to append into.
   * @param originMs Mutable origin for elapsed-time `t` values in this cadence.
   * @param metrics Numeric metric map keyed by {@link MetricsName}.
   * @param timestampMs Wall-clock sample time.
   */
  const recordSample = (
    bucket: MetricsCadenceBucket,
    originMs: { current: number | null },
    metrics: Record<string, number>,
    timestampMs: number
  ) => {
    // Skip empty callbacks so we do not advance `t` without metric values.
    if (Object.keys(metrics).length === 0) {
      return;
    }

    // Anchor elapsed-time `t` to the first sample in this cadence window.
    if (originMs.current === null) {
      originMs.current = timestampMs;
    }

    // Hub charts expect `t` as seconds since the first sample in this cadence batch.
    const elapsedSec = (timestampMs - originMs.current) / 1000;
    let tArr = bucket[METRICS_TIMESTAMP_KEY];
    if (!tArr) {
      tArr = [];
      bucket[METRICS_TIMESTAMP_KEY] = tArr;
    }
    tArr.push(elapsedSec);
    // tLen is the sample count after this push, used for back-fill length below.
    const tLen = tArr.length;

    // Pad any metric series already in the bucket that are absent in this callback,
    // so they stay length-aligned with `t`.
    for (const key of Object.keys(bucket)) {
      if (key !== METRICS_TIMESTAMP_KEY && !(key in metrics)) {
        bucket[key].push(NaN);
      }
    }

    // Append present metrics; back-fill NaN for all prior t-values when a series is new.
    for (const [key, value] of Object.entries(metrics)) {
      if (!bucket[key]) {
        // First time this key appears: fill the gap so index 0..tLen-2 are NaN.
        bucket[key] = new Array(tLen - 1).fill(NaN);
      }
      bucket[key].push(value);
    }
  };

  /** Shallow-copy bucket arrays so callers can clear live buffers after snapshotting. */
  const copyBucket = (bucket: MetricsCadenceBucket): MetricsCadenceBucket =>
    Object.fromEntries(Object.entries(bucket).map(([name, values]) => [name, [...values]]));

  /**
   * Move one cadence bucket into the outgoing snapshot and reset its live buffer.
   * @param cadence Cadence key written into the snapshot.
   * @param bucket Live cadence bucket.
   * @param originMs Origin timestamp state for this cadence.
   * @param snapshot Outgoing snapshot object.
   */
  const takeCadence = (
    cadence: MetricsCadence,
    bucket: MetricsCadenceBucket,
    originMs: { current: number | null },
    snapshot: MetricsSnapshot
  ) => {
    // Nothing recorded for this cadence since the last hub tick.
    if (Object.keys(bucket).length === 0) {
      return;
    }

    // Detach a copy so the hub can read stable arrays while we clear live buffers.
    snapshot[cadence] = copyBucket(bucket);

    // Clear live arrays so the next window starts fresh.
    for (const key of Object.keys(bucket)) {
      delete bucket[key];
    }

    // Next sample in this cadence gets a new elapsed-time origin.
    originMs.current = null;
  };

  return {
    recordRender(metrics, timestampMs = Date.now()) {
      recordSample(
        perRender,
        perRenderOrigin,
        toWireRecord([
          [MetricsName.RenderFramerate, metrics.framerate],
          [MetricsName.PoseSendFramerate, metrics.sendFramerate],
          [MetricsName.LatencyXrPoseAgeMs, metrics.xrPoseAgeMs],
        ]),
        timestampMs
      );
    },
    recordFrame(metrics, timestampMs = Date.now()) {
      recordSample(
        perFrame,
        perFrameOrigin,
        toWireRecord([
          [MetricsName.StreamingFramerate, metrics.framerate],
          [MetricsName.StreamingFrameCount, metrics.frameCount],
          [MetricsName.PoseToRenderTime, metrics.poseToRenderTimeMs],
          [MetricsName.LatencyPoseUploadMs, metrics.poseUploadMs],
          [MetricsName.LatencyPoseToFrameReceivedMs, metrics.poseToFrameReceivedMs],
          [MetricsName.FramePipelineCompositorSkippedPercent, metrics.compositorSkippedPercent],
          [MetricsName.FramePipelineOutOfOrderPercent, metrics.outOfOrderPercent],
          [MetricsName.FramePipelineMismatchedPercent, metrics.mismatchedPercent],
        ]),
        timestampMs
      );
    },
    recordNetwork(metrics, timestampMs = Date.now()) {
      recordSample(
        perNetwork,
        perNetworkOrigin,
        toWireRecord([
          [MetricsName.NetworkStreamingRateMbps, metrics.streamingRateMbps],
          [MetricsName.NetworkAvailableBandwidthMbps, metrics.availableBandwidthMbps],
          [MetricsName.NetworkRttMs, metrics.rttMs],
          [MetricsName.NetworkPacketLoss, metrics.packetLoss],
          [MetricsName.NetworkAvgDecodeTimeMs, metrics.avgDecodeTimeMs],
          [MetricsName.NetworkQualityScore, metrics.qualityScore],
          [MetricsName.NetworkBandwidthScore, metrics.bandwidthScore],
          [MetricsName.NetworkLossScore, metrics.lossScore],
          [MetricsName.NetworkLatencyScore, metrics.latencyScore],
          [MetricsName.SessionQuality, metrics.sessionQuality],
        ]),
        timestampMs
      );
    },
    takeSnapshot() {
      const snapshot: MetricsSnapshot = {};

      // Flush every cadence bucket that accumulated samples since the last report.
      takeCadence(MetricsCadence.PerRender, perRender, perRenderOrigin, snapshot);
      takeCadence(MetricsCadence.PerFrame, perFrame, perFrameOrigin, snapshot);
      takeCadence(MetricsCadence.PerNetwork, perNetwork, perNetworkOrigin, snapshot);

      // Hub skips empty ticks; return null when no cadence had data.
      return Object.keys(snapshot).length > 0 ? snapshot : null;
    },
  };
}
