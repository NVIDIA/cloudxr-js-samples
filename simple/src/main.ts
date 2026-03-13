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
 * CloudXR.js Simple Example - WebXR Streaming Application
 *
 * CloudXR streams XR content from a powerful server to lightweight clients (think Netflix for VR/AR).
 * Server does the heavy rendering, client displays video and sends back tracking data.
 *
 * Key Flow:
 * 1. constructor()           - Initialize UI and check browser support
 * 2. connectToCloudXR()      - Connect to server (called on CONNECT button click)
 * 3. initializeWebGL()       - Set up graphics rendering
 * 4. createXRSession()       - Enter VR/AR mode
 * 5. createCloudXRSession()  - Configure CloudXR streaming
 * 6. onXRFrame()            - Render loop: send tracking, receive & display video frames
 */

import { checkCapabilities } from '@helpers/BrowserCapabilities';
import {
  getDeviceProfile,
  resolveDeviceProfileId,
  type DeviceProfile,
  type DeviceProfileId,
} from '@helpers/DeviceProfiles';
import { loadIWERIfNeeded } from '@helpers/LoadIWER';
import { overridePressureObserver } from '@helpers/overridePressureObserver';
import { kPerformanceOptions } from '@helpers/PerformanceProfiles';
import {
  enableLocalStorage,
  getConnectionConfig,
  getGridFromInputs,
  getResolutionFromInputs,
  setupCertificateAcceptanceLink,
} from '@helpers/utils';
import { getOrCreateCanvas, logOrThrow } from '@helpers/WebGlUtils';
import {
  createSession,
  getGridValidationError,
  getGridValidationMessageForConnect,
  getResolutionValidationError,
  getResolutionValidationMessageForConnect,
  type Session,
  type SessionDelegates,
  type SessionOptions,
  type StreamingError,
  SessionState,
  validateDepthReprojectionGrid,
  validatePerEyeResolution,
} from '@nvidia/cloudxr';

// Override PressureObserver early to catch errors from buggy browser implementations
overridePressureObserver();

/**
 * CloudXR Client - Main Application Class
 *
 * Architecture: WebXR (hardware access) + WebGL (rendering) + CloudXR (streaming)
 */
class CloudXRClient {
  // UI Elements - Form inputs and display elements
  private startButton: HTMLButtonElement;
  private exitButton: HTMLButtonElement;
  private serverIpInput: HTMLInputElement;
  private portInput: HTMLInputElement;
  private proxyUrlInput: HTMLInputElement;
  private immersiveSelect: HTMLSelectElement;
  private deviceFrameRateSelect: HTMLSelectElement;
  private maxStreamingBitrateMbpsSelect: HTMLSelectElement;
  private proxyDefaultText: HTMLElement;
  private statusMessageBox: HTMLElement;
  private statusMessageText: HTMLElement;
  private perEyeWidthInput: HTMLInputElement;
  private perEyeHeightInput: HTMLInputElement;
  private reprojectionGridColsInput: HTMLInputElement;
  private reprojectionGridRowsInput: HTMLInputElement;
  private resolutionWidthValidationMessage: HTMLElement | null;
  private resolutionHeightValidationMessage: HTMLElement | null;
  private reprojectionGridColsValidationMessage: HTMLElement | null;
  private reprojectionGridRowsValidationMessage: HTMLElement | null;
  private validationMessageBox: HTMLElement;
  private validationMessageText: HTMLElement;
  private capabilitiesValid = false;
  private referenceSpaceSelect: HTMLSelectElement;
  private xrOffsetXInput: HTMLInputElement;
  private xrOffsetYInput: HTMLInputElement;
  private xrOffsetZInput: HTMLInputElement;
  private certAcceptanceLink: HTMLElement;
  private certLink: HTMLAnchorElement;
  private enablePoseSmoothingSelect: HTMLSelectElement;
  private posePredictionFactorInput: HTMLInputElement;
  private posePredictionFactorValue: HTMLElement;
  private enableTexSubImage2DSelect: HTMLSelectElement;
  private useQuestColorWorkaroundSelect: HTMLSelectElement;
  private xrWebGLLayerAlphaSelect: HTMLSelectElement;
  private xrWebGLLayerDepthSelect: HTMLSelectElement;
  private deviceProfileSelect: HTMLSelectElement;
  private deviceProfileWarning: HTMLElement;
  private mediaAddressInput: HTMLInputElement;
  private mediaPortInput: HTMLInputElement;
  private codecSelect: HTMLSelectElement;

  private deviceProfileId: DeviceProfileId = 'custom';
  private deviceProfile: DeviceProfile = getDeviceProfile('custom');

  // Core Session Components
  private xrSession: XRSession | null = null; // WebXR session (hardware access)
  private cloudxrSession: Session | null = null; // CloudXR session (streaming)
  private gl: WebGL2RenderingContext | null = null; // WebGL context (rendering)
  private baseLayer: XRWebGLLayer | null = null; // Bridge between WebXR and WebGL
  private deviceFrameRate: number = 0; // Target frame rate for XR session
  private hasSetTargetFrameRate: boolean = false; // Track if we've set target frame rate

  private onWebGLInitializedCallback?: (
    gl: WebGL2RenderingContext,
    useQuestColorWorkaround: boolean,
    referenceSpace: XRReferenceSpace
  ) => Promise<void>;
  private onXRFrameCallback?: (
    timestamp: DOMHighResTimeStamp,
    frame: XRFrame,
    gl: WebGL2RenderingContext,
    baseLayer: XRWebGLLayer
  ) => Promise<void>;
  private onCleanupCallback?: () => void;

