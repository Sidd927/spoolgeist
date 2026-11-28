import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: { "@spoolgeist/core": fileURLToPath(new URL("../core/src/index.ts", import.meta.url)) },
  },
  test: {
    name: "app",
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
