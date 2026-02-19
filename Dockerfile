# Copyright 2026 NVIDIA CORPORATION & AFFILIATES
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
#
# =============================================================================
# WARNING: This Dockerfile is for development and testing purposes only.
# Do NOT use in production environments.
# =============================================================================

FROM node:24-slim AS builder

# Build argument to specify which example to build (simple, react, or isaac)
ARG EXAMPLE_NAME=simple

WORKDIR /app

# Copy the specified example's source (everything except node_modules and build)
# Note: In staging repo, helpers are already copied into each example directory
COPY ${EXAMPLE_NAME}/ ./

# Copy CloudXR SDK tarball from root directory (shared by all examples)
COPY nvidia-cloudxr-*.tgz ./cloudxr-sdk.tgz

# Install CloudXR SDK and dependencies
RUN npm install ./cloudxr-sdk.tgz && \
    npm install && \
    npm run build

# Production stage - serve built files with nginx
FROM nginx:alpine

# Build argument (passed from builder stage)
ARG EXAMPLE_NAME=simple

# Copy built files from builder stage
COPY --from=builder /app/build /usr/share/nginx/html

# Install OpenSSL for HTTPS support (always enabled)
RUN apk add --no-cache openssl

# Create nginx configuration for both HTTP and HTTPS
RUN cat > /etc/nginx/conf.d/default.conf <<'EOF'
server {
    listen 80;
    server_name localhost;
    
    root /usr/share/nginx/html;
    index index.html;
    
    location / {
        try_files $uri $uri/ /index.html;
    }
    
    # Enable CORS
    add_header 'Access-Control-Allow-Origin' '*' always;
    add_header 'Access-Control-Allow-Methods' 'GET, POST, OPTIONS' always;
    add_header 'Access-Control-Allow-Headers' 'DNT,User-Agent,X-Requested-With,If-Modified-Since,Cache-Control,Content-Type,Range' always;
}

server {
    listen 443 ssl;
    server_name localhost;
    
    # SSL certificate paths (generated at startup)
    ssl_certificate /etc/nginx/ssl/server.crt;
    ssl_certificate_key /etc/nginx/ssl/server.key;
    
    root /usr/share/nginx/html;
    index index.html;
    
    location / {
        try_files $uri $uri/ /index.html;
    }
    
    # Enable CORS
    add_header 'Access-Control-Allow-Origin' '*' always;
    add_header 'Access-Control-Allow-Methods' 'GET, POST, OPTIONS' always;
    add_header 'Access-Control-Allow-Headers' 'DNT,User-Agent,X-Requested-With,If-Modified-Since,Cache-Control,Content-Type,Range' always;
}
EOF

# Create entrypoint script for SSL certificate generation
RUN cat > /docker-entrypoint.sh <<'EOF'
#!/bin/sh
set -e

# Generate self-signed SSL certificate if it doesn't exist
if [ ! -f /etc/nginx/ssl/server.crt ]; then
    echo "🔐 Generating self-signed SSL certificate..."
    mkdir -p /etc/nginx/ssl
    openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
        -keyout /etc/nginx/ssl/server.key \
        -out /etc/nginx/ssl/server.crt \
        -subj "/C=US/ST=CA/L=Santa Clara/O=NVIDIA/CN=localhost"
    echo "✅ SSL certificate generated"
else
    echo "✅ Using existing SSL certificate"
fi

# Start nginx
echo "Starting nginx on ports 80 (HTTP) and 443 (HTTPS)..."
exec nginx -g 'daemon off;'
EOF

RUN chmod +x /docker-entrypoint.sh

EXPOSE 80 443

ENTRYPOINT ["/docker-entrypoint.sh"]
