import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// Static SPA build for GitHub Pages: the deterministic engine runs in the
// visitor's browser, so no server is needed for the hosted demo.
export default defineConfig({
  base: "./",
  plugins: [react()],
  resolve: {
    alias: { "@spoolgeist/core": fileURLToPath(new URL("../core/src/index.ts", import.meta.url)) },
  },
  build: {
    outDir: "dist/client",
    emptyOutDir: true,
  },
});
