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
 * Emulated-AR passthrough backdrop for IWER.
 *
 * When running under IWER (Immersive Web Emulation Runtime) in AR mode there is
 * no real passthrough camera, so the emulator composites the transparent WebXR
 * canvas straight over the normal 2D DOM. That means the example's HTML page
 * (white background, controls, etc.) bleeds through wherever the XR layer is
 * transparent - which looks wrong when running the examples on desktop and
 * pollutes the Playwright golden screenshots.
 *
 * This helper replaces that backdrop with a neutral near-black / dark-gray
 * checkerboard so emulated AR reads as an obviously-synthetic environment
 * instead of the example's HTML page. It is a desktop/IWER development aid only
 * and has no effect on real headsets (where passthrough is provided by the
 * device compositor).
 *
 * Opt-out: append `?iwerArBackground=off` to the URL to keep the page visible
 * behind the emulated passthrough. This is useful when deliberately rendering
 * debug content onto the page and wanting to see it through the AR view.
 */

const STYLE_ID = 'iwer-ar-background-style';
const BODY_CLASS = 'iwer-ar-background';
const DISABLE_PARAM = 'iwerArBackground';

/**
 * Whether the dev has opted out of the checkerboard via the URL, e.g.
 * `?iwerArBackground=off`. Opting out keeps the page visible behind the
 * emulated passthrough so on-page debug content stays readable.
 *
 * @returns True when an explicit off-like value is present in the query string.
 */
function isDisabledByQuery(): boolean {
  // Guard for non-browser contexts (e.g. SSR/tests) with no location.
  if (typeof window === 'undefined' || !window.location) {
    return false;
  }
  // Absent parameter = enabled; only explicit off-like values disable it.
  const value = new URLSearchParams(window.location.search).get(DISABLE_PARAM);
  return value === 'off' || value === '0' || value === 'false';
}

/**
 * Inject the checkerboard `<style>` into the document head once.
 *
 * Idempotent: subsequent calls are a no-op once the style element exists, so it
 * is safe to call on every session start.
 */
function ensureStyle(): void {
  // Style already injected on a previous session - nothing to do.
  if (document.getElementById(STYLE_ID)) {
    return;
  }
  const style = document.createElement('style');
  style.id = STYLE_ID;
  // Two offset 45deg gradients produce a classic checkerboard. Colors are kept
  // dark (near-black base, dark-gray tiles) so the emulated backdrop is clearly
  // synthetic and stable for golden-image comparison.
  style.textContent = `
    body.${BODY_CLASS} {
      background-color: #0d0d0d !important;
      background-image:
        linear-gradient(45deg, #262626 25%, transparent 25%, transparent 75%, #262626 75%, #262626),
        linear-gradient(45deg, #262626 25%, transparent 25%, transparent 75%, #262626 75%, #262626) !important;
      background-size: 64px 64px !important;
      background-position: 0 0, 32px 32px !important;
    }
  `;
  document.head.appendChild(style);
}

/**
 * Enable or disable the emulated-AR dark checkerboard backdrop on `<body>`.
 *
 * Only enable when IWER is active AND the session is passthrough (AR); on real
 * devices and in VR the backdrop should stay off. Enabling is additionally
 * suppressed when the dev opts out via `?iwerArBackground=off` in the URL, so
 * on-page debug content stays visible behind the emulated passthrough.
 *
 * @param enabled - True to show the checkerboard backdrop (subject to the URL
 *   opt-out), false to restore the page's normal background.
 */
export function setIWERArBackground(enabled: boolean): void {
  if (enabled && !isDisabledByQuery()) {
    // Ensure the style exists, then opt <body> into the checkerboard backdrop.
    ensureStyle();
    document.body.classList.add(BODY_CLASS);
  } else {
    // Restore the page's normal background (session end, VR, or opted out).
    document.body.classList.remove(BODY_CLASS);
  }
}
