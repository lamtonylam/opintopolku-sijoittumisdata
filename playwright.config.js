import { defineConfig } from "@playwright/test";

// Live-DOM suite: runs the real extension sources against real opintopolku.fi.
// Deliberately minimal traffic — serial, no retries. See scripts/e2e.mjs gate
// (E2E_LIVE=1, max once per 24h) and AGENTS.md. Never add this to `npm test`.
export default defineConfig({
  testDir: "./tests",
  timeout: 120_000,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: { headless: true },
});
