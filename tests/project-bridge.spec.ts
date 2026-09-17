import { test, expect } from "@playwright/test";
import {
  unlinkedProjects,
  projectRefKey,
  type ImportCandidate,
} from "../lib/flightdeck/bridge";
import { type Project, examples } from "../lib/projects";
test("OS discovery excludes confirmed and denied projects without collapsing identities", () => {
  const ref = { instanceId: "os-a", workspaceId: "ops", projectId: "one" };
  const c: ImportCandidate = {
    ref,
    name: "Same label",
    workspaceName: "Operations",
    canImport: true,
  };
  const other = { ...c, ref: { ...ref, projectId: "two" } };
  expect(
    unlinkedProjects(
      [
        c,
        other,
        other,
        { ...c, ref: { ...ref, projectId: "denied" }, canImport: false },
      ],
      [ref],
      ref,
    ),
  ).toEqual([other]);
  expect(projectRefKey(ref)).not.toBe(
    projectRefKey({ ...ref, instanceId: "os-b" }),
  );
  expect(() =>
    unlinkedProjects(
      [{ ...c, ref: { ...ref, workspaceId: "wrong" } }],
      [],
      ref,
    ),
  ).toThrow("Unexpected FlightDeck context");
});
test("onboarding drafts persist, export, and remove without creating an OS project", async ({
  page,
  request,
}) => {
  expect((await request.get("/api/flightdeck/catalog")).status()).toBe(401);
  expect(
    (await request.post("/api/flightdeck/import", { data: {} })).status(),
  ).toBe(401);
  await page.goto("/?view=connection");
  await expect(page.getByText("Not connected", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "Your OS project list will appear here",
    }),
  ).toBeVisible();
  const project = await page.evaluate(async (fields) => {
    const r = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...fields, name: "Bridge QA", tasks: [] }),
    });
    return ((await r.json()) as { project: Project }).project;
  }, examples[0]);
  try {
    await page.reload();
    await page.getByRole("button", { name: /To FlightDeck/ }).click();
    await page
      .getByRole("button", { name: "Prepare onboarding", exact: true })
      .click();
    await page.getByLabel("Proposed OS project name").fill("Operations pilot");
    await page
      .getByLabel("Preferred workspace (optional)")
      .fill("Operations Europe");
    await page.getByRole("button", { name: "Save onboarding draft" }).click();
    await expect(
      page.getByText("Draft prepared", { exact: true }),
    ).toBeVisible();
    await page.reload();
    await page.getByRole("button", { name: /To FlightDeck/ }).click();
    await expect(page.getByText(/Operations Europe/)).toBeVisible();
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export draft" }).click();
    expect((await downloadPromise).suggestedFilename()).toBe(
      `flightdeck-draft-${project.id}.md`,
    );
    const responses = await page.evaluate(async (id) => {
      const onboard = await fetch(`/api/flightdeck/onboard/${id}`, {
        method: "POST",
      });
      const imported = await fetch("/api/flightdeck/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ref: { instanceId: "fake", workspaceId: "fake", projectId: "fake" },
        }),
      });
      return { onboard: onboard.status, imported: imported.status };
    }, project.id);
    expect(responses).toEqual({ onboard: 503, imported: 503 });
    await page.getByRole("button", { name: "Remove draft" }).click();
    await expect(page.getByText("Not prepared", { exact: true })).toBeVisible();
  } finally {
    await page.evaluate(async (id) => {
      const body = (await (await fetch("/api/projects")).json()) as {
        projects: Project[];
      };
      const p = body.projects.find((p: { id: string }) => p.id === id);
      if (p)
        await fetch(`/api/projects/${id}?revision=${p.revision}`, {
          method: "DELETE",
        });
    }, project.id);
  }
});
