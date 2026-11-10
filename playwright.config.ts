import "dotenv/config";
import { defineConfig, devices } from "@playwright/test";

/**
 * E2E тестове срещу работещ стек (`docker compose up -d`). Не стартира сървър сам —
 * тества истинския образ с entrypoint, миграции и bootstrap на администратора.
 * E2E_BASE_URL (по подразбиране http://localhost:3000).
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    locale: "bg-BG",
    timezoneId: "Europe/Sofia",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
