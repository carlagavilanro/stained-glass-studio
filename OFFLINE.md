# Offline operation guide

This project is designed to run locally without AI services, cloud processing, analytics, CDN files, or internet access.

## Fastest offline launch

After extracting the ZIP, open this file in a browser:

```text
dist/stained-glass-studio-offline.html
```

That HTML file has the app JavaScript and CSS inlined. It does not load scripts, fonts, images, models, or stylesheets from the web.

## Local-server launch

Some browsers are stricter with local `file://` pages. If double-clicking the HTML file causes browser restrictions, run the included dependency-free local server:

```bash
node run-offline.mjs
```

Then open:

```text
http://127.0.0.1:5173
```

This still does not use the internet. It only serves the already-built files from the `dist/` folder on your own computer.

## Development build

To rebuild from TypeScript source, install dependencies once while online or from your own offline npm mirror/cache:

```bash
npm ci
npm run build:offline
```

The finished ZIP already includes `dist/`, so `npm ci` is not required to use the app offline.

## What stays local

- PNG/JPG/WebP artwork files are read through the browser File API.
- SVG artwork files are parsed in the browser.
- OBJ/STL/GLB/GLTF mesh files are parsed in the browser.
- GLTF files with external `.bin` or texture files can be imported offline by selecting all referenced local files together.
- SVG and DXF exports are generated in the browser and downloaded locally.

## Runtime guard

The app installs a network guard that blocks non-local network requests from `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, and `sendBeacon`.

Allowed URLs are local or embedded resources only:

```text
same-origin local files
localhost / 127.0.0.1
file:
blob:
data:
```

## Verification

The source package includes an offline verification script:

```bash
npm run verify:offline
```

It scans the built app and source for remote runtime URLs and common cloud AI provider endpoints.
