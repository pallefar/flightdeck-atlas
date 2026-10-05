import { test, expect, type Page } from "@playwright/test";
import { permissions } from "../lib/access-policy";
import { catalogWithVisionCard, visionCardConfig, visionMenuUrl } from "../lib/flightdeck/vision-card";
import { defaultPreferences, flightdeckApp } from "../lib/collaboration";
import { en } from "../lib/i18n/en";
import { de } from "../lib/i18n/de";

const localUrl = "http://127.0.0.1:4173/console/vision?standalone=1";
const owner = { userId: "trusted-menu-owner", email: "karsten.haldan@gmail.com", superAdmin: true };

async function fixture(page: Page, viewer = owner) {
  const catalog = catalogWithVisionCard([], viewer, visionCardConfig(localUrl));
  let status = 200;
  let visionUrl: unknown = visionMenuUrl(viewer.superAdmin, catalog);
  await page.route("**/api/projects", route => route.fulfill({ json: { projects: [], access: { ...viewer, name: "Menu fixture", roleId: viewer.superAdmin ? "superadmin" : "member", roleName: viewer.superAdmin ? "Super Admin" : "Member", permissions } } }));
  await page.route("**/api/flightdeck/context**", route => route.fulfill({ json: { state: "not_configured" } }));
  await page.route("**/api/workspace", route => route.fulfill({ status, json: { email: viewer.email, apps: catalog, teams: [], teamOptions: [], people: [], capacity: [], notifications: [], roles: [], preferences: defaultPreferences, preferenceRevision: 1, accountMenu: { visionUrl } } }));
  return { set: (next: unknown, nextStatus = 200) => { visionUrl = next; status = nextStatus; } };
}

async function openAtlas(page: Page) {
  await page.goto("/?view=dashboard");
  // The shell remounts its private controls when authenticated access loads.
  await expect(page.locator(".sidebar .profile-button")).toContainText("Menu fixture");
}

for (const [locale, width] of [["en", 1440], ["de", 390]] as const) {
  test(`owner Super Admin account action is translated and keyboard accessible at ${locale} ${width}px`, async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL, viewport: { width, height: 1000 }, locale, reducedMotion: "reduce" });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await fixture(page);
    await openAtlas(page);
    if (width < 500) await page.getByRole("button", { name: "Open navigation", exact: true }).click();
    const trigger = page.getByRole("button", { name: locale === "de" ? de["account.menu.aria"] : en["account.menu.aria"], exact: true });
    await trigger.focus();
    await trigger.press("Enter");
    const action = page.getByRole("menuitem", { name: "Vision OS", exact: true });
    await expect(action).toHaveAttribute("href", localUrl);
    await expect(action).toHaveAttribute("target", "_blank");
    await expect(action).toHaveAttribute("rel", "noopener noreferrer");
    await expect(action).toHaveAttribute("title", locale === "de" ? de["account.menu.visionHint"] : en["account.menu.visionHint"]);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
    expect(errors).toEqual([]);
    await context.close();
  });
}

test("another Super Admin and an ordinary owner receive no private account action", async ({ browser, baseURL }) => {
  for (const viewer of [{ ...owner, email: "admin@example.test" }, { ...owner, superAdmin: false }]) {
    const context = await browser.newContext({ baseURL, locale: "en" });
    const page = await context.newPage();
    await fixture(page, viewer);
    await openAtlas(page);
    await page.getByRole("button", { name: "Account menu", exact: true }).click();
    await expect(page.getByRole("menu")).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Vision OS", exact: true })).toHaveCount(0);
    await context.close();
  }
});

test("the account menu rejects unsafe and absent server URLs, even when an app card exists", async ({ page }) => {
  const state = await fixture(page);
  await openAtlas(page);
  const trigger = page.getByRole("button", { name: "Account menu", exact: true });
  for (const url of [null, undefined, "javascript:alert(1)", "http://os.example.test/console/vision", "https://owner:secret@os.example.test/console/vision"]) {
    state.set(url);
    await trigger.click();
    await expect(page.getByRole("menu")).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Vision OS", exact: true })).toHaveCount(0);
    await page.keyboard.press("Escape");
  }
});

test("reopening the menu clears an earlier owner decision when the fresh request is refused", async ({ page }) => {
  const state = await fixture(page);
  await openAtlas(page);
  const trigger = page.getByRole("button", { name: "Account menu", exact: true });
  await trigger.click();
  await expect(page.getByRole("menuitem", { name: "Vision OS", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  state.set(null, 403);
  await trigger.click();
  await expect(page.getByRole("menu")).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Vision OS", exact: true })).toHaveCount(0);
});

test("the local browser action opens a new tab without forwarding Atlas authentication", async ({ page, context, baseURL }) => {
  await fixture(page);
  await context.addCookies([{ name: "atlas-menu-test-session", value: "synthetic-atlas-cookie", url: baseURL! }]);
  let headers: Record<string, string> = {};
  await context.route("http://127.0.0.1:4173/console/vision?standalone=1", async route => {
    headers = await route.request().allHeaders();
    await route.fulfill({ contentType: "text/html", body: "<title>OS independent sign-in fixture</title>" });
  });
  await openAtlas(page);
  await page.getByRole("button", { name: "Account menu", exact: true }).click();
  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("menuitem", { name: "Vision OS", exact: true }).click();
  const popup = await popupPromise;
  await expect(popup).toHaveURL(localUrl);
  await expect(popup).toHaveTitle("OS independent sign-in fixture");
  expect(headers.authorization).toBeUndefined();
  expect(headers["oai-authenticated-user-id"]).toBeUndefined();
  expect(headers["oai-authenticated-user-email"]).toBeUndefined();
  expect(headers.cookie ?? "").not.toContain("atlas-menu-test-session");
  expect(headers.referer).toBeUndefined();
  expect(await popup.evaluate(() => window.opener)).toBeNull();
});

test("the menu decision never trusts a stored forged Vision card", () => {
  const forged = { ...flightdeckApp, id: "vision-os", url: localUrl, reserved: true };
  const other = { ...owner, email: "other@example.test" };
  expect(visionMenuUrl(true, catalogWithVisionCard([forged], other, visionCardConfig(localUrl)))).toBeNull();
});
