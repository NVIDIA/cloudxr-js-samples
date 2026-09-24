# CloudXR.js Metrics Hub (local dev)

WebSocket hub plus a browser page that shows live metrics and rolling time-series charts. The CloudXR.js **react** sample registers with the hub over WebSocket (`/oob/v1/ws`), streams CloudXR metrics, and accepts remote config pushes.

The hub is reached **directly** (co-located, no proxy). The client opens a WebSocket at `{ws|wss}://{CloudXR Server IP}:{hubPort}/oob/v1/ws`, where the scheme follows the page transport and `hubPort` defaults to **8787**. The hub port is a separate `hubPort` query param — it does not reuse the `port` field, which always seeds CloudXR signaling.

## Layout (same idea as `examples/simple`)

| Path                    | Role                                                |
| ----------------------- | --------------------------------------------------- |
| `index.html`            | Static page shell (checked in)                      |
| `src/main.ts`           | Browser app — charts, WebSocket client              |
| `src/hub.css`           | Styles (bundled with the app)                       |
| `src/shared/metrics.ts` | Shared metrics parsing (server + browser)           |
| `src/hub/`              | Hub server modules (`Hub`, HTTP, WebSocket, config) |
| `server.ts`             | Thin bootstrap (~25 lines)                          |
| `build/`                | **Generated** — run `npm run build`                 |

```
server.ts          → bootstrap
src/hub/Hub.ts     → state, register, broadcast
src/hub/http.ts    → REST + static files from build/
src/hub/websocket.ts
src/shared/metrics.ts
```

## 1. Start the hub

```bash
cd examples/hub
npm install
npm start
```

By default the hub listens with **HTTPS/WSS** on port **8787** using a cached self-signed dev certificate (`.dev-certs/`). Your browser will prompt once to trust the certificate.

For plaintext HTTP/WS only (local dev with HTTP sample pages):

```bash
npm run start:http
# or: tsx server.ts --http
# or: HUB_HTTP=1 npm start
```

## 2. Open the hub page

**https://127.0.0.1:8787/** (default)

With `--http`: **http://127.0.0.1:8787/**

The page auto-connects as `operator` (add `?autoconnect=0` to disable).

## 3. Connect a sample client (OOB URL parameters)

Enable the hub channel with query parameters on the sample's page URL. The implementation lives under `examples/react/src/metrics/`. The sample wires the channel in `src/App.tsx` and seeds the 2D panel from the URL via `parseStreamUrlSeeds()` → `CloudXR2DUI.initialize()`.

1. Start the hub (see §1) on the **same transport** as the sample page — both HTTP or both HTTPS — so the browser allows the hub WebSocket.

2. Open the sample client with OOB enabled:

   ```text
   http://<sample-host>:8080/?oobEnable=1&hubPort=8787
   ```

   Example on the same machine:

   ```text
   http://127.0.0.1:8080/?oobEnable=1&hubPort=8787
   ```

   `hubPort` defaults to **8787**, so `?oobEnable=1` alone also works.

3. In the panel, set **CloudXR Server IP** to the same host you use as **Hub host** on the hub page (often `127.0.0.1`). The hub WebSocket address is derived from that IP — there is no separate “hub IP” query parameter.

4. Connect CloudXR as usual. In the browser console you should see:

   ```text
   [MetricsHub] Hub WebSocket: ws://127.0.0.1:8787/oob/v1/ws
   Hub hello — headset registered
   ```

   Open or refresh the hub tab **after** the client shows `connected to hub` if the headset does not appear immediately.

## Query parameter reference

Boolean flags accept **`1`** or **`true`** (case-insensitive). Other truthy strings are **not** treated as enabled unless noted.

### Metrics hub (hub WebSocket)

| Parameter      | Required         | Default  | Description                                                                                               |
| -------------- | ---------------- | -------- | --------------------------------------------------------------------------------------------------------- |
| `oobEnable`    | Yes (to connect) | off      | `1` or `true` — open `MetricsHubChannel` to the hub. Without this, no hub WebSocket is created.           |
| `hubPort`      | No               | **8787** | Metrics hub port. Distinct from `port` (CloudXR signaling) — setting it never touches the signaling port. |
| `controlToken` | No               | _(none)_ | Optional shared secret sent on hub register. Must match hub `HUB_TOKEN` when that env var is set.         |

`port` is **not** a hub parameter — it always seeds CloudXR signaling (see Stream/panel seeds below) regardless of `oobEnable`.

**Hub URL shape** (built when `oobEnable=1` and **CloudXR Server IP** is non-empty):

```text
{ws|wss}://{CloudXR Server IP}:{hubPort}/oob/v1/ws
```

