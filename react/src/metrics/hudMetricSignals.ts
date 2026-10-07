/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { computed, signal } from '@preact/signals-react';

/** Latest render frame rate reported by the CloudXR session. */
export const renderFps = signal<number | null>(null);

/** Latest pose-send frame rate reported by the CloudXR session. */
export const poseSendFps = signal<number | null>(null);

/** Latest streaming frame rate and pose-to-render latency reported by the CloudXR session. */
export const streamingMetrics = signal<{ fps: number; latencyMs: number } | null>(null);

/** Render frame rate formatted for the performance HUD. */
export const renderFpsText = computed(() =>
  // Keep an empty placeholder until the session reports a current sample.
  renderFps.value !== null ? renderFps.value.toFixed(1) : '-'
);

/** Pose-send frame rate formatted for the performance HUD. */
export const poseSendFpsText = computed(() =>
  // Match the render-rate placeholder until the session reports a current sample.
  poseSendFps.value !== null ? poseSendFps.value.toFixed(1) : '-'
);

/** Streaming frame rate formatted for the performance HUD. */
export const streamingFpsText = computed(() =>
  // Keep an empty placeholder when no streaming sample is available.
  streamingMetrics.value ? streamingMetrics.value.fps.toFixed(1) : '-'
);

/** Pose-to-render latency formatted for the performance HUD. */
export const poseToRenderText = computed(() =>
  // Include the unit only when a current latency sample is available.
  streamingMetrics.value ? `${streamingMetrics.value.latencyMs.toFixed(1)}ms` : '-'
);

/**
 * Clears values from the previous session after the stream reaches a terminal status.
 * @param status Human-readable session status reported by the CloudXR component.
 */
export function clearHudMetricSignalsForTerminalStatus(status: string): void {
  // Preserve current metrics through non-terminal transitions such as the pre-stream network test.
  if (status === 'Disconnected' || status === 'Error') {
    // Null values render as empty cards until the next session reports fresh metrics.
    renderFps.value = null;
    poseSendFps.value = null;
    streamingMetrics.value = null;
  }
}
