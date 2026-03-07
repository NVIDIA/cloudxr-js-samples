# React Three Fiber Example

This is a comprehensive CloudXR.js React Three Fiber example application that demonstrates how to integrate CloudXR streaming with modern React development patterns. This example showcases the power of combining CloudXR.js with React Three Fiber, React Three XR, and React Three UIKit to create immersive XR experiences with rich 3D user interfaces.

> NOTE: This example is not meant to be used for production.

## Overview

This example showcases the integration of CloudXR.js with the React Three Fiber ecosystem, providing:

- **React Three Fiber Integration**: Seamless integration with Three.js through React components
- **React Three XR**: WebXR session management with React hooks and state management
- **React Three UIKit**: Rich 3D user interface components for VR/AR experiences
- **CloudXR Streaming**: Real-time streaming of XR content from a CloudXR server
- **Modern React Patterns**: Hooks, context, and component-based architecture
- **Dual UI System**: 2D HTML interface for configuration and 3D VR interface for interaction

## Quick Start

Choose **Option A** (Docker) for a quick containerized setup, or **Option B** (Local) for development with hot reloading.

### Option A: Docker (Recommended for Quick Start)

#### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) installed and running

#### Build and Run

Build and run the sample client in a container:

```bash
# Build the Docker image (for react example)
docker build -t cloudxr-react-sample --build-arg EXAMPLE_NAME=react .

# Run the container
docker run -d --name cloudxr-react-sample -p 8080:80 -p 8443:443 cloudxr-react-sample
```

Open `http://localhost:8080` (HTTP) or `https://localhost:8443` (HTTPS) in your browser.

> **Note**: When using HTTPS, you'll need to accept the self-signed certificate warning in your browser.

To stop and remove the container:

```bash
docker stop cloudxr-react-sample && docker rm cloudxr-react-sample
```

### Option B: Local Development

#### Prerequisites

- Node.js (v20 or higher)
- A CloudXR server running and accessible
- A WebXR-compatible device (VR headset, AR device)

#### Build and Run

1. **Navigate to the example folder**

   ```bash
   cd react
   ```

2. **Install Dependencies**

   ```bash
   npm install /path/to/nvidia-cloudxr-<version>.tgz
   ```

3. **Build the Application**

   ```bash
   npm run build
   ```

4. **Start Development Server**

   ```bash
   npm run dev-server
   ```

5. **Open in Browser**
   - Navigate to `http://localhost:8080` (or the port shown in terminal)
   - For desktop browsers, IWER (Immersive Web Emulator Runtime) will automatically load to emulate a Meta Quest 3 headset

### Basic Usage

1. **Configure Connection**

   - Enter your CloudXR server IP address
   - Set the port (default: 49100)
   - Select AR or VR immersive mode

2. **Adjust Settings** (Optional)

   - Configure per-eye resolution (perEyeWidth and perEyeHeight, must be multiples of 16)
   - Set target frame rate and bitrate
   - Adjust XR reference space

3. **Start Streaming**
   - Click "CONNECT" to initiate the XR session
   - Grant XR permissions when prompted

> NOTE: In order to connect to an actual server and start streaming, you need:
>
> - A CloudXR server running and accessible
> - A WebXR-compatible device (VR/AR headset) or desktop browser (IWER loads automatically for emulation)