  /**
   * Initialize UI, enable localStorage, and check WebXR support
   */
  constructor(options?: {
    onWebGLInitialized?: (
      gl: WebGL2RenderingContext,
      useQuestColorWorkaround: boolean,
      referenceSpace: XRReferenceSpace
    ) => Promise<void>;
    onXRFrame?: (
      timestamp: DOMHighResTimeStamp,
      frame: XRFrame,
      gl: WebGL2RenderingContext,
      baseLayer: XRWebGLLayer
    ) => Promise<void>;
    onCleanup?: () => void;
  }) {
    // Store callbacks
    this.onWebGLInitializedCallback = options?.onWebGLInitialized;
    this.onXRFrameCallback = options?.onXRFrame;
    this.onCleanupCallback = options?.onCleanup;
    // Get references to all UI elements
    this.startButton = document.getElementById('startButton') as HTMLButtonElement;
    this.exitButton = document.getElementById('exitButton') as HTMLButtonElement;
    this.serverIpInput = document.getElementById('serverIpInput') as HTMLInputElement;
    this.portInput = document.getElementById('portInput') as HTMLInputElement;
    this.proxyUrlInput = document.getElementById('proxyUrl') as HTMLInputElement;
    this.immersiveSelect = document.getElementById('immersive') as HTMLSelectElement;
    this.deviceFrameRateSelect = document.getElementById('deviceFrameRate') as HTMLSelectElement;
    this.maxStreamingBitrateMbpsSelect = document.getElementById(
      'maxStreamingBitrateMbps'
    ) as HTMLSelectElement;
    this.proxyDefaultText = document.getElementById('proxyDefaultText') as HTMLElement;
    this.statusMessageBox = document.getElementById('statusMessageBox') as HTMLElement;
    this.statusMessageText = document.getElementById('statusMessageText') as HTMLElement;
    this.validationMessageBox = document.getElementById('validationMessageBox') as HTMLElement;
    this.validationMessageText = document.getElementById('validationMessageText') as HTMLElement;
    this.perEyeWidthInput = document.getElementById('perEyeWidth') as HTMLInputElement;
    this.perEyeHeightInput = document.getElementById('perEyeHeight') as HTMLInputElement;
    this.reprojectionGridColsInput = document.getElementById(
      'reprojectionGridCols'
    ) as HTMLInputElement;
    this.reprojectionGridRowsInput = document.getElementById(
      'reprojectionGridRows'
    ) as HTMLInputElement;
    this.resolutionWidthValidationMessage = document.getElementById(
      'resolutionWidthValidationMessage'
    );
    this.resolutionHeightValidationMessage = document.getElementById(
      'resolutionHeightValidationMessage'
    );
    this.reprojectionGridColsValidationMessage = document.getElementById(
      'reprojectionGridColsValidationMessage'
    );
    this.reprojectionGridRowsValidationMessage = document.getElementById(
      'reprojectionGridRowsValidationMessage'
    );
    this.referenceSpaceSelect = document.getElementById('referenceSpace') as HTMLSelectElement;
    this.xrOffsetXInput = document.getElementById('xrOffsetX') as HTMLInputElement;
    this.xrOffsetYInput = document.getElementById('xrOffsetY') as HTMLInputElement;
    this.xrOffsetZInput = document.getElementById('xrOffsetZ') as HTMLInputElement;
    this.certAcceptanceLink = document.getElementById('certAcceptanceLink') as HTMLElement;
    this.certLink = document.getElementById('certLink') as HTMLAnchorElement;
    this.enablePoseSmoothingSelect = document.getElementById(
      'enablePoseSmoothing'
    ) as HTMLSelectElement;
    this.posePredictionFactorInput = document.getElementById(
      'posePredictionFactor'
    ) as HTMLInputElement;
    this.posePredictionFactorValue = document.getElementById(
      'posePredictionFactorValue'
    ) as HTMLElement;
    this.enableTexSubImage2DSelect = document.getElementById(
      'enableTexSubImage2D'
    ) as HTMLSelectElement;
    this.useQuestColorWorkaroundSelect = document.getElementById(
      'useQuestColorWorkaround'
    ) as HTMLSelectElement;
    this.xrWebGLLayerAlphaSelect = document.getElementById(
      'xrWebGLLayerAlpha'
    ) as HTMLSelectElement;
    this.xrWebGLLayerDepthSelect = document.getElementById(
      'xrWebGLLayerDepth'
    ) as HTMLSelectElement;
    this.deviceProfileSelect = document.getElementById('deviceProfile') as HTMLSelectElement;
    this.deviceProfileWarning = document.getElementById('deviceProfileWarning') as HTMLElement;
    this.mediaAddressInput = document.getElementById('mediaAddress') as HTMLInputElement;
    this.mediaPortInput = document.getElementById('mediaPort') as HTMLInputElement;
    this.codecSelect = document.getElementById('codec') as HTMLSelectElement;

    // Enable localStorage to persist user settings
    enableLocalStorage(this.serverIpInput, 'serverIp');
    enableLocalStorage(this.portInput, 'port');
    enableLocalStorage(this.proxyUrlInput, 'proxyUrl');
    enableLocalStorage(this.immersiveSelect, 'immersiveMode');
    enableLocalStorage(this.deviceFrameRateSelect, 'deviceFrameRate');
    enableLocalStorage(this.maxStreamingBitrateMbpsSelect, 'maxStreamingBitrateMbps');
    enableLocalStorage(this.perEyeWidthInput, 'perEyeWidth');
    enableLocalStorage(this.perEyeHeightInput, 'perEyeHeight');
    enableLocalStorage(this.reprojectionGridColsInput, 'reprojectionGridCols');
    enableLocalStorage(this.reprojectionGridRowsInput, 'reprojectionGridRows');
    enableLocalStorage(this.referenceSpaceSelect, 'referenceSpace');
    enableLocalStorage(this.xrOffsetXInput, 'xrOffsetX');
    enableLocalStorage(this.xrOffsetYInput, 'xrOffsetY');
    enableLocalStorage(this.xrOffsetZInput, 'xrOffsetZ');
    enableLocalStorage(this.enablePoseSmoothingSelect, 'enablePoseSmoothing');
    enableLocalStorage(this.posePredictionFactorInput, 'posePredictionFactor');
    enableLocalStorage(this.enableTexSubImage2DSelect, 'enableTexSubImage2D');
    enableLocalStorage(this.useQuestColorWorkaroundSelect, 'useQuestColorWorkaround');
    enableLocalStorage(this.xrWebGLLayerAlphaSelect, 'xrWebGLLayerAlpha');
    enableLocalStorage(this.xrWebGLLayerDepthSelect, 'xrWebGLLayerDepth');
    enableLocalStorage(this.deviceProfileSelect, 'deviceProfile');
    enableLocalStorage(this.mediaAddressInput, 'mediaAddress');
    enableLocalStorage(this.mediaPortInput, 'mediaPort');
    enableLocalStorage(this.codecSelect, 'codec');

    // Update slider value display when it changes
    this.posePredictionFactorInput.addEventListener('input', () => {
      this.posePredictionFactorValue.textContent = this.posePredictionFactorInput.value;
    });
    // Set initial display value
    this.posePredictionFactorValue.textContent = this.posePredictionFactorInput.value;

    // Initialize device profile from restored value (do not overwrite form; form was restored from localStorage)
    this.setDeviceProfile(resolveDeviceProfileId(this.deviceProfileSelect.value), false);
    this.deviceProfileSelect.addEventListener('change', () => {
      this.setDeviceProfile(resolveDeviceProfileId(this.deviceProfileSelect.value), true);
      this.persistProfileFieldsToLocalStorage();
    });

    this.setProfileToCustomOnProfileLinkedChange(this.perEyeWidthInput, 'input');
    this.setProfileToCustomOnProfileLinkedChange(this.perEyeWidthInput, 'change');
    this.setProfileToCustomOnProfileLinkedChange(this.perEyeHeightInput, 'input');
    this.setProfileToCustomOnProfileLinkedChange(this.perEyeHeightInput, 'change');
    this.setProfileToCustomOnProfileLinkedChange(this.reprojectionGridColsInput, 'input');
    this.setProfileToCustomOnProfileLinkedChange(this.reprojectionGridColsInput, 'change');
    this.setProfileToCustomOnProfileLinkedChange(this.reprojectionGridRowsInput, 'input');
    this.setProfileToCustomOnProfileLinkedChange(this.reprojectionGridRowsInput, 'change');
    this.updateResolutionValidationMessage();
    this.updateGridValidationMessage();
    const updateResValidation = () => this.updateResolutionValidationMessage();
    this.perEyeWidthInput.addEventListener('input', updateResValidation);
    this.perEyeWidthInput.addEventListener('change', updateResValidation);
    this.perEyeWidthInput.addEventListener('blur', updateResValidation);
    this.perEyeWidthInput.addEventListener('keyup', updateResValidation);
    this.perEyeHeightInput.addEventListener('input', updateResValidation);
    this.perEyeHeightInput.addEventListener('change', updateResValidation);
    this.perEyeHeightInput.addEventListener('blur', updateResValidation);
    this.perEyeHeightInput.addEventListener('keyup', updateResValidation);
    const updateGridValidation = () => this.updateGridValidationMessage();
    this.reprojectionGridColsInput.addEventListener('input', updateGridValidation);
    this.reprojectionGridColsInput.addEventListener('change', updateGridValidation);
    this.reprojectionGridColsInput.addEventListener('blur', updateGridValidation);
    this.reprojectionGridColsInput.addEventListener('keyup', updateGridValidation);
    this.reprojectionGridRowsInput.addEventListener('input', updateGridValidation);
    this.reprojectionGridRowsInput.addEventListener('change', updateGridValidation);
    this.reprojectionGridRowsInput.addEventListener('blur', updateGridValidation);
    this.reprojectionGridRowsInput.addEventListener('keyup', updateGridValidation);
    this.setProfileToCustomOnProfileLinkedChange(this.deviceFrameRateSelect, 'change');
    this.setProfileToCustomOnProfileLinkedChange(this.maxStreamingBitrateMbpsSelect, 'change');
    this.setProfileToCustomOnProfileLinkedChange(this.codecSelect, 'change');
    this.setProfileToCustomOnProfileLinkedChange(this.enablePoseSmoothingSelect, 'change');
    this.setProfileToCustomOnProfileLinkedChange(this.posePredictionFactorInput, 'change');
    this.setProfileToCustomOnProfileLinkedChange(this.posePredictionFactorInput, 'input');
    this.setProfileToCustomOnProfileLinkedChange(this.enableTexSubImage2DSelect, 'change');
    this.setProfileToCustomOnProfileLinkedChange(this.useQuestColorWorkaroundSelect, 'change');
    this.setProfileToCustomOnProfileLinkedChange(this.xrWebGLLayerAlphaSelect, 'change');
    this.setProfileToCustomOnProfileLinkedChange(this.xrWebGLLayerDepthSelect, 'change');

    // Configure proxy information and port placeholder based on protocol
    if (window.location.protocol === 'https:') {
      this.proxyDefaultText.textContent =
        'Optional: Leave empty for direct WSS connection, or provide URL for proxy routing (e.g., https://proxy.example.com/)';
      this.portInput.placeholder = 'Port (default: 48322, or 443 if proxy URL set)';
    } else {
      this.proxyDefaultText.textContent = 'Not needed for HTTP - uses direct WS connection';
      this.portInput.placeholder = 'Port (default: 49100)';
    }

    this.startButton.addEventListener('click', () => this.connectToCloudXR());
    this.exitButton.addEventListener('click', () => this.xrSession?.end());

    // Set up certificate acceptance link
    setupCertificateAcceptanceLink(
      this.serverIpInput,
      this.portInput,
      this.proxyUrlInput,
      this.certAcceptanceLink,
      this.certLink
    );

    this.checkWebXRSupport();
  }

