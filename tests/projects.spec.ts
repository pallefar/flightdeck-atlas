import { test, expect } from "@playwright/test";
test("projects persist across reloads, tasks update, stale writes conflict, and invalid input is rejected", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Everything in motion." }),
  ).toBeVisible();
  expect((await request.get("/api/projects")).status()).toBe(401);
  await page
    .getByRole("button", { name: "New project", exact: true })
    .first()
    .click();
  await page
    .getByLabel("Project name", { exact: true })
    .fill("QA test project");
  await page
    .getByLabel("Description", { exact: true })
    .fill("Created by the persistence smoke test; cleaned up afterwards.");
  await page.getByLabel("Latitude", { exact: true }).fill("55.6753");
  await page.getByLabel("Longitude", { exact: true }).fill("12.5704");
  let id = "",
    revision = 1;
  try {
    const saved = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/projects") && r.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Create project", exact: true })
      .click();
    const response = await saved;
    expect(response.status()).toBe(201);
    const created = await response.json();
    id = created.project.id;
    await page.reload();
    await expect(
      page.locator(".project-card").filter({ hasText: "QA test project" }),
    ).toBeVisible();
    await page
      .locator(".project-card")
      .filter({ hasText: "QA test project" })
      .click();
    await page
      .getByLabel("New task", { exact: true })
      .fill("Verify persistence");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(
      page.getByRole("checkbox", { name: "Verify persistence" }),
    ).toBeVisible();
    await page.getByRole("checkbox", { name: "Verify persistence" }).click();
    await expect(
      page.getByText("100% complete", { exact: true }),
    ).toBeVisible();
    const checks = await page.evaluate(async (original) => {
      const latest = (await (await fetch("/api/projects")).json()) as {
        projects: Record<string, unknown>[];
      };
      const project = latest.projects.find((p) => p.id === original.id)!;
      const stale = await fetch(`/api/projects/${original.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(original),
      });
      const invalid = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...original, latitude: 999 }),
      });
      return { project, stale: stale.status, invalid: invalid.status };
    }, created.project);
    revision = checks.project.revision as number;
    expect(checks.stale).toBe(409);
    expect(checks.invalid).toBe(400);
    expect(revision).toBe(3);
    await page.reload();
    await page
      .locator(".project-card")
      .filter({ hasText: "QA test project" })
      .click();
    await expect(
      page.getByRole("checkbox", { name: "Verify persistence" }),
    ).toBeChecked();
  } finally {
    if (id)
      await page.evaluate(
        async ({ id }) => {
          const data = (await (await fetch("/api/projects")).json()) as {
            projects: { id: string; revision: number }[];
          };
          const p = data.projects.find((p) => p.id === id);
          if (p)
            await fetch(`/api/projects/${id}?revision=${p.revision}`, {
              method: "DELETE",
            });
        },
        { id },
      );
  }
});
test("cross-origin writes and unauthenticated access are rejected", async ({
  request,
}) => {
  expect(
    (
      await request.post("/api/projects", {
        headers: {
          Origin: "https://other.example",
          "Content-Type": "application/json",
        },
        data: {},
      })
    ).status(),
  ).toBe(403);
  expect(
    (await request.put("/api/projects/unknown", { data: {} })).status(),
  ).toBe(401);
  expect(
    (await request.delete("/api/projects/unknown?revision=1")).status(),
  ).toBe(401);
});
test("mobile dashboard stays within viewport and both views are reachable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("tab", { name: "God’s Eye", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "God’s Eye", exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Dashboard", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Everything in motion." }),
  ).toBeVisible();
});
test("TE branding and theme preference survive reload without hydration errors", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByRole("img", { name: "TE Connectivity", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Switch to dark mode", exact: true })
    .click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Switch to light mode", exact: true }),
  ).toBeEnabled();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page
    .getByRole("button", { name: "Switch to light mode", exact: true })
    .click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  expect(errors).toEqual([]);
});
