# CloudXR.js API Reference (for Agents)

Detailed type definitions and parameter descriptions for AI agents and coding assistants. Companion to [SKILL.md](SKILL.md) and [AGENTS.md](AGENTS.md).

For the full generated API docs, see: [docs.nvidia.com/cloudxr-sdk/apis/cloudxr-js/](https://docs.nvidia.com/cloudxr-sdk/apis/cloudxr-js/)

---

## createSession

```typescript
function createSession(options: SessionOptions, delegates?: SessionDelegates): Session;
```

Validates options (throws on invalid resolution/grid), then returns a `Session` in `Initialized` state.

Validation rules enforced:

- `perEyeWidth`: positive integer, multiple of 16, ≥ 256
- `perEyeHeight`: positive integer, multiple of 64, ≥ 256
- If both `reprojectionGridCols` and `reprojectionGridRows` are set, they must be valid grid dimensions

### Resolution Validation Helpers

```typescript
function validatePerEyeResolution(width: number, height: number): PerEyeResolutionValidationResult;
function getResolutionValidationError(result: PerEyeResolutionValidationResult): string | null;
function getResolutionValidationMessageForConnect(width: number, height: number): string | null;

function validateDepthReprojectionGrid(cols: number, rows: number): GridValidationResult;
function getGridValidationError(result: GridValidationResult): string | null;
function getGridValidationMessageForConnect(cols: number, rows: number): string | null;
```

Use these before `createSession` to show user-friendly validation messages in UI.

---

## SessionOptions (complete)

### Required Fields

| Field                 | Type                     | Description                                      |
| --------------------- | ------------------------ | ------------------------------------------------ |
| `serverAddress`       | `string`                 | IP or hostname of CloudXR Runtime server         |
| `serverPort`          | `number`                 | Signaling port (default runtime port: 49100)     |
| `useSecureConnection` | `boolean`                | `true` = WSS, `false` = WS                       |
| `gl`                  | `WebGL2RenderingContext` | WebGL2 context for rendering                     |
| `perEyeWidth`         | `number`                 | Width per eye in pixels (multiple of 16, ≥ 256)  |
| `perEyeHeight`        | `number`                 | Height per eye in pixels (multiple of 64, ≥ 256) |
| `referenceSpace`      | `XRReferenceSpace`       | WebXR reference space for tracking origin        |

### Optional: Networking

| Field                      | Type               | Description                                                                                                  |
| -------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------ |
| `mediaAddress`             | `string`           | IP for WebRTC media (NAT traversal). IPv4 only.                                                              |
| `mediaPort`                | `number`           | Port for WebRTC media. `0` = server-chosen. Only works when `mediaAddress` is set.                           |
| `sessionId`                | `string`           | NVCF session ID for cloud function routing                                                                   |
| `signalingQueryParameters` | `string`           | Query params appended to signaling URL (format: `key=val&key2=val2`)                                         |
| `signalingResourcePath`    | `string`           | Path inserted in signaling URL for proxy routing (e.g. target server IP)                                     |
| `iceServers`               | `RTCConfiguration` | STUN/TURN servers: `{ iceServers: [{urls, username?, credential?}], iceTransportPolicy?: 'all' \| 'relay' }` |

### Optional: Streaming

| Field                     | Type              | Description                                  |
| ------------------------- | ----------------- | -------------------------------------------- |
| `codec`                   | `'h264' \| 'av1'` | Video codec. Default: `'h264'`               |
| `deviceFrameRate`         | `number`          | Target frame rate (e.g. 72, 90)              |
| `maxStreamingBitrateKbps` | `number`          | Max bitrate in Kbps (e.g. 150000 = 150 Mbps) |

### Optional: Tracking & Rendering

| Field                     | Type             | Description                                                                |
| ------------------------- | ---------------- | -------------------------------------------------------------------------- |
| `enablePoseSmoothing`     | `boolean`        | Smooth head tracking data                                                  |
| `posePredictionFactor`    | `number`         | Prediction multiplier for head tracking                                    |
| `reprojectionGridCols`    | `number`         | Depth reprojection grid columns                                            |
| `reprojectionGridRows`    | `number`         | Depth reprojection grid rows                                               |
| `enableTexSubImage2D`     | `boolean`        | Use texSubImage2D for video upload                                         |
| `useQuestColorWorkaround` | `boolean`        | Color correction for Quest devices                                         |
| `glBinding`               | `XRWebGLBinding` | Required for R3F/Three.js integration. Get via `webXRManager.getBinding()` |

### Optional: Telemetry & Logging

| Field       | Type       | Description                                                                     |
| ----------- | ---------- | ------------------------------------------------------------------------------- |
| `logLevel`  | `LogLevel` | Max log verbosity: `Silent(0)`, `Error(1)`, `Warning(2)`, `Info(3)`, `Debug(4)` |
| `telemetry` | `object`   | `{ enabled?: boolean, appInfo?: { version?: string, product?: string } }`       |

---

## Session Interface

```typescript
interface Session {
  readonly state: SessionState;

  connect(): void; // Throws if options invalid. Transitions: Initialized/Disconnected → Connecting
  disconnect(): void; // Transitions: Connected → Disconnecting → Disconnected

  sendTrackingStateToServer( // Returns false if not connected
    time: DOMHighResTimeStamp,
    frame: XRFrame
  ): boolean;

  render( // Composites latest server frame onto XR layer
    time: DOMHighResTimeStamp,
    frame: XRFrame,
    layer: XRWebGLLayer
  ): void;

  /** @deprecated Use availableMessageChannels instead */
  sendServerMessage(message: object): void;

  readonly availableMessageChannels: ReadonlyArray<MessageChannel>;
}
```

---

## SessionState Enum

```typescript
enum SessionState {
  Initialized = 'Initialized', // Created, not yet connected
  Connecting = 'Connecting', // Handshake in progress
  Connected = 'Connected', // Streaming active
  Disconnecting = 'Disconnecting', // Teardown in progress
  Disconnected = 'Disconnected', // Clean disconnect, can reconnect
  Error = 'Error', // Unrecoverable, must recreate
}
```

---

## SessionDelegates Interface

```typescript
interface SessionDelegates {
  onStreamStarted?: () => void;
  onStreamStopped?: (error?: StreamingError) => void;
  onWebGLStateChangeBegin?: () => void;
  onWebGLStateChangeEnd?: () => void;
  /** @deprecated Use session.availableMessageChannels */
  onServerMessageReceived?: (messageData: Uint8Array) => void;
  onMetrics?: (metrics: Metrics, cadence: MetricsCadence) => void;
  onLog?: (entries: LogEntry[]) => void;
}
```

### StreamingError

```typescript
interface StreamingError extends Error {
  code?: number; // e.g. 0xC0F2220C — include in bug reports
  reasonCode?: number; // stream stop reason
}
```

---

## MessageChannel Interface

```typescript
enum MessageChannelStatus {
  NotInitialized = 'NotInitialized',
  Ready = 'Ready',
  Closed = 'Closed',
}

interface MessageChannel extends Disposable {
  readonly uuid: string;
  readonly status: MessageChannelStatus;
  readonly receivedMessageStream: ReadableStream<Uint8Array>;
  sendServerMessage(data: Uint8Array): void;
  receiveMessage(): Promise<Uint8Array>;
  disconnect(): void;
}
```

---

## Metrics

```typescript
enum MetricsName {
  RenderFramerate = 'render.framerate', // FPS of rendered frames
  PoseToRenderTime = 'render.pose_to_render_time', // ms from pose sent to frame displayed
  StreamingFramerate = 'streaming.framerate', // FPS of received server frames
  StreamingFrameCount = 'streaming.frame_count', // Total valid frames received
}

enum MetricsCadence {
  PerFrame = 'frame', // Fired each time a server frame arrives
  PerRender = 'render', // Fired each client render
}

type Metrics = Partial<Record<MetricsName, number>>;
```

---

## LogLevel Enum

```typescript
enum LogLevel {
  Silent = 0, // No logs
  Error = 1, // Failures only
  Warning = 2, // + recoverable issues
  Info = 3, // + lifecycle events
  Debug = 4, // + frame-level trace (verbose)
}

interface LogEntry {
  timestamp: DOMHighResTimeStamp; // performance.now() timeline
  level: LogLevel;
  message: string;
}
```

---

## Recommended Device Profiles

| Device         | perEyeWidth | perEyeHeight | deviceFrameRate | Notes                            |
| -------------- | ----------- | ------------ | --------------- | -------------------------------- |
| Quest 3        | 2048        | 1792         | 90              | HTTP or HTTPS                    |
| Quest 3S       | 2048        | 1792         | 90              | HTTP or HTTPS                    |
| Pico 4 Ultra   | 2048        | 1792         | 90              | HTTPS only                       |
| Desktop Chrome | 1024        | 1024         | 60              | IWER auto-loads for XR emulation |

---

## URL Construction

The SDK constructs the signaling WebSocket URL as:

```
{ws|wss}://{serverAddress}:{serverPort}/{signalingResourcePath}/sign_in?{SDK params}&{signalingQueryParameters}
```

Example with proxy:

```
wss://proxy.example.com:443/192.168.1.100/sign_in?client_type=6&...&token=abc
```

---

## IWER XRDevice API (Desktop Emulation)

When developing on desktop Chrome without a headset, [IWER](https://meta-quest.github.io/immersive-web-emulation-runtime/) provides a programmatic API for controlling the emulated XR device. Both samples auto-load IWER via `loadIWERIfNeeded()`, which exposes the device as `window.xrDevice`.

### XRDevice

```typescript
class XRDevice {
  constructor(deviceConfig: XRDeviceConfig, deviceOptions?: Partial<XRDeviceOptions>);

  readonly position: Vector3; // headset world position (set via .set(x, y, z))
  readonly quaternion: Quaternion; // headset orientation (set via .set(x, y, z, w))
  stereoEnabled: boolean;
  ipd: number;
  fovy: number;
  primaryInputMode: 'controller' | 'hand';
  controlMode: 'manual' | 'programmatic'; // 'manual' = DevUI drives, 'programmatic' = external code drives

  readonly controllers: { [key in XRHandedness]?: XRController };
  readonly hands: { [key in XRHandedness]?: XRHandInput };

  recenter(): void;
  updateVisibilityState(state: XRVisibilityState): void;
  notifyStateChange(): void; // sync DevUI after programmatic changes
}
```

### XRController

```typescript
class XRController {
  connected: boolean;
  readonly position: Vector3;
  readonly quaternion: Quaternion;
  readonly inputSource: XRInputSource;

  updateButtonValue(id: string, value: number): void; // 0 = released, 1 = fully pressed
  updateButtonTouch(id: string, touched: boolean): void;
  updateAxis(id: string, type: 'x-axis' | 'y-axis', value: number): void; // -1 to 1
  updateAxes(id: string, x: number, y: number): void;
}
```

### Button and Axis IDs

| ID                       | Component                          |
| ------------------------ | ---------------------------------- |
| `xr-standard-trigger`    | Index trigger                      |
| `xr-standard-squeeze`    | Grip/squeeze                       |
| `xr-standard-thumbstick` | Thumbstick button (press) and axes |
| `a-button` / `x-button`  | A (right) / X (left)               |
| `b-button` / `y-button`  | B (right) / Y (left)               |
| `thumbrest`              | Touch surface                      |

Axis groups use the same IDs — pass to `updateAxis` or `updateAxes`.

### Device Profiles

IWER ships built-in profiles: `metaQuest3`, `metaQuest3S`, `metaQuestPro`. Import from the IWER global:

```typescript
const xrDevice = new IWER.XRDevice(IWER.metaQuest3);
```

### Control Modes

By default, DevUI is in `'manual'` mode and continuously writes poses to the device. To control the device programmatically (from console, Playwright, or agents), switch to `'programmatic'` mode first:

```javascript
window.xrDevice.controlMode = 'programmatic'; // DevUI stops writing, reads from device instead
window.xrDevice.position.set(0, 1.6, 0);
window.xrDevice.notifyStateChange(); // sync DevUI visual state
// ... do your automation ...
window.xrDevice.controlMode = 'manual'; // return control to DevUI
```

For full API documentation: [XRDevice](https://meta-quest.github.io/immersive-web-emulation-runtime/api/xr-device.html) · [XRController](https://meta-quest.github.io/immersive-web-emulation-runtime/api/xr-controller.html) · [Config Interfaces](https://meta-quest.github.io/immersive-web-emulation-runtime/api/config-interfaces.html)

---

## Further Reading

- [CloudXR.js API Reference (generated)](https://docs.nvidia.com/cloudxr-sdk/apis/cloudxr-js/) — authoritative, auto-generated from source
- [Session API Guide](https://docs.nvidia.com/cloudxr-sdk/latest/usr_guide/cloudxr_js/session_api.html) — lifecycle, advanced connection patterns
- [Performance Guide](https://docs.nvidia.com/cloudxr-sdk/latest/usr_guide/cloudxr_js/performance.html) — profiling, framebuffer scaling, foveation
- [Network Setup](https://docs.nvidia.com/cloudxr-sdk/latest/requirement/network_setup.html) — firewall, WiFi, STUN/TURN
- [Troubleshooting](https://docs.nvidia.com/cloudxr-sdk/latest/usr_guide/cloudxr_js/troubleshooting.html) — error codes and solutions
- [CloudXR.js Samples](https://github.com/NVIDIA/cloudxr-js-samples) — source code on GitHub
