---
name: cloudxr-js-sdk
description: Build WebXR streaming clients with NVIDIA CloudXR.js SDK. Use when developing WebXR apps, integrating CloudXR streaming, creating VR/AR web clients, working with @nvidia/cloudxr, or building React Three Fiber XR applications.
---

# NVIDIA CloudXR.js SDK

CloudXR.js streams XR content from a GPU server to a web browser. The server renders; the client displays video and sends back head/hand tracking. Think "Netflix for VR."

## Quick Start

### Install

From NGC tarball:

```bash
npm install nvidia-cloudxr-<version>.tgz
```

Peer dependencies (app must provide): `gl-matrix`, `long`.

### Minimal Integration (5 steps)

```typescript
import { createSession, SessionState } from '@nvidia/cloudxr';

// 1. Get WebXR session + WebGL context
const xrSession = await navigator.xr.requestSession('immersive-vr', {
  optionalFeatures: ['local-floor'],
});
const gl = xrSession.renderState.baseLayer.context;
const referenceSpace = await xrSession.requestReferenceSpace('local-floor');

// 2. Create CloudXR session
const session = createSession(
  {
    serverAddress: '192.168.1.100',
    serverPort: 49100,
    useSecureConnection: false,
    gl,
    perEyeWidth: 2048,
    perEyeHeight: 1792,
    referenceSpace,
  },
  {
    onStreamStarted: () => console.log('Streaming'),
    onStreamStopped: err => err && console.error(err.message),
  }
);

// 3. Connect
session.connect();

// 4. Render loop
function onFrame(time, frame) {
  session.sendTrackingStateToServer(time, frame);
  session.render(time, frame, xrSession.renderState.baseLayer);
  xrSession.requestAnimationFrame(onFrame);
}
xrSession.requestAnimationFrame(onFrame);

// 5. Disconnect when done
session.disconnect();
```

## Core API

| Export                               | Purpose                                                                                                                |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `createSession(options, delegates?)` | Create a session. Returns `Session`.                                                                                   |
| `Session`                            | Interface: `state`, `connect()`, `disconnect()`, `sendTrackingStateToServer()`, `render()`, `availableMessageChannels` |
| `SessionOptions`                     | Config: server address/port, WebGL context, resolution, codec, bitrate, ICE servers, etc.                              |
| `SessionDelegates`                   | Callbacks: `onStreamStarted`, `onStreamStopped`, `onWebGLStateChangeBegin/End`, `onMetrics`, `onLog`                   |
| `SessionState`                       | Enum: `Initialized → Connecting → Connected → Disconnecting → Disconnected → Error`                                    |
| `MessageChannel`                     | Binary data channel for custom app messages (preferred over deprecated `sendServerMessage`)                            |

## Required SessionOptions

| Field                 | Type                     | Notes                                             |
| --------------------- | ------------------------ | ------------------------------------------------- |
| `serverAddress`       | `string`                 | IP or hostname of CloudXR Runtime                 |
| `serverPort`          | `number`                 | Default `49100`                                   |
| `useSecureConnection` | `boolean`                | `true` for WSS (production), `false` for WS (dev) |
| `gl`                  | `WebGL2RenderingContext` | From canvas or XR layer                           |
| `perEyeWidth`         | `number`                 | Must be multiple of 16, ≥ 256                     |
| `perEyeHeight`        | `number`                 | Must be multiple of 64, ≥ 256                     |
| `referenceSpace`      | `XRReferenceSpace`       | From WebXR session                                |

## Key Optional SessionOptions

| Field                        | Default        | Notes                                        |
| ---------------------------- | -------------- | -------------------------------------------- |
| `codec`                      | `'h264'`       | Also `'av1'`                                 |
| `deviceFrameRate`            | device default | e.g. `72`, `90`                              |
| `maxStreamingBitrateKbps`    | SDK default    | e.g. `150000`                                |
| `enablePoseSmoothing`        | —              | Smooth head tracking                         |
| `posePredictionFactor`       | —              | Prediction multiplier                        |
| `mediaAddress` / `mediaPort` | —              | NAT traversal                                |
| `signalingResourcePath`      | —              | Proxy routing path                           |
| `signalingQueryParameters`   | —              | Auth tokens, etc.                            |
| `iceServers`                 | —              | STUN/TURN for enterprise NAT                 |
| `glBinding`                  | —              | `XRWebGLBinding` for R3F                     |
| `telemetry`                  | —              | `{ enabled, appInfo: { version, product } }` |

## Resolution Rules

- `perEyeWidth` must be a multiple of **16** and ≥ **256**
- `perEyeHeight` must be a multiple of **64** and ≥ **256**
- Stream resolution: width = `perEyeWidth * 2`, height = `perEyeHeight * 9 / 4`
- Use `validatePerEyeResolution()` and `getResolutionValidationError()` before calling `createSession`

## Two Integration Patterns

### Pattern 1: Vanilla WebGL + WebXR

