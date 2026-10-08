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

import { URL_PARAMS, type UrlParam } from './params';

const MIN_STREAM_TEST_SECONDS = 5;
const MAX_STREAM_TEST_SECONDS = 30;

/**
 * Resolves a configured stream-test duration to the range supported by the SDK.
 * @param durationSeconds - Duration supplied by the form, URL, or local storage
 * @returns A finite duration clamped to the inclusive 5–30 second range
 */
export function resolveStreamTestSeconds(durationSeconds: number | undefined): number {
  // Use the SDK's minimum as the sample default when persisted input is unusable.
  if (durationSeconds === undefined || !Number.isFinite(durationSeconds)) {
    return MIN_STREAM_TEST_SECONDS;
  }

  // Mirror the SDK bounds so the sample countdown matches the measurement window.
  return Math.min(MAX_STREAM_TEST_SECONDS, Math.max(MIN_STREAM_TEST_SECONDS, durationSeconds));
}

/**
 * Collects the URL params present in `params`, keyed by UrlParam.key. A param is
 * included only when its query param is present and passes its (optional)
 * validation; everything else is skipped. Pure — no DOM access. `urlParams` is
 * injectable for testing and defaults to the real registry.
 */
export function seedsFromParams(
  params: URLSearchParams,
  urlParams: UrlParam[] = URL_PARAMS
): Map<string, string> {
  const seeds = new Map<string, string>();
  for (const param of urlParams) {
    const raw = params.get(param.url ?? param.key);
    if (raw === null) continue;
    if (param.isValid && !param.isValid(raw)) continue;
    seeds.set(param.key, raw);
  }
  return seeds;
}
