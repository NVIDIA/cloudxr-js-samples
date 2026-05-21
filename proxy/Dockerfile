FROM haproxy:3.2

# Switch to root user for package installation
USER root

# Install necessary tools
RUN apt-get update && apt-get install -y \
    bash \
    gettext-base \
    openssl \
    && rm -rf /var/lib/apt/lists/*

# Create directory for configuration
RUN mkdir -p /usr/local/etc/haproxy/certs \
    && chown -R haproxy:haproxy /usr/local/etc/haproxy

COPY --chmod=755 generate-cert.sh /usr/local/bin/generate-cert.sh
COPY --chown=haproxy:haproxy --chmod=440 haproxy.cfg.template /usr/local/etc/haproxy/haproxy.cfg.template

# Create the entrypoint script
COPY <<EOF /entrypoint.sh
#!/bin/bash

# Use default BACKEND_HOST if not set
if [[ -z "\${BACKEND_HOST:+x}" ]]; then
    export BACKEND_HOST=localhost
    echo "BACKEND_HOST not set, using default: \${BACKEND_HOST}"
fi

# Use default BACKEND_PORT if not set
if [[ -z "\${BACKEND_PORT:+x}" ]]; then
    export BACKEND_PORT=49100
    echo "BACKEND_PORT not set, using default: \${BACKEND_PORT}"
fi

# Use default PROXY_PORT if not set
if [[ -z "\${PROXY_PORT:+x}" ]]; then
    export PROXY_PORT=48322
    echo "PROXY_PORT not set, using default: \${PROXY_PORT}"
fi

# Use default health check interval if not set
if [[ -z "\${HEALTH_CHECK_INTERVAL:+x}" ]]; then
    export HEALTH_CHECK_INTERVAL=2s
    echo "HEALTH_CHECK_INTERVAL not set, using default: \${HEALTH_CHECK_INTERVAL}"
fi

# Use default health check rise if not set
if [[ -z "\${HEALTH_CHECK_RISE:+x}" ]]; then
    export HEALTH_CHECK_RISE=2
    echo "HEALTH_CHECK_RISE not set, using default: \${HEALTH_CHECK_RISE}"
fi

# Use default health check fall if not set
if [[ -z "\${HEALTH_CHECK_FALL:+x}" ]]; then
    export HEALTH_CHECK_FALL=3
    echo "HEALTH_CHECK_FALL not set, using default: \${HEALTH_CHECK_FALL}"
fi

echo "Launching WebSocket SSL Proxy:"
echo "  Backend Host: \${BACKEND_HOST}"
echo "  Backend Port: \${BACKEND_PORT}"
echo "  Proxy Port: \${PROXY_PORT}"
echo "  Health Check Interval: \${HEALTH_CHECK_INTERVAL}"
echo "  Health Check Rise: \${HEALTH_CHECK_RISE}"
echo "  Health Check Fall: \${HEALTH_CHECK_FALL}"
echo "  Cert Hostnames (extra SAN entries): \${CERT_HOSTNAMES:-<none>}"

# Generate self-signed SSL certificate (if needed)
/usr/local/bin/generate-cert.sh
export PROXY_SSL_BIND_OPTIONS="ssl crt /usr/local/etc/haproxy/certs/server.pem"

# Process the template and create the final config
envsubst < /usr/local/etc/haproxy/haproxy.cfg.template > /usr/local/etc/haproxy/haproxy.cfg

# Function to handle signals and forward them to HAProxy
handle_signal() {
    echo "Received signal, shutting down HAProxy..."
    if [[ -n "\$HAPROXY_PID" ]]; then
        kill -TERM "\$HAPROXY_PID" 2>/dev/null
        wait "\$HAPROXY_PID"
    fi
    exit 0
}

# Set up signal handlers
trap handle_signal SIGTERM SIGINT

# Start HAProxy in background and capture PID
echo "Starting HAProxy..."
haproxy -f /usr/local/etc/haproxy/haproxy.cfg &
HAPROXY_PID=\$!

# Wait for HAProxy process
wait "\$HAPROXY_PID"
EOF

RUN chmod +x /entrypoint.sh

# Switch back to haproxy user
USER haproxy

# Set the entrypoint
ENTRYPOINT ["/entrypoint.sh"]
