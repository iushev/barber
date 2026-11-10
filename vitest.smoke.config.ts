import { defineConfig } from "vitest/config";

/** Smoke тестове срещу работещ compose стек (виж tests/smoke/*). */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/smoke/**/*.test.ts"],
    setupFiles: ["dotenv/config"],
    testTimeout: 180_000,
  },
});
