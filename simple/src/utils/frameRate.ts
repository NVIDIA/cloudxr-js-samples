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

/** The optional WebXR frame-rate members used by supported headsets. */
export interface FrameRateSession {
  frameRate?: number;
  supportedFrameRates?: ArrayLike<number>;
  updateTargetFrameRate?: (rate: number) => Promise<void>;
  addEventListener?: (type: string, listener: () => void) => void;
  removeEventListener?: (type: string, listener: () => void) => void;
}

/** Minimal logging surface accepted by applyTargetFrameRate; satisfied by console and test spies. */
export interface FrameRateLogger {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
}

/** Tuning knobs for applyTargetFrameRate; defaults are conservative values safe for all headsets. */
export interface ApplyTargetFrameRateOptions {
  /** Give up waiting for updateTargetFrameRate() after this long, without failing the session. */
  updateTimeoutMs?: number;
  /** After the update resolves, wait at most this long for session.frameRate to report the new rate. */
  rateSettleGraceMs?: number;
}

const DEFAULT_UPDATE_TIMEOUT_MS = 2000;
const DEFAULT_RATE_SETTLE_GRACE_MS = 500;

/**
 * Checks whether a value is a usable frame rate.
 * @param value The candidate value.
 * @returns `true` only for finite positive numbers.
 */