> **Quick Start Tip:** For the fastest way to get a server running, try [LÖVR](https://github.com/NVIDIA/cloudxr-lovr-sample) - a lightweight VR framework that's great for testing your CloudXR.js client setup.

## Technical Architecture

### Core Components

#### `App.tsx`

Main React application component managing:

- XR store configuration and session state
- CloudXR component integration
- 2D UI management and event handling
- Error handling and capability checking
- React Three Fiber Canvas setup

#### `CloudXRComponent.tsx`

Handles the core CloudXR streaming functionality:

- CloudXR session lifecycle management
- WebXR session event handling
- WebGL state management and render target preservation
- Frame-by-frame rendering loop with pose tracking
- Integration with Three.js WebXRManager

#### `CloudXR2DUI.tsx`

Manages the 2D HTML interface:

- Form field management and localStorage persistence
- Proxy configuration based on protocol
- Event listener management and cleanup
- Error handling and user feedback
- Configuration validation and updates

#### `CloudXRUI.tsx` (3D UI)

Renders the in-VR user interface:

- React Three UIKit components for 3D UI
- Interactive control buttons with hover effects
- Server information and status display
- Event handler integration

## Development

### Project Structure

```bash
react/
├── src/
│   ├── App.tsx              # Main React application
│   ├── CloudXRComponent.tsx # CloudXR streaming component
│   ├── CloudXR2DUI.tsx      # 2D UI management class
│   ├── CloudXRUI.tsx        # 3D VR UI component
│   ├── index.tsx            # React app entry point
│   └── index.html           # HTML template
├── public/
│   ├── play-circle.svg                   # Play button icon (Heroicons)
│   ├── stop-circle.svg                   # Stop button icon (Heroicons)
│   ├── arrow-uturn-left.svg              # Reset button icon (Heroicons)
│   └── arrow-left-start-on-rectangle.svg # Disconnect button icon (Heroicons)
├── package.json             # Dependencies and scripts
├── webpack.common.js        # Webpack configuration
├── webpack.dev.js           # Development webpack config
├── webpack.prod.js          # Production webpack config
└── tsconfig.json            # TypeScript configuration
```

## React Three Fiber Integration

### XR Store Configuration

The application uses React Three XR's store for XR session management:

```javascript
const store = createXRStore({
  foveation: 0,
  emulate: { syntheticEnvironment: false },
});
```

### Canvas Setup

React Three Fiber Canvas with WebXR integration:

```typescript
<Canvas events={noEvents} gl={{ preserveDrawingBuffer: true }}>
  <XR store={store}>
    <CloudXRComponent config={config} applicationName="My App" />
    <CloudXR3DUI onAction1={handleAction1} />
  </XR>
</Canvas>
```

### Custom Render Loop

The CloudXR component uses `useFrame` for custom rendering:

```typescript
useFrame((state, delta) => {
  if (webXRManager.isPresenting && session) {
    // CloudXR rendering logic
    cxrSession.sendTrackingStateToServer(timestamp, xrFrame);
    cxrSession.render(timestamp, xrFrame, layer);
  }
}, -1000);
```

## 3D User Interface

### React Three UIKit Components

The 3D UI uses React Three UIKit for modern VR/AR interfaces:

- **Container**: Layout and positioning components
- **Text**: 3D text rendering with custom fonts
- **Button**: Interactive buttons with hover effects
- **Image**: Texture-based image display
- **Root**: Main UI container with pixel-perfect rendering

### UI Positioning

3D UI elements are positioned in world space:

```typescript
<group position={[1.8, -0.5, -1.3]} rotation={[0, -0.3, 0]}>
  <Root pixelSize={0.001} width={1920} height={1440}>
    {/* UI components */}
  </Root>
</group>
```

### WebGL State Tracking

This example uses WebGL state tracking to prevent rendering conflicts between React Three Fiber and CloudXR. Both libraries render to the same WebGL context, but CloudXR's rendering operations modify WebGL state (framebuffers, textures, buffers, VAOs, shaders, blend modes, etc.) which can interfere with React Three Fiber's expectations. The example wraps the WebGL context with `bindGL()` from `@helpers/WebGLStateBinding`, then uses CloudXR's `onWebGLStateChangeBegin` and `onWebGLStateChangeEnd` callbacks to automatically save and restore state around CloudXR's rendering. This ensures React Three Fiber always finds the WebGL context in the expected state after each CloudXR render operation.

See `examples/helpers/WebGLStateBinding.ts`, `WebGLState.ts`, and `WebGLStateApply.ts` for implementation details. Comprehensive tests are available in `tests/unit/WebGLState.test.ts` and `tests/playwright/WebGLTests/src/WebGLStateBindingTests.ts`.

## Documentation

For comprehensive guides beyond this README, see the [NVIDIA CloudXR SDK documentation](https://docs.nvidia.com/cloudxr-sdk/latest/):

- [React Sample Workflow](https://docs.nvidia.com/cloudxr-sdk/latest/usr_guide/cloudxr_js/sample_react.html) -- full build and validation walkthrough
- [Client Setup](https://docs.nvidia.com/cloudxr-sdk/latest/usr_guide/cloudxr_js/client_setup.html) -- headset browser configuration (Meta Quest, Pico 4 Ultra)
- [Session API](https://docs.nvidia.com/cloudxr-sdk/latest/usr_guide/cloudxr_js/session_api.html) -- connection lifecycle, WebXR integration patterns
- [Performance Tuning](https://docs.nvidia.com/cloudxr-sdk/latest/usr_guide/cloudxr_js/performance.html) -- resolution, foveation, bitrate
- [Proxy Setup](https://docs.nvidia.com/cloudxr-sdk/latest/usr_guide/cloudxr_js/proxy_setup.html) -- HTTPS/WSS proxy for device testing
- [Troubleshooting](https://docs.nvidia.com/cloudxr-sdk/latest/usr_guide/cloudxr_js/troubleshooting.html) -- common issues and diagnostics

## License

See the [LICENSE](../LICENSE) file for details.

### Third-Party Assets

Icons used in the immersive UI are from [Heroicons](https://heroicons.com/) by Tailwind Labs, licensed under the MIT License. See [HEROICONS_LICENSE](public/HEROICONS_LICENSE) for details.
