import { defineConfig } from "vitest/config";

// One real near-sandbox (nearcore 2.14.0) per file.
export default defineConfig({
  test: {
    include: ["test/integration/**/*.test.ts"],
    testTimeout: 180_000,
    hookTimeout: 180_000,
    fileParallelism: false,
    pool: "forks",
  },
});