function isFinitePositive(value: unknown): value is number {
  // 0 is not a valid frame rate; NaN/±Infinity would break downstream rate arithmetic.
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/**
 * Returns true when `target` appears in `values`.
 * Uses a manual loop because `values` is ArrayLike (e.g. Float32Array), not a plain Array,
 * so Array.prototype.includes is not available without conversion.
 * @param values Device-supported frame rates, when exposed.
 * @param target The requested frame rate.
 * @returns Whether the exact target is listed.
 */
function containsFrameRate(values: ArrayLike<number> | undefined, target: number): boolean {
  // An absent list cannot prove that the requested rate is supported.
  if (!values) return false;

  // Scan the ArrayLike in place to support typed arrays without allocating a copy.
  for (let index = 0; index < values.length; index += 1) {
    // Frame rates are discrete device values, so only an exact match is valid.
    if (values[index] === target) return true;
  }

  // Exhausting the advertised list establishes that the target is unsupported.
  return false;
}

/**
 * Discriminated union for the three ways updateTargetFrameRate() can settle.
 * Using a union (rather than throwing on timeout/rejection) keeps applyTargetFrameRate's
 * control flow linear and ensures every outcome is handled without try/catch nesting.
 */
type UpdateOutcome =
  | { kind: 'updated' }
  | { kind: 'timeout' }
  | { kind: 'rejected'; error: unknown };

/**
 * Race updateTargetFrameRate() against a deadline.
 * Always resolves (never rejects) so a hung or rejected call never blocks CloudXR creation.
 * The timer is cleared in .finally() so a long-settling call cannot fire after we've moved on.
 * @param update The browser frame-rate update operation.
 * @param timeoutMs Maximum time to wait for the browser.
 * @returns The normalized update outcome.
 */
function raceUpdateAgainstTimeout(
  update: Promise<void>,
  timeoutMs: number
): Promise<UpdateOutcome> {
  let timer!: ReturnType<typeof setTimeout>;

  // Bound browsers that leave the experimental update promise pending forever.
  const timeout = new Promise<UpdateOutcome>(resolve => {
    timer = setTimeout(() => resolve({ kind: 'timeout' }), timeoutMs);
  });

  // Normalize fulfillment and rejection so callers handle every outcome uniformly.
  const settled = update.then(
    (): UpdateOutcome => ({ kind: 'updated' }),
    (error: unknown): UpdateOutcome => ({ kind: 'rejected', error })
  );

  // Clear the losing timeout to avoid work after the update has settled.
  return Promise.race([settled, timeout]).finally(() => clearTimeout(timer));
}

/**
 * The WebXR spec allows session.frameRate to keep its old value when
 * updateTargetFrameRate() resolves; the attribute change is only observable via a
 * later "frameratechange" event. Wait briefly for it so a stale value is not
 * advertised to CloudXR.
 * @param session The WebXR session reporting the effective frame rate.
 * @param targetFrameRate The accepted target frame rate.
 * @param graceMs Maximum time to wait for the reported rate to catch up.
 * @returns A promise that resolves when the rate changes or the grace period expires.
 */
function waitForReportedFrameRate(
  session: FrameRateSession,
  targetFrameRate: number,
  graceMs: number
): Promise<void> {
  // Extract to locals so the narrowing from the undefined-check holds inside the closure.
  // Both must be present: adding a listener without being able to remove it would leak.
  const { addEventListener, removeEventListener } = session;
  if (!addEventListener || !removeEventListener) {
    return Promise.resolve();
  }

  // Resolve through one cleanup path so the event and timeout cannot leak listeners.
  return new Promise(resolve => {
    let done = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Guard: both the timeout and the onChange listener can race to finish(); only the first wins.
    const finish = () => {
      if (done) return;
      done = true;
      if (timer !== undefined) clearTimeout(timer);
      removeEventListener?.('frameratechange', onChange);
      resolve();
    };
    const onChange = () => {
      if (session.frameRate === targetFrameRate) finish();
    };

    // Observe the delayed attribute update permitted by the WebXR API.
    addEventListener('frameratechange', onChange);

    // A bounded grace period prevents a missing event from blocking CloudXR startup.
    timer = setTimeout(finish, graceMs);
  });
}

/**
 * Apply a headset frame rate and wait for the browser before CloudXR negotiates its stream.
 * Returns the effective rate to advertise to CloudXR, falling back without aborting the session.
 * A hung updateTargetFrameRate() must not block CloudXR session creation, so the wait is bounded.
 * @param session The WebXR session whose frame rate should be updated.
 * @param targetFrameRate The desired frame rate.
 * @param logger Logging destination for fallbacks and failures.
 * @param options Timeout and settling overrides.
 * @returns The effective frame rate CloudXR should advertise.
 */
export async function applyTargetFrameRate(
  session: FrameRateSession,
  targetFrameRate: number,
  logger: FrameRateLogger = console,
  options: ApplyTargetFrameRateOptions = {}
): Promise<number> {
  const updateTimeoutMs = options.updateTimeoutMs ?? DEFAULT_UPDATE_TIMEOUT_MS;
  const rateSettleGraceMs = options.rateSettleGraceMs ?? DEFAULT_RATE_SETTLE_GRACE_MS;
  const currentFrameRate = isFinitePositive(session.frameRate) ? session.frameRate : undefined;
  const fallbackFrameRate = currentFrameRate ?? targetFrameRate;

  // Invalid targets must never reach browser rate arithmetic.
  if (!isFinitePositive(targetFrameRate)) {
    logger.warn('Ignoring invalid target WebXR frame rate:', targetFrameRate);
    return fallbackFrameRate;
  }

  // Without both API members, preserve the current/default rate and continue startup.
  if (!session.updateTargetFrameRate || !session.supportedFrameRates) {
    logger.warn(
      'WebXR target frame-rate API is unavailable; using the current/default frame rate:',
      fallbackFrameRate
    );
    return fallbackFrameRate;
  }

  // Requesting a rate absent from the device list would reject on compliant browsers.
  if (!containsFrameRate(session.supportedFrameRates, targetFrameRate)) {
    logger.warn('Requested WebXR frame rate is not supported by this device:', targetFrameRate);
    return fallbackFrameRate;
  }

  // Capture synchronous browser failures before normalizing the asynchronous outcome.
  let update: Promise<void>;
  try {
    update = session.updateTargetFrameRate(targetFrameRate);
  } catch (error) {
    logger.warn('Failed to apply the requested WebXR frame rate:', targetFrameRate, error);
    return fallbackFrameRate;
  }

  const outcome = await raceUpdateAgainstTimeout(update, updateTimeoutMs);

  // A hung browser API must not block creation of the CloudXR session.
  if (outcome.kind === 'timeout') {
    logger.warn(
      `updateTargetFrameRate(${targetFrameRate}) did not settle within ${updateTimeoutMs} ms; ` +
        'continuing so CloudXR negotiation is not blocked. Advertising the known rate:',
      fallbackFrameRate
    );
    return fallbackFrameRate;
  }

  // A rejected update falls back without aborting an otherwise usable XR session.
  if (outcome.kind === 'rejected') {
    logger.warn('Failed to apply the requested WebXR frame rate:', targetFrameRate, outcome.error);
    return fallbackFrameRate;
  }

  // Step 4: Update resolved — wait briefly for session.frameRate to reflect the change.
  const reportsStaleRate = () =>
    session.frameRate !== undefined && session.frameRate !== targetFrameRate;

  // Give the browser's observable attribute a bounded chance to catch up.
  if (reportsStaleRate()) {
    await waitForReportedFrameRate(session, targetFrameRate, rateSettleGraceMs);
  }

  // A resolved updateTargetFrameRate() means the device accepted the rate change.
  // session.frameRate may lag behind the acceptance (it only settles with a later
  // frameratechange event), so the accepted target is the honest rate to advertise.
  if (reportsStaleRate()) {
    logger.warn(
      `Browser still reports ${session.frameRate} Hz after accepting ${targetFrameRate} Hz; ` +
        'advertising the accepted target to CloudXR.'
    );
  } else {
    logger.info('WebXR frame rate applied before CloudXR negotiation:', targetFrameRate);
  }
  return targetFrameRate;
}
