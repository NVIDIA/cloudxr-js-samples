# NVIDIA CloudXR.js SDK - Getting Started

For comprehensive documentation, see the [NVIDIA CloudXR SDK documentation](https://docs.nvidia.com/cloudxr-sdk/latest/usr_guide/cloudxr_js/index.html).

[The NVIDIA CloudXR.js SDK](https://docs.nvidia.com/cloudxr-sdk/latest/usr_guide/cloudxr_js/index.html) enables developers to build web clients that stream high-quality spatial content from CloudXR servers with powerful GPUs to web browsers on XR devices. It consists of:

- **CloudXR.js SDK** - a JavaScript client library
- **WebGL-based simple sample client** that uses core Web APIs (WebGL, WebXR)
- **React-based sample client** that uses the R3F (React-Three-Fiber) framework stack

## Architecture

```
┌─────────────────────────┐         WebSocket + WebRTC        ┌──────────────────────────┐
│   Browser (Client)      │ ◄──────────────────────────────► │   GPU Server             │
│                         │                                   │                          │
│  CloudXR.js SDK         │   signaling (WS :49100)          │  CloudXR Runtime         │
│  ├─ createSession()     │   signaling TLS proxy (:48322)   │  ├─ OpenXR app           │
│  ├─ connect()           │   media (WebRTC :47998)           │  │  (Omniverse, Isaac,    │
│  ├─ sendTracking()      │   tracking data (client→server)  │  │   LÖVR, Unreal, etc.)  │
│  └─ render()            │   video frames (server→client)   │  └─ NVIDIA GPU(s)        │
│                         │                                   │                          │
│  WebXR Device API       │                                   │                          │
│  WebGL2 Rendering       │                                   │                          │
└─────────────────────────┘                                   └──────────────────────────┘
```

Think of it like a video call where one side is a GPU rendering a VR scene, and the other side is a lightweight browser on a headset. The server does all the heavy rendering; the client just displays decoded video frames and sends back head/hand tracking data.

### Networking Ports

| Port  | Protocol     | Purpose                                  |
| ----- | ------------ | ---------------------------------------- |
| 49100 | WebSocket    | Signaling (direct, non-secure)           |
| 48322 | WSS          | Signaling TLS proxy (default HTTPS port) |
| 47998 | UDP (WebRTC) | Media stream (video + audio)             |

It is _strongly recommended_ that you work through this guide if you have never run CloudXR.js before.

## The Pieces of a CloudXR.js Deployment

Even for development, you'll need all the pieces of a CloudXR.js deployment in order to build and test a client. These are:

- a CloudXR Server
  - with a _top-end_ NVIDIA GPU or 2 (e.g. dual RTX 6000 Ada)
  - which will run
    - the CloudXR Runtime
    - an OpenXR application (the thing you want to render on the server but see on the client)
- a CloudXR.js development workstation
  - with Node.js and `npm`
  - which will run
    - the CloudXR.js sample client build
    - a Node-based development web server
- a CloudXR.js client
  - which is one of:
    - an XR headset (Quest 2/3/3S or Pico 4 Ultra) with its built-in Browser app
    - a desktop browser: [Google Chrome](https://www.google.com/chrome) or Edge (IWER automatically loads for XR emulation)
  - which will run...
    - the CloudXR.js sample client _served from the development web server_.

We _recommend_ that for your first experience, all above run on _the same computer_ to eliminate networking related issues.

## High Level Workflow

You need both a working client and a working server in order to test. Typically we follow a startup flow where server starts before the client:

1. CloudXR Runtime
2. Server XR application
3. Sample client build + web server
4. Test from the same computer
5. Test from an XR headset (Quest 2/3/3S or Pico 4 Ultra) or a different computer

> **Quick Start Tip:** For the fastest way to get a server running, try [LÖVR](https://github.com/NVIDIA/cloudxr-lovr-sample) - a lightweight VR framework that's great for testing your CloudXR.js client setup.

## Documentation

Full documentation is available on the [NVIDIA CloudXR SDK documentation site](https://docs.nvidia.com/cloudxr-sdk/latest/), including:

- [CloudXR.js User Guide](https://docs.nvidia.com/cloudxr-sdk/latest/usr_guide/cloudxr_js/index.html) — Session API, client setup, performance tuning, troubleshooting
- [CloudXR.js API Reference](https://docs.nvidia.com/cloudxr-sdk/apis/cloudxr-js/) — Full generated TypeScript API docs
- [Quick Start Guide](https://docs.nvidia.com/cloudxr-sdk/latest/quickstart.html) — End-to-end guided walkthrough
- [Simple WebGL Workflow](https://docs.nvidia.com/cloudxr-sdk/latest/usr_guide/cloudxr_js/sample_webgl.html)
- [React Sample Workflow](https://docs.nvidia.com/cloudxr-sdk/latest/usr_guide/cloudxr_js/sample_react.html)
- [WebSocket Proxy Setup](https://docs.nvidia.com/cloudxr-sdk/latest/usr_guide/cloudxr_js/proxy_setup.html)
- [Network Configuration](https://docs.nvidia.com/cloudxr-sdk/latest/requirement/network_setup.html)

### For AI Agents

- [AGENTS.md](AGENTS.md) — Operational guide for AI coding agents
- [SKILL.md](SKILL.md) — Concise coding-agent quick reference
- [agent-api-reference.md](agent-api-reference.md) — Full API type details for agents

### Related Projects

- [CloudXR.js Samples on GitHub](https://github.com/NVIDIA/cloudxr-js-samples)
- [Isaac Teleop](https://github.com/NVIDIA/IsaacTeleop) — Robot teleoperation using CloudXR.js

## License

The samples are licensed under the Apache License 2.0. See the [LICENSE](LICENSE) file for details.
