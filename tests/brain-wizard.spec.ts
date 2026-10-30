import { test, expect } from "@playwright/test";

// The web wizard, the same four steps the macOS app opens on. These tests drive
// it in a browser against mocked API responses: the order of the questions, the
// keyboard, and the two calls it makes (project, then intake).
const list = { projects: [] };
const view = {
  record: {
    projectId: "p-9",
    name: "Purchase order exception handling",
    stage: "intake",
    revision: 1,
    entryType: "process",
  },
  status: "active",
  workspace: { id: "general", name: "General" },
  assignments: {
    owner: "seedy@sites.test",
    processOwner: null,
    teoaApprover: null,
    visionApprover: null,
  },
  access: { canEdit: true, canAssignRoles: true, canView: true },
  data: {},
  stage: { current: "intake", next: "reuse", missing: ["classification"], missingForNext: [] },
  chain: { ok: true, length: 1 },
  evidence: [],
  values: [],
  reuse: null,
  gates: [],
  canGate: { intake: true },
};
test.beforeEach(async ({ page }) => {
  await page.route("**/api/onboarding", (route) => route.fulfill({ json: list }));
  await page.route("**/api/onboarding/*", (route) => route.fulfill({ json: view }));
  await page.route("**/api/workspaces", (route) =>
    route.fulfill({
      json: { workspaces: [{ id: "general", name: "General", slug: "general", role: "admin" }] },
    }),
  );
  await page.route("**/api/projects", (route) =>
    route.fulfill({ status: 201, json: { project: { id: "p-9", name: "p" } } }),
  );
});
test("the front door opens a four-step wizard with two illustrated choices", async ({ page }) => {
  await page.goto("/?view=brain");
  await page.getByRole("button", { name: "Start the wizard" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Onboard something new" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: /A project/ })).toBeVisible();
  await expect(dialog.getByRole("button", { name: /A process/ })).toBeVisible();
  // The steps are visible, and the first is the current one.
  await expect(dialog.getByRole("listitem").first()).toHaveAttribute("aria-current", "step");
});
test("the whole flow creates the project and opens its intake", async ({ page }) => {
  const calls: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/onboarding") || request.url().includes("/api/projects")) {
      calls.push(`${request.method()} ${new URL(request.url()).pathname}`);
    }
  });
  await page.goto("/?view=brain");
  await page.getByRole("button", { name: "Start the wizard" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: /A process/ }).click();
  await dialog.getByRole("button", { name: "Continue" }).click();
  // Where: the workspace and the owner.
  await expect(dialog.getByRole("radio", { name: /General/ })).toBeChecked();
  await dialog.getByLabel("Owner").fill("seedy@sites.test");
  await dialog.getByRole("button", { name: "Continue" }).click();
  // Details: the name is required before continuing.
  const next = dialog.getByRole("button", { name: "Continue" });
  await expect(next).toBeDisabled();
  await dialog.getByRole("textbox", { name: "Name" }).fill("Purchase order exception handling");
  await dialog.getByRole("textbox", { name: "Problem" }).fill("Exceptions arrive by email and are retyped.");
  await expect(next).toBeEnabled();
  await next.click();
  // Review names every choice before anything is created.
  await expect(dialog.getByText("A process")).toBeVisible();
  await expect(dialog.getByText("General")).toBeVisible();
  await expect(dialog.getByText("Purchase order exception handling")).toBeVisible();
  await dialog.getByRole("button", { name: "Create the process" }).click();
  await expect(page.locator(".brain-notice")).toContainText(
    "Project created and its intake is open.",
  );
  // Two WRITES, in order: the project, then its intake. The reads around them
  // are the lane's own list and candidate loads.
  expect(calls.filter((call) => call.startsWith("POST"))).toEqual([
    "POST /api/projects",
    "POST /api/onboarding/p-9",
  ]);
  // The new project's brain is what opens.
  expect(calls.at(-1)).toBe("GET /api/onboarding/p-9");
});
test("Escape closes the wizard without creating anything", async ({ page }) => {
  await page.goto("/?view=brain");
  await page.getByRole("button", { name: "Start the wizard" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