  /**
   * Check browser support: WebXR, WebGL2, WebRTC, and video frame callbacks
   * Also loads Immersive Web Emulator if needed (for desktop development)
   */
  private async checkWebXRSupport(): Promise<void> {
    const { supportsImmersive, iwerLoaded } = await loadIWERIfNeeded();
    if (!supportsImmersive) {
      this.showStatus('Immersive mode not supported', 'error');
      this.startButton.disabled = true;
      return;
    }

    this.startButton.disabled = true;
    this.startButton.innerHTML = 'CONNECT (checking capabilities)';

    const result = await checkCapabilities();
    if (!result.success) {
      this.showStatus(
        'Browser does not meet required capabilities:\n' + result.failures.join('\n'),
        'error'
      );
      this.startButton.innerHTML = 'CONNECT (capabilities check failed)';
      return;
    }

    if (result.warnings.length > 0) {
      this.showStatus('Performance notice:\n' + result.warnings.join('\n'), 'info');
    } else if (iwerLoaded) {
      // Include IWER status in the final success message
      this.showStatus(
        'CloudXR.js SDK is supported. Ready to connect! -- Using IWER (Immersive Web Emulator Runtime) - Emulating Meta Quest 3.',
        'info'
      );
    } else {
      this.showStatus('CloudXR.js SDK is supported. Ready to connect!', 'success');
    }

    this.capabilitiesValid = true;
    this.updateConnectButtonState();
  }

