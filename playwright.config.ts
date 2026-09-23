import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  use: {
    // A second checkout can run its own dev server on another port and point
    // the suite at it, e.g. ATLAS_BASE_URL=http://localhost:5174. Specs that
    // hard-code ORIGIN :5173 (flightdeck-context-route, project-bridge) still
    // need the server on 5173.
    baseURL: process.env.ATLAS_BASE_URL ?? "http://localhost:5173",
    channel: "chrome",
    headless: true,
    viewport: { width: 1440, height: 1000 },
    screenshot: "only-on-failure",
  },
});
