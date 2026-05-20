# NVIDIA CloudXR.js — Agent Instructions

> Operational guide for AI coding agents working in this codebase.
> For detailed API types, see [agent-api-reference.md](agent-api-reference.md).
> For a coding-focused quick reference, see [SKILL.md](SKILL.md).

## What This Is

CloudXR.js is a **TypeScript SDK** that streams VR/AR from a GPU server to a web browser via WebRTC. The server renders; the browser displays video and sends back head/hand tracking.

## Commands

```bash
# Download latest SDK from NGC (update version as needed)
SDK_VERSION="6.1.0"
SDK_FILE="nvidia-cloudxr-${SDK_VERSION}.tgz"
curl -fL -o "${SDK_FILE}" \
  "https://api.ngc.nvidia.com/v2/resources/nvidia/cloudxr-js/versions/${SDK_VERSION}/files/${SDK_FILE}?download=true"

# Install SDK + run any sample
cd simple/ && npm install "../${SDK_FILE}" && npm run dev   # Vanilla WebGL
cd react/  && npm install "../${SDK_FILE}" && npm run dev   # React Three Fiber

# Peer deps the app must provide: gl-matrix, long
```

## When Scaffolding a New Client

1. Import: `import { createSession, SessionState } from '@nvidia/cloudxr';`
2. Obtain a WebXR session (use `optionalFeatures: ['local-floor']` — recommended, not required)
3. Get a `WebGL2RenderingContext` and `XRReferenceSpace`
4. Call `createSession(options, delegates)` — see required fields below
5. Call `session.connect()`
6. In the XR `requestAnimationFrame` loop: call `sendTrackingStateToServer(time, frame)` then `render(time, frame, layer)`

### Required SessionOptions

| Field                 | Type                     | Constraint                    |
| --------------------- | ------------------------ | ----------------------------- |
| `serverAddress`       | `string`                 | IP or hostname                |
| `serverPort`          | `number`                 | `49100` (WS) or `48322` (WSS) |
| `useSecureConnection` | `boolean`                | `true` = WSS, `false` = WS    |
| `gl`                  | `WebGL2RenderingContext` | —                             |
| `perEyeWidth`         | `number`                 | Multiple of **16**, ≥ 256     |
| `perEyeHeight`        | `number`                 | Multiple of **64**, ≥ 256     |
| `referenceSpace`      | `XRReferenceSpace`       | `'local-floor'` recommended   |

### Device Defaults

| Device         | perEyeWidth | perEyeHeight | frameRate | HTTPS required? |
| -------------- | ----------- | ------------ | --------- | --------------- |
| Quest 3 / 3S   | 2048        | 1792         | 90        | No              |
| Pico 4 Ultra   | 2048        | 1792         | 90        | **Yes**         |
| Desktop Chrome | 1024        | 1024         | 60        | No              |

## When Integrating with React Three Fiber

- Set `renderer.autoClear = false` — **critical**, or Three.js clears the CloudXR framebuffer
- Pass `glBinding: webXRManager.getBinding()` in SessionOptions
- Use `useFrame` with negative priority (`-1000`) to render before Three.js
- Use `onWebGLStateChangeBegin/End` delegates to save/restore GL state

## When Debugging Connection Issues

| Symptom            | Cause                | Fix                                                                       |
| ------------------ | -------------------- | ------------------------------------------------------------------------- |
| `connect()` throws | Invalid resolution   | Width % 16 == 0, Height % 64 == 0, both ≥ 256                             |
| Black screen       | GL state corruption  | Add `onWebGLStateChangeBegin/End` delegates                               |
| Black screen (R3F) | Three.js clearing FB | `renderer.autoClear = false`                                              |
| Connection timeout | Firewall             | Open ports: 49100 (WS signaling), 47998 (WebRTC media), 48322 (WSS proxy) |
| Pico won't connect | HTTP blocked         | Use HTTPS with WSS proxy (see `proxy/` sample)                            |

Ports: 49100 = WS signaling (direct), 48322 = WSS signaling TLS proxy (default HTTPS), 47998 = WebRTC media (video + audio). With an external proxy, signaling goes through port 443 instead of 48322.

## When Using IWER (Desktop XR Emulation)

Both samples auto-load [IWER](https://meta-quest.github.io/immersive-web-emulation-runtime/) on desktop browser. After load, `window.xrDevice` is available for programmatic control.

### Programmatic control pattern

```javascript
window.xrDevice.controlMode = 'programmatic'; // MUST set first or DevUI overwrites
window.xrDevice.position.set(0, 1.6, 0); // headset position (meters)
window.xrDevice.notifyStateChange(); // sync DevUI
// ... automate ...
window.xrDevice.controlMode = 'manual'; // return to DevUI
```

### Controller/hand input

```javascript
const right = window.xrDevice.controllers['right'];
right.position.set(0.3, 1.2, -0.5);
right.updateButtonValue('xr-standard-trigger', 1.0); // press
right.updateButtonValue('xr-standard-trigger', 0.0); // release
window.xrDevice.notifyStateChange();
```

Button IDs: `xr-standard-trigger`, `xr-standard-squeeze`, `xr-standard-thumbstick`, `a-button`/`x-button`, `b-button`/`y-button`.

### Key rules for IWER automation

- `window.xrDevice` is `undefined` when a real headset is detected (IWER not loaded)
- Always call `notifyStateChange()` after pose/input changes
- XR session must be active (after CONNECT) for poses to affect rendering
- Positions are in **meters** — 1 cm = 0.01, 10 cm = 0.10
- For smooth motion, step incrementally (0.005 m per step with 100 ms delays)

## Boundaries

### Always

- Validate resolution with `validatePerEyeResolution()` before `createSession`
- Check `session.state === SessionState.Connected` before calling `sendTrackingStateToServer`
- Use `onWebGLStateChangeBegin/End` when sharing the GL context
- Set `controlMode = 'programmatic'` before setting IWER poses

### Never

- Use `perEyeWidth` or `perEyeHeight` values that violate constraints (multiples of 16/64, ≥ 256)
- Omit `autoClear = false` in R3F integrations
- Use the deprecated `sendServerMessage()` — use `availableMessageChannels` instead
- Jump to absolute IWER positions without reading current pose first (apply relative deltas)

## Escalation

- If connection fails after 3 attempts → stop, report the error code from `onStreamStopped`
- If resolution validation fails → run `getResolutionValidationError()` and show the message
- If IWER is undefined → a real headset was detected; IWER is not loaded, skip programmatic control

## Links

- [SKILL.md](SKILL.md) — coding-agent quick reference with integration patterns
- [agent-api-reference.md](agent-api-reference.md) — full SessionOptions, delegates, enums, metrics
- [CloudXR.js User Guide](https://docs.nvidia.com/cloudxr-sdk/latest/usr_guide/cloudxr_js/index.html)
- [CloudXR.js API Docs](https://docs.nvidia.com/cloudxr-sdk/apis/cloudxr-js/)
- [Samples on GitHub](https://github.com/NVIDIA/cloudxr-js-samples)
- [IWER XRDevice API](https://meta-quest.github.io/immersive-web-emulation-runtime/api/xr-device.html)