  private showStatus(message: string, type: 'success' | 'error' | 'info'): void {
    this.statusMessageText.textContent = message;
    this.statusMessageBox.className = `status-message-box show ${type}`;
    console[type === 'error' ? 'error' : 'info'](message);
  }

  /** Update inline resolution validation messages under each input. */
  private updateResolutionValidationMessage(): void {
    const { w: wNum, h: hNum } = getResolutionFromInputs(
      this.perEyeWidthInput,
      this.perEyeHeightInput
    );
    const { widthError, heightError } = validatePerEyeResolution(wNum, hNum);
    if (this.resolutionWidthValidationMessage) {
      const showWidth = widthError ?? '';
      this.resolutionWidthValidationMessage.textContent = showWidth;
      this.resolutionWidthValidationMessage.className = showWidth
        ? 'config-text resolution-validation-error'
        : 'config-text';
    }
    if (this.resolutionHeightValidationMessage) {
      const showHeight = heightError ?? '';
      this.resolutionHeightValidationMessage.textContent = showHeight;
      this.resolutionHeightValidationMessage.className = showHeight
        ? 'config-text resolution-validation-error'
        : 'config-text';
    }
    this.updateConnectButtonState();
  }

  /** Update inline grid validation messages under each input. */
  private updateGridValidationMessage(): void {
    const { reprojectionGridCols, reprojectionGridRows } = getGridFromInputs(
      this.reprojectionGridColsInput,
      this.reprojectionGridRowsInput
    );
    const { reprojectionGridColsError, reprojectionGridRowsError } = validateDepthReprojectionGrid(
      reprojectionGridCols,
      reprojectionGridRows
    );
    if (this.reprojectionGridColsValidationMessage) {
      const showGridCols = reprojectionGridColsError ?? '';
      this.reprojectionGridColsValidationMessage.textContent = showGridCols;
      this.reprojectionGridColsValidationMessage.className = showGridCols
        ? 'config-text resolution-validation-error'
        : 'config-text';
    }
    if (this.reprojectionGridRowsValidationMessage) {
      const showGridRows = reprojectionGridRowsError ?? '';
      this.reprojectionGridRowsValidationMessage.textContent = showGridRows;
      this.reprojectionGridRowsValidationMessage.className = showGridRows
        ? 'config-text resolution-validation-error'
        : 'config-text';
    }
    this.updateConnectButtonState();
  }

  /** Disable Connect button when resolution invalid; show validation in its own box. */
  private updateConnectButtonState(): void {
    const { w, h } = getResolutionFromInputs(this.perEyeWidthInput, this.perEyeHeightInput);
    const { reprojectionGridCols, reprojectionGridRows } = getGridFromInputs(
      this.reprojectionGridColsInput,
      this.reprojectionGridRowsInput
    );
    const resolutionError = getResolutionValidationError(w, h);
    const gridError = getGridValidationError(reprojectionGridCols, reprojectionGridRows);
    const connectMessage = getResolutionValidationMessageForConnect(w, h);
    const gridConnectMessage = getGridValidationMessageForConnect(
      reprojectionGridCols,
      reprojectionGridRows
    );
    const combinedConnectMessage = [connectMessage, gridConnectMessage].filter(Boolean).join(' ');
    if (combinedConnectMessage) {
      this.validationMessageText.textContent = combinedConnectMessage;
      this.validationMessageBox.className = 'validation-message-box show';
    } else {
      this.validationMessageText.textContent = '';
      this.validationMessageBox.className = 'validation-message-box';
    }
    const shouldEnable = this.capabilitiesValid && !resolutionError && !gridError;
    this.startButton.disabled = !shouldEnable;
    if (shouldEnable) {
      this.startButton.innerHTML = 'CONNECT';
    }
  }

