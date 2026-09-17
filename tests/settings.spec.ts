import { test, expect } from "@playwright/test";

test("dashboard settings apply, persist, and reset without changing project data", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Open settings", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Workspace settings" });
  await dialog
    .getByLabel("Project layout", { exact: true })
    .selectOption("list");
  await dialog
    .getByLabel("Project order", { exact: true })
    .selectOption("name");
  await dialog.getByRole("switch", { name: "Summary metrics" }).click();
  await dialog.getByRole("switch", { name: "Focus panel" }).click();
  await dialog.getByLabel("Appearance", { exact: true }).selectOption("dark");
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.locator(".project-grid")).toHaveClass(/project-list/);
  await expect(page.locator(".metrics")).toHaveCount(0);
  await expect(page.locator(".focus-panel")).toHaveCount(0);
  await expect(page.locator(".project-card").first()).toContainText(
    "Casa Horizon",
  );
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Open settings" }),
  ).toBeEnabled();
  await expect(page.locator(".project-grid")).toHaveClass(/project-list/);
  await expect(page.locator(".metrics")).toHaveCount(0);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "Open settings" }).click();
  await dialog
    .getByRole("button", { name: "Reset dashboard", exact: true })
    .click();
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.locator(".project-grid")).not.toHaveClass(/project-list/);
  await expect(page.locator(".metrics")).toBeVisible();
  await expect(page.locator(".focus-panel")).toBeVisible();
  await expect(page.locator(".project-card")).toHaveCount(4);
});

test("globe settings change the map and instant journey, persist, and honor explicit view links", async ({
  page,
}) => {
  test.setTimeout(60000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/?view=globe");
  await page.getByRole("button", { name: "Open settings" }).click();
  const dialog = page.getByRole("dialog", { name: "Workspace settings" });
  await expect(
    dialog.getByRole("button", { name: "God’s Eye", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await dialog.getByLabel("Map style", { exact: true }).selectOption("street");
  await dialog
    .getByRole("switch", { name: "3D buildings", exact: true })
    .click();
  await dialog.getByRole("switch", { name: "Terrain relief" }).click();
  await dialog.getByRole("switch", { name: "Project labels" }).click();
  await dialog.getByRole("switch", { name: "Location list" }).click();
  await dialog
    .getByLabel("Camera & workspace journey", { exact: true })
    .selectOption("instant");
  await dialog.getByLabel("Start view", { exact: true }).selectOption("globe");
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.locator(".globe-projects")).toHaveCount(0);
  await expect(page.locator(".globe-hint")).toContainText("Street map", {
    timeout: 20000,
  });
  await expect(page.locator(".globe-hint")).not.toContainText("3D buildings");
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "God’s Eye", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Open settings" }).click();
  await expect(
    dialog.getByRole("switch", { name: "Project labels" }),
  ).not.toBeChecked();
  await expect(dialog.getByLabel("Map style", { exact: true })).toHaveValue(
    "street",
  );
  await dialog.getByRole("switch", { name: "Location list" }).click();
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await page
    .locator(".location-row")
    .filter({ hasText: "FlightDeck OS" })
    .click();
  await page
    .getByRole("button", { name: "Enter workspace", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "FlightDeck OS", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".journey-dialog")).toHaveCount(0);
  await page.goto("/?view=dashboard");
  await expect(
    page.getByRole("heading", { name: "Everything in motion." }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("settings recover from invalid storage and fit a small mobile screen", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      "atlas-settings-v1",
      '{"dashboard":{"layout":"broken"},"globe":null}',
    ),
  );
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto("/");
  await page.getByRole("button", { name: "Open settings" }).click();
  const dialog = page.getByRole("dialog", { name: "Workspace settings" });
  await expect(
    dialog.getByLabel("Project layout", { exact: true }),
  ).toHaveValue("cards");
  await dialog.getByRole("button", { name: "God’s Eye", exact: true }).click();
  await dialog
    .getByLabel("Camera & workspace journey", { exact: true })
    .selectOption("quick");
  const box = await dialog.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(667);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    375,
  );
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Open settings" }),
  ).toBeFocused();
});
