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

import {
  createSession,
  getGridValidationError,
  getGridValidationMessageForConnect,
  getResolutionValidationError,
  getResolutionValidationMessageForConnect,
  type LogEntry,
  type Session,
  type SessionDelegates,
  type SessionOptions,
  type StreamingError,
  LogLevel,
  MicState,
  SessionState,
  validateDepthReprojectionGrid,
  validatePerEyeResolution,
} from '@nvidia/cloudxr';
import type { XRDevice } from 'iwer';

import { checkCapabilities } from './utils/BrowserCapabilities';
import {
  enableLocalStorage,
  getConnectionConfig,
  getGridFromInputs,
  getResolutionFromInputs,
  setSelectValueIfAvailable,
  setupCertificateAcceptanceLink,
  type CertLinkController,
  type CertStatusInfo,
} from './utils/configuration';
import {
  getDeviceProfile,
  resolveDeviceProfileId,
  type DeviceProfile,
  type DeviceProfileId,
} from './utils/DeviceProfiles';
import { applyTargetFrameRate, FrameRateSession } from './utils/frameRate';
import { setIWERArBackground } from './utils/IWERBackground';
import { loadIWERIfNeeded } from './utils/LoadIWER';
import { requestMicPermission } from './utils/micPermission';
import { overridePressureObserver } from './utils/overridePressureObserver';
import { kPerformanceOptions } from './utils/PerformanceProfiles';
import { getOrCreateCanvas, logOrThrow } from './utils/WebGlUtils';

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
  private iwerLoaded = false; // True when IWER (desktop emulator) supplies navigator.xr
  private certStatus: CertStatusInfo = { accepted: true, required: false, verified: true };
  private certLinkController: CertLinkController | null = null;
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
  private framebufferScaleFactorInput: HTMLInputElement;
  private framebufferScaleFactorValue: HTMLElement;
  private deviceProfileSelect: HTMLSelectElement;
  private deviceProfileWarning: HTMLElement;
  private mediaAddressInput: HTMLInputElement;
  private mediaPortInput: HTMLInputElement;
  private clientTokenInput: HTMLInputElement;
  private codecSelect: HTMLSelectElement;
  private micEnabledSelect: HTMLSelectElement;

  private deviceProfileId: DeviceProfileId = 'custom';
  private deviceProfile: DeviceProfile = getDeviceProfile('custom');

  // Core Session Components
  private xrSession: XRSession | null = null; // WebXR session (hardware access)
  private cloudxrSession: Session | null = null; // CloudXR session (streaming)

  private gl: WebGL2RenderingContext | null = null; // WebGL context (rendering)
  private baseLayer: XRWebGLLayer | null = null; // Bridge between WebXR and WebGL
  private deviceFrameRate: number = 0; // Target frame rate for XR session

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
    this.framebufferScaleFactorInput = document.getElementById(
      'framebufferScaleFactor'
    ) as HTMLInputElement;
    this.framebufferScaleFactorValue = document.getElementById(
      'framebufferScaleFactorValue'
    ) as HTMLElement;
    this.deviceProfileSelect = document.getElementById('deviceProfile') as HTMLSelectElement;
    this.deviceProfileWarning = document.getElementById('deviceProfileWarning') as HTMLElement;
    this.mediaAddressInput = document.getElementById('mediaAddress') as HTMLInputElement;
    this.mediaPortInput = document.getElementById('mediaPort') as HTMLInputElement;
    this.clientTokenInput = document.getElementById('clientToken') as HTMLInputElement;
    this.codecSelect = document.getElementById('codec') as HTMLSelectElement;
    this.micEnabledSelect = document.getElementById('micEnabled') as HTMLSelectElement;

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
    enableLocalStorage(this.framebufferScaleFactorInput, 'framebufferScaleFactor');
    enableLocalStorage(this.deviceProfileSelect, 'deviceProfile');
    enableLocalStorage(this.mediaAddressInput, 'mediaAddress');
    enableLocalStorage(this.mediaPortInput, 'mediaPort');
    // clientToken is a secret; keep it ephemeral (read from the input on submit,
    // never persisted to or logged from localStorage).
    enableLocalStorage(this.codecSelect, 'codec');
    enableLocalStorage(this.micEnabledSelect, 'micEnabled');

    // Update slider value display when it changes
    this.posePredictionFactorInput.addEventListener('input', () => {
      this.posePredictionFactorValue.textContent = this.posePredictionFactorInput.value;
    });
    // Set initial display value
    this.posePredictionFactorValue.textContent = this.posePredictionFactorInput.value;

    this.framebufferScaleFactorInput.addEventListener('input', () => {
      this.framebufferScaleFactorValue.textContent = this.framebufferScaleFactorInput.value;
    });
    this.framebufferScaleFactorValue.textContent = this.framebufferScaleFactorInput.value;

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
    this.setProfileToCustomOnProfileLinkedChange(this.framebufferScaleFactorInput, 'change');
    this.setProfileToCustomOnProfileLinkedChange(this.framebufferScaleFactorInput, 'input');

    // Configure proxy information and port placeholder based on protocol
    if (window.location.protocol === 'https:') {
      this.proxyDefaultText.textContent =
        'Optional: Leave empty for direct WSS connection, or provide URL for proxy routing (e.g., https://proxy.example.com/)';
      this.portInput.placeholder = 'Port (default: 48322, or 443 if proxy URL set)';
    } else {
      this.proxyDefaultText.textContent = 'Not needed for HTTP - uses direct WS connection';
      this.portInput.placeholder = 'Port (default: 49100)';
    }

    this.startButton.addEventListener('click', async () => {
      this.updateConnectButtonState();
      if (this.certStatus.required && !this.certStatus.accepted && this.certLinkController) {
        this.startButton.disabled = true;
        this.startButton.textContent = 'CONNECT (waiting for certificate check...)';
        let certWaitTimeoutId: ReturnType<typeof setTimeout> | null = null;
        try {
          await Promise.race([
            this.certLinkController.verifyNow(),
            new Promise<void>(resolve => {
              certWaitTimeoutId = setTimeout(resolve, 500);
            }),
          ]);
        } finally {
          if (certWaitTimeoutId !== null) {
            clearTimeout(certWaitTimeoutId);
          }
        }
        this.startButton.textContent = 'CONNECT';
        this.updateConnectButtonState();
      }
      if (this.startButton.disabled) {
        return;
      }
      await this.connectToCloudXR();
    });
    this.exitButton.addEventListener('click', () => this.xrSession?.end());

    // Set up certificate acceptance link
    this.certLinkController = setupCertificateAcceptanceLink(
      this.serverIpInput,
      this.portInput,
      this.proxyUrlInput,
      this.certAcceptanceLink,
      this.certLink,
      (status: CertStatusInfo) => {
        this.certStatus = status;
        this.updateConnectButtonState();
      }
    );

    this.checkWebXRSupport();
  }

  /**
   * Check browser support: WebXR, WebGL2, WebRTC, and video frame callbacks
   * Also loads Immersive Web Emulator if needed (for desktop development)
   */
  private async checkWebXRSupport(): Promise<void> {
    const { supportsImmersive, iwerLoaded } = await loadIWERIfNeeded();
    this.iwerLoaded = iwerLoaded;
    if (!supportsImmersive) {
      this.showStatus('Immersive mode not supported', 'error');
      this.startButton.disabled = true;
      return;
    }

    this.startButton.disabled = true;
    this.startButton.innerHTML = 'CONNECT (checking capabilities)';

    // IWER replaces the desktop user agent with its emulated Quest profile, so skip headset firmware checks.
    const result = await checkCapabilities(iwerLoaded);
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
        'CloudXR.js SDK is supported. Using IWER (Immersive Web Emulator Runtime) - Emulating Meta Quest 3.',
        'info'
      );
    } else {
      this.showStatus('CloudXR.js SDK is supported.', 'success');
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
    const certPending =
      this.certStatus.required && this.certStatus.verified === true && !this.certStatus.accepted;
    const certMessage = certPending
      ? 'Accept the certificate using the link below before connecting.'
      : '';
    const combinedConnectMessage = [connectMessage, gridConnectMessage, certMessage]
      .filter(Boolean)
      .join('\n');
    if (combinedConnectMessage) {
      this.validationMessageText.textContent = combinedConnectMessage;
      this.validationMessageBox.className = 'validation-message-box show';
    } else {
      this.validationMessageText.textContent = '';
      this.validationMessageBox.className = 'validation-message-box';
    }
    const shouldEnable = this.capabilitiesValid && !resolutionError && !gridError && !certPending;
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
    const serverIp = this.serverIpInput.value.trim() || window.location.hostname || '127.0.0.1';

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

      // Snapshot mic preference early so the pre-flight check and onStreamStarted
      // callback both see the same value.
      const micEnabled = this.micEnabledSelect.value !== 'false';

      // Request mic permission before entering WebXR — Chrome exits immersive mode
      // when a getUserMedia dialog appears, so we cache the permission first.
      const micResult = await requestMicPermission(micEnabled);
      if (micResult === 'denied') {
        this.showStatus(
          'Microphone permission denied — grant mic access, or disable upstream audio and try again.',
          'error'
        );
        // Re-enable the button so the user can act on the "try again" message without
        // needing a page reload (mirrors what the catch block does on other failures).
        this.startButton.disabled = false;
        this.startButton.innerHTML = 'CONNECT';
        return;
      }
      if (micResult === 'unavailable') {
        // No mic hardware; show a warning but proceed without audio.
        this.showStatus('No microphone found — connecting without audio.', 'info');
      }

      // Initialize WebGL, XR session, and reference space (only after resolution is valid)
      await this.initializeWebGL();
      await this.createXRSession(immersiveMode, deviceFrameRate);

      // CloudXR must advertise the rate actually used by the headset. Apply and confirm
      // the target frame rate now, before CloudXR negotiates the stream, to avoid a
      // producer/consumer pacing mismatch that causes burst/freeze artifacts on Quest 3.
      this.deviceFrameRate = await applyTargetFrameRate(
        this.xrSession! as FrameRateSession,
        deviceFrameRate
      );

      let referenceSpace = await this.getReferenceSpace(referenceSpaceType);
      if (xrOffsetX !== 0 || xrOffsetY !== 0 || xrOffsetZ !== 0) {
        const offsetTransform = new XRRigidTransform(
          { x: xrOffsetX, y: xrOffsetY, z: xrOffsetZ },
          { x: 0, y: 0, z: 0, w: 1 }
        );
        referenceSpace = referenceSpace.getOffsetReferenceSpace(offsetTransform);
      }

      // Create CloudXR session and connect to server.
      // Pass micEnabled so createCloudXRSession uses the same snapshot taken above
      // rather than re-reading the DOM (guards against mid-connect UI toggles).
      await this.createCloudXRSession(
        serverIp,
        port,
        proxyUrl,
        perEyeWidth,
        perEyeHeight,
        reprojectionGridCols,
        reprojectionGridRows,
        maxStreamingBitrateKbps,
        referenceSpace,
        micEnabled && micResult === 'granted'
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

    // Register cleanup early so a partial setup failure below still restores
    // DOM/UI state (e.g. removes the IWER background class from <body>).
    this.xrSession.addEventListener('end', () => this.handleXRSessionEnd());

    // Under IWER on desktop there is no real passthrough, so the emulator
    // composites the transparent XR canvas over this page's HTML. Replace that
    // bleed-through with a neutral dark checkerboard for AR (passthrough)
    // sessions. No-op on real headsets and in VR (opaque blend mode).
    const isPassthrough = this.xrSession.environmentBlendMode !== 'opaque';
    setIWERArBackground(this.iwerLoaded && isPassthrough);

    // Create XRWebGLLayer - provides framebuffer for CloudXR to render into
    const xrWebGLLayerAntialias =
      this.deviceProfile.web?.xrWebGLLayerAntialias ?? kPerformanceOptions.xrWebGLLayer_antialias;
    const xrWebGLLayerScale = this.getFramebufferScaleFactor();
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

    this.deviceFrameRate = deviceFrameRate;
    this.xrSession.updateRenderState({ baseLayer: this.baseLayer });
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
   * Configure CloudXR session and set up event handlers.
   * Establishes WebRTC connection, receives video stream, sends tracking data.
   *
   * @param serverIp - CloudXR server IP address or hostname.
   * @param port - Signaling port.
   * @param proxyUrl - Optional proxy URL for HTTPS signaling routing.
   * @param perEyeWidth - Per-eye stream width in pixels.
   * @param perEyeHeight - Per-eye stream height in pixels.
   * @param reprojectionGridCols - Optional reprojection grid column count.
   * @param reprojectionGridRows - Optional reprojection grid row count.
   * @param maxStreamingBitrateKbps - Maximum target streaming bitrate in Kbps.
   * @param referenceSpace - Resolved XR reference space used for tracking.
   * @param micEnabled - Whether mic capture should be enabled when the stream starts.
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
    referenceSpace: XRReferenceSpace,
    micEnabled: boolean
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
      clientToken: this.clientTokenInput.value.trim() || undefined,
      gl: this.gl!,
      codec: this.codecSelect.value as 'h264' | 'h265' | 'av1',
      perEyeWidth, // Stream resolution: width = perEyeWidth * 2 (side-by-side)
      perEyeHeight, // Stream resolution: height = perEyeHeight * 9/4 (includes metadata)
      reprojectionGridCols,
      reprojectionGridRows,
      referenceSpace,
      deviceFrameRate: this.deviceFrameRate, // effective rate confirmed by applyTargetFrameRate
      maxStreamingBitrateKbps,
      enablePoseSmoothing: this.enablePoseSmoothingSelect.value === 'true',
      posePredictionFactor: parseFloat(this.posePredictionFactorInput.value),
      enableTexSubImage2D: this.enableTexSubImage2DSelect.value === 'true',
      useQuestColorWorkaround: this.useQuestColorWorkaroundSelect.value === 'true',
      mediaAddress,
      mediaPort,
      logLevel: LogLevel.Info, // Deliver Info-and-above SDK logs to onLog
      telemetry: {
        enabled: true,
        appInfo: { version: '6.4.0', product: 'CloudXR.js WebGL Example' },
      },
    };

    const delegates: SessionDelegates = {
      onStreamStarted: () => {
        console.info('CloudXR stream started');
        this.startButton.innerHTML = 'CONNECT (streaming)';
        this.exitButton.style.display = 'block';
        this.showStatus('Streaming started!', 'success');
        // Enable upstream mic capture only when the user opted in.
        if (micEnabled) {
          const ok = this.cloudxrSession?.setMicEnabled(true);
          // Warn to aid diagnosis when mic activation is rejected by current session state.
          if (!ok)
            console.warn('[CloudXR] setMicEnabled(true) returned false (session not active?)');
        }
      },
      onMicStateUpdate: (state: MicState) => {
        // Log every mic transition for permission/device debugging.
        console.info('[CloudXR] Mic state:', MicState[state]);
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
      onLog: (entries: LogEntry[]) => {
        for (const { level, message } of entries) {
          const print =
            level === LogLevel.Error
              ? console.error
              : level === LogLevel.Warning
                ? console.warn
                : level === LogLevel.Debug
                  ? console.debug
                  : console.info;
          print(`[CloudXR] ${message}`);
        }
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

    if (!this.cloudxrSession) {
      console.debug('Skipping frame, CloudXR session not created yet');
      return;
    }

    // Pump tracking during Connecting so the SDK can read
    // XRSession.enabledFeatures from these early frames to detect capabilities
    // (e.g. body-tracking) before the stream starts.
    // sendTrackingStateToServer returns false (no-op) while Connecting.
    if (this.cloudxrSession.state === SessionState.Connecting) {
      try {
        this.cloudxrSession.sendTrackingStateToServer(timestamp, frame);
      } catch (error) {
        console.error('Error in render frame:', error);
        return;
      }
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
      // Restore the normal page background (removes the IWER AR checkerboard).
      setIWERArBackground(false);

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

  private getFramebufferScaleFactor(): number {
    const scale = parseFloat(this.framebufferScaleFactorInput.value);
    if (!Number.isNaN(scale)) {
      return scale;
    }
    return (
      this.deviceProfile.web?.framebufferScaleFactor ??
      kPerformanceOptions.xrWebGLLayer_framebufferScaleFactor
    );
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
      setSelectValueIfAvailable(this.deviceFrameRateSelect, String(cloudxr.deviceFrameRate));
    }
    if (cloudxr.maxStreamingBitrateKbps !== undefined) {
      const mbps = Math.round(cloudxr.maxStreamingBitrateKbps / 1000);
      setSelectValueIfAvailable(this.maxStreamingBitrateMbpsSelect, String(mbps));
    }
    if (cloudxr.codec) {
      setSelectValueIfAvailable(this.codecSelect, cloudxr.codec);
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
    if (profile.web?.framebufferScaleFactor !== undefined) {
      this.framebufferScaleFactorInput.value = String(profile.web.framebufferScaleFactor);
      this.framebufferScaleFactorValue.textContent = this.framebufferScaleFactorInput.value;
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
      localStorage.setItem('framebufferScaleFactor', this.framebufferScaleFactorInput.value);
    } catch (e) {
      console.warn('Failed to persist profile fields to localStorage:', e);
    }
  }
}

// Application entry point - wait for DOM to load, then initialize client
document.addEventListener('DOMContentLoaded', () => {
  new CloudXRClient();
});