  /**
   * Main connection flow - orchestrates WebGL, WebXR, and CloudXR setup
   * Steps: Read config → Initialize WebGL → Create XR session → Connect to CloudXR server
   */
  private async connectToCloudXR(): Promise<void> {
    // Read configuration from UI form
    const serverIp = this.serverIpInput.value.trim() || 'localhost';

    // Determine default port based on connection type and proxy usage
    const useSecureConnection = window.location.protocol === 'https:';
    const portValue = parseInt(this.portInput.value, 10);
    const proxyUrl = this.proxyUrlInput.value;
    const hasProxy = proxyUrl.trim().length > 0;

    let defaultPort = 49100; // HTTP default (direct CloudXR Runtime connection)
    if (useSecureConnection) {
      defaultPort = hasProxy ? 443 : 48322; // HTTPS with proxy → 443, HTTPS without → 48322
    }

    const port = portValue || defaultPort;
    const { w: perEyeWidth, h: perEyeHeight } = getResolutionFromInputs(
      this.perEyeWidthInput,
      this.perEyeHeightInput
    );
    const { reprojectionGridCols, reprojectionGridRows } = getGridFromInputs(
      this.reprojectionGridColsInput,
      this.reprojectionGridRowsInput
    );

    // Validate resolution before starting XR so we never enter VR with invalid config
    const resolutionError = getResolutionValidationError(perEyeWidth, perEyeHeight);
    const gridError = getGridValidationError(reprojectionGridCols, reprojectionGridRows);
    if (resolutionError || gridError) {
      const connectMessage = getResolutionValidationMessageForConnect(perEyeWidth, perEyeHeight);
      const gridConnectMessage = getGridValidationMessageForConnect(
        reprojectionGridCols,
        reprojectionGridRows
      );
      this.showStatus(
        [connectMessage ?? resolutionError, gridConnectMessage ?? gridError]
          .filter(Boolean)
          .join(' '),
        'error'
      );
      return;
    }

    const deviceFrameRate = parseInt(this.deviceFrameRateSelect.value, 10);
    const maxStreamingBitrateKbps = parseInt(this.maxStreamingBitrateMbpsSelect.value, 10) * 1000;
    const immersiveMode = this.immersiveSelect.value as 'ar' | 'vr';
    const referenceSpaceType = this.referenceSpaceSelect.value as XRReferenceSpaceType;
    const xrOffsetX = (parseFloat(this.xrOffsetXInput.value) || 0) / 100; // cm to meters
    const xrOffsetY = (parseFloat(this.xrOffsetYInput.value) || 0) / 100;
    const xrOffsetZ = (parseFloat(this.xrOffsetZInput.value) || 0) / 100;

    try {
      this.startButton.disabled = true;
      this.startButton.innerHTML = 'CONNECT (connecting)';
      this.showStatus(`Connecting to Server ${serverIp}:${port}...`, 'info');

      // Initialize WebGL, XR session, and reference space (only after resolution is valid)
      await this.initializeWebGL();
      await this.createXRSession(immersiveMode, deviceFrameRate);

      let referenceSpace = await this.getReferenceSpace(referenceSpaceType);
      if (xrOffsetX !== 0 || xrOffsetY !== 0 || xrOffsetZ !== 0) {
        const offsetTransform = new XRRigidTransform(
          { x: xrOffsetX, y: xrOffsetY, z: xrOffsetZ },
          { x: 0, y: 0, z: 0, w: 1 }
        );
        referenceSpace = referenceSpace.getOffsetReferenceSpace(offsetTransform);
      }

      // Create CloudXR session and connect to server
      await this.createCloudXRSession(
        serverIp,
        port,
        proxyUrl,
        perEyeWidth,
        perEyeHeight,
        reprojectionGridCols,
        reprojectionGridRows,
        maxStreamingBitrateKbps,
        referenceSpace
      );

      // Call extension hook after CloudXR session is created
      if (this.onWebGLInitializedCallback) {
        const useQuestColorWorkaround = this.useQuestColorWorkaroundSelect.value === 'true';
        await this.onWebGLInitializedCallback(this.gl!, useQuestColorWorkaround, referenceSpace);
      }

      this.cloudxrSession!.connect();
      this.startButton.innerHTML = 'CONNECT (waiting for streaming)';
      this.showStatus(`Connected to Server ${serverIp}:${port}...`, 'info');
    } catch (error) {
      this.showStatus(`Connection failed: ${error}`, 'error');
      this.startButton.disabled = false;
      this.startButton.innerHTML = 'CONNECT';

      if (this.xrSession) {
        try {
          await this.xrSession.end();
        } catch (endError) {
          console.error('Error ending XR session during cleanup:', endError);
          this.clearSessionReferences();
        }
      } else {
        this.clearSessionReferences();
      }
    }
  }

  /**
   * Initialize WebGL2 context for rendering (high-performance, XR-compatible)
   */
  private async initializeWebGL(): Promise<void> {
    const webglCanvas = getOrCreateCanvas('webglCanvas');
    const gl = webglCanvas.getContext('webgl2', {
      alpha: true,
      depth: true,
      stencil: false,
      desynchronized: false,
      antialias: this.getWebglAntialias(),
      failIfMajorPerformanceCaveat: true,
      powerPreference: this.getWebglPowerPreference(), // Favor higher power rendering, e.g., discrete GPU over integrated GPU on laptops
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
    }) as WebGL2RenderingContext;

    if (!gl) throw new Error('Failed to create WebGL2 context');

    await gl.makeXRCompatible(); // Required before using with XRWebGLLayer
    this.gl = gl;
    logOrThrow('Creating WebGL context', this.gl);
  }

