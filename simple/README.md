# CloudXR.js Simple Example

A minimal WebGL example demonstrating WebXR streaming from a CloudXR server to a web browser. This example shows how to integrate WebXR with CloudXR to stream immersive VR/AR content.

> **Note:** This example is for learning purposes, not production use.

## Quick Start

Choose **Option A** (Docker) for a quick containerized setup, or **Option B** (Local) for development with hot reloading.

### Option A: Docker (Recommended for Quick Start)

#### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) installed and running

#### Build and Run

Build and run the sample client in a container:

```bash
# Build the Docker image (for simple example)
docker build -t cloudxr-js-sample --build-arg EXAMPLE_NAME=simple .

# Run the container
docker run -d --name cloudxr-js-sample -p 8080:80 -p 8443:443 cloudxr-js-sample
```

Open `http://localhost:8080` (HTTP) or `https://localhost:8443` (HTTPS) in your browser.

> **Note**: When using HTTPS, you'll need to accept the self-signed certificate warning in your browser.

To stop and remove the container:

```bash
docker stop cloudxr-js-sample && docker rm cloudxr-js-sample
```

### Option B: Local Development

#### Prerequisites

- Node.js (v20 or higher)

#### Build and Run

1. **Navigate to the example folder**

   ```bash
   cd simple
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

   - Enter CloudXR server IP address (default: localhost)
   - Set port (default: 49100)
   - Select AR or VR mode

2. **Adjust Settings (Optional)**

   - Per-eye resolution (must be multiples of 16)
   - Target frame rate (72, 90, or 120 FPS)
   - Streaming bitrate
   - XR reference space and camera offsets

3. **Start Streaming**
   - Click "CONNECT"
   - Grant XR permissions when prompted

**Requirements:**

- CloudXR server running and accessible
- WebXR-compatible device (VR/AR headset) or desktop browser (IWER loads automatically for emulation)

> **Quick Start Tip:** For the fastest way to get a server running, try [LÖVR](https://github.com/NVIDIA/cloudxr-lovr-sample) - a lightweight VR framework that's great for testing your CloudXR.js client setup.

## Architecture

### CloudXRClient Class

The main application class (`CloudXRClient` in `main.ts`) handles:

**Initialization:**

- UI element management and localStorage persistence
- Browser capability checks (WebXR, WebGL2, WebRTC)
- Event listener setup

**Connection Flow:**

1. **WebGL Setup** - Creates high-performance WebGL2 context
2. **WebXR Session** - Enters immersive VR/AR mode
3. **Reference Space** - Configures coordinate system for tracking
4. **CloudXR Session** - Establishes streaming connection to server
5. **Render Loop** - Sends tracking data, receives video, renders frames

**Key Components:**

- **WebXR Session** - Hardware access (headset, controllers)
- **WebGL Context** - Video rendering
- **CloudXR Session** - Streaming management (WebRTC-based)
- **XRWebGLLayer** - Bridge between WebXR and WebGL

## Project Structure

```
simple/
├── src/
│   └── main.ts          # Main application sample
├── index.html           # UI and form elements sample
├── package.json         # Dependencies and scripts
├── webpack.common.js    # Webpack base configuration sample
├── webpack.dev.js       # Development configuration sample
├── webpack.prod.js      # Production configuration sample
└── tsconfig.json        # TypeScript configuration sample
```

## Code Overview

The `main.ts` file contains well-commented code explaining each step:

1. **Browser Checks** - Validates WebXR, WebGL2, and WebRTC support
2. **Connection Setup** - Reads form inputs and validates configuration
3. **WebGL Initialization** - Creates optimized rendering context
4. **WebXR Session** - Enters immersive mode with requested features
5. **CloudXR Setup** - Configures streaming session with event handlers
6. **Render Loop** - Runs 72-120 times per second:
   - Sends tracking data to server
   - Receives video frame
   - Renders to display

Each method includes inline comments explaining the purpose and key concepts.

## Documentation

For comprehensive guides beyond this README, see the [NVIDIA CloudXR SDK documentation](https://docs.nvidia.com/cloudxr-sdk/latest/):

- [Simple WebGL Workflow](https://docs.nvidia.com/cloudxr-sdk/latest/usr_guide/cloudxr_js/sample_webgl.html) -- full build and validation walkthrough
- [Client Setup](https://docs.nvidia.com/cloudxr-sdk/latest/usr_guide/cloudxr_js/client_setup.html) -- headset browser configuration (Meta Quest, Pico 4 Ultra)
- [Session API](https://docs.nvidia.com/cloudxr-sdk/latest/usr_guide/cloudxr_js/session_api.html) -- connection lifecycle and configuration
- [Performance Tuning](https://docs.nvidia.com/cloudxr-sdk/latest/usr_guide/cloudxr_js/performance.html) -- resolution, foveation, bitrate
- [Proxy Setup](https://docs.nvidia.com/cloudxr-sdk/latest/usr_guide/cloudxr_js/proxy_setup.html) -- HTTPS/WSS proxy for device testing
- [Troubleshooting](https://docs.nvidia.com/cloudxr-sdk/latest/usr_guide/cloudxr_js/troubleshooting.html) -- common issues and diagnostics

## License

See the [LICENSE](../LICENSE) file for details.
