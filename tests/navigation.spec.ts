import { test, expect, type Page } from "@playwright/test";
import { examples } from "../lib/projects";
import { createDeck } from "../lib/presentations";
const fixtures: string[] = [];
const deckFixtures: string[] = [];
test.afterEach(async ({ page }) => {
  for (const id of deckFixtures.splice(0)) {
    const r = await page.request.get(`/api/decks?id=${id}`);
    if (r.ok()) {
      const d = (await r.json()).deck;
      await page.request.delete(`/api/decks?id=${id}&revision=${d.revision}`);
    }
  }
  for (const id of fixtures.splice(0)) {
    const r = await page.request.get(`/api/projects/${id}`);
    if (r.ok()) {
      const p = (await r.json()).project;
      await page.request.delete(`/api/projects/${id}?revision=${p.revision}`);
    }
  }
});
test("shared links, resources and presentations keep explicit project boundaries", async ({
  page,
}) => {
  const first = await create(page),
    second = await create(page);
  const response = await page.request.put(`/api/projects/${second.id}`, {
    data: {
      ...second,
      tasks: [
        { id: "other", title: "Only in the second project", done: false },
      ],
    },
  });
  expect(response.ok()).toBe(true);
  for (const [project, title] of [
    [first, "First project review"],
    [second, "Second project review"],
  ] as const) {
    const r = await page.request.post("/api/decks", {
      data: {
        data: {
          ...createDeck([project], "Leadership update", "Sponsor", "This week"),
          title,
        },
      },
    });
    expect(r.status()).toBe(200);
    deckFixtures.push((await r.json()).deck.id);
  }
  await page.goto(`/?project=${first.id}&work=resources&form=kept-link`);
  await expect(
    page.getByRole("heading", { name: "Resource planner", exact: true }),
  ).toBeVisible();
  expect(new URL(page.url()).searchParams.get("workspace")).toBe(first.id);
  expect(new URL(page.url()).searchParams.get("project")).toBeNull();
  expect(new URL(page.url()).searchParams.get("form")).toBe("kept-link");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".resource-task-chips")).toContainText(
    "Confirm launch scope",
  );
  await expect(page.locator(".resource-task-chips")).not.toContainText(
    "Only in the second project",
  );
  const filtered = await (
    await page.request.get(`/api/decks?project=${first.id}`)
  ).json();
  expect(filtered.decks.map((d: { title: string }) => d.title)).toEqual([
    "First project review",
  ]);
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Project presentations", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "First project review", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Second project review", exact: true }),
  ).toHaveCount(0);
  await page.getByLabel("Working project").selectOption(second.id);
  await expect(
    page.getByRole("heading", { name: "Second project review", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "First project review", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Back to all projects", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Everything in motion." }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("navigation")
      .getByRole("button", { name: "Think like a CEO", exact: true }),
  ).toHaveCount(0);
  await page.goto("/?view=manage&tool=CEO&workspace=unavailable-project");
  await expect(
    page.getByRole("heading", { name: "Choose a project", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".leadership-review")).toHaveCount(0);
  await expect(page.locator(".nav-project-identity")).toHaveCount(0);
});
async function create(page: Page) {
  await page.goto("/");
  const response = await page.request.post("/api/projects", {
    data: {
      ...examples[0],
      name: "Navigation QA " + Date.now(),
      status: "Planning",
      category: "Launch",
      tasks: [
        {
          id: "scope",
          title: "Confirm launch scope",
          done: false,
          priority: "High",
        },
        { id: "build", title: "Build pilot", done: false, workflow: "doing" },
      ],
      color: "orange",
    },
  });
  expect(response.status(), await response.text()).toBe(201);
  const p = (await response.json()).project;
  fixtures.push(p.id);
  return p;
}
test("sidebar exposes full-page work views and role reviews with persistent project context", async ({
  page,
}) => {
  const p = await create(page);
  await page.reload();
  const nav = page.getByRole("navigation", { name: "Main navigation" });
  await expect(
    nav.getByRole("button", { name: "Task table", exact: true }),
  ).toHaveCount(0);
  await page.locator(".project-card").filter({ hasText: p.name }).click();
  await expect(
    page.getByRole("heading", { name: "Project overview", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".nav-project-identity")).toContainText(p.name);
  await nav.getByRole("button", { name: "Task table", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Task table", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByLabel("Working project")).toHaveValue(p.id);
  await expect(
    page.getByRole("button", { name: "Task table", exact: true }).last(),
  ).toHaveAttribute("aria-pressed", "true");
  await page
    .getByPlaceholder("Find a task or owner")
    .fill("Confirm launch scope");
  await nav
    .getByRole("button", { name: "Tasks & subtasks", exact: true })
    .click();
  await expect(page.getByPlaceholder("Find a task or owner")).toHaveValue(
    "Confirm launch scope",
  );
  await page.goBack();
  await expect(
    page.getByRole("heading", { name: "Task table", exact: true }),
  ).toBeVisible();
  await expect(page.getByPlaceholder("Find a task or owner")).toHaveValue(
    "Confirm launch scope",
  );
  await nav
    .getByRole("button", { name: "Think like a VP", exact: true })
    .click();
  await expect(
    page
      .locator(".leadership-roles")
      .getByRole("button", { name: "Think like a VP", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Think like a VP", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Working project")).toHaveValue(p.id);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await nav
    .getByRole("button", { name: "Think like a Director", exact: true })
    .click();
  await expect(
    page
      .locator(".leadership-roles")
      .getByRole("button", { name: "Think like a Director", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await nav.getByRole("button", { name: "Work tools", exact: true }).click();
  await nav.getByRole("button", { name: "Automations", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Automations", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".standalone-studio")).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Automations", exact: true }),
  ).toBeVisible();
});
test("Kanban moves projects and tasks durably with drag and keyboard alternatives", async ({
  page,
}) => {
  const p = await create(page);
  await page.reload();
  await page.getByRole("button", { name: "Board", exact: true }).click();
  // The board renders before React has attached its drag handlers, so under
  // load a drag made straight after the reload can be lost and the card stays
  // in Planning. Repeat the drag until it lands (a second drop onto the same
  // column changes nothing), and let the save finish before reloading.
  const saved = page.waitForResponse(
    (r) =>
      r.request().method() === "PUT" &&
      new URL(r.url()).pathname === `/api/projects/${p.id}` &&
      r.ok(),
  );
  await expect(async () => {
    await page
      .locator(".board-card")
      .filter({ hasText: p.name })
      .dragTo(
        page.getByRole("region", { name: "In progress projects", exact: true }),
      );
    await expect(page.getByLabel("Status for " + p.name)).toHaveValue(
      "In progress",
      { timeout: 2_000 },
    );
  }).toPass({ timeout: 20_000 });
  await saved;
  await page.reload();
  await expect(page.getByLabel("Status for " + p.name)).toHaveValue(
    "In progress",
  );
  await page
    .locator(".board-card")
    .filter({ hasText: p.name })
    .getByRole("button")
    .click();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Kanban board", exact: true })
    .click();
  const board = page.locator(".task-kanban");
  await board
    .locator(".workbench-task")
    .filter({ hasText: "Confirm launch scope" })
    .dragTo(page.getByRole("region", { name: "Doing tasks", exact: true }));
  await expect(
    page.getByLabel("Workflow for Confirm launch scope"),
  ).toHaveValue("doing");
  await page
    .getByLabel("Workflow for Confirm launch scope")
    .selectOption("done");
  await expect(
    page.getByLabel("Workflow for Confirm launch scope"),
  ).toHaveValue("done");
  const nav = page.getByRole("navigation", { name: "Main navigation" });
  await nav
    .getByRole("button", { name: "Tasks & subtasks", exact: true })
    .click();
  await nav.getByRole("button", { name: "Kanban board", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Kanban board", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".project-board")).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByLabel("Workflow for Confirm launch scope"),
  ).toHaveValue("done");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(
    (await (await page.request.get(`/api/projects/${p.id}`)).json()).project
      .tasks[0].done,
  ).toBe(true);
  await page.screenshot({
    path: "/private/tmp/atlas-navigation-kanban.png",
    fullPage: true,
    animations: "disabled",
  });
});
test("help search and keyboard or tap explanations lead to real destinations on mobile", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?view=help");
  await expect(
    page.getByRole("heading", { name: "Find your next move." }),
  ).toBeVisible();
  await page.getByLabel("Search help").fill("CEO");
  await page
    .getByRole("button", { name: "Open Think like a CEO", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Choose a project", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".leadership-review")).toHaveCount(0);
  await page.locator(".project-picker-card").first().click();
  await expect(
    page.getByRole("heading", { name: "Think like a CEO", exact: true }),
  ).toBeVisible();
  const help = page.getByRole("button", {
    name: "Help: Think like a CEO",
    exact: true,
  });
  await help.focus();
  await expect(page.getByRole("tooltip")).toContainText(
    "live FlightDeck AI is pending",
  );
  await page.keyboard.press("Escape");
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await help.click();
  await expect(page.getByRole("tooltip")).toBeVisible();
  await page.keyboard.press("Escape");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Open navigation" }).click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("button", { name: "Kanban board", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "/private/tmp/atlas-navigation-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
  await dialog
    .getByRole("button", { name: "Kanban board", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Kanban board", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("the Atlas brand, the globe brand and the build-progress back link return to the portfolio", async ({
  page,
}) => {
  const dashboard = page.getByRole("tabpanel", { name: "Dashboard" });
  await page.goto("/?view=help");
  await expect(
    page.getByRole("heading", { name: "Find your next move." }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Atlas home", exact: true }).click();
  await expect(dashboard).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Find your next move." }),
  ).toHaveCount(0);
  await page.goto("/?view=globe");
  await expect(dashboard).toHaveCount(0);
  await page
    .getByRole("link", { name: "Atlas dashboard", exact: true })
    .click();
  await expect(dashboard).toBeVisible();
  await expect(page).toHaveURL(/[?&]view=dashboard/);
  await page.goto("/progress");
  await expect(
    page.getByRole("heading", { name: "Atlas build progress" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "← Back to Atlas" }).click();
  await expect(dashboard).toBeVisible();
});