  /**
   * Create WebXR session, XRWebGLLayer, and start render loop
   */
  private async createXRSession(
    immersiveMode: 'ar' | 'vr',
    deviceFrameRate: number
  ): Promise<void> {
    const mode = immersiveMode === 'vr' ? 'immersive-vr' : 'immersive-ar';
    const options = {
      requiredFeatures: ['local-floor'],
      optionalFeatures: ['hand-tracking', 'body-tracking'],
    };

    // Try requested mode, fallback to alternative if unsupported
    try {
      this.xrSession = await navigator.xr!.requestSession(mode, options);
    } catch (error) {
      console.warn(`${mode} session failed, trying alternative:`, error);
      const altMode = immersiveMode === 'vr' ? 'immersive-ar' : 'immersive-vr';
      this.xrSession = await navigator.xr!.requestSession(altMode, options);
    }

    // Create XRWebGLLayer - provides framebuffer for CloudXR to render into
    const xrWebGLLayerAntialias =
      this.deviceProfile.web?.xrWebGLLayerAntialias ?? kPerformanceOptions.xrWebGLLayer_antialias;
    const xrWebGLLayerScale =
      this.deviceProfile.web?.framebufferScaleFactor ??
      kPerformanceOptions.xrWebGLLayer_framebufferScaleFactor;
    const xrWebGLLayerAlpha = this.getXrWebGLLayerAlpha();
    const xrWebGLLayerDepth = this.getXrWebGLLayerDepth();
    this.baseLayer = new XRWebGLLayer(this.xrSession, this.gl!, {
      alpha: xrWebGLLayerAlpha,
      antialias: xrWebGLLayerAntialias,
      depth: xrWebGLLayerDepth,
      framebufferScaleFactor: xrWebGLLayerScale,
      ignoreDepthValues: false,
      stencil: false,
    });

    console.info('WebXR antialias result:', this.baseLayer.antialias);

    // This controls the local render foveation, independent of streaming/server-render foveation
    // - Local render foveation buys frame time in the browser render loop
    // - Server/stream foveation buys server render frame time and lowers streaming bandwidth
    if ('fixedFoveation' in this.baseLayer) {
      const profileFoveation = this.deviceProfile.web?.fixedFoveation;
      if (profileFoveation === null) {
        console.info('Local render foveation disabled by device profile');
      } else {
        const foveation = profileFoveation ?? kPerformanceOptions.xrWebGLLayer_fixedFoveationLevel;
        // With high buffer scaling, higher foveation is visually acceptable and help frame time.
        console.info('Setting local render foveation to', foveation);
        this.baseLayer.fixedFoveation = foveation;
      }
    } else {
      console.info('Local render foveation is not supported');
    }

    // Store frame rate for later use in render loop
    this.deviceFrameRate = deviceFrameRate;
    this.hasSetTargetFrameRate = false;

    this.xrSession.updateRenderState({ baseLayer: this.baseLayer });
    this.xrSession.addEventListener('end', () => this.handleXRSessionEnd());
    this.xrSession.requestAnimationFrame(this.onXRFrame.bind(this));
  }

  /**
   * Get XR reference space with fallbacks
   * Reference space types: 'local-floor' (room-scale), 'local' (seated), 'viewer' (head-locked)
   */
  private async getReferenceSpace(
    referenceSpaceType: XRReferenceSpaceType
  ): Promise<XRReferenceSpace> {
    try {
      return await this.xrSession!.requestReferenceSpace(referenceSpaceType);
    } catch (error) {
      console.warn(`'${referenceSpaceType}' not supported, trying fallbacks...`);
      try {
        return await this.xrSession!.requestReferenceSpace('local-floor');
      } catch {
        try {
          return await this.xrSession!.requestReferenceSpace('local');
        } catch {
          return await this.xrSession!.requestReferenceSpace('viewer');
        }
      }
    }
  }

