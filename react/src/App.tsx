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
 * App.tsx - Main CloudXR React Application
 *
 * This is the root component of the CloudXR React example application. It sets up:
 * - WebXR session management and XR store configuration
 * - CloudXR server configuration (IP, port, stream settings)
 * - UI state management (connection status, session state)
 * - Integration between CloudXR rendering component and UI components
 * - Entry point for AR/VR experiences with CloudXR streaming
 *
 * The app integrates with the HTML interface which provides a "CONNECT" button
 * to enter AR mode and displays the CloudXR UI with generic action buttons
 * and disconnect when in XR mode.
 */

import * as CloudXR from '@nvidia/cloudxr';
import { getResolutionValidationError } from '@nvidia/cloudxr';
import { signal, computed } from '@preact/signals-react';
import { Canvas } from '@react-three/fiber';
import { setPreferredColorScheme } from '@react-three/uikit';
import { XR, createXRStore, noEvents, PointerEvents, XROrigin, useXR } from '@react-three/xr';
import type { XRDevice } from 'iwer';
import { useState, useMemo, useEffect, useRef } from 'react';

import CloudXRComponent from './cloudxr/CloudXRComponent';
import { CloudXR2DUI } from './CloudXR2DUI';
import CloudXR3DUI from './CloudXRUI';
import { SimpleEnvironment } from './components/SimpleEnvironment';
import { resolveStreamTestSeconds } from './config/resolve';
import {
  clearHudMetricSignalsForTerminalStatus,
  poseSendFps,
  poseSendFpsText,
  poseToRenderText,
  renderFps,
  renderFpsText,
  streamingFpsText,
  streamingMetrics,
} from './metrics/hudMetricSignals';
import { createMetricsSnapshotBuffers } from './metrics/metricsHubChannel';
import { isMetricsHubEnabled } from './metrics/metricsHubUrl';
import type { MetricsSnapshotBuffers } from './metrics/metricsSnapshotBuffers';
import { useMetricsHubChannel } from './metrics/useMetricsHubChannel';
import { checkCapabilities } from './utils/BrowserCapabilities';
import { getDeviceProfile, resolveDeviceProfileId } from './utils/DeviceProfiles';
import { setIWERArBackground } from './utils/IWERBackground';
import { loadIWERIfNeeded } from './utils/LoadIWER';
import { requestMicPermission } from './utils/micPermission';
import type { MicPermissionResult } from './utils/micPermission';
import { overridePressureObserver } from './utils/overridePressureObserver';
import { kPerformanceOptions } from './utils/PerformanceProfiles';

// Override PressureObserver early to catch errors from buggy browser implementations
overridePressureObserver();

setPreferredColorScheme('dark');

// Live session quality level (0–4); see CloudXR.QualityScore.
const sessionQualitySignal = signal<number>(0);

// Stream-test signal - text and traffic-light color for the in-VR panel. Module-scoped to match
// the HUD metrics pattern; the result persists until a new session starts or the current one ends.
const streamTest = signal<{ text: string; color: string } | null>(null);
const streamTestText = computed(() => streamTest.value?.text ?? '');
const streamTestColor = computed(() => streamTest.value?.color ?? 'white');

