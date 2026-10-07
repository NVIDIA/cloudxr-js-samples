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
 * Override PressureObserver to catch errors from unexpected browser implementations.
 *
 * Some browsers have buggy PressureObserver implementations that throw errors
 * when observe() is called. This wrapper catches and logs those errors instead
 * of letting them propagate.
 *
 * This should be called early in your application, before any code attempts
 * to use PressureObserver.
 */
export function overridePressureObserver(): void {
  // Skip environments without a browser implementation to wrap.
  if (typeof window === 'undefined' || !(window as any).PressureObserver) {
    return;
  }

  // Preserve the native constructor so the wrapper retains its implementation.
  const OriginalPressureObserver = (window as any).PressureObserver;

  /** Wraps the browser observer so implementation errors cannot escape into the application. */
  class PressureObserver extends OriginalPressureObserver {
    /**
     * Delegates observation while converting browser failures into warnings.
     * @param source The pressure source accepted by the native implementation.
     * @returns The native result, or `undefined` after a handled failure.
     */
    observe(source: any) {
      try {
        const result = super.observe(source);

        // Some browser implementations reject asynchronously instead of throwing.
        if (result && typeof result.catch === 'function') {
          return result.catch((error: unknown) => {
            // Rejections may contain strings or other non-Error values.
            const message = error instanceof Error ? error.message : String(error);
            console.warn('PressureObserver.observe() failed:', message);
            return undefined;
          });
        }
        return result;
      } catch (error: unknown) {
        // Synchronous throws are equally allowed to contain non-Error values.
        const message = error instanceof Error ? error.message : String(error);
        console.warn('PressureObserver.observe() failed:', message);
        return undefined;
      }
    }
  }

  // Replace the global only after the defensive subclass is fully defined.
  (window as any).PressureObserver = PressureObserver;
}
