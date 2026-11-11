import { defineConfig } from "vitest/config";

/** Long-running, reproducible reports that regenerate the numbers in docs/ (not part of `npm test`). */
export default defineConfig({
  test: {
    include: ["reports/**/*.report.ts"],
    environment: "node",
    testTimeout: 1_800_000,
  },
});
