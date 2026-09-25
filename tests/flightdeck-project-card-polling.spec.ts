import { test, expect, type Page } from "@playwright/test";
import { build } from "esbuild";
import { examples, type Project } from "../lib/projects";
import {
  projectStatus,
  type OnboardSendRow,
} from "../lib/flightdeck/onboard-route";

// The FlightDeck card's reads of the onboarding status (review round 2 of
// onb-atlas-project-entry-card). The real component is bundled and mounted
// in headless Chrome with a fake fetch and a fake clock, so every request
// the card and its form make is counted. No Atlas server is involved.

const ROOT = process.cwd();
const ENTRY = `
import { createRoot } from "react-dom/client";
import Card from "./app/flightdeck-project-card";
const w = window as any;
createRoot(document.getElementById("root")!).render(
  <Card project={w.__project} superAdmin={true} requesterRequests={false}
    demo={false} busy={false} onSave={async () => null} />,
);
`;
let bundle = "";
test.beforeAll(async () => {
  const out = await build({
    stdin: {
      contents: ENTRY,
      resolveDir: ROOT,
      loader: "tsx",
      sourcefile: "entry.tsx",
    },
    bundle: true,
    write: false,
    format: "iife",
    jsx: "automatic",
    alias: { "@": ROOT },
    define: { "process.env.NODE_ENV": '"development"' },
    loader: { ".css": "empty" },
    logLevel: "silent",
  });
  bundle = out.outputFiles[0].text;
});

const row = (over: Partial<OnboardSendRow>): OnboardSendRow => ({
  id: "op-1",
  atlas_project_id: "p1",
  atlas_revision: 3,
  idempotency_key: "k",
  destination_workspace_id: "ws-ops",
  proposed_label: "Harbour pilot",
  proposed_project_id: null,
  state: "filed",
  submission_id: "a".repeat(24),
  received_at: "2026-09-25T10:00:00.000Z",
  payload_sha256: null,
  reason_code: null,
  setup_state: null,
  created_by: "u",
  updated_at: "2026-09-25T10:00:00.000Z",
  checked_at: "2026-09-25T10:05:00.000Z",
  request_body: null,
  adopted: 0,
  ...over,
});
const ADMIN = { superAdmin: true };
const unsent = projectStatus(ADMIN, { operation: null })!;
const filed = projectStatus(ADMIN, { operation: row({}) })!;
const project: Project = {
  ...examples[0],
  id: "p1",
  source: "atlas",
  revision: 3,
  canEdit: true,
  archived: false,
  flightdeckDraft: { label: "Harbour pilot" },
} as Project;

/** Mounts the card; `answer(n)` is the n-th (0-based) status response. */
async function mount(page: Page, answers: unknown[]) {
  await page.clock.install({ time: new Date("2026-09-25T12:00:00Z") });
  await page.addInitScript(
    ({ project, answers }) => {
      const w = window as unknown as Record<string, unknown>;
      w.__project = project;
      const calls: string[] = [];
      w.__calls = calls;
      window.fetch = async (input: RequestInfo | URL) => {
        const url = String(input);
        const json = (body: unknown, status = 200) =>
          new Response(JSON.stringify(body), {
            status,
            headers: { "content-type": "application/json" },
          });
        if (url.startsWith("/api/flightdeck/onboard/")) {
          const n = calls.length;
          calls.push(url);
          const a = answers[Math.min(n, answers.length - 1)];
          return a === null ? json({ error: "x" }, 503) : json(a);
        }
        if (url.startsWith("/api/workspace"))
          return json({ apps: [], teams: [] });
        return json({ error: "not in this test" }, 404);
      };
    },
    { project, answers },
  );
  // A made-up origin served from memory, so init scripts run and nothing
  // leaves the test.
  await page.route("http://card.test/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html><body><div id="root"></div><script>${bundle.replace(/<\/script/g, "<\\/script")}</script></body></html>`,
    }),
  );
  await page.goto("http://card.test/project");
}
const calls = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { __calls: string[] }).__calls.length,
  );

test("opening the form does not start a request loop", async ({ page }) => {
  await mount(page, [unsent]);
  await expect.poll(() => calls(page)).toBe(1);
  await page.getByRole("button", { name: /continue/i }).click();
  // The form reads the status once; the card may re-read once. Then quiet.
  await page.clock.runFor(2_000);
  const settled = await calls(page);
  expect(settled).toBeLessThanOrEqual(3);
  await page.clock.runFor(5_000);
  expect(await calls(page)).toBe(settled);
});

test("a status that becomes pollable after a local read is polled", async ({
  page,
}) => {
  // Loaded unsent (not pollable, no timer); the form sends and reads a
  // filed status; closing the form re-reads it: the card must follow it.
  await mount(page, [unsent, filed]);
  await expect.poll(() => calls(page)).toBe(1);
  await page.getByRole("button", { name: /continue/i }).click();
  await page.clock.runFor(1_000);
  await page
    .getByRole("button", { name: /close|cancel/i })
    .first()
    .click();
  await page.clock.runFor(1_000);
  const before = await calls(page);
  await expect(page.getByText(/waiting|review/i).first()).toBeVisible();
  await page.clock.runFor(61_000);
  expect(await calls(page)).toBeGreaterThan(before);
});

test("the card honours Retry-After", async ({ page }) => {
  await mount(page, [{ ...filed, retryAfter: 300 }]);
  await expect.poll(() => calls(page)).toBe(1);
  await page.clock.runFor(120_000);
  expect(await calls(page)).toBe(1);
  await page.clock.runFor(181_000);
  expect(await calls(page)).toBe(2);
});

test("failed reads back off instead of retrying every minute", async ({
  page,
}) => {
  await mount(page, [null]);
  await expect.poll(() => calls(page)).toBe(1);
  // 1 min, then 2 min, then 4 min: 3 reads by 3 minutes, not 4.
  for (let i = 0; i < 6; i++) await page.clock.runFor(30_000);
  const at3 = await calls(page);
  await page.clock.runFor(61_000);
  expect(at3).toBeLessThanOrEqual(3);
  expect(await calls(page)).toBeLessThanOrEqual(3);
});