- **`ws` vs `wss`:** follows the page scheme — `wss` on HTTPS pages, `ws` on HTTP pages (so the browser doesn't block it as mixed content).
- **Host:** always the **CloudXR Server IP** field in the panel (same as stream/signaling server), not a separate query key.
- **Path:** `/oob/v1/ws` (constant `METRICS_HUB_WS_PATH`).

### Stream / panel seeds (bookmark-friendly)

Parsed by `parseStreamUrlSeeds()` and applied when the 2D UI initializes. URL values override `localStorage` for that session.

| Parameter            | Applied to panel      | Values                 | Description                                                                                                                                                                                                 |
| -------------------- | --------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `serverIP`           | **CloudXR Server IP** | hostname or IP         | Seeds the server IP input and `localStorage` key `serverIp`. Also used as the hub WebSocket host when OOB is enabled.                                                                                       |
| `port`               | **Port**              | `1`–`65535`            | Always seeds the **CloudXR signaling** port (default **49100** on HTTP), independent of `oobEnable`. The metrics hub uses its own `hubPort` param, so the two never collide.                                |
| `codec`              | **Video Codec**       | `h264`, `h265`, `av1`  | Seeds the codec dropdown and `localStorage` key `codec`.                                                                                                                                                    |
| `headless`           | **Headless** checkbox | `true` or `false` only | Skips client-side CloudXR render (tracking still on); forces **VR** immersive mode. Stored as `cloudxrHeadless` in `localStorage`. Note: `1` / `0` are **not** accepted — use the strings `true` / `false`. |
| `panelHiddenAtStart` | _(not a URL seed)_    | —                      | Hub-side only; not in `STREAM_URL_SEED_KEYS`. Pass via the hub REST API (`/api/oob/v1/config?panelHiddenAtStart=true`) or hub URL query, not as a headset URL parameter.                                    |

## Example URLs

### Local dev (metrics hub on 8787)

```text
http://127.0.0.1:8080/?oobEnable=1&hubPort=8787
```

Same with server IP pre-filled:

```text
http://127.0.0.1:8080/?oobEnable=1&hubPort=8787&serverIP=127.0.0.1
```

With codec and headless:

```text
http://127.0.0.1:8080/?oobEnable=1&hubPort=8787&serverIP=127.0.0.1&codec=av1&headless=false
```

To override the signaling port as well, add `port`; it is independent of `hubPort`:

```text
http://127.0.0.1:8080/?oobEnable=1&hubPort=8787&port=49100
```

### HTTPS page (default WSS hub)

```text
https://<sample-host>:8080/?oobEnable=1&hubPort=8787
```

The client uses `wss://` automatically because the page is HTTPS; run the default HTTPS hub (not `--http`).

With optional auth:

```text
http://127.0.0.1:8080/?oobEnable=1&hubPort=8787&controlToken=<secret>
```

## Port semantics (common confusion)

| Connection                 | Typical port (HTTP dev) | Controlled by                                             |
| -------------------------- | ----------------------- | --------------------------------------------------------- |
| Sample webpack dev server  | **8080**                | the sample's dev server (e.g. `examples/react`)           |
| CloudXR signaling (WebRTC) | **49100**               | Panel **Port** field (or `port` URL seed)                 |
| Metrics hub                | **8787**                | `hubPort` query param or default `LOCAL_METRICS_HUB_PORT` |

`port` and `hubPort` are independent: `port` always targets CloudXR signaling, `hubPort` always targets the metrics hub. Omitting `hubPort` defaults the hub to **8787**; omitting `port` leaves signaling at the panel **Port** field (**49100** on HTTP).

## Troubleshooting

| Symptom                              | Check                                                                                                                       |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| No `[MetricsHub] Hub WebSocket:` log | `oobEnable=1` missing, or **CloudXR Server IP** empty                                                                       |
| Mixed-content error                  | Page transport ≠ hub transport. Keep both HTTP (hub `--http`) or both HTTPS (default hub).                                  |
| Hub shows 0 headsets                 | Hub opened before the client registered — refresh hub after the client connects; confirm Server IP matches hub **Hub host** |
| `register rejected (bad token)`      | Set matching `controlToken` on the client URL and `HUB_TOKEN` on hub                                                        |
| Hub on wrong port                    | `hubPort` controls the hub (default **8787**); `port` only seeds signaling and never changes the hub                        |

## Related files

| File                                                 | Role                                               |
| ---------------------------------------------------- | -------------------------------------------------- |
| `examples/react/src/metrics/metricsHubUrl.ts`        | URL parsing, hub URL builder, stream seeds         |
| `examples/react/src/metrics/metricsHubChannel.ts`    | WebSocket protocol client                          |
| `examples/react/src/metrics/useMetricsHubChannel.ts` | React hook used by the sample                      |
| `examples/react/src/App.tsx`                         | Metrics buffers, hub hook, `parseStreamUrlSeeds()` |
| `examples/react/src/CloudXR2DUI.tsx`                 | Applies URL seeds to the connect panel             |

## License

Apache-2.0
