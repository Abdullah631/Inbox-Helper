import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./", import.meta.url)) } },
  test: {
    include: ["tests/**/*.test.ts"],
    // Clears API keys and blocks real network calls in every test (see tests/setup.ts).
    setupFiles: ["tests/setup.ts"],
  },
});
