import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  use: {
    // A second checkout can run its own dev server on another port and point
    // the suite at it, e.g. ATLAS_BASE_URL=http://localhost:5174. A spec that
    // opens its own browser context passes this baseURL on; the ORIGIN
    // constants in flightdeck-context-route and project-bridge only build
    // in-process Requests and never reach a server.
    baseURL: process.env.ATLAS_BASE_URL ?? "http://localhost:5173",
    channel: "chrome",
    headless: true,
    viewport: { width: 1440, height: 1000 },
    screenshot: "only-on-failure",
  },
});
