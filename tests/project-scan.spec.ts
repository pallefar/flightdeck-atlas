import { test, expect } from "@playwright/test";
import { scanProjects, projectSignals } from "../lib/project-scan";
import { examples } from "../lib/projects";
test("portfolio search matches actual tasks and accents, filters attention, and omits archived projects", () => {
  const p = {
    ...examples[0],
    name: "Qualité pilot",
    priority: "High" as const,
    blocker: "Waiting on approval",
    tasks: [
      {
        id: "one",
        title: "Review supplier",
        done: false,
        dueDate: "2026-09-15",
      },
    ],
  };
  expect(scanProjects([p], "qualite supplier", "all", "2026-09-17")).toEqual([
    p,
  ]);
  expect(scanProjects([p], "unknown", "all", "2026-09-17")).toEqual([]);
  expect(
    scanProjects(
      [p, { ...p, id: "archive", archived: true }],
      "",
      "attention",
      "2026-09-17",
    ),
  ).toEqual([p]);
  expect(projectSignals(p, "2026-09-17").overdue).toBe(1);
  expect(
    scanProjects(
      [
        {
          ...p,
          blocker: "",
          dueDate: "",
          tasks: [{ ...p.tasks[0], done: true }],
        },
      ],
      "",
      "attention",
      "2026-09-17",
    ),
  ).toEqual([]);
});
test("top navigation, immersive layout, visible globe settings and scanner work together", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/?view=globe");
  const nav = page.locator(".topbar");
  await expect(
    nav.getByRole("tab", { name: "Project Eye", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".sidebar")).toBeHidden();
  await page.getByRole("button", { name: "Open Project Eye settings" }).click();
  const dialog = page.getByRole("dialog", { name: "Workspace settings" });
  await expect(
    dialog.getByRole("button", { name: "Project Eye", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await dialog.getByRole("switch", { name: "Sunlight & shadows" }).click();
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await page
    .getByRole("button", { name: "Cinematic scan", exact: true })
    .click();
  await page.getByLabel("Search project intelligence").fill("Kyoto");
  await page
    .getByRole("button", { name: "Scan portfolio", exact: true })
    .click();
  await expect(page.locator(".scan-result-summary")).toContainText("1 match");
  await expect(page.locator(".scan-project-row")).toHaveCount(1);
  await expect(page.locator(".scan-project-row")).toContainText(
    "Kyoto Field Notes",
  );
  await page.getByLabel("Search project intelligence").fill("no-such-project");
  await page.getByRole("button", { name: "Scan again", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "No matching projects" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Show all projects" }).click();
  await expect(page.locator(".scan-project-row")).toHaveCount(4);
  const first = page.locator(".scan-project-row").first();
  await first.click();
  await expect(page.locator(".destination-card")).toBeVisible();
  await page.getByRole("button", { name: "Close selected project" }).click();
  await first.click();
  await expect(page.locator(".destination-card")).toBeVisible();
  await page.getByRole("button", { name: "Close selected project" }).click();
  await page.getByRole("button", { name: "Tour locations" }).click();
  await expect(page.locator(".globe-tour-status")).toContainText("1 / 4");
  await page.getByRole("button", { name: "Stop portfolio tour" }).click();
  await expect(page.locator(".globe-tour-status")).toHaveCount(0);
  await page.getByRole("button", { name: "Hide panel" }).click();
  await expect(page.locator(".globe-discovery")).toHaveCount(0);
  await nav.getByRole("tab", { name: "Dashboard", exact: true }).click();
  await expect(page.locator(".sidebar")).toBeVisible();
});
test("cinematic scan animates, can cancel, respects mobile width and saved scan mode", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 667 });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/?view=globe");
  await page
    .getByRole("button", { name: "Cinematic scan", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Scan portfolio", exact: true })
    .click();
  await expect(
    page.getByRole("progressbar", { name: "Project scan" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(
    page.getByRole("progressbar", { name: "Project scan" }),
  ).toHaveCount(0);
  await page.getByLabel("Search project intelligence").fill("copenhagen");
  await page
    .getByRole("button", { name: "Scan portfolio", exact: true })
    .click();
  await expect(page.locator(".scan-result-summary")).toContainText("1 match", {
    timeout: 7000,
  });
  await expect(page.locator(".scan-project-row").first()).toBeInViewport();
  await page.getByLabel("Search project intelligence").fill("no-such-project");
  await page.getByRole("button", { name: "Scan again", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "No matching projects" }),
  ).toBeInViewport({ timeout: 7000 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    375,
  );
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Cinematic scan", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Open Project Eye settings" }).click();
  const box = await page.getByRole("dialog").boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(667);
  expect(errors).toEqual([]);
});
