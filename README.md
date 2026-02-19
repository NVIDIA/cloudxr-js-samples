# NVIDIA CloudXR.js SDK - Getting Started

> **Note:** For detailed documentation, see the `docs/` folder (open `docs/index.html` in browser).

[The NVIDIA CloudXR.js SDK](#) enables developers to build web clients that stream high-quality spatial content from CloudXR servers with powerful GPUs to web browsers on XR devices. It consists of:

- **CloudXR.js SDK** - a JavaScript client library
- **WebGL-based simple sample client** that uses core Web APIs (WebGL, WebXR)
- **React-based sample client** that uses the R3F (React-Three-Fiber) framework stack

<!-- #region firstRunGuide -->

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
    - an XR headset (Meta Quest 3 or Pico 4 Ultra) with its built-in Browser app
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
5. Test from an XR headset (Quest 3 or Pico 4 Ultra) or a different computer

> **Quick Start Tip:** For the fastest way to get a server running, try [LÖVR](https://github.com/NVIDIA/cloudxr-lovr-sample) - a lightweight VR framework that's great for testing your CloudXR.js client setup.

<!-- #endregion firstRunGuide -->

Please refer to [the CloudXR.js SDK documentations](#sdk-documentation) for details.

## SDK Documentation

The `docs/` folder contains comprehensive documentation including:

- Getting Started guides with example server applications
- API reference for building custom clients
- Common issues and solutions

Open `docs/index.html` in your browser for organized navigation with table of contents.

## Support

For technical support and questions about this early access release:

- Review the troubleshooting sections in the SDK documentation
- Study the example implementations for integration patterns
- Contact the NVIDIA CloudXR team for additional assistance

## License

This project is licensed under the Apache License 2.0. See the [LICENSE](LICENSE) file for details.

> **Note**: This is an early access release of CloudXR.js. Features and APIs may change in future releases.
