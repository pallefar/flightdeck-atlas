import { test, expect, type Page } from "@playwright/test";
import { examples, type Project } from "../lib/projects";
import { permissions } from "../lib/access-policy";

const fixture: Project = {
  ...examples[0], id: "compact-qa", name: "Compact workspace QA", sponsor: "Quality team",
  description: "Browser fixture for the approved layout.", canEdit: true, canShare: false,
  priority: "High", nextAction: "Review source procedure", revision: 3,
  tasks: [{ id: "review", title: "Review source SOP", done: false, assignee: "Quality team", description: "Keep the source numbering", startDate: "2026-10-05", dueDate: "2026-10-08" }],
  activity: [{ id: "recorded", at: "2026-10-05", kind: "note", text: "Actual fixture activity" }],
};
async function mockProjects(page: Page, readOnly = false) {
  let current = { ...fixture, canEdit: !readOnly };
  const writes: unknown[] = [];
  await page.route("**/api/projects", route => route.fulfill({ json: { projects: [current], access: { userId: "local_seedy", email: "seedy@sites.test", name: "QA", roleId: "owner", roleName: "Owner", superAdmin: false, permissions } } }));
  await page.route(`**/api/projects/${fixture.id}`, route => {
    if (route.request().method() === "PUT") {
      const body = route.request().postDataJSON();
      writes.push(body);
      current = { ...current, ...body, revision: current.revision + 1 };
    }
    return route.fulfill({ json: { project: current } });
  });
  await page.route(`**/api/projects/${fixture.id}/collaboration`, route => route.fulfill({ json: { people: [], email: "seedy@sites.test" } }));
  return writes;
}

test("portfolio inspection is keyboard accessible, reads actual project fields, and opens the same project", async ({ page }) => {
  await mockProjects(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Projects", exact: true })).toBeVisible();
  await expect(page.locator(".portfolio-table")).toContainText("Quality team");
  const trigger = page.getByRole("button", { name: "Project details: Compact workspace QA", exact: true });
  await trigger.click();
  const inspector = page.getByRole("complementary", { name: "Project details: Compact workspace QA" });
  await expect(inspector).toContainText("Actual fixture activity");
  await expect(inspector).toContainText("Review source procedure");
  await inspector.getByRole("button", { name: "Close project details" }).focus();
  await page.keyboard.press("Escape");
  await expect(inspector).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await inspector.getByRole("button", { name: "Open workspace" }).click();
  await expect(page.getByLabel("Working project")).toHaveValue(fixture.id);
  expect(new URL(page.url()).searchParams.get("workspace")).toBe(fixture.id);
});

test("task detail panel retains its list and draft, refuses competing writes, then saves using its base revision", async ({ page }) => {
  const writes = await mockProjects(page);
  await page.goto(`/?project=${fixture.id}&work=list`);
  await page.getByRole("button", { name: "Edit Review source SOP", exact: true }).click();
  await expect(page.locator(".task-workbench-list")).toBeVisible();
  await expect(page.getByLabel("Workflow for Review source SOP")).toBeDisabled();
  await expect(page.getByRole("button", { name: "Task board", exact: true })).toBeDisabled();
  await page.getByLabel("Task description").fill("Faithful conversion draft");
  page.once("dialog", dialog => dialog.dismiss());
  await page.getByRole("button", { name: "Back to all projects", exact: true }).click();
  await expect(page.getByLabel("Task description")).toHaveValue("Faithful conversion draft");
  expect(writes).toHaveLength(0);
  await page.getByRole("button", { name: "Save task", exact: true }).click();
  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatchObject({ revision: 3, tasks: [{ description: "Faithful conversion draft" }] });
  await expect(page.locator(".task-detail-editor")).toHaveCount(0);
  await expect(page.getByLabel("Search tasks")).toBeFocused();
});

test("read-only project details stay readable without enabling mutations", async ({ page }) => {
  const writes = await mockProjects(page, true);
  await page.goto(`/?project=${fixture.id}&work=list`);
  await page.getByRole("button", { name: "View Review source SOP", exact: true }).click();
  await expect(page.getByLabel("Task description")).toHaveValue("Keep the source numbering");
  await expect(page.getByLabel("Task description")).toBeDisabled();
  await expect(page.getByRole("button", { name: "Save task", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Back to tasks", exact: true }).click();
  expect(writes).toHaveLength(0);
});

test("timeline pointer gestures cannot change a schedule while a task draft is open", async ({ page }) => {
  const writes = await mockProjects(page);
  await page.clock.install({ time: new Date("2026-10-05T10:00:00Z") });
  await page.goto(`/?project=${fixture.id}&work=timeline`);
  const row = page.getByRole("button", { name: "Timeline task Review source SOP", exact: true });
  await row.locator("strong").click();
  await page.getByLabel("Task description").fill("Held timeline draft");
  const bar = row.locator(".timeline-bar");
  const box = await bar.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2 + 100, box!.y + box!.height / 2);
  await page.mouse.up();
  await expect(page.getByRole("button", { name: "Apply schedule move" })).toHaveCount(0);
  await expect(page.getByLabel("Task description")).toHaveValue("Held timeline draft");
  expect(writes).toHaveLength(0);
});

for (const width of [390, 1440]) {
  test(`immersive globe fills the ${width}px viewport below the actual header`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await mockProjects(page);
    await page.goto("/?view=globe");
    await page.getByRole("button", { name: "Open Project Eye settings", exact: true }).waitFor();
    const geometry = await page.evaluate(() => {
      const rect = (selector: string) => {
        const r = document.querySelector(selector)!.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom };
      };
      return { header: rect(".topbar"), globe: rect(".globe-page"), indicator: rect(".view-tab-indicator"), tab: rect("#globe-tab") };
    });
    expect(geometry.globe.x).toBe(0);
    expect(geometry.globe.width).toBe(width);
    expect(geometry.globe.y).toBe(geometry.header.bottom);
    expect(geometry.globe.bottom).toBe(1000);
    expect(geometry.indicator.x).toBeCloseTo(geometry.tab.x, 0);
    expect(geometry.indicator.width).toBe(geometry.tab.width);
  });
}

for (const locale of ["en", "de"] as const) for (const width of [390, 1440]) {
  test(`${locale} compact portfolio and inspector fit ${width}px without page overflow`, async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL, viewport: { width, height: 1000 }, locale, reducedMotion: "reduce" });
    const page = await context.newPage();
    await mockProjects(page);
    await page.goto("/");
    await page.getByRole("button", { name: `${locale === "de" ? "Projektdetails" : "Project details"}: ${fixture.name}`, exact: true }).click();
    await expect(page.locator(".portfolio-inspector")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.locator(".portfolio-inspector").getByRole("button", { name: locale === "de" ? "Arbeitsbereich öffnen" : "Open workspace" }).click();
    if (width < 1000) await page.getByRole("button", { name: "Open navigation", exact: true }).click();
    await page.getByRole("navigation").getByRole("button", { name: "Tasks & subtasks", exact: true }).click();
    await page.getByRole("button", { name: "Edit Review source SOP", exact: true }).click();
    await expect(page.locator(".task-detail-editor")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await context.close();
  });
}
