# Stained Glass Studio

[Open the studio](https://carla.codes/demos/glass/) · [Carla's workshop](https://carla.codes/#glass-visualizer)

A browser-based maker tool for exploring designs before cutting material. Import an image or SVG, recolor pieces, inspect a Three.js preview, and export labeled SVG/DXF patterns. Parametric lampshade and triangular 3D mesh workflows are also included.

## Try the shortest path

1. Select **Try the stained-glass sample**.
2. Choose a piece and change its color. **Undo color change** reverses edits.
3. Rotate or zoom the preview.
4. Export SVG for colored cut outlines, centerlines, and labels, or DXF for geometry layers.

Changing source settings rebuilds geometry and resets edits. Exports are design aids: inspect dimensions and fit with a material prototype before fabrication. Complex SVG features and non-triangular fabrication constraints are not fully represented.

## Run locally

Node.js 22 or newer.

```sh
npm ci
npm run dev
npm test
npm run build
```

The production build uses relative asset paths. `npm run build:offline` additionally packages standalone HTML; that optional path is separate from the verified hosted build.

## Processing and privacy

Files are processed in the browser. No AI service, analytics, or cloud upload is used by the app. Dependencies are bundled. A runtime guard blocks cross-origin requests; SVG import removes scripts, event attributes, external references, and embedded content before attaching allowlisted geometry to the DOM.

Inputs: PNG/JPG/WebP, closed SVG geometry, and OBJ/STL/GLB/GLTF meshes. Raster tracing groups colors and dark separators; a Voronoi fallback generates mosaics. SVG styling outside the geometry allowlist is omitted.

## Engineering choices

- Three.js for preview and camera controls.
- Clipper for inward polygon offsets and came/fit allowance.
- Typed geometry separating outlines, cut contours, seams, and metadata.
- SVG/DXF outputs without server processing.
- Four tests covering shared edges, winding/insets, degenerate input, XML escaping/colors, and DXF layers.

CI runs tests and TypeScript/Vite compilation. This repository was extracted from Carla's existing local studio and extended with a sample → recolor → export workflow. It is an ongoing maker-tool exploration, not a certified fabrication product.
