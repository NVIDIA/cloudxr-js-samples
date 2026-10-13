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
 * CloudXRComponent.tsx - CloudXR WebXR Integration Component
 *
 * This component handles the core CloudXR streaming functionality and WebXR integration.
 * It manages:
 * - CloudXR session lifecycle (creation, connection, disconnection, cleanup)
 * - WebXR session event handling (sessionstart, sessionend)
 * - WebGL state management and render target preservation
 * - Frame-by-frame rendering loop with pose tracking and stream rendering
 * - Server configuration and connection parameters
 * - Status reporting back to parent components
 *
 * The component accepts configuration via props and communicates status changes
 * and disconnect requests through callback props. It integrates with Three.js
 * and React Three Fiber for WebXR rendering while preserving WebGL state
 * for CloudXR's custom rendering pipeline.
 */

import * as CloudXR from '@nvidia/cloudxr';
import { useThree, useFrame } from '@react-three/fiber';
import { useXR } from '@react-three/xr';
import { useRef, useEffect } from 'react';
import type { MutableRefObject } from 'react';
import type { WebGLRenderer, WebXRManager } from 'three';

import type { CloudXRConfig } from '../config/CloudXRConfig';
import type { MetricsSnapshotBuffers } from '../metrics/metricsSnapshotBuffers';
import { getConnectionConfig, ConnectionConfiguration } from '../utils/configuration';
import { applyTargetFrameRate, FrameRateSession } from '../utils/frameRate';
import type { MicPermissionResult } from '../utils/micPermission';

import { MetricsTracker } from './Metrics';
import { bindGL } from './WebGLStateBinding';

/**
 * Props for the CloudXRComponent.
 */
interface CloudXRComponentProps {
  /** CloudXR configuration including server address, resolution, and XR settings. */
  config: CloudXRConfig;

  /** Microphone permission snapshot captured before entering the XR session. */
  micPermissionResultRef: MutableRefObject<MicPermissionResult>;

  /** Application name used for telemetry. */
  applicationName: string;

  /** Callback fired when connection status changes. Receives connection state and human-readable status message. */
  onStatusChange?: (isConnected: boolean, status: string) => void;

  /** Callback fired when an error occurs. Receives error message string. */
  onError?: (error: string) => void;

  /** Callback fired when CloudXR session is created or destroyed. Receives session instance or null. */
  onSessionReady?: (session: CloudXR.Session | null) => void;

  /** Callback fired with the resolved server address after proxy configuration is applied. */
  onServerAddress?: (address: string) => void;

  /** Callback fired with render performance metrics ({@link MetricsCadence.PerRender}). */
  onRenderPerformanceMetrics?: (
    metrics: Parameters<MetricsSnapshotBuffers['recordRender']>[0]
  ) => void;

  /** Callback fired with streaming performance metrics ({@link MetricsCadence.PerFrame}). */
  onStreamingPerformanceMetrics?: (
    metrics: Parameters<MetricsSnapshotBuffers['recordFrame']>[0]
  ) => void;

  /** Callback fired with network performance metrics ({@link MetricsCadence.PerNetwork}). */
  onNetworkPerformanceMetrics?: (
    metrics: Parameters<MetricsSnapshotBuffers['recordNetwork']>[0]
  ) => void;

  /**
   * Callback fired with batched SDK log entries for forwarding to the operator hub.
   *
   * Receives the same entries already printed to the browser console; callers
   * can pass them straight to {@link HeadsetControlChannel.sendLogs}.
   */
  onLog?: (entries: CloudXR.LogEntry[]) => void;

  /** Pre-stream session test configuration. When set, the SDK measures quality before streaming starts. */
  streamTest?: { durationSeconds: number; mode: 'off' | 'warn' | 'block' };

  /** Callback fired once when the session test's measurement window begins. */
  onStreamTestStarted?: () => void;

  /** Callback fired when the session test finishes, with its result. */
  onStreamTestStopped?: (result: CloudXR.StreamTestResult) => void;

