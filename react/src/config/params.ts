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
 * Single source of truth for the URL query parameters the React example accepts.
 *
 * Each setting is declared once here and seeded into its form control on load
 * (see resolve.ts and CloudXR2DUI.applyUrlSeeds), instead of being read ad hoc
 * per field. URL values override stored/default values for the current load but
 * are not persisted.
 */
export interface UrlParam {
  /** Canonical identifier; matches the CloudXRConfig field. */
  key: string;
  /** URL query parameter name. Defaults to `key` when omitted. */
  url?: string;
  /** id of the bound form control in index.html. */
  elementId: string;
  /** Optional check for the raw URL string; invalid values are ignored. */
  isValid?: (raw: string) => boolean;
}

// Validator factory: passes only when raw exactly matches one of the allowed strings.
const oneOf =
  (...allowed: string[]) =>
  (raw: string): boolean =>
    allowed.includes(raw);
// Accepts only the literal 'true'/'false'.
const isBool = oneOf('true', 'false');
// Accepts any finite number; rejects empty/whitespace-only input.
const isNumber = (raw: string): boolean => raw.trim() !== '' && Number.isFinite(Number(raw));

/** Every URL-settable setting, with its bound control and optional validation. */
export const URL_PARAMS: UrlParam[] = [
  { key: 'serverIP', elementId: 'serverIpInput' },
  { key: 'port', elementId: 'portInput', isValid: isNumber },
  { key: 'serverType', elementId: 'serverType', isValid: oneOf('manual', 'nvcf') },
  { key: 'app', elementId: 'app' },
  { key: 'codec', elementId: 'codec', isValid: oneOf('auto', 'h264', 'h265', 'av1') },
  { key: 'immersiveMode', elementId: 'immersive', isValid: oneOf('ar', 'vr') },
  { key: 'deviceFrameRate', elementId: 'deviceFrameRate', isValid: isNumber },
  { key: 'maxStreamingBitrateMbps', elementId: 'maxStreamingBitrateMbps', isValid: isNumber },
  { key: 'perEyeWidth', elementId: 'perEyeWidth', isValid: isNumber },
  { key: 'perEyeHeight', elementId: 'perEyeHeight', isValid: isNumber },
  { key: 'reprojectionGridCols', elementId: 'reprojectionGridCols', isValid: isNumber },
  { key: 'reprojectionGridRows', elementId: 'reprojectionGridRows', isValid: isNumber },
  {
    key: 'referenceSpace',
    elementId: 'referenceSpace',
    isValid: oneOf('auto', 'local-floor', 'local', 'viewer', 'unbounded'),
  },
  { key: 'xrOffsetX', elementId: 'xrOffsetX', isValid: isNumber },
  { key: 'xrOffsetY', elementId: 'xrOffsetY', isValid: isNumber },
  { key: 'xrOffsetZ', elementId: 'xrOffsetZ', isValid: isNumber },
  { key: 'enablePoseSmoothing', elementId: 'enablePoseSmoothing', isValid: isBool },
  { key: 'posePredictionFactor', elementId: 'posePredictionFactor', isValid: isNumber },
  { key: 'enableTexSubImage2D', elementId: 'enableTexSubImage2D', isValid: isBool },
  { key: 'useQuestColorWorkaround', elementId: 'useQuestColorWorkaround', isValid: isBool },
  { key: 'proxyUrl', elementId: 'proxyUrl' },
  { key: 'mediaAddress', elementId: 'mediaAddress' },
  { key: 'mediaPort', elementId: 'mediaPort', isValid: isNumber },
  {
    key: 'streamTestMode',
    elementId: 'streamTestMode',
    isValid: oneOf('off', 'warn', 'block'),
  },
  {
    key: 'streamTestDurationSeconds',
    elementId: 'streamTestDurationSeconds',
    isValid: isNumber,
  },
  // deviceProfile is intentionally omitted: it is a preset that bulk-fills the fields
  // above via a change handler, which programmatic seeding does not trigger.
];