See the [Simple WebGL sample](https://github.com/NVIDIA/cloudxr-js-samples/tree/main/simple).

Key flow: check capabilities → create WebGL context → request XR session → `createSession()` → XR RAF loop with `sendTrackingStateToServer()` + `render()`.

WebGL state: CloudXR modifies GL state during render. If you share the context, save/restore via `onWebGLStateChangeBegin` / `onWebGLStateChangeEnd` delegates.

### Pattern 2: React Three Fiber (R3F)

See the [React sample](https://github.com/NVIDIA/cloudxr-js-samples/tree/main/react).

```tsx
import * as CloudXR from '@nvidia/cloudxr';
import { useThree, useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import { bindGL } from '@helpers/WebGLStateBinding';

function CloudXRComponent({ config }) {
  const gl = useThree().gl.getContext() as WebGL2RenderingContext;
  const trackedGL = bindGL(gl);
  const sessionRef = useRef<CloudXR.Session | null>(null);

  // On XR session start → createSession + connect
  // On XR session end → disconnect

  useFrame(state => {
    const xrFrame = state.gl.xr.getFrame();
    if (sessionRef.current?.state === CloudXR.SessionState.Connected && xrFrame) {
      const timestamp = state.clock.elapsedTime * 1000;
      const layer = state.gl.xr.getBaseLayer() as XRWebGLLayer;
      sessionRef.current.sendTrackingStateToServer(timestamp, xrFrame);
      sessionRef.current.render(timestamp, xrFrame, layer);
    }
  }, -1000); // negative priority = run before Three.js render
}
```

Critical R3F detail: set `threeRenderer.autoClear = false` so Three.js doesn't clear the framebuffer after CloudXR renders. Use `bindGL()` from helpers to save/restore WebGL state around CloudXR calls.

## Error Handling

```typescript
// connect() throws synchronously if it can't initiate
try {
  session.connect();
} catch (e) {
  /* handle */
}

// sendTrackingStateToServer returns false if not connected
if (!session.sendTrackingStateToServer(time, frame)) {
  /* not ready */
}

// Streaming errors arrive via delegate
onStreamStopped: (error?: StreamingError) => {
  if (error) {
    console.error(error.message);
    if (error.code) console.error(`0x${error.code.toString(16).toUpperCase()}`);
  }
};
```

## Message Channels (Custom App Data)

```typescript
const channels = session.availableMessageChannels;
for (const ch of channels) {
  if (ch.status === MessageChannelStatus.Ready) {
    ch.sendServerMessage(new Uint8Array([...]));
    const msg = await ch.receiveMessage();
  }
}
```

## Proxy / HTTPS Setup

For headsets requiring HTTPS (Pico 4 Ultra) or production:

```typescript
createSession({
  serverAddress: 'proxy.example.com',
  serverPort: 443,
  useSecureConnection: true,
  signalingResourcePath: '/192.168.1.100', // target server behind proxy
  // ...
});
```

See the [WSS proxy sample](https://github.com/NVIDIA/cloudxr-js-samples/tree/main/proxy) for a Docker-based HAProxy setup.

## Desktop Development with IWER

On desktop Chrome (no headset), both samples auto-load **IWER** (Immersive Web Emulation Runtime) via `loadIWERIfNeeded()`. IWER emulates a Meta Quest 3 so `requestSession('immersive-vr')` succeeds and `sendTrackingStateToServer()` sends valid poses. The device is exposed as `window.xrDevice` for programmatic access.

IWER's `XRDevice` API supports **programmatic control** — set `window.xrDevice.controlMode = 'programmatic'` to take over from DevUI, then set headset/controller position, orientation, button values, and thumbstick axes from code. Call `notifyStateChange()` after changes to keep DevUI in sync. See [agent-api-reference.md](agent-api-reference.md) for the full IWER XRDevice API and [AGENTS.md](AGENTS.md) for operational rules on IWER automation.

## Samples Overview

| Sample       | Stack                         | Location                                                                 |
| ------------ | ----------------------------- | ------------------------------------------------------------------------ |
| Simple WebGL | Vanilla WebGL2 + WebXR        | [simple/](https://github.com/NVIDIA/cloudxr-js-samples/tree/main/simple) |
| React        | R3F + @react-three/xr + uikit | [react/](https://github.com/NVIDIA/cloudxr-js-samples/tree/main/react)   |
| WSS Proxy    | Docker + HAProxy              | [proxy/](https://github.com/NVIDIA/cloudxr-js-samples/tree/main/proxy)   |

Run any sample: `npm install && npm run dev` in its directory. For Isaac Teleop, see [github.com/NVIDIA/IsaacTeleop](https://github.com/NVIDIA/IsaacTeleop).

## Common Pitfalls

1. **Resolution validation fails** — `perEyeWidth` must be multiple of 16, `perEyeHeight` multiple of 64, both ≥ 256
2. **Black screen in R3F** — forgot `autoClear = false` or missing WebGL state save/restore
3. **Connection fails on headset** — check HTTPS requirement (Pico needs WSS), firewall ports: 49100 (WS signaling), 47998 (WebRTC media), 48322 (WSS signaling TLS proxy), or 443 with external proxy
4. **Choppy tracking** — enable `enablePoseSmoothing`, tune `posePredictionFactor`
5. **Shared WebGL context corruption** — always use `onWebGLStateChangeBegin/End` delegates

## Additional Resources

- [agent-api-reference.md](agent-api-reference.md) — detailed types, enums, all SessionOptions fields
- [CloudXR.js API Reference](https://docs.nvidia.com/cloudxr-sdk/apis/cloudxr-js/) — full generated API docs
- [CloudXR.js User Guide](https://docs.nvidia.com/cloudxr-sdk/latest/usr_guide/cloudxr_js/index.html) — getting started, session API, client setup, performance, troubleshooting
- [CloudXR SDK Documentation](https://docs.nvidia.com/cloudxr-sdk/latest/index.html) — runtime, networking, deployment
- [CloudXR.js Samples on GitHub](https://github.com/NVIDIA/cloudxr-js-samples) — all sample source code
