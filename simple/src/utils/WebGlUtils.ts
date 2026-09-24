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
 * Returns an existing canvas or creates one with the requested identifier.
 * @param id DOM identifier for the canvas.
 * @param resolution Optional backing-buffer dimensions.
 * @returns The verified canvas element.
 * @throws When a canvas cannot be created.
 */
export function getOrCreateCanvas(
  id: string,
  resolution?: { width: number; height: number }
): HTMLCanvasElement {
  // Reuse an existing render target so callers do not create duplicate canvases.
  let canvas = document.getElementById(id) as HTMLCanvasElement | null;

  // Create and attach the canvas only when the page has not provided one.
  if (!canvas) {
    canvas = document.createElement('canvas') as HTMLCanvasElement;
    canvas.id = id;
    // canvas.style.display = "none";
    document.body.appendChild(canvas);
  }

  // Guard the function contract even if a nonstandard DOM fails to create the element.
  if (!canvas) {
    throw new Error('Failed to create canvas');
  }

  // Apply backing resolution only when the caller explicitly supplies dimensions.
  if (resolution) {
    canvas.width = resolution.width;
    canvas.height = resolution.height;
  }

  return canvas;
}

/**
 * Reports the current WebGL error with a readable symbolic name.
 * @param tagString Context describing the WebGL operation being checked.
 * @param gl WebGL2 context whose error state should be inspected.
 * @returns Nothing when the context reports no error.
 * @throws When WebGL reports any error code.
 */
export function logOrThrow(tagString: string, gl: WebGL2RenderingContext) {
  // Read the error once so the reported code belongs to this checkpoint.
  const err = gl.getError();

  // Only nonzero WebGL errors require symbolic mapping and an exception.
  if (err !== gl.NO_ERROR) {
    let errorString;

    // Convert implementation constants into actionable diagnostic names.
    switch (err) {
      case gl.INVALID_ENUM:
        errorString = 'INVALID_ENUM';
        break;
      case gl.INVALID_VALUE:
        errorString = 'INVALID_VALUE';
        break;
      case gl.INVALID_OPERATION:
        errorString = 'INVALID_OPERATION';
        break;
      case gl.INVALID_FRAMEBUFFER_OPERATION:
        errorString = 'INVALID_FRAMEBUFFER_OPERATION';
        break;
      case gl.OUT_OF_MEMORY:
        errorString = 'OUT_OF_MEMORY';
        break;
      case gl.CONTEXT_LOST_WEBGL:
        errorString = 'CONTEXT_LOST_WEBGL';
        break;
      default:
        errorString = 'UNKNOWN_ERROR';
        break;
    }

    // Fail at the originating checkpoint instead of allowing corrupted GL state to continue.
    throw new Error('WebGL error: ' + tagString + ': ' + errorString + ' (' + err + ')');
  } else {
    // Keep successful checkpoints visible when debug logging is enabled.
    console.debug('WebGL no-error: ' + tagString);
  }
}