  /**
   * Configure CloudXR session and set up event handlers
   * Establishes WebRTC connection, receives video stream, sends tracking data
   */
  private async createCloudXRSession(
    serverIp: string,
    port: number,
    proxyUrl: string,
    perEyeWidth: number,
    perEyeHeight: number,
    reprojectionGridCols: number | undefined,
    reprojectionGridRows: number | undefined,
    maxStreamingBitrateKbps: number,
    referenceSpace: XRReferenceSpace
  ): Promise<void> {
    const connectionConfig = getConnectionConfig(serverIp, port, proxyUrl);

    // Parse media address and port if provided
    const mediaAddress = this.mediaAddressInput.value.trim() || undefined;
    const mediaPortValue = parseInt(this.mediaPortInput.value, 10);
    const mediaPort = !isNaN(mediaPortValue) ? mediaPortValue : undefined;

    const sessionOptions: SessionOptions = {
      serverAddress: connectionConfig.serverIP,
      serverPort: connectionConfig.port,
      useSecureConnection: connectionConfig.useSecureConnection,
      signalingResourcePath: connectionConfig.resourcePath,
      gl: this.gl!,
      codec: this.codecSelect.value as 'h264' | 'h265' | 'av1',
      perEyeWidth, // Stream resolution: width = perEyeWidth * 2 (side-by-side)
      perEyeHeight, // Stream resolution: height = perEyeHeight * 9/4 (includes metadata)
      reprojectionGridCols,
      reprojectionGridRows,
      referenceSpace,
      deviceFrameRate: parseInt(this.deviceFrameRateSelect.value, 10),
      maxStreamingBitrateKbps,
      enablePoseSmoothing: this.enablePoseSmoothingSelect.value === 'true',
      posePredictionFactor: parseFloat(this.posePredictionFactorInput.value),
      enableTexSubImage2D: this.enableTexSubImage2DSelect.value === 'true',
      useQuestColorWorkaround: this.useQuestColorWorkaroundSelect.value === 'true',
      mediaAddress,
      mediaPort,
      telemetry: {
        enabled: true,
        appInfo: { version: '6.1.0', product: 'CloudXR.js WebGL Example' },
      },
    };

    const delegates: SessionDelegates = {
      onStreamStarted: () => {
        console.info('CloudXR stream started');
        this.startButton.innerHTML = 'CONNECT (streaming)';
        this.exitButton.style.display = 'block';
        this.showStatus('Streaming started!', 'success');
      },
      onStreamStopped: (error?: StreamingError) => {
        if (error) {
          // Display user-friendly error message with error code if available
          const errorMsg = error.code
            ? `${error.message} (Error code: 0x${error.code.toString(16).toUpperCase()})`
            : error.message;

          console.error('Stream stopped with error:', errorMsg);
          this.showStatus(`Stream stopped: ${errorMsg}`, 'error');

          // Log additional debug info if available
          if (error.reasonCode !== undefined) {
            console.debug('Stop reason code:', error.reasonCode);
          }
        } else {
          console.info('Stream stopped normally');
          this.showStatus('Stream stopped', 'info');
        }

        if (this.xrSession) {
          this.xrSession
            .end()
            .catch(endError => console.error('Error ending XR session:', endError))
            .finally(() => (this.exitButton.style.display = 'none'));
        } else {
          this.exitButton.style.display = 'none';
        }

        this.startButton.disabled = false;
        this.startButton.innerHTML = 'CONNECT';
      },
      onWebGLStateChangeBegin: () => console.debug('WebGL state change begin'),
      onWebGLStateChangeEnd: () => console.debug('WebGL state change end'),
      onServerMessageReceived: (messageData: Uint8Array) => {
        const messageString = new TextDecoder().decode(messageData);
        console.debug('Server message:', messageString);
      },
    };

    try {
      this.cloudxrSession = createSession(sessionOptions, delegates);
    } catch (error) {
      console.error('Failed to create CloudXR session:', error);
      throw error;
    }
  }

  /**
   * Main render loop - runs every frame (72-120 FPS)
   * Sends tracking data to server, receives video frame, renders to display
   */
  private async onXRFrame(timestamp: DOMHighResTimeStamp, frame: XRFrame): Promise<void> {
    this.xrSession!.requestAnimationFrame(this.onXRFrame.bind(this));

    // Set target frame rate on first frame only
    if (!this.hasSetTargetFrameRate && 'updateTargetFrameRate' in this.xrSession!) {
      this.hasSetTargetFrameRate = true;
      try {
        await this.xrSession!.updateTargetFrameRate(this.deviceFrameRate);
        console.debug(
          `Target frame rate set to ${this.deviceFrameRate}, current: ${this.xrSession!.frameRate}`
        );
      } catch (error) {
        console.error('Failed to set target frame rate:', error);
      }
    }

    if (!this.cloudxrSession) {
      console.debug('Skipping frame, CloudXR session not created yet');
      return;
    }

    if (this.cloudxrSession.state !== SessionState.Connected) {
      console.debug('Skipping frame, session not ready');
      return;
    }

    try {
      // Send tracking (head/hand positions) → Receive video → Render
      this.cloudxrSession.sendTrackingStateToServer(timestamp, frame);
      this.gl!.bindFramebuffer(this.gl!.FRAMEBUFFER, this.baseLayer!.framebuffer);
      this.cloudxrSession.render(timestamp, frame, this.baseLayer!);

      // Call extension hook if provided
      if (this.onXRFrameCallback && this.gl && this.baseLayer) {
        await this.onXRFrameCallback(timestamp, frame, this.gl, this.baseLayer);
      }
    } catch (error) {
      console.error('Error in render frame:', error);
    }
  }

  /**
   * Cleanup when XR session ends (user exits, removes headset, or error occurs)
   */
  private handleXRSessionEnd(): void {
    try {
      if (this.cloudxrSession) {
        this.cloudxrSession.disconnect();
        this.cloudxrSession = null;
      }

      this.clearSessionReferences();

      this.startButton.disabled = false;
      this.startButton.innerHTML = 'CONNECT';
      this.exitButton.style.display = 'none';
    } catch (error) {
      this.showStatus(`Disconnect error: ${error}`, 'error');
    }
  }

  private clearSessionReferences(): void {
    // Call extension cleanup hook if provided
    if (this.onCleanupCallback) {
      this.onCleanupCallback();
    }

    this.baseLayer = null;
    this.xrSession = null;
    this.gl = null;
    this.hasSetTargetFrameRate = false;
  }

  private getWebglAntialias(): boolean {
    return this.deviceProfile.web?.webglAntialias ?? kPerformanceOptions.webglContext_antialias;
  }

  private getWebglPowerPreference(): WebGLPowerPreference {
    return this.deviceProfile.web?.powerPreference ?? 'high-performance';
  }

  private getXrWebGLLayerAlpha(): boolean {
    const uiValue = this.xrWebGLLayerAlphaSelect.value;
    if (uiValue === 'true') return true;
    if (uiValue === 'false') return false;
    return this.deviceProfile.web?.alpha ?? true;
  }

  private getXrWebGLLayerDepth(): boolean {
    const uiValue = this.xrWebGLLayerDepthSelect.value;
    if (uiValue === 'true') return true;
    if (uiValue === 'false') return false;
    return this.deviceProfile.web?.depth ?? true;
  }

