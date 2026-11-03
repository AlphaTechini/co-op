import { defineConfig } from "vitest/config";

// Each file boots one real near-sandbox (nearcore 2.14.0); run files one after another.
export default defineConfig({
  test: {
    include: ["test/integration/**/*.test.ts"],
    testTimeout: 180_000,
    hookTimeout: 180_000,
    fileParallelism: false,
    pool: "forks",
  },
});
