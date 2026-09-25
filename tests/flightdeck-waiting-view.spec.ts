import { test, expect, type Page } from "@playwright/test";
import { build } from "esbuild";
import { examples, type Project } from "../lib/projects";
import {
  projectStatus,
  type OnboardSendRow,
  type WaitingFacts,
} from "../lib/flightdeck/onboard-route";
import { en } from "../lib/i18n/en";

// The waiting view as an editor sees it (onb-atlas-status-timeline, plan
// 2026-09-25 J4): the real card and form are bundled and mounted in headless
// Chrome with a fake fetch, fed the editor's projection. No Atlas server is
// involved and nothing leaves the test.

const ROOT = process.cwd();
const ENTRY = `
import { createRoot } from "react-dom/client";
import Card from "./app/flightdeck-project-card";
const w = window as any;
createRoot(document.getElementById("root")!).render(
  <Card project={w.__project} superAdmin={false} requesterRequests={true}
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
  atlas_revision: 7,
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
const facts = (over: Partial<WaitingFacts> = {}): WaitingFacts => ({
  transitions: [
    { stage: "submitted", observedAt: "2026-09-25T10:00:00.000Z" },
  ],
  history: [
    {
      revision: 5,
      stage: "needs-more-info",
      transitions: [
        { stage: "submitted", observedAt: null },
        { stage: "needs-more-info", observedAt: "2026-09-24T09:00:00.000Z" },
      ],
    },
  ],
  responsePolicyDays: null,
  ...over,
});
const project: Project = {
  ...examples[0],
  id: "p1",
  source: "atlas",
  revision: 7,
  canEdit: true,
  archived: false,
  flightdeckDraft: { label: "Harbour pilot" },
} as Project;

async function mount(page: Page, status: unknown) {
  await page.clock.install({ time: new Date("2026-09-25T12:00:00Z") });
  await page.addInitScript(
    ({ project, status }) => {
      const w = window as unknown as Record<string, unknown>;
      w.__project = project;
      const calls: string[] = [];
      w.__calls = calls;
      window.fetch = async (input: RequestInfo | URL) => {
        const url = String(input);
        calls.push(url);
        const json = (body: unknown, code = 200) =>
          new Response(JSON.stringify(body), {
            status: code,
            headers: { "content-type": "application/json" },
          });
        if (url.startsWith("/api/flightdeck/onboard/")) return json(status);
        if (url.startsWith("/api/workspace"))
          return json({ apps: [], teams: [] });
        return json({ error: "not in this test" }, 404);
      };
    },
    { project, status },
  );
  await page.route("http://card.test/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html><body><div id="root"></div><script>${bundle.replace(/<\/script/g, "<\\/script")}</script></body></html>`,
    }),
  );
  await page.goto("http://card.test/project");
}

test("an editor's waiting card: next step, honest outage, 'Last update seen', no ETA, no live check", async ({
  page,
}) => {
  const status = projectStatus(
    { superAdmin: false },
    {
      operation: row({
        check_failures: 3,
        unreachable_since: "2026-09-25T10:10:00.000Z",
      }),
      waiting: facts(),
    },
  );
  await mount(page, status);
  const card = page.locator("#flightdeck");
  await expect(card.getByText(/Could not reach FlightDeck since/)).toBeVisible();
  // The stage stays: still waiting for FlightDeck's review.
  await expect(card.getByText(en["onb.card.waitingFlightDeck"])).toBeVisible();
  await expect(card.getByText(en["onb.next.submitted"])).toBeVisible();
  await expect(card.getByText(/Last update seen/)).toBeVisible();
  await expect(card.getByText(/Last checked with FlightDeck/)).toHaveCount(0);
  await expect(card.getByText(/Usually answered/)).toHaveCount(0);
  // The editor's reads never ask the server to check FlightDeck.
  const calls = await page.evaluate(
    () => (window as unknown as { __calls: string[] }).__calls,
  );
  expect(calls.filter((u) => u.includes("refresh=1"))).toEqual([]);

  // View status: the observed log and the linked correction history.
  await card.getByRole("button", { name: en["onb.card.view"] }).click();
  const log = card.getByRole("list", { name: en["onb.observed.aria"] });
  await expect(log.getByRole("listitem")).toHaveCount(1);
  await expect(log).toContainText("Submitted: seen");
  const history = card.getByRole("region", { name: en["onb.history.title"] });
  await expect(history).toContainText(
    /Revision 5: Needs more info \(seen .+\)\. Sent again as revision 7\./,
  );
});

test("with the owner's response policy set, the card shows it while FlightDeck reviews", async ({
  page,
}) => {
  const status = projectStatus(
    { superAdmin: false },
    {
      operation: row({}),
      waiting: facts({
        history: [],
        transitions: [{ stage: "submitted", observedAt: null }],
        responsePolicyDays: 5,
      }),
    },
  );
  await mount(page, status);
  const card = page.locator("#flightdeck");
  await expect(
    card.getByText("Usually answered within 5 working days."),
  ).toBeVisible();
  await expect(card.getByText(/Could not reach FlightDeck/)).toHaveCount(0);
  await card.getByRole("button", { name: en["onb.card.view"] }).click();
  await expect(
    card.getByRole("list", { name: en["onb.observed.aria"] }),
  ).toContainText("Submitted: before tracking");
});