function App() {
  // 2D UI management
  const [cloudXR2DUI, setCloudXR2DUI] = useState<CloudXR2DUI | null>(null);
  // This ref is read by the session-start callback, which can run before React has rerendered.
  const micPermissionResultRef = useRef<MicPermissionResult>('skipped');
  // IWER loading state
  const [iwerLoaded, setIwerLoaded] = useState(false);

  // Capability state management
  const [capabilitiesValid, setCapabilitiesValid] = useState(false);
  const capabilitiesCheckedRef = useRef(false);
  // App-owned stream-test countdown timer (the SDK only signals window start/stop).
  const streamTestCountdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Clear the countdown if the component unmounts mid-test (e.g. user exits XR).
  useEffect(
    () => () => {
      if (streamTestCountdownRef.current) {
        clearInterval(streamTestCountdownRef.current);
        streamTestCountdownRef.current = null;
      }
    },
    []
  );
  // Connection state management
  const [isConnected, setIsConnected] = useState(false);
  // Session status management
  const [sessionStatus, setSessionStatus] = useState('Disconnected');
  // Error message management
  const [errorMessage, setErrorMessage] = useState('');
  // CloudXR session reference
  const [cloudXRSession, setCloudXRSession] = useState<CloudXR.Session | null>(null);
  // XR mode state for UI visibility
  const [isXRMode, setIsXRMode] = useState(false);
  // Server address being used for connection
  const [serverAddress, setServerAddress] = useState<string>('');

  // Load IWER first (must happen before anything else)
  // Note: React Three Fiber's emulation is disabled (emulate: false) to avoid conflicts
  useEffect(() => {
    const loadIWER = async () => {
      const { supportsImmersive, iwerLoaded: wasIwerLoaded } = await loadIWERIfNeeded();
      if (!supportsImmersive) {
        setErrorMessage('Immersive mode not supported');
        setIwerLoaded(false);
        setCapabilitiesValid(false);
        capabilitiesCheckedRef.current = false; // Reset check flag on failure
        return;
      }
      // IWER loaded successfully, now we can proceed with capability checks
      setIwerLoaded(true);
      // Store whether IWER was loaded for status message display later
      if (wasIwerLoaded) {
        sessionStorage.setItem('iwerWasLoaded', 'true');
      }
    };

    loadIWER();
  }, []);

  // Update button state when IWER fails and UI becomes ready
  useEffect(() => {
    if (cloudXR2DUI && !iwerLoaded && !capabilitiesValid) {
      cloudXR2DUI.setStartButtonState(true, 'CONNECT (immersive mode not supported)');
    }
  }, [cloudXR2DUI, iwerLoaded, capabilitiesValid]);

  // Check capabilities once CloudXR2DUI is ready and IWER is loaded
  useEffect(() => {
    const checkCapabilitiesOnce = async () => {
      if (!cloudXR2DUI || !iwerLoaded) {
        return;
      }

      // Guard: only check capabilities once
      if (capabilitiesCheckedRef.current) {
        return;
      }
      capabilitiesCheckedRef.current = true;

      // Disable button and show checking status
      cloudXR2DUI.setStartButtonState(true, 'CONNECT (checking capabilities)');

      // Set by the IWER load effect above; passed to checkCapabilities to skip browser
      // version checks that don't apply when running under a desktop XR emulator.
      const iwerWasLoaded = sessionStorage.getItem('iwerWasLoaded') === 'true';
      let result: { success: boolean; failures: string[]; warnings: string[] } = {
        success: false,
        failures: [],
        warnings: [],
      };
      try {
        result = await checkCapabilities(iwerWasLoaded);
      } catch (error) {
        cloudXR2DUI.showStatus(`Capability check error: ${error}`, 'error');
        setCapabilitiesValid(false);
        cloudXR2DUI.setStartButtonState(true, 'CONNECT (capability check failed)');
        capabilitiesCheckedRef.current = false; // Reset on error for potential retry
        return;
      }
      if (!result.success) {
        cloudXR2DUI.showStatus(
          'Browser does not meet required capabilities:\n' + result.failures.join('\n'),
          'error'
        );
        setCapabilitiesValid(false);
        cloudXR2DUI.setStartButtonState(true, 'CONNECT (capability check failed)');
        capabilitiesCheckedRef.current = false; // Reset on failure for potential retry
        return;
      }

      // Show final status message with IWER info if applicable
      if (result.warnings.length > 0) {
        cloudXR2DUI.showStatus('Performance notice:\n' + result.warnings.join('\n'), 'info');
      } else if (iwerWasLoaded) {
        // Include IWER status in the final success message
        cloudXR2DUI.showStatus(
          'CloudXR.js SDK is supported.\nUsing IWER (Immersive Web Emulator Runtime) - Emulating Meta Quest 3.',
          'info'
        );
      } else {
        cloudXR2DUI.showStatus('CloudXR.js SDK is supported.', 'success');
      }

      setCapabilitiesValid(true);
      cloudXR2DUI.setStartButtonState(false, 'CONNECT');
      cloudXR2DUI.updateConnectButtonState();
    };

    checkCapabilitiesOnce();
  }, [cloudXR2DUI, iwerLoaded]);

  // Track config changes to trigger re-renders when form values change
  const [configVersion, setConfigVersion] = useState(0);

  // Derive the active device profile from the UI. This drives XR store defaults.
  // The UI can change these values, so we need to recompute when config changes.
  const deviceProfile = useMemo(
    () => getDeviceProfile(resolveDeviceProfileId(cloudXR2DUI?.getConfiguration().deviceProfileId)),
    [cloudXR2DUI, configVersion]
  );
  const xrFoveation =
    deviceProfile.web?.foveation ?? kPerformanceOptions.xrWebGLLayer_fixedFoveationLevel;
  const xrFrameBufferScaling =
    deviceProfile.web?.frameBufferScaling ??
    kPerformanceOptions.xrWebGLLayer_framebufferScaleFactor;

  // XR store must be created after we know which device profile is active.
  // useMemo prevents re-creating the store for unrelated UI changes.
  const store = useMemo(
    () =>
      createXRStore({
        emulate: false, // Disable IWER emulation from react in favor of custom iwer loading function
        foveation: xrFoveation,
        // CloudXRComponent applies the configured rate before CloudXR negotiates the stream.
        // Disabling the store's automatic "high" preference avoids racing that negotiation.
        frameRate: false,
        frameBufferScaling: xrFrameBufferScaling,
        // Use local WebXR input profile assets only when bundled (optional build without assets)
        ...(process.env.WEBXR_ASSETS_VERSION && {
          baseAssetPath: `${new URL('.', window.location.href).href}npm/@webxr-input-profiles/assets@${process.env.WEBXR_ASSETS_VERSION}/dist/profiles/`,
        }),
        hand: {
          model: false, // Disable hand models but keep pointer functionality
        },
        // Request optional WebXR features - use property names, not optionalFeatures array!
        handTracking: true,
        bodyTracking: true,
        // Explicitly disable environment/scene feature requests to avoid extra headset prompts.
        anchors: false,
        layers: false,
        meshDetection: false,
        planeDetection: false,
        depthSensing: false,
        domOverlay: false,
        hitTest: false,
        // Explicitly enable session offer flows; keep session entry on explicit button action.
        offerSession: true,
      }),
    [xrFoveation, xrFrameBufferScaling]
  );

  // Initialize CloudXR2DUI
  useEffect(() => {
    // Create and initialize the 2D UI manager
    const ui = new CloudXR2DUI(() => {
      // Callback when configuration changes
      setConfigVersion(v => v + 1);
    });
    ui.initialize();
    ui.setupConnectButtonHandler(
      async () => {
        // Reset React state so an identical failure from this retry is delivered again.
        setErrorMessage('');

        const config = ui.getConfiguration();
        const resolutionError = getResolutionValidationError(
          config.perEyeWidth,
          config.perEyeHeight
        );
        if (resolutionError) {
          ui.updateConnectButtonState();
          return;
        }

        // Show the browser's microphone prompt while this click still owns the user gesture,
        // before WebXR becomes immersive. Chrome can exit immersive mode when this prompt
        // appears after enterAR()/enterVR().
        const result = await requestMicPermission(config.micEnabled !== false);
        micPermissionResultRef.current = result;
        if (result === 'denied') {
          ui.showError(
            'Microphone permission denied — grant mic access, or disable upstream audio and try again.'
          );
          ui.setStartButtonState(false, 'CONNECT');
          ui.updateConnectButtonState();
          return;
        }
        if (result === 'unavailable') {
          ui.showStatus('No microphone found — connecting without audio.', 'info');
        }

        // Start XR session
        if (config.immersiveMode === 'ar') {
          await store.enterAR();
        } else if (ui.getConfiguration().immersiveMode === 'vr') {
          await store.enterVR();
        } else {
          setErrorMessage('Unrecognized immersive mode');
        }
      },
      (error: Error) => {
        setErrorMessage(`Failed to start XR session: ${error}`);
      }
    );

    setCloudXR2DUI(ui);

    // Cleanup function
    return () => {
      if (ui) {
        ui.cleanup();
      }
    };
  }, [store]);

  // Update HTML error message display when error state changes
  useEffect(() => {
    if (cloudXR2DUI) {
      if (errorMessage) {
        cloudXR2DUI.showError(errorMessage);
      } else {
        cloudXR2DUI.hideError();
      }
    }
  }, [errorMessage, cloudXR2DUI]);

  // Listen for XR session state changes to update button and UI visibility
  useEffect(() => {
    const handleXRStateChange = () => {
      const xrState = store.getState();

      if (xrState.mode === 'immersive-ar' || xrState.mode === 'immersive-vr') {
        // XR session is active

        setIsXRMode(true);
        // Under IWER on desktop there is no real passthrough, so the emulator
        // composites the transparent XR canvas over this page's HTML. Replace
        // that bleed-through with a neutral dark checkerboard for passthrough AR
        // only. Gate on the true IWER-runtime signal (sessionStorage) rather
        // than the `iwerLoaded` state, which just means immersive-ready and is
        // also true on real headsets, and confirm passthrough via the session's
        // blend mode (matching the simple example). No-op on real devices, in
        // VR, and in opaque AR.
        const iwerWasLoaded = sessionStorage.getItem('iwerWasLoaded') === 'true';
        const isPassthrough =
          xrState.session != null && xrState.session.environmentBlendMode !== 'opaque';
        setIWERArBackground(iwerWasLoaded && xrState.mode === 'immersive-ar' && isPassthrough);
        if (cloudXR2DUI) {
          cloudXR2DUI.setStartButtonState(true, 'CONNECT (XR session active)');
        }
      } else {
        // XR session ended
        setIsXRMode(false);
        // Restore the normal page background (removes the IWER AR checkerboard).
        setIWERArBackground(false);
        if (cloudXR2DUI) {
          cloudXR2DUI.setStartButtonState(false, 'CONNECT');
          cloudXR2DUI.updateConnectButtonState();
        }

        if (xrState.error) {
          setErrorMessage(`XR session error: ${xrState.error}`);
        }
      }
    };

    // Subscribe to XR state changes
    const unsubscribe = store.subscribe(handleXRStateChange);

    // Cleanup
    return () => {
      unsubscribe();
      setIsXRMode(false);
      // Ensure the emulated-AR backdrop never outlives this component.
      setIWERArBackground(false);
    };
  }, [cloudXR2DUI, store]);

  /**
   * Updates connection status and clears stale metrics when the stream ends.
   * @param connected - True when the stream is connected.
   * @param status - Human-readable session status string.
   */
  const handleStatusChange = (connected: boolean, status: string) => {
    setIsConnected(connected);
    setSessionStatus(status);
    if (!connected || status !== 'Connected') {
      // Clear the previous session's indicator until fresh quality data arrives.
      sessionQualitySignal.value = 0;
    }
    clearHudMetricSignalsForTerminalStatus(status);
    // Forward streaming state to the hub (no-op when the channel is inactive).
    metricsHubRef.current?.sendStreamStatus(connected && status === 'Connected');
  };

  const handleSessionReady = (session: CloudXR.Session | null) => {
    // Clear the network-test indicator and countdown on both a new session and a teardown.
    // onStreamTestStopped does not fire on a mid-test disconnect (abort is not a result), so this
    // is what stops a countdown still running when the user disconnects during the test window.
    if (streamTestCountdownRef.current) {
      clearInterval(streamTestCountdownRef.current);
      streamTestCountdownRef.current = null;
    }
    streamTest.value = null;
    setCloudXRSession(session);
  };

  /**
   * Helper to send a message using MessageChannel API (new) or legacy API (fallback).
   * Automatically uses the first available message channel if present.
   */
  const sendMessage = async (message: any) => {
    if (!cloudXRSession) {
      console.error('CloudXR session not available');
      return false;
    }

    // Try new MessageChannel API first
    const channels = cloudXRSession.availableMessageChannels;
    if (channels.length > 0) {
      const channel = channels[0];
      console.log(`Using MessageChannel API (${channels.length} channels available)`);

      try {
        const encoder = new TextEncoder();
        const data = encoder.encode(JSON.stringify(message));
        const success = channel.sendServerMessage(data);
        if (success) {
          console.log('Message sent via MessageChannel:', message);
        } else {
          console.error('Failed to send message via MessageChannel');
        }
        return success;
      } catch (error) {
        console.error('Error sending via MessageChannel:', error);
        return false;
      }
    }

    // Fallback to legacy API
    console.log('Using legacy sendServerMessage API');
    try {
      cloudXRSession.sendServerMessage(message);
      console.log('Message sent via legacy API:', message);
      return true;
    } catch (error) {
      console.error('Error sending via legacy API:', error);
      return false;
    }
  };

  // UI Event Handlers
  const handleAction1 = async () => {
    console.log('Action 1 pressed');
    const success = await sendMessage({ type: 'action', message: { action: 'action_1' } });
    if (!success) {
      console.error('Failed to send Action 1 message');
    }
  };

  const handleAction2 = async () => {
    console.log('Action 2 pressed');
    const success = await sendMessage({ type: 'action', message: { action: 'action_2' } });
    if (!success) {
      console.error('Failed to send Action 2 message');
    }
  };

  const handleDisconnect = () => {
    console.log('Disconnect pressed');
    const xrState = store.getState();
    const session = xrState.session;
    if (session) {
      session.end().catch((err: unknown) => {
        setErrorMessage(
          `Failed to end XR session: ${err instanceof Error ? err.message : String(err)}`
        );
      });
    }
  };

  // CloudXR metrics hub (opt-in via ?oobEnable=1). Buffer the SDK metrics and
  // push them to the hub; ref keeps the buffers stable across re-renders.
  const metricsSnapshotBuffersRef = useRef<ReturnType<typeof createMetricsSnapshotBuffers> | null>(
    null
  );
  if (metricsSnapshotBuffersRef.current === null) {
    metricsSnapshotBuffersRef.current = createMetricsSnapshotBuffers();
  }

  // Hub host is the CloudXR stream Server IP (no separate param); set by onServerAddress.
  const hubServerIP = useMemo(() => serverAddress.trim(), [serverAddress]);

  // Constant URL opt-in (?oobEnable=1); gates the per-frame recording below.
  const oobEnabled = useMemo(
    () => isMetricsHubEnabled(new URLSearchParams(window.location.search)),
    []
  );
  const metricsHubRef = useMetricsHubChannel({
    // Hook bails on oobEnable/hubServerIP itself, so only the UI-ready gate is needed here.
    enabled: cloudXR2DUI !== null,
    hubServerIP,
    getMetricsSnapshot: () => metricsSnapshotBuffersRef.current!.takeSnapshot(),
  });

  /** Feed render FPS and pose send FPS to the HUD signals and record the sample to the hub render buffer when active. */
  const handleRenderPerformanceMetrics = (
    metrics: Parameters<MetricsSnapshotBuffers['recordRender']>[0]
  ) => {
    if (metrics.framerate !== undefined) renderFps.value = metrics.framerate;
    if (metrics.sendFramerate !== undefined) poseSendFps.value = metrics.sendFramerate;
    // sendBegin and renderBegin emit separate PerRender callbacks, so any key alone is sufficient.
    if (
      oobEnabled &&
      (metrics.framerate !== undefined ||
        metrics.sendFramerate !== undefined ||
        metrics.xrPoseAgeMs !== undefined)
    )
      metricsSnapshotBuffersRef.current!.recordRender(metrics);
  };

  /** Update the streaming HUD signal (FPS + latency) and forward the sample to the hub frame buffer when active. */
  const handleStreamingPerformanceMetrics = (
    metrics: Parameters<MetricsSnapshotBuffers['recordFrame']>[0]
  ) => {
    // Preserve previous HUD values for fields absent in this partial callback.
    if (metrics.framerate !== undefined || metrics.poseToRenderTimeMs !== undefined) {
      const prev = streamingMetrics.value ?? { fps: 0, latencyMs: 0 };
      streamingMetrics.value = {
        fps: metrics.framerate ?? prev.fps,
        latencyMs: metrics.poseToRenderTimeMs ?? prev.latencyMs,
      };
    }
    if (oobEnabled) metricsSnapshotBuffersRef.current!.recordFrame(metrics);
  };

  /** Forward network metrics to the hub buffer; no-op when hub is inactive. */
  const handleNetworkPerformanceMetrics = (
    metrics: Parameters<MetricsSnapshotBuffers['recordNetwork']>[0]
  ) => {
    if (metrics.sessionQuality !== undefined) {
      // Keep the quality indicator synced with the latest per-network cadence sample.
      sessionQualitySignal.value = metrics.sessionQuality;
    }
    // Partial updates are OK; empty structs are skipped inside recordNetwork.
    if (oobEnabled) metricsSnapshotBuffersRef.current!.recordNetwork(metrics);
  };

  const stopNetworkTestCountdown = () => {
    if (streamTestCountdownRef.current) {
      clearInterval(streamTestCountdownRef.current);
      streamTestCountdownRef.current = null;
    }
  };

  // Fired once when the measurement window begins; app drives its own countdown from config.
  const handleStreamTestStarted = () => {
    stopNetworkTestCountdown();
    // Normalize once so the countdown mirrors the SDK-supported measurement window.
    let remaining = resolveStreamTestSeconds(config?.streamTestDurationSeconds);
    const tick = () => {
      // Hold at 0 until the result arrives; don't tick into negatives.
      if (remaining <= 0) {
        streamTest.value = { text: 'Testing network… 0s', color: '#ffd24d' };
        stopNetworkTestCountdown();
        return;
      }
      streamTest.value = { text: `Testing network… ${remaining}s`, color: '#ffd24d' };
      remaining -= 1;
    };
    tick();
    streamTestCountdownRef.current = setInterval(tick, 1000);
  };

  const handleStreamTestStopped = (result: CloudXR.StreamTestResult) => {
    stopNetworkTestCountdown();
    // Light is consistent with the gate: red ⟺ failed. On a pass, green when every gated dimension
    // is Good+, else yellow as a caution (a gated dimension came back only Poor/Fair).
    let color: string;
    let label: string;
    // Worst over the gated dimensions that have data; empty (all NoData) treated as NoData.
    const measured = [
      result.latencyScore,
      result.jitterScore,
      result.bandwidthScore,
      result.devicePerformanceScore,
    ].filter(s => s !== CloudXR.QualityScore.NoData);
    if (!result.passed) {
      color = '#ff5d5d'; // red — failed the gate
      label = 'failed';
    } else {
      const worst = measured.length ? Math.min(...measured) : CloudXR.QualityScore.NoData;
      color = worst >= CloudXR.QualityScore.Good ? '#5dd35d' : '#ffd24d';
      label = 'passed';
    }
    // QualityScore is a numeric enum; reverse-map to its name (e.g. Excellent, Poor) so the panel
    // reads as a quality rating rather than an ambiguous "5/5".
    const scoreName = (s: CloudXR.QualityScore) => CloudXR.QualityScore[s];
    streamTest.value = {
      text: `Stream test ${label} — latency: ${scoreName(result.latencyScore)}, jitter: ${scoreName(result.jitterScore)}, ${result.serverFps ?? '-'} fps`,
      color,
    };
  };

  // Memo config based on configVersion (manual dependency tracker incremented on config changes)

  const config = useMemo(
    () => (cloudXR2DUI ? cloudXR2DUI.getConfiguration() : null),
    [cloudXR2DUI, configVersion]
  );

  // Sync XR mode state to body class for CSS styling
  useEffect(() => {
    if (isXRMode) {
      document.body.classList.add('xr-mode');
    } else {
      document.body.classList.remove('xr-mode');
    }

    return () => {
      document.body.classList.remove('xr-mode');
    };
  }, [isXRMode]);

  // Set up message receiving from MessageChannel (new API) or legacy callback
  // Poll for channel availability since channels can be announced at any time
  useEffect(() => {
    // Wait for Connected: opening a channel sends a control message that requires the
    // session to be connected (it is still Connecting during the network test).
    if (!cloudXRSession || !isConnected) {
      return;
    }

    let active = true;
    let receiverActive = false;

    const checkAndSetupReceiver = () => {
      if (!active || receiverActive) return;

      const channels = cloudXRSession.availableMessageChannels;
      if (channels.length > 0) {
        // Use new MessageChannel API
        const channel = channels[0];
        console.log('Setting up MessageChannel receiver');
        receiverActive = true;

        const receiveMessages = async () => {
          while (active) {
            try {
              const data = await channel.receiveMessage();
              if (data === null) {
                console.log('MessageChannel closed');
                break;
              }

              // Decode and handle message
              const decoder = new TextDecoder();
              const messageText = decoder.decode(data);
              console.log('Received message via MessageChannel:', messageText);

              // Parse if JSON
              try {
                const message = JSON.parse(messageText);
                console.log('Parsed message:', message);
                // Handle message here if needed
              } catch {
                console.log('Non-JSON message:', messageText);
              }
            } catch (error) {
              console.error('Error receiving message:', error);
              break;
            }
          }
        };

        receiveMessages();
      }
    };

    // Check immediately
    checkAndSetupReceiver();

    // Poll every 1 second to check if channels become available
    const pollInterval = setInterval(checkAndSetupReceiver, 1000);

    return () => {
      active = false;
      clearInterval(pollInterval);
    };
  }, [cloudXRSession, isConnected]);

  return (
    <>
      <Canvas
        events={noEvents}
        style={{
          background: '#000',
          width: '100vw',
          height: '100vh',
          position: 'fixed',
          top: 0,
          left: 0,
          zIndex: -1,
        }}
        gl={{
          alpha: true, // R3F default, but being explicit
          depth: true,
          stencil: false,
          antialias:
            deviceProfile.web?.webglAntialias ?? kPerformanceOptions.webglContext_antialias,
          // desynchronized omitted — WebGL spec defaults to false (synchronous presentation), so the explicit opt-out is redundant.
          failIfMajorPerformanceCaveat: true,
          powerPreference: deviceProfile.web?.powerPreference ?? 'high-performance', // R3F default, but being explicit
          premultipliedAlpha: false,
          preserveDrawingBuffer: true, // Keep buffer for custom rendering
        }}
        camera={{ position: [0, 0, 0.65] }}
        onWheel={e => {
          e.preventDefault();
        }}
      >
        <PointerEvents batchEvents={false} />
        <XR store={store}>
          <SimpleEnvironment />
          <XROrigin />
          {cloudXR2DUI && config && (
            <>
              <CloudXRComponent
                config={config}
                micPermissionResultRef={micPermissionResultRef}
                applicationName="CloudXR React Example"
                onStatusChange={handleStatusChange}
                onError={error => {
                  if (cloudXR2DUI) {
                    cloudXR2DUI.showError(error);
                  }
                }}
                onSessionReady={handleSessionReady}
                onServerAddress={setServerAddress}
                onRenderPerformanceMetrics={handleRenderPerformanceMetrics}
                onStreamingPerformanceMetrics={handleStreamingPerformanceMetrics}
                onNetworkPerformanceMetrics={handleNetworkPerformanceMetrics}
                streamTest={
                  config.streamTestMode && config.streamTestMode !== 'off'
                    ? {
                        // Normalize before passing config so the UI and SDK use the same duration.
                        durationSeconds: resolveStreamTestSeconds(config.streamTestDurationSeconds),
                        mode: config.streamTestMode,
                      }
                    : undefined
                }
                onStreamTestStarted={handleStreamTestStarted}
                onStreamTestStopped={handleStreamTestStopped}
              />
              <CloudXR3DUI
                onAction1={handleAction1}
                onAction2={handleAction2}
                onDisconnect={handleDisconnect}
                serverAddress={serverAddress || config.serverIP}
                sessionStatus={sessionStatus}
                renderFpsText={renderFpsText}
                poseSendFpsText={poseSendFpsText}
                streamingFpsText={streamingFpsText}
                poseToRenderText={poseToRenderText}
                sessionQuality={sessionQualitySignal}
                streamTestText={streamTestText}
                streamTestColor={streamTestColor}
                position={[0, 1.6, -1.8]}
                rotation={[0, 0, 0]}
              />
            </>
          )}
        </XR>
      </Canvas>
    </>
  );
}

export default App;
