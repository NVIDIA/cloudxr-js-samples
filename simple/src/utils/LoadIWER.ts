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

import type { XRDevice } from 'iwer';

declare global {
  /** Adds the optional IWER device installed by the desktop XR fallback. */
  interface Window {
    xrDevice?: XRDevice | null;
  }
}

const IWER_version = '2.3.0';
const IWER_DEVUI_version = '2.3.0';
let pendingIWERLoad: Promise<IWERLoadResult> | null = null;

/** Reports whether immersive XR is available and whether IWER supplied it. */
export interface IWERLoadResult {
  supportsImmersive: boolean;
  iwerLoaded: boolean;
}

/**
 * Uses native immersive XR when available, otherwise installs IWER and its optional DevUI.
 * @returns The resulting immersive-support and IWER-loading state.
 */
export async function loadIWERIfNeeded(): Promise<IWERLoadResult> {
  // Share the capability probe and fallback installation across concurrent callers.
  if (pendingIWERLoad) {
    return pendingIWERLoad;
  }

  // Retain a successful result so later initialization cannot reinstall IWER.
  const iwerLoad = loadIWER();
  pendingIWERLoad = iwerLoad;

  // Await the shared work under a rejection guard so an unexpected failure remains retryable.
  try {
    const result = await iwerLoad;

    // Allow a retry after failure without clearing newer work started by another caller.
    if (!result.supportsImmersive && pendingIWERLoad === iwerLoad) {
      pendingIWERLoad = null;
    }

    return result;
  } catch (error) {
    // Do not let an older rejection clear a retry that has already started.
    if (pendingIWERLoad === iwerLoad) {
      pendingIWERLoad = null;
    }
    throw error;
  }
}

/**
 * Probes native immersive support and installs IWER when no native mode is usable.
 * @returns The resulting immersive-support and IWER-loading state.
 */
async function loadIWER(): Promise<IWERLoadResult> {
  let supportsImmersive = false;
  let iwerLoaded = false;

  // Probe both immersive modes because either native mode makes the emulator unnecessary.
  if ('xr' in navigator) {
    try {
      const vr = await (navigator.xr as XRSystem).isSessionSupported?.('immersive-vr');
      const ar = await (navigator.xr as XRSystem).isSessionSupported?.('immersive-ar');
      supportsImmersive = Boolean(vr || ar);
    } catch (_) {
      // Probe failures are treated as unsupported so the fallback remains available.
    }
  }

  // Load IWER only when the browser cannot supply an immersive session itself.
  if (!supportsImmersive) {
    console.info('Immersive mode not supported, loading IWER as fallback.');

    // The core runtime must load before DevUI can attach to its XR device.
    const script = document.createElement('script');
    script.src = `https://unpkg.com/iwer@${IWER_version}/build/iwer.min.js`;
    script.async = true;
    script.integrity = 'sha384-m8Xcl9WwdP6j/5Fv7MAs7IvvW3PmWCbNZlbF8IsJAnujyeMZi0/xgUE4mM7Tbm/j';
    script.crossOrigin = 'anonymous';

    // Wait for either load outcome so callers receive a complete fallback result.
    await new Promise<void>(resolve => {
      script.onload = async () => {
        console.info('IWER loaded as fallback.');
        const IWERGlobal = (window as any).IWER || (globalThis as any).IWER;

        // A downloaded script without its expected global cannot install an XR runtime.
        if (!IWERGlobal) {
          console.warn('IWER global not found after script load.');
          supportsImmersive = false;
          resolve();
          return;
        }

        // DevUI is optional but must load after IWER exposes its device APIs.
        const devUIScript = document.createElement('script');
        devUIScript.src = `https://unpkg.com/@iwer/devui@${IWER_DEVUI_version}/build/iwer-devui.min.js`;
        devUIScript.async = true;
        devUIScript.integrity =
          'sha384-TAu5gWlv92O6gkVclV8HYctTEswyA/0eoS6ULHjjLCShUVts4kDlUg6iLEKmL1r8';
        devUIScript.crossOrigin = 'anonymous';

        // Settle on both outcomes because DevUI failure must not block the core runtime.
        await new Promise<void>(devUIResolve => {
          devUIScript.onload = () => {
            console.info('IWER DevUI loaded.');
            devUIResolve();
          };

          // Continue without UI controls when the optional script cannot load.
          devUIScript.onerror = error => {
            console.warn('Failed to load IWER DevUI:', error);
            devUIResolve();
          };

          // Appending starts the asynchronous DevUI download after handlers are installed.
          document.head.appendChild(devUIScript);
        });

        // Runtime setup is isolated so a third-party failure degrades to unsupported XR.
        try {
          const device: XRDevice = new IWERGlobal.XRDevice(IWERGlobal.metaQuest3);

          const IWER_DevUI = (window as any).IWER_DevUI || (globalThis as any).IWER_DevUI;

          // Attach controls only when the optional DevUI global was initialized.
          if (IWER_DevUI?.DevUI) {
            device.installDevUI(IWER_DevUI.DevUI);
            console.info('IWER DevUI initialized with XR device.');
          } else {
            console.warn('IWER DevUI not found after script load, continuing without DevUI.');
          }

          // Replace a native XRSystem that exists but cannot start an immersive session.
          await device.installRuntime({ forceInstall: true });

          // Publish the device only after the emulated runtime has installed successfully.
          window.xrDevice = device;
          supportsImmersive = true;
          iwerLoaded = true;
        } catch (e) {
          // Installation failures must leave the caller in the unsupported state.
          console.warn('IWER runtime install failed:', e);
          supportsImmersive = false;
        }
        resolve();
      };

      // A core script failure cannot provide immersive fallback, but must still settle.
      script.onerror = () => {
        console.warn('Failed to load IWER.');
        supportsImmersive = false;
        resolve();
      };

      // Appending starts the core IWER download after both completion handlers exist.
      document.head.appendChild(script);
    });
  }

  // Report native support separately from whether the emulator supplied it.
  return { supportsImmersive, iwerLoaded };
}
