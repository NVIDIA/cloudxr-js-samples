/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * CloudXR configuration interface containing all streaming settings.
 */
export interface CloudXRConfig {
  /** IP address of the CloudXR streaming server */
  serverIP: string;

  /** Port number for the CloudXR server connection */
  port: number;

  /** Whether to use secure connection (HTTPS/WSS) or insecure (HTTP/WS) */
  useSecureConnection: boolean;

  /** Width of each eye in pixels (must be multiple of 16) */
  perEyeWidth: number;

  /** Height of each eye in pixels (must be multiple of 16) */
  perEyeHeight: number;

  /** Depth reprojection mesh grid vertex columns (not cell columns). Undefined uses factor mode. */
  reprojectionGridCols?: number;

  /** Depth reprojection mesh grid vertex rows (not cell rows). Undefined uses factor mode. */
  reprojectionGridRows?: number;

  /** Target frame rate for the XR device in frames per second (FPS) */
  deviceFrameRate: number;

  /** Maximum streaming bitrate in Megabits per second (Mbps) */
  maxStreamingBitrateMbps: number;

  /** Preferred video codec used for streaming */
  codec?: 'h264' | 'h265' | 'av1';

  /** XR immersive mode: 'ar' for augmented reality, 'vr' for virtual reality */
  immersiveMode: 'ar' | 'vr';

  /** Optional device profile identifier used by the examples UI */
  deviceProfileId?: string;

  /** Application identifier string for the CloudXR session */
  app: string;

  /** Type of server being connected to */
  serverType: string;

  /** Optional proxy URL for HTTPS routing (e.g., 'https://proxy.example.com/'); if empty, uses direct WSS connection */
  proxyUrl: string;

  /** Preferred XR reference space for tracking and positioning */
  referenceSpaceType: 'auto' | 'local-floor' | 'local' | 'viewer' | 'unbounded';

  /** XR reference space offset along X axis in meters (positive is right) */
  xrOffsetX?: number;
  /** XR reference space offset along Y axis in meters (positive is up) */
  xrOffsetY?: number;
  /** XR reference space offset along Z axis in meters (positive is backward) */
  xrOffsetZ?: number;

  /** Enable secondary position smoothing in CloudXR */
  enablePoseSmoothing?: boolean;
  /** Pose prediction factor for CloudXR (0.0-1.0) */
  posePredictionFactor?: number;
  /** Enable texSubImage2D optimization in CloudXR */
  enableTexSubImage2D?: boolean;
  /** Quest-specific color workaround in CloudXR */
  useQuestColorWorkaround?: boolean;
  /** Whether WebXR controller models should be hidden */
  hideControllerModel?: boolean;

  /** Media server address for WebRTC streaming (for NAT traversal) */
  mediaAddress?: string;

  /** Media server port for WebRTC streaming (use 0 for server-provided port) */
  mediaPort?: number;

  /** Per-session client token used to authenticate the connection (kept ephemeral; never persisted) */
  clientToken?: string;

  /** Pre-stream network test duration in seconds */
  streamTestDurationSeconds?: number;

  /** Pre-stream network test mode: 'off' disables it, 'warn' reports, 'block' disconnects on failure */
  streamTestMode?: 'off' | 'warn' | 'block';

  /**
   * Whether to enable microphone capture and upstream audio when streaming starts.
   * Defaults to `true` (mic is enabled on stream start, prompting browser permission).
   * Set to `false` to suppress mic capture entirely for this session.
   * Requires the server to be started with NV_MIC_STREAMING=1.
   */
  micEnabled?: boolean;
}
