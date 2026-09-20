import { test, expect } from "@playwright/test";
test("view flight reverses with one canvas, skips cleanly, and keeps tab navigation", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByRole("tab", { name: "Project Eye", exact: true }).click();
  const flight = page.locator(".view-flight");
  await expect(flight).toHaveAttribute("data-direction", "globe");
  await expect(flight.locator("canvas")).toHaveCount(1);
  await flight
    .locator("canvas")
    .evaluate((el) => el.setAttribute("data-flight-test", "same-scene"));
  await page.waitForTimeout(900);
  await page.getByRole("tab", { name: "Dashboard", exact: true }).click();
  await expect(flight).toHaveAttribute("data-direction", "dashboard");
  await expect(flight.locator("canvas")).toHaveAttribute(
    "data-flight-test",
    "same-scene",
  );
  await page.getByRole("button", { name: "Skip to Dashboard" }).click();
  await expect(flight).toHaveCount(0);
  await expect(
    page.getByRole("tab", { name: "Dashboard", exact: true }),
  ).toBeFocused();
  await expect(
    page.getByRole("tabpanel", { name: "Dashboard", exact: true }),
  ).not.toHaveAttribute("inert");
  await page.getByRole("tab", { name: "Project Eye", exact: true }).click();
  await expect(flight).toHaveCount(0, { timeout: 12000 });
  await page.getByRole("tab", { name: "Dashboard", exact: true }).click();
  await expect(flight).toHaveCount(1);
  await expect(flight).toHaveCount(0, { timeout: 12000 });
  expect(errors).toEqual([]);
});
test("reduced motion skips camera travel and arrow keys select the other tab", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const dashboard = page.getByRole("tab", { name: "Dashboard", exact: true });
  await expect(dashboard).toBeEnabled();
  await dashboard.focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    page.getByRole("tab", { name: "Project Eye", exact: true }),
  ).toBeFocused();
  await expect(page.locator(".view-flight")).toHaveCount(0);
  await expect(page).toHaveURL(/view=globe/);
  await page.keyboard.press("Home");
  await expect(dashboard).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByRole("heading", { name: "Everything in motion." }),
  ).toBeVisible();
});
