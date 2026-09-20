import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { readdirSync } from "node:fs";
const accessFixtures: { name: string; email: string }[] = [];
test.afterAll(() => {
  if (!accessFixtures.length) return;
  const folder = ".wrangler/state/v3/d1/miniflare-D1DatabaseObject";
  for (const file of readdirSync(folder).filter(
    (p) => p.endsWith(".sqlite") && p !== "metadata.sqlite",
  )) {
    const db = new DatabaseSync(`${folder}/${file}`);
    try {
      if (
        !db
          .prepare("SELECT name FROM sqlite_master WHERE name='atlas_roles'")
          .get()
      )
        continue;
      for (const fixture of accessFixtures) {
        db.prepare("DELETE FROM atlas_members WHERE email=?").run(
          fixture.email,
        );
        db.prepare("DELETE FROM atlas_roles WHERE name=? AND builtin=0").run(
          fixture.name,
        );
        db.prepare(
          "DELETE FROM atlas_access_events WHERE target=? OR target=?",
        ).run(fixture.email, fixture.name);
      }
    } finally {
      db.close();
    }
  }
});
import {
  canChangeProject,
  builtinRoles,
  type AccessProfile,
} from "../lib/access-policy";
import { briefing } from "../lib/briefing";
import { examples } from "../lib/projects";
import { parseFeed, newsSources } from "../lib/ai-news";

test("Owner and custom project permissions cannot widen authority by role name", () => {
  const owner: AccessProfile = {
    userId: "owner-a",
    email: "owner@example.test",
    name: "Owner",
    roleId: "owner",
    roleName: "Owner",
    superAdmin: false,
    permissions: builtinRoles[1].permissions,
  };
  expect(canChangeProject(owner, "owner-a")).toBe(true);
  expect(canChangeProject(owner, "owner-b")).toBe(false);
  expect(canChangeProject(owner, "owner-b", true)).toBe(false);
  expect(
    canChangeProject(
      {
        ...owner,
        roleId: "superadmin",
        roleName: "Super Admin",
        permissions: ["projects.read"],
      },
      "owner-a",
    ),
  ).toBe(false);
  const admin = {
    ...owner,
    roleId: "admin",
    permissions: builtinRoles[0].permissions,
  };
  expect(canChangeProject(admin, "owner-b")).toBe(true);
  expect(admin.superAdmin).toBe(false);
});

test("archived completions remain in history but leave the action queue", () => {
  const now = new Date("2026-09-17T12:00:00Z");
  const p = {
    ...examples[0],
    archived: true,
    tasks: [
      {
        id: "done",
        title: "Completed",
        done: true,
        completedAt: now.toISOString(),
      },
      { id: "todo", title: "Old action", done: false },
    ],
  };
  const summary = briefing([p], "day", now);
  expect(summary.completed).toHaveLength(1);
  expect(summary.actions).toHaveLength(0);
});

test("AI headlines retain provenance and reject external and future links", () => {
  const xml = `<rss><channel><item><title><![CDATA[Useful &amp; new]]></title><link>https://openai.com/news/example</link><pubDate>Wed, 16 Sep 2026 12:00:00 GMT</pubDate></item><item><title>Bad destination</title><link>https://malicious.example/news</link><pubDate>Wed, 16 Sep 2026 12:00:00 GMT</pubDate></item><item><title>Future</title><link>https://openai.com/future</link><pubDate>Wed, 16 Sep 2030 12:00:00 GMT</pubDate></item></channel></rss>`;
  const items = parseFeed(
    xml,
    newsSources[0],
    Date.parse("2026-09-17T12:00:00Z"),
  );
  expect(items).toHaveLength(1);
  expect(items[0].title).toBe("Useful & new");
  expect(items[0].source).toBe("OpenAI");
});

