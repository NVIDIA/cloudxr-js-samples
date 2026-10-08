/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Structured console logging for the metrics hub server process.
 */

/** Logger returned by {@link createLogger}. */
export interface HubLogger {
  /** Informational messages (always emitted). */
  info: (...args: unknown[]) => void;
  /** Warning messages (always emitted). */
  warn: (...args: unknown[]) => void;
  /** Verbose debug messages (emitted only when debug mode is enabled). */
  debug: (...args: unknown[]) => void;
}

/**
 * Create a prefixed hub logger.
 * @param debug When true, {@link HubLogger.debug} writes to the console.
 * @returns Logger with consistent ``[OperatorHub]`` prefixes.
 */
export function createLogger(debug: boolean): HubLogger {
  return {
    info: (...args: unknown[]) => console.info('[OperatorHub]', ...args),
    warn: (...args: unknown[]) => console.warn('[OperatorHub]', ...args),
    debug: (...args: unknown[]) => {
      // Verbose traffic logs are opt-in via HUB_DEBUG to keep default output quiet.
      if (debug) console.info('[OperatorHub DEBUG]', ...args);
    },
  };
}
