import { defineConfig } from "vite";

// base: "./" makes the production build work from a local folder or file:// URL.
// No CDN or remote assets are used by this project.
export default defineConfig({
  base: "./",
  build: {
    chunkSizeWarningLimit: 1200
  }
});
