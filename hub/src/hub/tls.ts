/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Development TLS credentials for the local metrics hub (self-signed, cached on disk).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import selfsigned from 'selfsigned';

/** PEM key and certificate pair for {@link https.createServer}. */
export interface TlsCredentials {
  key: string;
  cert: string;
}

/**
 * Load cached dev TLS credentials or generate a new self-signed pair for localhost.
 * @param certDir Directory used to persist generated PEM files between runs.
 */
export async function loadOrCreateDevTlsCredentials(certDir: string): Promise<TlsCredentials> {
  const keyPath = join(certDir, 'dev-key.pem');
  const certPath = join(certDir, 'dev-cert.pem');

  // Reuse cached PEMs so dev restarts do not regenerate certificates.
  if (existsSync(keyPath) && existsSync(certPath)) {
    return {
      key: readFileSync(keyPath, 'utf8'),
      cert: readFileSync(certPath, 'utf8'),
    };
  }

  mkdirSync(certDir, { recursive: true });
  // selfsigned v5+ returns a Promise; await before writing PEM files.
  const generated = await selfsigned.generate(
    [{ name: 'commonName', value: 'CloudXR Metrics Hub (dev)' }],
    {
      days: 825,
      keySize: 2048,
      algorithm: 'sha256',
      extensions: [
        {
          name: 'subjectAltName',
          altNames: [
            { type: 2, value: 'localhost' },
            { type: 7, ip: '127.0.0.1' },
          ],
        },
      ],
    }
  );

  // Restrict key permissions (owner read/write only) for TLS tooling and Sonar compliance.
  writeFileSync(keyPath, generated.private, { encoding: 'utf8', mode: 0o600 });
  writeFileSync(certPath, generated.cert, 'utf8');

  return { key: generated.private, cert: generated.cert };
}
