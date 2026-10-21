import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  // Next's tsconfig uses jsx: preserve, which esbuild would leave untransformed.
  esbuild: { jsx: "automatic" },
  test: {
    // Pure logic runs in node; component tests opt in with `// @vitest-environment jsdom`.
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["src/test/setup.ts"],
  },
});
