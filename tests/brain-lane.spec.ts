import { test, expect } from "@playwright/test";

// The brain lane's surface, in a browser against mocked API responses.
//
// These tests assert *display*, never a rule: whether a gate may pass, which
// prerequisite is missing and whether a classification is blocked are decided
// by the server (lib/onboarding/routes.ts) and only shown here. So a disabled
// gate and a printed refusal are both the server's own words.
const list = {
  projects: [
    {
      projectId: "p-1",
      name: "Contract intake",
      stage: "capture",
      status: "active",
      revision: 4,
      updatedAt: "2026-10-28T10:00:00.000Z",
    },
    {
      projectId: "p-2",
      name: "Payroll onboarding",
      stage: "aligned",
      status: "active",
      revision: 9,
      updatedAt: "2026-10-27T10:00:00.000Z",
    },
  ],
};
const view = {
  record: {
    projectId: "p-1",
    name: "Contract intake",
    stage: "capture",
    revision: 4,
    entryType: "project",
  },
  status: "active",
  workspace: { id: "general", name: "General" },
  assignments: {
    owner: "owner@example.test",
    processOwner: null,
    teoaApprover: null,
    visionApprover: null,
  },
  access: { canEdit: true, canAssignRoles: true, canView: true },
  data: { problem: "Two systems", requester: "Anna", site: "Bensheim" },
  facts: {},
  stage: {
    current: "capture",
    next: "as-is",
    missing: ["scan"],
    missingForNext: ["as-is-map", "as-is-signoff"],
  },
  chain: { ok: true, length: 4 },
  evidence: [
    {
      id: "e-1",
      kind: "recording",
      source: "capture.mp4",
      classification: "internal",
      scanState: "review",
      status: "pending",
      bytes: 1024,
    },
  ],
  values: [],
  reuse: null,
  gates: [
    { stage: "intake", decision: "pass", at: "2026-10-01T08:00:00.000Z" },
    { stage: "reuse", decision: "pass", at: "2026-10-06T09:00:00.000Z" },
  ],
  canGate: { capture: false },
};
test.describe("the board", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/api/onboarding", (route) => route.fulfill({ json: list }));
    await page.route("**/api/workspaces", (route) =>
      route.fulfill({
        json: { workspaces: [{ id: "general", name: "General", slug: "general", role: "admin" }] },
      }),
    );
    await page.route("**/api/onboarding/*", (route) => route.fulfill({ json: view }));
  });
  test("a card sits in its stage column and opens the project's brain", async ({
    page,
  }) => {
    await page.goto("/?view=brain");
    await expect(
      page.getByRole("heading", { name: "Onboarding brain" }).first(),
    ).toBeVisible();
    const capture = page.getByRole("region", { name: "Capture", exact: true });
    await expect(
      capture.getByRole("button", { name: /Contract intake/ }),
    ).toBeVisible();
    await expect(
      page
        .getByRole("region", { name: "Aligned", exact: true })
        .getByRole("button", { name: /Payroll onboarding/ }),
    ).toBeVisible();
    await capture.getByRole("button", { name: /Contract intake/ }).click();
    const detail = page.getByRole("complementary", { name: "Project brain" });
    await expect(
      detail.getByRole("heading", { name: "Contract intake" }),
    ).toBeVisible();
    await expect(detail.getByRole("status").first()).toContainText(
      "Audit chain verified (4 events)",
    );
    // The server said the scan is still missing, so the lane lists it and
    // disables the gate it could not pass.
    await expect(detail.getByText("Clear the governance scan")).toBeVisible();
    // The assignment step is visible: who owns it, and a control to assign more.
    await expect(detail.getByText("owner@example.test")).toBeVisible();
    await expect(detail.getByRole("button", { name: "Assign" })).toBeVisible();
    await expect(
      detail.getByRole("button", { name: "Pass this stage" }),
    ).toBeDisabled();
    await expect(
      detail.getByText("Your role cannot pass this stage."),
    ).toBeVisible();
    await expect(detail.getByRole("listitem").filter({ hasText: "capture.mp4" })).toBeVisible();
  });
  test("an intake can be started from the lane", async ({ page }) => {
    await page.route("**/api/projects", (route) =>
      route.fulfill({
        json: {
          projects: [
            {
              id: "p-3",
              name: "New intake",
              canEdit: true,
              status: "In progress",
              tasks: [],
              updatedAt: "2026-10-28T09:00:00.000Z",
              source: "atlas",
              revision: 1,
            },
            {
              id: "p-4",
              name: "Someone else's",
              canEdit: false,
              status: "In progress",
              tasks: [],
              updatedAt: "2026-10-27T09:00:00.000Z",
              source: "atlas",
              revision: 1,
            },
          ],
        },
      }),
    );
    await page.goto("/?view=brain");
    const start = page.getByRole("region", { name: "Start an intake" });
    // Only the project this person may edit is offered.
    await expect(start.getByRole("option", { name: "New intake" })).toBeAttached();
    await expect(start.getByRole("option", { name: "Someone else's" })).toHaveCount(0);
    await start.getByLabel("Project").selectOption("p-3");
    await start.getByRole("button", { name: "Start the intake" }).click();
    await expect(page.locator(".brain-notice")).toContainText("Intake opened.");
  });
  test("a refusal from the server is printed as it came back", async ({ page }) => {
    const allowed = { ...view, canGate: { capture: true } };
    await page.route("**/api/onboarding/*", (route) => route.fulfill({ json: allowed }));
    // Registered last, so it wins for the gate path only.
    await page.route("**/api/onboarding/*/gate", (route) =>
      route.fulfill({
        status: 409,
        json: {
          error: "This stage still has unmet requirements.",
          code: "prerequisite_missing",
          missing: ["scan"],
        },
      }),
    );
    await page.goto("/?view=brain");
    await page
      .getByRole("region", { name: "Capture", exact: true })
      .getByRole("button", { name: /Contract intake/ })
      .click();
    const detail = page.getByRole("complementary", { name: "Project brain" });
    await detail.getByRole("button", { name: "Pass this stage" }).click();
    await expect(page.locator(".brain-notice")).toContainText(
      "This stage still has unmet requirements. (scan)",
    );
  });
});
test.describe("assigning a role", () => {
  test("a workspace admin assigns the process owner and sees it", async ({ page }) => {
    await page.route("**/api/onboarding", (route) => route.fulfill({ json: list }));
    await page.route("**/api/workspaces", (route) =>
      route.fulfill({
        json: { workspaces: [{ id: "general", name: "General", slug: "general", role: "admin" }] },
      }),
    );
    const assignedView = {
      ...view,
      assignments: { ...view.assignments, processOwner: "process@example.test" },
    };
    await page.route("**/api/onboarding/*/roles", (route) =>
      route.fulfill({ json: assignedView }),
    );
    await page.route("**/api/onboarding/*", (route) => route.fulfill({ json: view }));
    await page.goto("/?view=brain");
    await page
      .getByRole("region", { name: "Capture", exact: true })
      .getByRole("button", { name: /Contract intake/ })
      .click();
    const detail = page.getByRole("complementary", { name: "Project brain" });
    const roles = detail.getByRole("region", { name: "Roles" });
    await roles.getByLabel("Assign").fill("process@example.test");
    await roles.getByRole("button", { name: "Assign" }).click();
    await expect(page.locator(".brain-notice")).toContainText("Role assigned.");
    await expect(detail.getByText("process@example.test")).toBeVisible();
  });
});
test.describe("onboarding a new project or process", () => {
  test("creates the project, opens its intake and shows it", async ({ page }) => {
    await page.route("**/api/onboarding", (route) => route.fulfill({ json: list }));
    await page.route("**/api/workspaces", (route) =>
      route.fulfill({
        json: { workspaces: [{ id: "general", name: "General", slug: "general", role: "admin" }] },
      }),
    );
    await page.route("**/api/onboarding/*", (route) =>
      route.fulfill({ json: { ...view, record: { ...view.record, entryType: "process" } } }),
    );
    await page.route("**/api/projects", async (route) => {
      if (route.request().method() === "POST") {
        return route.fulfill({
          status: 201,
          json: { project: { id: "p-9", name: "Invoice matching" } },
        });
      }
      return route.fulfill({ json: { projects: [] } });
    });
    await page.goto("/?view=brain");
    const form = page.getByRole("region", { name: "Onboard a new project or process" });
    await form.getByLabel("Name").fill("Invoice matching");
    await form.getByLabel("What are you onboarding?").selectOption("process");
    await form.getByRole("button", { name: "Onboard it" }).click();
    await expect(page.locator(".brain-notice")).toContainText(
      "Project created and its intake is open.",
    );
    // The detail opens on the new project and says it is a process.
    const detail = page.getByRole("complementary", { name: "Project brain" });
    await expect(detail).toContainText("Process");
  });
});
test.describe("German", () => {
  test.use({ locale: "de-DE" });
  test("the lane, its columns and its errors are German", async ({ page }) => {
    await page.route("**/api/onboarding", (route) =>
      route.fulfill({ status: 503, body: "down" }),
    );
    await page.goto("/?view=brain");
    await expect(
      page.getByRole("heading", { name: "Onboarding-Gehirn" }).first(),
    ).toBeVisible();
    // The failure text is the German one, and the lane offers a retry.
    await expect(page.getByRole("alert")).toContainText(
      "Das Onboarding-Gehirn konnte nicht geladen werden.",
    );
    await expect(
      page.getByRole("button", { name: "Erneut versuchen" }),
    ).toBeVisible();
  });
});