  /**
   * Settings for the performance metrics reported via onRenderPerformanceMetrics and onStreamingPerformanceMetrics callbacks.
   * Each window size controls how many samples are averaged before reporting.
   */
  metricsSettings?: {
    /** Window size for render FPS rolling average. Default: 100 */
    renderFpsWindow?: number;
    /** Window size for streaming FPS rolling average. Default: 20 */
    streamingFpsWindow?: number;
    /** Window size for pose-to-render latency rolling average. Default: 20 */
    poseToRenderWindow?: number;
  };

  /**
   * When true, skip WebGL rendering.
   */
  headless?: boolean;
}

/**
 * React component that integrates CloudXR with Three.js/WebXR.
 * Manages the CloudXR session lifecycle, render loop, and performance metrics
 * reporting. Mount inside an {@link XR} context so it can access the XR session
 * and the Three.js WebGL renderer.
 */
export default function CloudXRComponent({
  config,
  micPermissionResultRef,
  applicationName,
  onStatusChange,
  onError,
  onSessionReady,
  onServerAddress,
  onRenderPerformanceMetrics,
  onStreamingPerformanceMetrics,
  onNetworkPerformanceMetrics,
  onLog,
  streamTest,
  onStreamTestStarted,
  onStreamTestStopped,
  metricsSettings = {},
  headless = false,
}: CloudXRComponentProps) {
  const threeRenderer: WebGLRenderer = useThree().gl;
  const { session } = useXR();
  // React reference to the CloudXR session that persists across re-renders.
  const cxrSessionRef = useRef<CloudXR.Session | null>(null);

  // Metrics trackers for averaging performance metrics
  // Use prop values if provided, otherwise use defaults
  const renderFpsTrackerRef = useRef<MetricsTracker>(
    new MetricsTracker(metricsSettings.renderFpsWindow ?? 100)
  );
  const poseSendFpsTrackerRef = useRef<MetricsTracker>(new MetricsTracker(100));
  const streamingFpsTrackerRef = useRef<MetricsTracker>(
    new MetricsTracker(metricsSettings.streamingFpsWindow ?? 20)
  );
  const poseToRenderTrackerRef = useRef<MetricsTracker>(
    new MetricsTracker(metricsSettings.poseToRenderWindow ?? 20)
  );

  // Disable Three.js so it doesn't clear the framebuffer after CloudXR renders.
  threeRenderer.autoClear = false;

  // Access Three.js WebXRManager and WebGL context.
  const gl: WebGL2RenderingContext = threeRenderer.getContext() as WebGL2RenderingContext;

  const trackedGL = bindGL(gl);

  // Set up event listeners in useEffect to add them only once
  useEffect(() => {
    const webXRManager = threeRenderer.xr;

    if (webXRManager) {
      const handleSessionStart = async () => {
        const xrSession = (webXRManager as WebXRManager).getSession();

        // CloudXR must advertise the rate actually used by the headset. Wait for WebXR to
        // apply the configured rate before creating the CloudXR session to avoid a pacing race.
        const effectiveDeviceFrameRate = xrSession
          ? await applyTargetFrameRate(xrSession as FrameRateSession, config.deviceFrameRate)
          : config.deviceFrameRate;

        // Explicitly request the desired reference space from the XRSession to avoid
        // inheriting a default 'local-floor' space that could stack with UI offsets.
        let referenceSpace: XRReferenceSpace | null = null;
        try {
          if (xrSession) {
            if (config.referenceSpaceType === 'auto') {
              const fallbacks: XRReferenceSpaceType[] = [
                'local-floor',
                'local',
                'viewer',
                'unbounded',
              ];
              for (const t of fallbacks) {
                try {
                  referenceSpace = await xrSession.requestReferenceSpace(t);
                  if (referenceSpace) break;
                } catch (_) {}
              }
            } else {
              try {
                referenceSpace = await xrSession.requestReferenceSpace(
                  config.referenceSpaceType as XRReferenceSpaceType
                );
              } catch (error) {
                console.error(
                  `Failed to request reference space '${config.referenceSpaceType}':`,
                  error
                );
              }
            }
          }
        } catch (error) {
          console.error('Failed to request XR reference space:', error);
          referenceSpace = null;
        }

        if (!referenceSpace) {
          // As a last resort, fall back to WebXRManager's current reference space
          referenceSpace = webXRManager.getReferenceSpace();
        }

        if (referenceSpace) {
          // Ensure that the session is not already created.
          if (cxrSessionRef.current) {
            console.error('CloudXR session already exists');
            return;
          }

          const glBinding = webXRManager.getBinding();
          if (!glBinding) {
            console.warn('No WebGL binding found');
          }

          // Apply proxy configuration logic
          let connectionConfig: ConnectionConfiguration;
          try {
            connectionConfig = getConnectionConfig(config.serverIP, config.port, config.proxyUrl);
            onServerAddress?.(connectionConfig.serverIP);
          } catch (error) {
            onStatusChange?.(false, 'Configuration Error');
            onError?.(`Proxy configuration failed: ${error}`);
            return;
          }

          // Apply XR offset if provided in config (meters)
          const offsetX = config.xrOffsetX || 0;
          const offsetY = config.xrOffsetY || 0;
          const offsetZ = config.xrOffsetZ || 0;
          if (offsetX !== 0 || offsetY !== 0 || offsetZ !== 0) {
            const offsetTransform = new XRRigidTransform(
              { x: offsetX, y: offsetY, z: offsetZ },
              { x: 0, y: 0, z: 0, w: 1 }
            );
            referenceSpace = referenceSpace.getOffsetReferenceSpace(offsetTransform);
          }

          // Fill in CloudXR session options.
          const cloudXROptions: CloudXR.SessionOptions = {
            serverAddress: connectionConfig.serverIP,
            serverPort: connectionConfig.port,
            useSecureConnection: connectionConfig.useSecureConnection,
            signalingResourcePath: connectionConfig.resourcePath,
            clientToken: config.clientToken,
            perEyeWidth: config.perEyeWidth,
            perEyeHeight: config.perEyeHeight,
            reprojectionGridCols: config.reprojectionGridCols,
            reprojectionGridRows: config.reprojectionGridRows,
            codec: config.codec,
            gl: gl,
            referenceSpace: referenceSpace,
            deviceFrameRate: effectiveDeviceFrameRate,
            maxStreamingBitrateKbps: config.maxStreamingBitrateMbps * 1000, // Convert Mbps to Kbps
            enablePoseSmoothing: config.enablePoseSmoothing,
            posePredictionFactor: config.posePredictionFactor,
            enableTexSubImage2D: config.enableTexSubImage2D,
            useQuestColorWorkaround: config.useQuestColorWorkaround,
            mediaAddress: config.mediaAddress,
            mediaPort: config.mediaPort,
            glBinding: glBinding,
            streamTest,
            logLevel: CloudXR.LogLevel.Info, // Deliver Info-and-above SDK logs to onLog
            telemetry: {
              enabled: true,
              appInfo: {
                version: '6.4.0',
                product: applicationName,
              },
            },
          };

          // Store the render target and key GL bindings to restore after CloudXR rendering
          const cloudXRDelegates: CloudXR.SessionDelegates = {
            onLog: (entries: CloudXR.LogEntry[]) => {
              // When no onLog prop is provided, mirror entries to the browser console directly
              // so SDK logs are always visible in DevTools. When an onLog prop IS provided,
              // the caller owns routing (e.g. hub-only forwarding) — avoid duplicate console lines.
              if (!onLog) {
                for (const { level, message } of entries) {
                  // Pick the console method matching this severity so DevTools filtering works.
                  const printFn =
                    level === CloudXR.LogLevel.Error
                      ? console.error
                      : level === CloudXR.LogLevel.Warning
                        ? console.warn
                        : level === CloudXR.LogLevel.Debug
                          ? console.debug
                          : console.info;
                  printFn(`[CloudXR] ${message}`);
                }
              }

              // Forward the batch to the caller (hub log forwarding, etc.).
              onLog?.(entries);
            },
            onWebGLStateChangeBegin: () => {
              // Save the current render target before CloudXR changes state
              trackedGL.save();
            },
            onWebGLStateChangeEnd: () => {
              // Restore the tracked GL state to the state before CloudXR rendering.
              trackedGL.restore();
            },
            onStreamStarted: () => {
              console.debug('CloudXR stream started');
              onStatusChange?.(true, 'Connected');
              // Enable mic only if the pre-flight check confirmed permission was granted.
              if (micPermissionResultRef.current === 'granted') {
                cxrSession.setMicEnabled(true);
              }
            },
            onMicStateUpdate: (state: CloudXR.MicState) => {
              // Log every mic transition to aid permission/device debugging.
              console.info('[CloudXR] Mic state:', CloudXR.MicState[state]);
            },
            onStreamTestStarted: () => {
              onStatusChange?.(false, 'Testing network');
              onStreamTestStarted?.();
            },
            onStreamTestStopped: result => {
              console.debug('Session test complete:', result);
              onStreamTestStopped?.(result);
            },
            onStreamStopped: (error?: CloudXR.StreamingError) => {
              if (error) {
                // Display user-friendly error message with error code if available
                const errorMsg = error.code
                  ? `${error.message} (Error code: 0x${error.code.toString(16).toUpperCase()})`
                  : error.message;

                console.error('Stream stopped with error:', errorMsg);
                onStatusChange?.(false, 'Error');
                onError?.(`CloudXR session stopped: ${errorMsg}`);

                // Log additional debug info if available
                if (error.reasonCode !== undefined) {
                  console.debug('Stop reason code:', error.reasonCode);
                }
              } else {
                console.debug('CloudXR session stopped');
                onStatusChange?.(false, 'Disconnected');
              }
              // Clear the session reference
              cxrSessionRef.current = null;
              onSessionReady?.(null);
            },
            onMetrics: (metrics: CloudXR.Metrics, cadence: CloudXR.MetricsCadence) => {
              if (onRenderPerformanceMetrics && cadence === CloudXR.MetricsCadence.PerRender) {
                // Only forward keys present in this PerRender tick (pose age is optional).
                onRenderPerformanceMetrics({
                  ...(metrics[CloudXR.MetricsName.RenderFramerate] !== undefined && {
                    framerate: renderFpsTrackerRef.current.add(
                      metrics[CloudXR.MetricsName.RenderFramerate]!
                    ),
                  }),
                  ...(metrics[CloudXR.MetricsName.PoseSendFramerate] !== undefined && {
                    sendFramerate: poseSendFpsTrackerRef.current.add(
                      metrics[CloudXR.MetricsName.PoseSendFramerate]!
                    ),
                  }),
                  ...(metrics[CloudXR.MetricsName.LatencyXrPoseAgeMs] !== undefined && {
                    xrPoseAgeMs: metrics[CloudXR.MetricsName.LatencyXrPoseAgeMs],
                  }),
                });
              }

              if (onStreamingPerformanceMetrics && cadence === CloudXR.MetricsCadence.PerFrame) {
                // PerFrame callbacks are partial (render vs decode paths); omit absent keys.
                onStreamingPerformanceMetrics({
                  ...(metrics[CloudXR.MetricsName.StreamingFramerate] !== undefined && {
                    framerate: streamingFpsTrackerRef.current.add(
                      metrics[CloudXR.MetricsName.StreamingFramerate]!
                    ),
                  }),
                  ...(metrics[CloudXR.MetricsName.StreamingFrameCount] !== undefined && {
                    frameCount: metrics[CloudXR.MetricsName.StreamingFrameCount],
                  }),
                  ...(metrics[CloudXR.MetricsName.PoseToRenderTime] !== undefined && {
                    poseToRenderTimeMs: poseToRenderTrackerRef.current.add(
                      metrics[CloudXR.MetricsName.PoseToRenderTime]!
                    ),
                  }),
                  ...(metrics[CloudXR.MetricsName.LatencyPoseUploadMs] !== undefined && {
                    poseUploadMs: metrics[CloudXR.MetricsName.LatencyPoseUploadMs],
                  }),
                  ...(metrics[CloudXR.MetricsName.LatencyPoseToFrameReceivedMs] !== undefined && {
                    poseToFrameReceivedMs:
                      metrics[CloudXR.MetricsName.LatencyPoseToFrameReceivedMs],
                  }),
                  ...(metrics[CloudXR.MetricsName.FramePipelineCompositorSkippedPercent] !==
                    undefined && {
                    compositorSkippedPercent:
                      metrics[CloudXR.MetricsName.FramePipelineCompositorSkippedPercent],
                  }),
                  ...(metrics[CloudXR.MetricsName.FramePipelineOutOfOrderPercent] !== undefined && {
                    outOfOrderPercent: metrics[CloudXR.MetricsName.FramePipelineOutOfOrderPercent],
                  }),
                  ...(metrics[CloudXR.MetricsName.FramePipelineMismatchedPercent] !== undefined && {
                    mismatchedPercent: metrics[CloudXR.MetricsName.FramePipelineMismatchedPercent],
                  }),
                });
              }

              if (onNetworkPerformanceMetrics && cadence === CloudXR.MetricsCadence.PerNetwork) {
                // Quality and statistics arrive as partial PerNetwork updates.
                onNetworkPerformanceMetrics({
                  ...(metrics[CloudXR.MetricsName.NetworkStreamingRateMbps] !== undefined && {
                    streamingRateMbps: metrics[CloudXR.MetricsName.NetworkStreamingRateMbps],
                  }),
                  ...(metrics[CloudXR.MetricsName.NetworkAvailableBandwidthMbps] !== undefined && {
                    availableBandwidthMbps:
                      metrics[CloudXR.MetricsName.NetworkAvailableBandwidthMbps],
                  }),
                  ...(metrics[CloudXR.MetricsName.NetworkRttMs] !== undefined && {
                    rttMs: metrics[CloudXR.MetricsName.NetworkRttMs],
                  }),
                  ...(metrics[CloudXR.MetricsName.NetworkPacketLoss] !== undefined && {
                    packetLoss: metrics[CloudXR.MetricsName.NetworkPacketLoss],
                  }),
                  ...(metrics[CloudXR.MetricsName.NetworkAvgDecodeTimeMs] !== undefined && {
                    avgDecodeTimeMs: metrics[CloudXR.MetricsName.NetworkAvgDecodeTimeMs],
                  }),
                  ...(metrics[CloudXR.MetricsName.NetworkQualityScore] !== undefined && {
                    qualityScore: metrics[CloudXR.MetricsName.NetworkQualityScore],
                  }),
                  ...(metrics[CloudXR.MetricsName.NetworkBandwidthScore] !== undefined && {
                    bandwidthScore: metrics[CloudXR.MetricsName.NetworkBandwidthScore],
                  }),
                  ...(metrics[CloudXR.MetricsName.NetworkLossScore] !== undefined && {
                    lossScore: metrics[CloudXR.MetricsName.NetworkLossScore],
                  }),
                  ...(metrics[CloudXR.MetricsName.NetworkLatencyScore] !== undefined && {
                    latencyScore: metrics[CloudXR.MetricsName.NetworkLatencyScore],
                  }),
                  ...(metrics[CloudXR.MetricsName.SessionQuality] !== undefined && {
                    sessionQuality: metrics[CloudXR.MetricsName.SessionQuality],
                  }),
                });
              }
            },
          };

          // Create the CloudXR session.
          let cxrSession: CloudXR.Session;
          try {
            cxrSession = CloudXR.createSession(cloudXROptions, cloudXRDelegates);
          } catch (error) {
            onStatusChange?.(false, 'Session Creation Failed');
            onError?.(`Failed to create CloudXR session: ${error}`);
            return;
          }

          // Store the session in the ref so it persists across re-renders
          cxrSessionRef.current = cxrSession;

          // Notify parent that session is ready
          onSessionReady?.(cxrSession);

          // Start session (synchronous call that initiates connection)
          try {
            cxrSession.connect();
            console.log('CloudXR session connect initiated');
            // Note: The session will transition to Connected state via the onStreamStarted callback
            // Use cxrSession.state to check if streaming has actually started
          } catch (error) {
            onStatusChange?.(false, 'Connection Failed');
            // Report error via callback
            onError?.('Failed to connect CloudXR session');
            // Clean up the failed session
            cxrSessionRef.current = null;
          }
        }
      };

      const handleSessionEnd = () => {
        if (cxrSessionRef.current) {
          cxrSessionRef.current.disconnect();
          cxrSessionRef.current = null;
          onSessionReady?.(null);
        }
      };

      // Add start+end session event listeners to the WebXRManager.
      webXRManager.addEventListener('sessionstart', handleSessionStart);
      webXRManager.addEventListener('sessionend', handleSessionEnd);

      // Cleanup function to remove listeners
      return () => {
        webXRManager.removeEventListener('sessionstart', handleSessionStart);
        webXRManager.removeEventListener('sessionend', handleSessionEnd);
      };
    }
  }, [threeRenderer, config]); // Re-register handlers when renderer or config changes

  // Custom render loop - runs every frame
  useFrame((state, delta) => {
    const webXRManager = threeRenderer.xr;

    if (webXRManager.isPresenting && session) {
      // Access the current WebXR XRFrame
      const xrFrame = state.gl.xr.getFrame();
      if (xrFrame) {
        // Get THREE WebXRManager from the useFrame state.
        const webXRManager = state.gl.xr;

        if (!cxrSessionRef || !cxrSessionRef.current) {
          console.debug('Skipping frame, no session yet');
          if (!headless) {
            // Clear the framebuffer as we've set autoClear to false.
            threeRenderer.clear();
          }
          return;
        }

        // Get session from reference.
        const cxrSession: CloudXR.Session = cxrSessionRef.current;

        // Get timestamp from useFrame state and convert to milliseconds.
        const timestamp: DOMHighResTimeStamp = state.clock.elapsedTime * 1000;

        // Pump tracking during Connecting so the SDK can read
        // XRSession.enabledFeatures from these early frames to detect
        // capabilities (e.g. body-tracking) before the stream starts.
        // It returns false while Connecting but may throw deferred exceptions
        // (handled below).
        if (cxrSession.state === CloudXR.SessionState.Connecting) {
          try {
            cxrSession.sendTrackingStateToServer(timestamp, xrFrame);
          } catch (error) {
            console.error('CloudXR render loop error:', error);
            return;
          }
        }

        // If the CloudXR session is not connected, skip the frame.
        if (cxrSession.state !== CloudXR.SessionState.Connected) {
          console.debug('Skipping frame, session not connected, state:', cxrSession.state);
          if (!headless) {
            // Clear the framebuffer as we've set autoClear to false.
            threeRenderer.clear();
          }
          return;
        }

        try {
          // Send the tracking state (including viewer pose and hand/controller data) to the server;
          // that triggers server-side rendering for the frame.
          cxrSession.sendTrackingStateToServer(timestamp, xrFrame);

          if (!headless) {
            const layer: XRWebGLLayer = webXRManager.getBaseLayer() as XRWebGLLayer;
            cxrSession.render(timestamp, xrFrame, layer);
          }
        } catch (error) {
          // Handle deferred exceptions from callbacks or render errors
          const errorMessage = error instanceof Error ? error.message : String(error);
          console.error('CloudXR render loop error:', error);
          // Disconnect session on error
          cxrSession.disconnect();
          onError?.(`CloudXR error: ${errorMessage}`);
        }
      }
    }
  }, -1000);

  return null;
}
