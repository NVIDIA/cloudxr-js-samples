#!/bin/bash
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0
#
# Generates a self-signed SSL certificate for the WSS proxy, with a
# subjectAltName covering localhost, loopback, and any names supplied via
# CERT_HOSTNAMES (comma-separated DNS / IPv4 / IPv6).
#
# Env vars:
#   CERT_DIR        Output directory. Default: /usr/local/etc/haproxy/certs
#   CERT_HOSTNAMES  Extra SAN entries (comma-separated). Default: empty.

# Fail fast: any failed mkdir/cd/openssl/cat must stop the script — openssl and
# the following commands use paths relative to $CERT_DIR, so a silent cd
# failure would write the cert files to the script's invocation cwd.
set -euo pipefail

CERT_DIR="${CERT_DIR:-/usr/local/etc/haproxy/certs}"
CERT_FILE="$CERT_DIR/server.pem"

mkdir -p "$CERT_DIR"

# Only generate if certificate doesn't exist
if [[ ! -f "$CERT_FILE" ]]; then
    # Build a subjectAltName list. Modern browsers require SAN — CN is ignored
    # for hostname matching, and CN is never consulted for IP literals.
    # Defaults cover loopback; CERT_HOSTNAMES adds LAN IPs / DNS names for
    # headsets that connect over the network (e.g. "192.168.1.42,xr-host.local").
    SAN_LIST="DNS:localhost,IP:127.0.0.1,IP:::1"
    if [[ -n "${CERT_HOSTNAMES:-}" ]]; then
        IFS=',' read -ra _extra <<< "$CERT_HOSTNAMES"
        for h in "${_extra[@]}"; do
            # Strip whitespace + stray single/double quotes that get embedded
            # when CERT_HOSTNAMES is double-quoted in compose/env-file ("foo").
            h_trim=$(echo "$h" | tr -d '[:space:]"'"'")
            [[ -z "$h_trim" ]] && continue
            if [[ "$h_trim" =~ ^([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})$ ]] \
                && (( BASH_REMATCH[1] <= 255 && BASH_REMATCH[2] <= 255 && BASH_REMATCH[3] <= 255 && BASH_REMATCH[4] <= 255 )); then
                SAN_LIST="$SAN_LIST,IP:$h_trim"
            elif [[ "$h_trim" == *:* ]]; then
                SAN_LIST="$SAN_LIST,IP:$h_trim"
            else
                SAN_LIST="$SAN_LIST,DNS:$h_trim"
            fi
        done
    fi

    echo "🔐 Generating self-signed SSL certificate (SAN: $SAN_LIST) ..."
    cd "$CERT_DIR"
    openssl req -x509 -newkey rsa:2048 \
        -keyout server.key -out server.crt \
        -days 365 -nodes \
        -subj "/CN=localhost" \
        -addext "subjectAltName=$SAN_LIST" \
        -quiet
    # Combine certificate and key into a single file for HAProxy
    cat server.crt server.key > server.pem
    # Ownership only applies when the haproxy user exists (inside the image);
    # tests may run as another user and that's fine.
    if id haproxy >/dev/null 2>&1; then
        chown haproxy:haproxy server.key server.crt server.pem
    fi
    chmod 600 server.key server.pem
    chmod 644 server.crt
    echo "✅ SSL certificate generated at $CERT_FILE"
else
    echo "✅ Using existing SSL certificate from $CERT_FILE"
fi
