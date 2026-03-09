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

import { checkCapabilities } from '@helpers/BrowserCapabilities';
import { getDeviceProfile, resolveDeviceProfileId } from '@helpers/DeviceProfiles';
import { loadIWERIfNeeded } from '@helpers/LoadIWER';
import { overridePressureObserver } from '@helpers/overridePressureObserver';
import { kPerformanceOptions } from '@helpers/PerformanceProfiles';
import CloudXRComponent from '@helpers/react/CloudXRComponent';
import { SimpleEnvironment } from '@helpers/react/SimpleEnvironment';
import * as CloudXR from '@nvidia/cloudxr';
import { getResolutionValidationError } from '@nvidia/cloudxr';
import { Canvas } from '@react-three/fiber';
import { setPreferredColorScheme } from '@react-three/uikit';
import { XR, createXRStore, noEvents, PointerEvents, XROrigin, useXR } from '@react-three/xr';
import { useState, useMemo, useEffect, useRef } from 'react';

import { CloudXR2DUI } from './CloudXR2DUI';
import CloudXR3DUI from './CloudXRUI';

// Override PressureObserver early to catch errors from buggy browser implementations
overridePressureObserver();

setPreferredColorScheme('dark');

function App() {
  // 2D UI management
  const [cloudXR2DUI, setCloudXR2DUI] = useState<CloudXR2DUI | null>(null);
  // IWER loading state
  const [iwerLoaded, setIwerLoaded] = useState(false);
  // Capability state management
  const [capabilitiesValid, setCapabilitiesValid] = useState(false);
  const capabilitiesCheckedRef = useRef(false);
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

      let result: { success: boolean; failures: string[]; warnings: string[] } = {
        success: false,
        failures: [],
        warnings: [],
      };
      try {
        result = await checkCapabilities();
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
      const iwerWasLoaded = sessionStorage.getItem('iwerWasLoaded') === 'true';
      if (result.warnings.length > 0) {
        cloudXR2DUI.showStatus('Performance notice:\n' + result.warnings.join('\n'), 'info');
      } else if (iwerWasLoaded) {
        // Include IWER status in the final success message
        cloudXR2DUI.showStatus(
          'CloudXR.js SDK is supported. Ready to connect!\nUsing IWER (Immersive Web Emulator Runtime) - Emulating Meta Quest 3.',
          'info'
        );
      } else {
        cloudXR2DUI.showStatus('CloudXR.js SDK is supported. Ready to connect!', 'success');
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
        frameBufferScaling: xrFrameBufferScaling,
        // Use local WebXR input profile assets only when bundled (optional build without assets)
        ...(process.env.WEBXR_ASSETS_VERSION && {
          baseAssetPath: `${new URL('.', window.location).href}npm/@webxr-input-profiles/assets@${process.env.WEBXR_ASSETS_VERSION}/dist/profiles/`,
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
        const config = ui.getConfiguration();
        const resolutionError = getResolutionValidationError(
          config.perEyeWidth,
          config.perEyeHeight
        );
        if (resolutionError) {
          ui.updateConnectButtonState();
          return;
        }
        // Start XR session
        if (config.immersiveMode === 'ar') {
          await store.enterAR();
        } else if (ui.getConfiguration().immersiveMode === 'vr') {
          await store.enterVR();
        } else {
          setErrorMessage('Unrecognized immersive mode');
        }
        store.setFrameRate((supportedFrameRates: ArrayLike<number>): number | false => {
          let frameRate = ui.getConfiguration().deviceFrameRate;
          // ArrayLike may not have includes; do a manual search.
          let found = false;
          for (let i = 0; i < supportedFrameRates.length; ++i) {
            if (supportedFrameRates[i] === frameRate) {
              found = true;
              break;
            }
          }
          if (found) {
            console.info('Requested frame rate', frameRate, 'is supported; requested it.');
            return frameRate;
          } else {
            console.warn('Requested frame rate', frameRate, 'is not supported; using default.');
            return false;
          }
        });
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
        if (cloudXR2DUI) {
          cloudXR2DUI.setStartButtonState(true, 'CONNECT (XR session active)');
        }
      } else {
        // XR session ended
        setIsXRMode(false);
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
    };
  }, [cloudXR2DUI, store]);

  // CloudXR status change handler
  const handleStatusChange = (connected: boolean, status: string) => {
    setIsConnected(connected);
    setSessionStatus(status);
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

  // Memo config based on configVersion (manual dependency tracker incremented on config changes)
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
    if (!cloudXRSession) {
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
  }, [cloudXRSession]);

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
          desynchronized: false,
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
                applicationName="CloudXR React Example"
                onStatusChange={handleStatusChange}
                onError={error => {
                  if (cloudXR2DUI) {
                    cloudXR2DUI.showError(error);
                  }
                }}
                onSessionReady={setCloudXRSession}
                onServerAddress={setServerAddress}
              />
              <CloudXR3DUI
                onAction1={handleAction1}
                onAction2={handleAction2}
                onDisconnect={handleDisconnect}
                serverAddress={serverAddress || config.serverIP}
                sessionStatus={sessionStatus}
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
