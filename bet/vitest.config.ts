import path from "node:path";
import { defineConfig } from "vitest/config";

// Vitest config kept minimal — pure-function unit tests only (no DB, no
// Next runtime). The `@/*` alias is wired manually because the obvious
// `vite-tsconfig-paths` plugin is ESM-only and our vitest config loads
// through CJS by default. One-line resolve.alias is simpler.
export default defineConfig({
  // CSS pipeline is disabled because our tests are pure-function — nobody
  // imports a .css file — and Vite would otherwise try to load the Tailwind
  // 4 PostCSS plugin and complain.
  css: { postcss: { plugins: [] } },
  resolve: {
    alias: {
      "@": path.resolve(__dirname),
    },
  },
  test: {
    include: ["__tests__/**/*.test.ts"],
    environment: "node",
    testTimeout: 5_000,
  },
});