  private setProfileToCustomIfNeeded(): void {
    if (this.deviceProfileSelect.value === 'custom') return;
    this.deviceProfileSelect.value = 'custom';
    this.setDeviceProfile('custom', false);
    try {
      localStorage.setItem('deviceProfile', 'custom');
    } catch (_) {}
  }

  private setProfileToCustomOnProfileLinkedChange(
    element: HTMLInputElement | HTMLSelectElement,
    event: string
  ): void {
    element.addEventListener(event, () => this.setProfileToCustomIfNeeded());
  }

  private setDeviceProfile(profileId: DeviceProfileId, applyToUi: boolean): void {
    this.deviceProfileId = profileId;
    this.deviceProfile = getDeviceProfile(profileId);
    this.updateDeviceProfileWarning(this.deviceProfile);

    if (applyToUi && profileId !== 'custom') {
      this.applyDeviceProfileToUI(this.deviceProfile);
    }
  }

  private updateDeviceProfileWarning(profile: DeviceProfile): void {
    if (!this.deviceProfileWarning) return;
    const needsHttps = profile.connection?.httpsRequired === true;
    const isHttp = window.location.protocol === 'http:';

    if (needsHttps && isHttp) {
      this.deviceProfileWarning.textContent =
        'This device requires HTTPS mode (Pico 4 Ultra does not support HTTP).';
      this.deviceProfileWarning.style.display = 'block';
    } else {
      this.deviceProfileWarning.style.display = 'none';
      this.deviceProfileWarning.textContent = '';
    }
  }

  private applyDeviceProfileToUI(profile: DeviceProfile): void {
    const cloudxr = profile.cloudxr;
    if (!cloudxr) return;

    if (cloudxr.perEyeWidth !== undefined) {
      this.perEyeWidthInput.value = String(cloudxr.perEyeWidth);
    }
    if (cloudxr.perEyeHeight !== undefined) {
      this.perEyeHeightInput.value = String(cloudxr.perEyeHeight);
    }
    this.reprojectionGridColsInput.value =
      cloudxr.reprojectionGridCols !== undefined ? String(cloudxr.reprojectionGridCols) : '';
    this.reprojectionGridRowsInput.value =
      cloudxr.reprojectionGridRows !== undefined ? String(cloudxr.reprojectionGridRows) : '';
    if (cloudxr.deviceFrameRate !== undefined) {
      this.setSelectValueIfAvailable(this.deviceFrameRateSelect, String(cloudxr.deviceFrameRate));
    }
    if (cloudxr.maxStreamingBitrateKbps !== undefined) {
      const mbps = Math.round(cloudxr.maxStreamingBitrateKbps / 1000);
      this.setSelectValueIfAvailable(this.maxStreamingBitrateMbpsSelect, String(mbps));
    }
    if (cloudxr.codec) {
      this.setSelectValueIfAvailable(this.codecSelect, cloudxr.codec);
    }
    if (cloudxr.enablePoseSmoothing !== undefined) {
      this.enablePoseSmoothingSelect.value = String(cloudxr.enablePoseSmoothing);
    }
    if (cloudxr.posePredictionFactor !== undefined) {
      this.posePredictionFactorInput.value = String(cloudxr.posePredictionFactor);
      this.posePredictionFactorValue.textContent = this.posePredictionFactorInput.value;
    }
    if (cloudxr.useQuestColorWorkaround !== undefined) {
      this.useQuestColorWorkaroundSelect.value = String(cloudxr.useQuestColorWorkaround);
    }
    if (cloudxr.enableTexSubImage2D !== undefined) {
      this.enableTexSubImage2DSelect.value = String(cloudxr.enableTexSubImage2D);
    }
    if (profile.web?.alpha !== undefined) {
      this.xrWebGLLayerAlphaSelect.value = String(profile.web.alpha);
    }
    if (profile.web?.depth !== undefined) {
      this.xrWebGLLayerDepthSelect.value = String(profile.web.depth);
    }
  }

  private persistProfileFieldsToLocalStorage(): void {
    try {
      localStorage.setItem('perEyeWidth', this.perEyeWidthInput.value);
      localStorage.setItem('perEyeHeight', this.perEyeHeightInput.value);
      localStorage.setItem('reprojectionGridCols', this.reprojectionGridColsInput.value);
      localStorage.setItem('reprojectionGridRows', this.reprojectionGridRowsInput.value);
      localStorage.setItem('deviceFrameRate', this.deviceFrameRateSelect.value);
      localStorage.setItem('maxStreamingBitrateMbps', this.maxStreamingBitrateMbpsSelect.value);
      localStorage.setItem('codec', this.codecSelect.value);
      localStorage.setItem('enablePoseSmoothing', this.enablePoseSmoothingSelect.value);
      localStorage.setItem('posePredictionFactor', this.posePredictionFactorInput.value);
      localStorage.setItem('enableTexSubImage2D', this.enableTexSubImage2DSelect.value);
      localStorage.setItem('useQuestColorWorkaround', this.useQuestColorWorkaroundSelect.value);
      localStorage.setItem('xrWebGLLayerAlpha', this.xrWebGLLayerAlphaSelect.value);
      localStorage.setItem('xrWebGLLayerDepth', this.xrWebGLLayerDepthSelect.value);
    } catch (e) {
      console.warn('Failed to persist profile fields to localStorage:', e);
    }
  }

  private setSelectValueIfAvailable(select: HTMLSelectElement, value: string): void {
    const hasOption = Array.from(select.options).some(option => option.value === value);
    if (hasOption) {
      select.value = value;
    }
  }
}

// Application entry point - wait for DOM to load, then initialize client
document.addEventListener('DOMContentLoaded', () => {
  new CloudXRClient();
});
