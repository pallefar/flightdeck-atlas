import { test, expect, type Page } from "@playwright/test";
import { examples, type Project } from "../lib/projects";
import { permissions } from "../lib/access-policy";
import type { VisionProjection } from "../lib/flightdeck/vision";

const fixture: Project = { ...examples[0], id: "vision-browser-qa", name: "Synthetic HR assessment fixture", source: "atlas", revision: 3, canEdit: true, canShare: false };
const projection = (): VisionProjection => ({ schema: "vision-projection/1", workspaceId: "hr-fixture", projectId: "hr-project", enrolled: true, status: "review_due", canActivate: true, canOperate: true, canDeliver: false, assessmentRevision: 2, visionRevision: 1, approvedGoals: ["Improve HR service quality"], requiredActions: ["Review pilot evidence"], approvedStage: "Pilot", pendingStage: "Ready for FlightDeck", deliveryStatus: "In progress", atlasRevision: 3, checkedAt: new Date().toISOString() });
async function mock(page: Page, canEdit: boolean, ownerLink: boolean) {
  await page.route("**/api/projects", route => route.fulfill({ json: { projects: [{ ...fixture, canEdit }], access: { userId: "browser-fixture", email: "fixture@example.test", name: "QA", roleId: "owner", roleName: "Owner", superAdmin: false, permissions } } }));
  await page.route(`**/api/projects/${fixture.id}/collaboration`, route => route.fulfill({ json: { people: [], email: "fixture@example.test" } }));
  let pending = true, retries = 0;
  await page.route("**/api/flightdeck/vision?*", route => route.fulfill({ json: { state: "ok", projection: projection(), openUrl: ownerLink ? "https://os.example.test/console/vision?standalone=1" : null, syncPending: pending } }));
  await page.route("**/api/flightdeck/vision/sync?*", route => { retries++; pending = false; return route.fulfill({ json: { synced: true } }); });
  return { retries: () => retries };
}

for (const [locale, width] of [["en", 1440], ["de", 390]] as const) {
  test(`approved shared assessment and durable retry fit ${locale} ${width}px project workspace`, async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL, viewport: { width, height: 1000 }, locale, reducedMotion: "reduce" });
    const page = await context.newPage(), errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    const state = await mock(page, true, true);
    await page.goto(`/?view=manage&tool=overview&workspace=${fixture.id}`);
    const card = page.locator(".vision-project-status");
    await expect(card).toHaveCount(1);
    await expect(card).toContainText("Review pilot evidence");
    await expect(card).toContainText("Improve HR service quality");
    await expect(card).toContainText("Ready for FlightDeck");
    await expect(card.getByRole("link")).toHaveAttribute("rel", "noopener noreferrer");
    await card.getByRole("button", { name: locale === "de" ? "Erneut synchronisieren" : "Retry sync", exact: true }).click();
    await expect(card.getByRole("button")).toHaveCount(0);
    expect(state.retries()).toBe(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
    await context.close();
  });
}

test("a read-only shared assessment view offers no private launcher or synchronization write", async ({ page }) => {
  const state = await mock(page, false, false);
  await page.goto(`/?view=manage&tool=overview&workspace=${fixture.id}`);
  const card = page.locator(".vision-project-status");
  await expect(card).toContainText("Review pilot evidence");
  await expect(card).toContainText("synchronization is pending");
  await expect(card.getByRole("link")).toHaveCount(0);
  await expect(card.getByRole("button")).toHaveCount(0);
  expect(state.retries()).toBe(0);
});
