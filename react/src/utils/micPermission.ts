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

export type MicPermissionResult = 'granted' | 'denied' | 'unavailable' | 'skipped';

/**
 * Request browser microphone permission before a WebXR session starts.
 *
 * Returns:
 * - `'skipped'`     — mic is disabled; no API calls made.
 * - `'granted'`     — permission is (now) held; safe to call `setMicEnabled`.
 * - `'denied'`      — user explicitly refused; show a permissions error.
 * - `'unavailable'` — no suitable mic device found; hardware issue, not a permissions issue.
 *
 * Queries the Permissions API first (non-prompting fast path) and calls
 * `getUserMedia` only when a prompt is actually needed. Tracks are stopped
 * immediately — we need only the cached permission, not live audio.
 *
 * Must run before `navigator.xr.requestSession()` because Chrome exits
 * immersive WebXR mode when a `getUserMedia` dialog appears mid-session.
 *
 * @param micEnabled - Whether the user has opted in to mic capture.
 * @returns `'granted'`, `'denied'`, `'unavailable'`, or `'skipped'` — see above.
 */
export async function requestMicPermission(micEnabled: boolean): Promise<MicPermissionResult> {
  // Default to skipped; overwritten below if mic is enabled and a result is determined.
  let result: MicPermissionResult = 'skipped';

  if (micEnabled) {
    // Fast path: check cached permission state without triggering a prompt.
    let needsPrompt = true;
    if (typeof navigator.permissions !== 'undefined') {
      try {
        const status = await navigator.permissions.query({
          name: 'microphone' as PermissionName,
        });
        if (status.state === 'granted') {
          result = 'granted';
          needsPrompt = false;
        } else if (status.state === 'denied') {
          result = 'denied';
          needsPrompt = false;
        }
        // state === 'prompt': fall through to getUserMedia to show the dialog now.
      } catch {
        // Permissions API does not support querying 'microphone' on this browser; fall through.
      }
    }

    if (needsPrompt) {
      // Trigger the permission dialog before WebXR starts so we can cache the result.
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        // Stop all tracks immediately — we need only the permission, not the audio stream.
        stream.getTracks().forEach(t => t.stop());
        result = 'granted';
      } catch (err) {
        // NotAllowedError = user denied. Any other DOMException (NotFoundError, etc.)
        // means a hardware or device issue, not a user decision — report separately.
        result =
          err instanceof DOMException && err.name === 'NotAllowedError' ? 'denied' : 'unavailable';
      }
    }
  }

  return result;
}
