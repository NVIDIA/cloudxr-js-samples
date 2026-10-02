# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0
#
# CloudXR metrics hub for the streaming e2e. Runs in plaintext HTTP/WS mode
# (HUB_HTTP=1) so the http-served examples can open ws:// to it with no cert
# trust step. See tests/docker-compose.test-e2e.yaml.
FROM node:22-bookworm-slim

WORKDIR /app

# Install with dev deps (esbuild builds the viewer bundle; tsx runs server.ts).
COPY package.json ./
RUN npm install

COPY . .
# Build, then hand /app to the unprivileged `node` user the base image ships.
RUN npm run build && chown -R node:node /app

ENV HUB_HTTP=1 \
    HUB_PORT=8787
EXPOSE 8787

# Drop privileges: 8787 is unprivileged and HTTP mode writes no certs.
USER node

# Run tsx directly (skip the per-start npx resolution).
CMD ["./node_modules/.bin/tsx", "server.ts", "--http"]
