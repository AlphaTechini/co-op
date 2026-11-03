import { defineConfig } from "vitest/config";

// Fast route-level tests (no chain). The sandbox test: vitest.integration.config.ts
export default defineConfig({
  test: { include: ["test/unit/**/*.test.ts"], testTimeout: 15_000 },
});
