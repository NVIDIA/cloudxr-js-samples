# CloudXR WSS Proxy

WebSocket SSL Proxy for CloudXR.js examples. Provides secure WSS connection to CloudXR Runtime.

For comprehensive proxy setup guidance including Kubernetes deployments and certificate trust on XR headsets, see [WebSocket Proxy Setup](https://docs.nvidia.com/cloudxr-sdk/latest/usr_guide/cloudxr_js/proxy_setup.html) in the CloudXR SDK documentation.

## What It Does

- Provides WSS (WebSocket Secure) endpoint (default port `48322`)
- Automatically generates self-signed SSL certificates on startup
- Forwards traffic to CloudXR Runtime (default `localhost:49100`)
- Configurable backend, proxy ports, and health checks
- CORS support for browser-based XR applications

## Usage

### Build the Docker Image

```bash
cd proxy
docker build -t cloudxr-wss-proxy .
```

### Run the Proxy

```bash
docker run -d --name wss-proxy \
  --network host \
  -e BACKEND_HOST=localhost \
  -e BACKEND_PORT=49100 \
  -e PROXY_PORT=48322 \
  cloudxr-wss-proxy
```

### View Logs

```bash
docker logs -f wss-proxy
```

### Stop the Proxy

```bash
docker stop wss-proxy
docker rm wss-proxy
```

## Configuration

### Environment Variables

| Variable                | Default     | Description                                      |
| ----------------------- | ----------- | ------------------------------------------------ |
| `BACKEND_HOST`          | `localhost` | CloudXR Runtime hostname or IP address           |
| `BACKEND_PORT`          | `49100`     | CloudXR Runtime WebSocket port                   |
| `PROXY_PORT`            | `48322`     | SSL proxy listening port                         |
| `HEALTH_CHECK_INTERVAL` | `2s`        | Time between backend health checks               |
| `HEALTH_CHECK_RISE`     | `2`         | Consecutive successful checks to mark backend UP |
| `HEALTH_CHECK_FALL`     | `3`         | Consecutive failed checks to mark backend DOWN   |

## SSL Certificates

### Self-Signed SSL

Certificates are automatically generated on first run:

```
🔐 Generating self-signed SSL certificate...
✅ SSL certificate generated at /usr/local/etc/haproxy/certs/server.pem
```

On subsequent runs, the existing certificate is reused:

```
✅ Using existing SSL certificate from /usr/local/etc/haproxy/certs/server.pem
```

Certificates are stored in `/usr/local/etc/haproxy/certs/`:

- `server.crt` - Public certificate
- `server.key` - Private key
- `server.pem` - Combined certificate + key (used by HAProxy)

### Persistence

To persist certificates across container restarts, use a Docker volume:

```bash
docker run -d --name wss-proxy \
  --network host \
  -v cloudxr-proxy-certs:/usr/local/etc/haproxy/certs \
  -e BACKEND_HOST=localhost \
  -e BACKEND_PORT=49100 \
  -e PROXY_PORT=48322 \
  cloudxr-wss-proxy
```

This ensures the same certificate is reused when you restart the container.

### Using Custom Certificates

If you have your own SSL certificate, you can use it instead of the auto-generated self-signed certificate:

1. **Prepare certificate:**

   Combine your certificate and private key into a single PEM file:

   ```bash
   cat your-cert.crt your-key.key > server.pem
   ```

2. **Mount certificate into container:**

   ```bash
   docker run -d --name wss-proxy \
     --network host \
     -v /path/to/server.pem:/usr/local/etc/haproxy/certs/server.pem:ro \
     -e BACKEND_HOST=localhost \
     -e BACKEND_PORT=49100 \
     -e PROXY_PORT=48322 \
     cloudxr-wss-proxy
   ```

### For XR Headsets

You need to trust the certificate on your XR headset browser. See [Client Setup](https://docs.nvidia.com/cloudxr-sdk/latest/usr_guide/cloudxr_js/client_setup.html) for device-specific instructions.

## Architecture

```
┌─────────────────┐         WSS (port 48322)        ┌─────────────┐
│   XR Browser    │ ──────────────────────────────► │  WSS Proxy  │
│   or Emulator   │         SSL encrypted           │  (HAProxy)  │
└─────────────────┘                                 └──────┬──────┘
                                                           │
                                                           │ WS (port 49100)
                                                           │ unencrypted
                                                           ▼
                                                    ┌──────────────┐
                                                    │   CloudXR    │
                                                    │   Runtime    │
                                                    └──────────────┘
```

## Troubleshooting

### Container won't start

```bash
# Check logs
docker logs wss-proxy

# Common issues:
# - Port 48322 already in use
# - Certificate generation failed
```

### Certificate errors on headset

```bash
# Regenerate certificates by removing the volume
docker stop wss-proxy
docker rm wss-proxy
docker volume rm cloudxr-proxy-certs
# Then run the proxy again
```

### Connection refused

```bash
# Check CloudXR Runtime is running on localhost:49100
docker logs wss-proxy

# Run with custom backend host/port:
docker run -d --name wss-proxy \
  --network host \
  -e BACKEND_HOST=192.168.1.100 \
  -e BACKEND_PORT=49100 \
  cloudxr-wss-proxy
```

## License

Apache License 2.0 - See LICENSE file in repository root