test("a project action, update, briefing, archive, and restore form one durable workflow", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "New project", exact: true })
    .first()
    .click();
  await page.getByLabel("Project name", { exact: true }).fill("Action hub QA");
  await page
    .getByLabel("Next action", { exact: true })
    .fill("Review the pilot with Quality");
  const created = page.waitForResponse(
    (r) => r.url().endsWith("/api/projects") && r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Create project", exact: true })
    .click();
  const id = (await (await created).json()).project.id;
  try {
    await page
      .locator(".project-card")
      .filter({ hasText: "Action hub QA" })
      .click();
    await page
      .getByLabel("New task", { exact: true })
      .fill("Agree a measurable outcome");
    await page.getByLabel("Task due date", { exact: true }).fill("2026-09-01");
    await page
      .getByRole("combobox", { name: "Task priority", exact: true })
      .selectOption("High");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(
      page.getByRole("checkbox", { name: "Agree a measurable outcome" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Edit Agree a measurable outcome" })
      .click();
    await page.getByLabel("Task owner", { exact: true }).fill("Quality lead");
    await page.getByRole("button", { name: "Save task", exact: true }).click();
    await page
      .getByRole("checkbox", { name: "Agree a measurable outcome" })
      .click();
    await expect(
      page.getByText("100% complete", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: /Updates ·/ }).click();
    await expect(
      page.getByText("Task details updated: Agree a measurable outcome", {
        exact: true,
      }),
    ).toBeVisible();
    await page
      .getByLabel("Project update", { exact: true })
      .fill("Pilot outcome agreed with the function owner.");
    await page
      .getByRole("button", { name: "Record update", exact: true })
      .click();
    await expect(
      page.getByText("Pilot outcome agreed with the function owner.", {
        exact: true,
      }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page
      .getByRole("button", { name: "Team & personal", exact: true })
      .click();
    await page.getByRole("button", { name: "Briefings", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Daily briefing" }),
    ).toBeVisible();
    await expect(page.locator(".briefing-metrics")).toContainText(
      "Completed today1",
    );
    await expect(page.locator(".activity-section")).toContainText(
      "Pilot outcome agreed",
    );
    await page.getByRole("button", { name: "This week", exact: true }).click();
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export summary" }).click();
    expect((await download).suggestedFilename()).toMatch(/^atlas-week-/);
    await page.getByRole("tab", { name: "Dashboard", exact: true }).click();
    await page
      .locator(".project-card")
      .filter({ hasText: "Action hub QA" })
      .click();
    await page
      .getByRole("button", { name: "Archive project", exact: true })
      .click();
    await expect(page.locator(".project-card")).toHaveCount(0);
    await page.getByRole("button", { name: "Archived", exact: true }).click();
    await page
      .locator(".project-card")
      .filter({ hasText: "Action hub QA" })
      .click();
    await page
      .getByRole("button", { name: "Restore project", exact: true })
      .click();
    await page
      .getByRole("tabpanel", { name: "Dashboard", exact: true })
      .getByRole("button", { name: "All projects", exact: true })
      .click();
    await page.reload();
    await expect(
      page.locator(".project-card").filter({ hasText: "Action hub QA" }),
    ).toBeVisible();
  } finally {
    await page
      .evaluate(async (id) => {
        const data = (await (await fetch("/api/projects")).json()) as {
          projects: { id: string; revision: number }[];
        };
        const p = data.projects.find((p) => p.id === id);
        if (p)
          await fetch(`/api/projects/${id}?revision=${p.revision}`, {
            method: "DELETE",
          });
      }, id)
      .catch(() => {});
  }
});

test("consultancy playbook creates a real onboarding project and does not duplicate its active pilot", async ({
  page,
}) => {
  await page.goto("/?view=ideas");
  const card = page
    .locator(".opportunity-card")
    .filter({ hasText: "Make evidence easier to find" });
  const created = page.waitForResponse(
    (r) => r.url().endsWith("/api/projects") && r.request().method() === "POST",
  );
  await card.getByRole("button", { name: "Start a pilot" }).click();
  const p = (await (await created).json()).project;
  try {
    await expect(
      page.getByRole("dialog", { name: "Make evidence easier to find" }),
    ).toBeVisible();
    expect(p.tasks).toHaveLength(7);
    expect(p.functionArea).toBe("Quality");
    expect(p.onboardingStage).toBe("Discovery");
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await expect(
      card.getByRole("button", { name: "Open pilot" }),
    ).toBeVisible();
    await expect(page.locator(".onboarding-pipeline")).toContainText(
      "Make evidence easier to find",
    );
  } finally {
    await page.evaluate(async (p) => {
      await fetch(`/api/projects/${p.id}?revision=${p.revision}`, {
        method: "DELETE",
      });
    }, p);
  }
});

test("Super Admin can define and grant a role; protected identity and invalid grants are rejected", async ({
  page,
  request,
}) => {
  expect((await request.get("/api/access")).status()).toBe(401);
  expect(
    (
      await request.get("/api/access", {
        headers: {
          "oai-authenticated-user-id": "fake",
          "oai-authenticated-user-email": "seedy@sites.test",
        },
      })
    ).status(),
  ).toBe(401);
  await page.goto("/?view=access");
  await expect(
    page.getByRole("heading", { name: "People & access" }),
  ).toBeVisible();
  const suffix = randomUUID(),
    name = `QA reviewer ${suffix}`,
    email = `qa-${suffix}@example.test`;
  accessFixtures.push({ name, email });
  await page.getByLabel("Role name", { exact: true }).fill(name);
  await page.getByRole("button", { name: "Create role", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Role created");
  const checks = await page.evaluate(
    async ({ name, email }) => {
      const initial = (await (await fetch("/api/access")).json()) as {
        superAdmin: string;
        roles: { id: string; name: string }[];
      };
      const role = initial.roles.find((r) => r.name === name)!;
      const post = async (body: Record<string, unknown>) =>
        (
          await fetch("/api/access", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          })
        ).status;
      return {
        role: role.id,
        grant: await post({ action: "grant", email, roleId: role.id }),
        protected: await post({
          action: "grant",
          email: initial.superAdmin,
          roleId: "owner",
        }),
        escalation: await post({
          action: "create-role",
          name: "Hidden Super",
          permissions: ["projects.read", "access.manage"],
        }),
        dependency: await post({
          action: "create-role",
          name: "Archive without edit",
          permissions: ["projects.read", "projects.archive_all"],
        }),
        revoke: await post({ action: "revoke", email }),
      };
    },
    { name, email },
  );
  expect(checks.grant).toBe(200);
  expect(checks.protected).toBe(400);
  expect(checks.escalation).toBe(400);
  expect(checks.dependency).toBe(400);
  expect(checks.revoke).toBe(200);
});
