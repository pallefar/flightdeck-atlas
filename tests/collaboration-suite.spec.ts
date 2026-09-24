import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { readdirSync } from "node:fs";
import {
  builtinRoles,
  projectPolicy,
  type AccessProfile,
} from "../lib/access-policy";
import { examples, projectSchema, type Task } from "../lib/projects";
import { portfolioAdvice } from "../lib/advisor";
import { createDeck } from "../lib/presentations";
const cleanup: { table: string; id: string }[] = [];
test.afterAll(() => {
  const folder = ".wrangler/state/v3/d1/miniflare-D1DatabaseObject";
  for (const file of readdirSync(folder).filter(
    (f) => f.endsWith(".sqlite") && f !== "metadata.sqlite",
  )) {
    const db = new DatabaseSync(`${folder}/${file}`);
    try {
      if (
        !db
          .prepare("SELECT name FROM sqlite_master WHERE name='atlas_apps'")
          .get()
      )
        continue;
      for (const f of cleanup) {
        db.prepare(`DELETE FROM ${f.table} WHERE id=?`).run(f.id);
        db.prepare("DELETE FROM atlas_access_events WHERE target=?").run(f.id);
      }
    } finally {
      db.close();
    }
  }
});
test("project sharing limits admin authority, honours team revocation and keeps dependencies out of advice", () => {
  const a: AccessProfile = {
    userId: "member",
    email: "member@example.test",
    name: "Member",
    roleId: "admin",
    roleName: "Admin",
    superAdmin: false,
    permissions: builtinRoles[0].permissions,
  };
  expect(
    projectPolicy(a, "owner", { visibility: "private", grants: [] }, []),
  ).toMatchObject({ read: false, edit: false, comment: false });
  const share = {
    visibility: "shared" as const,
    grants: [
      { type: "team" as const, target: "team", role: "editor" as const },
    ],
  };
  expect(
    projectPolicy(a, "owner", share, [{ id: "team", members: [a.email] }]).edit,
  ).toBe(true);
  expect(
    projectPolicy(a, "owner", share, [{ id: "team", members: [] }]).read,
  ).toBe(false);
  expect(
    projectPolicy(
      { ...a, roleId: "viewer", permissions: ["projects.read"] },
      "owner",
      {
        visibility: "shared",
        grants: [{ type: "person", target: a.email, role: "commenter" }],
      },
      [],
    ),
  ).toMatchObject({ read: true, edit: false, comment: true, share: false });
  const p = {
    ...examples[0],
    tasks: [
      { id: "a", title: "Prerequisite", done: false },
      {
        id: "b",
        title: "Blocked by dependency",
        done: false,
        priority: "High" as const,
        dependsOn: ["a"],
      },
    ],
  };
  expect(
    portfolioAdvice([p]).actions.find((x) => x.t.id === "b")?.blocked,
  ).toBe(true);
  expect(
    projectSchema.safeParse({
      ...p,
      tasks: p.tasks.map((t) => ({
        ...t,
        dependsOn: [t.id === "a" ? "b" : "a"],
      })),
    }).success,
  ).toBe(false);
});
test("collaboration, sharing, recurrence, attachments and deck persistence enforce revisions", async ({
  page,
}) => {
  await page.goto("/");
  const api = page.context().request;
  const idSuffix = randomUUID();
  const created = await api.post("/api/projects", {
    data: {
      ...examples[0],
      name: `Suite QA ${idSuffix}`,
      tasks: [
        {
          id: "repeat",
          title: "Weekly review",
          done: false,
          recurrence: "weekly",
          assigneeEmail: "seedy@sites.test",
        },
      ],
    },
  });
  expect(created.status()).toBe(201);
  let p = (await created.json()).project;
  cleanup.push({ table: "atlas_projects", id: p.id });
  const sharing = await api.get(`/api/projects/${p.id}/sharing`);
  expect((await sharing.json()).sharing.visibility).toBe("private");
  expect(
    (
      await api.put(`/api/projects/${p.id}/sharing`, {
        data: {
          visibility: "shared",
          grants: [
            {
              type: "person",
              target: "unapproved@example.test",
              role: "editor",
            },
          ],
          revision: 1,
        },
      })
    ).status(),
  ).toBe(400);
  const team = await api.post("/api/workspace", {
    data: {
      action: "team",
      id: `qa-${idSuffix}`,
      revision: 0,
      data: { name: "QA team", members: ["seedy@sites.test"] },
    },
  });
  expect(team.status()).toBe(200);
  cleanup.push({ table: "atlas_teams", id: `qa-${idSuffix}` });
  const shared = await api.put(`/api/projects/${p.id}/sharing`, {
    data: {
      visibility: "shared",
      grants: [{ type: "team", target: `qa-${idSuffix}`, role: "editor" }],
      revision: 1,
    },
  });
  expect(shared.status()).toBe(200);
  expect(
    (
      await api.put(`/api/projects/${p.id}/sharing`, {
        data: { visibility: "private", grants: [], revision: 1 },
      })
    ).status(),
  ).toBe(409);
  const commentId = randomUUID(),
    comment = {
      kind: "comment",
      title: "Decision context",
      body: "Discuss this task",
      mentions: ["seedy@sites.test"],
      taskId: "repeat",
    };
  expect(
    (
      await api.post(`/api/projects/${p.id}/collaboration`, {
        data: { id: commentId, data: comment, author: "spoof@example.test" },
      })
    ).status(),
  ).toBe(200);
  expect(
    (
      await api.post(`/api/projects/${p.id}/collaboration`, {
        data: { id: commentId, data: comment },
      })
    ).status(),
  ).toBe(409);
  const history = (
    await (
      await api.get(`/api/projects/${p.id}/collaboration?kind=comment`)
    ).json()
  ).records;
  expect(history[0].author).toBe("seedy@sites.test");
  const reviewId = randomUUID(),
    review = {
      kind: "approval",
      title: "Approve weekly review",
      body: "Please review",
      reviewer: "seedy@sites.test",
    };
  expect(
    (
      await api.post(`/api/projects/${p.id}/collaboration`, {
        data: { id: reviewId, data: review },
      })
    ).status(),
  ).toBe(200);
  expect(
    (
      await api.post(`/api/projects/${p.id}/collaboration`, {
        data: {
          id: reviewId,
          revision: 1,
          action: "review",
          data: { ...review, status: "approved", body: "Approved." },
        },
      })
    ).status(),
  ).toBe(200);
  const update = await api.put(`/api/projects/${p.id}`, {
    data: { ...p, tasks: p.tasks.map((t: Task) => ({ ...t, done: true })) },
  });
  expect(update.status()).toBe(200);
  p = (await update.json()).project;
  expect(p.tasks).toHaveLength(2);
  expect(p.tasks[1].recurrenceSource).toBe("repeat");
  const again = await api.put(`/api/projects/${p.id}`, { data: p });
  expect(again.status()).toBe(200);
  p = (await again.json()).project;
  expect(p.tasks).toHaveLength(2);
  const upload = await api.post(`/api/projects/${p.id}/files`, {
    multipart: {
      file: {
        name: "notes.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("Private project notes"),
      },
    },
  });
  expect(upload.status()).toBe(200);
  const file = (
    await (await api.get(`/api/projects/${p.id}/collaboration`)).json()
  ).files[0];
  const download = await api.get(`/api/files/${file.id}`);
  expect(download.status()).toBe(200);
  expect(download.headers()["content-disposition"]).toContain("attachment");
  expect(await download.text()).toBe("Private project notes");
  await api.delete(`/api/files/${file.id}`);
  const deck = createDeck([p], "Leadership update", "QA team", "Current");
  const saved = await api.post("/api/decks", {
    data: { id: randomUUID(), revision: 0, data: deck },
  });
  expect(saved.status()).toBe(200);
  const d = (await saved.json()).deck;
  cleanup.push({ table: "atlas_decks", id: d.id });
  expect(
    (await (await api.get(`/api/decks?id=${d.id}`)).json()).deck.slides.length,
  ).toBeGreaterThan(3);
  expect(
    (
      await api.post("/api/decks", {
        data: { id: d.id, revision: 99, data: d },
      })
    ).status(),
  ).toBe(409);
  await page.goto(`/?view=dashboard&project=${p.id}`);
  await page
    .getByRole("button", { name: "Collaborate & share", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Decision context", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Reviews", exact: true }).click();
  await expect(page.getByText("approved", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Back to all projects", exact: true }).click();
  await page.goto("/?view=presentations");
  await page.getByRole("button", { name: /Leadership update/ }).click();
  const fileDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export PowerPoint" }).click();
  const ppt = await fileDownload;
  expect(ppt.suggestedFilename()).toMatch(/\.pptx$/);
  const stream = await ppt.createReadStream();
  let bytes = 0;
  for await (const chunk of stream!) bytes += chunk.length;
  expect(bytes).toBeGreaterThan(10000);
});
test("app registry, launcher and globe display controls work on mobile", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  const api = page.context().request;
  const id = `qa-${randomUUID()}`,
    app = {
      name: "QA workspace",
      description: "Launcher test",
      url: "https://example.com/",
      icon: "",
      category: "Test",
      enabled: true,
      featured: false,
      order: 10,
      audience: "all",
      people: [],
      teams: [],
      roles: [],
      login: "external",
      newTab: true,
    };
  const saved = await api.post("/api/workspace", {
    data: { action: "app", id, revision: 0, data: app },
  });
  expect(saved.status()).toBe(200);
  cleanup.push({ table: "atlas_apps", id });
  expect(
    (
      await api.post("/api/workspace", {
        data: {
          action: "app",
          revision: 0,
          data: { ...app, url: "javascript:alert(1)" },
        },
      })
    ).status(),
  ).toBe(400);
  await page.setViewportSize({ width: 375, height: 667 });
  await page.getByRole("button", { name: "Open apps", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Your apps" })).toBeVisible();
  await expect(
    page.getByRole("link", { name: /QA workspace/ }),
  ).toHaveAttribute("href", "https://example.com/");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    375,
  );
  await page.keyboard.press("Escape");
  await page.goto("/?view=globe");
  await page
    .getByRole("button", { name: "Open Project Eye settings", exact: true })
    .click();
  await page
    .getByLabel("Visual preset", { exact: true })
    .selectOption("thermal");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.locator(".globe-telemetry")).toContainText(
    "SIMULATED DISPLAY EFFECT",
  );
  await page
    .getByRole("button", { name: "Scene director", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Scene director", exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
