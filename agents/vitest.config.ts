import { defineConfig } from "vitest/config";

// Fast unit tests only (no sandbox). Integration tests: vitest.integration.config.ts
export default defineConfig({
  test: { include: ["test/unit/**/*.test.ts"], testTimeout: 15_000 },
});
