import { test, expect } from "@playwright/test";
import { projectSchema, examples, type Project } from "../lib/projects";
import {
  calculate,
  numericValue,
  emptyWork,
  criticalPath,
  reschedule,
  widgetValue,
} from "../lib/advanced-work";
const cleanup: string[] = [];
test.afterEach(async ({ page }) => {
  for (const id of cleanup.splice(0)) {
    const r = await page.request.get(`/api/projects/${id}`);
    if (r.ok()) {
      const p = (await r.json()).project;
      await page.request.delete(`/api/projects/${id}?revision=${p.revision}`);
    }
  }
});
async function create(page: any, extra: any = {}) {
  await page.goto("/");
  const r = await page.request.post("/api/projects", {
    data: {
      ...examples[0],
      name: "Studio QA " + Date.now(),
      tasks: [
        {
          id: "a",
          title: "Discovery",
          done: false,
          startDate: "2026-09-21",
          dueDate: "2026-09-22",
          estimateMinutes: 60,
          assigneeEmail: "seedy@sites.test",
        },
        {
          id: "b",
          title: "Pilot",
          done: false,
          dependsOn: ["a"],
          startDate: "2026-09-21",
          dueDate: "2026-09-23",
        },
      ],
      ...extra,
    },
  });
  expect(r.ok(), await r.text()).toBeTruthy();
  const p = (await r.json()).project;
  cleanup.push(p.id);
  return p as Project;
}
test("safe formulas, nested task constraints and generalized schedule math", () => {
  expect(calculate("[x] / ([y] - 1)", (k) => (k === "x" ? 10 : 3))).toBe(5);
  expect(calculate("globalThis.fetch('x')", () => 1)).toBeNull();
  expect(calculate("1/0", () => 1)).toBeNull();
  const fields: any[] = [
    {
      id: "value",
      name: "Value",
      type: "formula",
      formula: "[estimate] / ([rate]-1)",
      options: [],
    },
  ];
  expect(
    projectSchema.safeParse({
      ...examples[0],
      work: { ...emptyWork(), fields },
    }).success,
  ).toBeTruthy();
  const many: any[] = [
    { id: "f0", name: "Input", type: "number", formula: "", options: [] },
  ];
  for (let i = 1; i < 20; i++)
    many.push({
      id: `f${i}`,
      name: `F${i}`,
      type: "formula",
      formula: Array(8)
        .fill(`[f${i - 1}]`)
        .join("+"),
      options: [],
    });
  const start = Date.now();
  expect(
    projectSchema.safeParse({
      ...examples[0],
      work: { ...emptyWork(), fields: many },
    }).success,
  ).toBeTruthy();
  expect(
    numericValue(
      { id: "x", title: "X", done: false, customValues: { f0: 1 } },
      "f19",
      many,
    ),
  ).toBe(8 ** 19);
  expect(Date.now() - start).toBeLessThan(1000);
  expect(
    projectSchema.safeParse({
      ...examples[0],
      tasks: [
        { id: "a", title: "A", done: true },
        { id: "b", title: "B", done: false, parentId: "a" },
      ],
    }).success,
  ).toBeFalsy();
  const tasks: any[] = [
    {
      id: "a",
      title: "A",
      done: false,
      startDate: "2026-09-21",
      dueDate: "2026-09-23",
    },
    {
      id: "b",
      title: "B",
      done: false,
      startDate: "2026-09-21",
      dueDate: "2026-09-22",
      scheduleLinks: [{ taskId: "a", projectId: "", type: "FS", lag: 1 }],
    },
  ];
  const result = reschedule(tasks);
  expect(result[1].startDate).toBe("2026-09-25");
  expect(criticalPath(tasks).finish).toBe(6);
  expect(
    widgetValue(tasks, {
      id: "w",
      name: "Count",
      aggregate: "count",
      metric: "estimate",
      display: "number",
      filter: { mode: "all", conditions: [] },
    }),
  ).toBe(2);
});
test("persistent timers record once and shared blocks reject lost updates", async ({
  page,
}) => {
  const p = await create(page),
    call = (data: any) =>
      page.request.post("/api/work", { data: { ...data, projectId: p.id } }),
    token = crypto.randomUUID();
  expect(
    (await call({ action: "start-timer", taskId: "a", token })).ok(),
  ).toBeTruthy();
  expect(
    (
      await call({
        action: "start-timer",
        taskId: "a",
        token: crypto.randomUUID(),
      })
    ).status(),
  ).toBe(409);
  expect((await call({ action: "stop-timer", token })).ok()).toBeTruthy();
  expect((await call({ action: "stop-timer", token })).ok()).toBeTruthy();
  let current = (await (await page.request.get(`/api/projects/${p.id}`)).json())
    .project;
  expect(current.tasks[0].timeEntries).toHaveLength(1);
  const block = crypto.randomUUID();
  expect(
    (
      await call({
        action: "block",
        id: block,
        revision: 0,
        data: { title: "Shared note", body: "First" },
      })
    ).ok(),
  ).toBeTruthy();
  expect(
    (
      await call({
        action: "block",
        id: block,
        revision: 1,
        data: { title: "Shared note", body: "Second" },
      })
    ).ok(),
  ).toBeTruthy();
  expect(
    (
      await call({
        action: "block",
        id: block,
        revision: 1,
        data: { title: "Shared note", body: "Lost" },
      })
    ).status(),
  ).toBe(409);
  const another = crypto.randomUUID();
  expect(
    (
      await call({
        action: "block",
        id: another,
        revision: 0,
        data: { title: "Independent", body: "Concurrent block" },
      })
    ).ok(),
  ).toBeTruthy();
  const body = await (
    await page.request.get(`/api/work?project=${p.id}`)
  ).json();
  expect(body.records.find((r: any) => r.id === block).data.body).toBe(
    "Second",
  );
});
test("intake approval is idempotent, applies creation rules, and reminders cancel permanently", async ({
  page,
}) => {
  let p = await create(page, {
    tasks: [{ id: "a", title: "Scope", done: false, dueDate: "2026-10-01" }],
    work: {
      ...emptyWork(),
      rules: [
        {
          id: "created-rule",
          name: "Intake priority",
          enabled: true,
          trigger: "created",
          conditions: { mode: "all", conditions: [] },
          action: "priority",
          value: "High",
        },
      ],
    },
  });
  const call = (data: any) =>
      page.request.post("/api/work", { data: { ...data, projectId: p.id } }),
    formId = crypto.randomUUID(),
    requestId = crypto.randomUUID();
  expect(
    (
      await call({
        action: "form",
        id: formId,
        revision: 0,
        data: {
          title: "Request",
          description: "",
          reviewer: "seedy@sites.test",
          enabled: true,
          questions: ["Why?"],
        },
      })
    ).ok(),
  ).toBeTruthy();
  expect(
    (
      await call({
        action: "submit-request",
        id: requestId,
        formId,
        title: "Intake task",
        description: "Outcome",
        answers: ["Benefit"],
      })
    ).ok(),
  ).toBeTruthy();
  const review = {
    action: "review-request",
    id: requestId,
    revision: 1,
    decision: "task",
    reason: "Agreed",
  };
  expect((await call(review)).ok()).toBeTruthy();
  expect((await call(review)).status()).toBe(409);
  p = (await (await page.request.get(`/api/projects/${p.id}`)).json()).project;
  expect(p.tasks.filter((t) => t.title === "Intake task")).toHaveLength(1);
  expect(p.tasks.find((t) => t.title === "Intake task")?.priority).toBe("High");
  const reminder = crypto.randomUUID();
  expect(
    (
      await call({
        action: "reminder",
        id: reminder,
        taskId: "a",
        at: new Date(Date.now() + 3600000).toISOString(),
        timezone: "Europe/Warsaw",
      })
    ).ok(),
  ).toBeTruthy();
  let r = await page.request.put(`/api/projects/${p.id}`, {
    data: {
      ...p,
      tasks: p.tasks.map((t) => (t.id === "a" ? { ...t, done: true } : t)),
    },
  });
  expect(r.ok(), await r.text()).toBeTruthy();
  p = (await r.json()).project;
  r = await page.request.put(`/api/projects/${p.id}`, {
    data: {
      ...p,
      tasks: p.tasks.map((t) => (t.id === "a" ? { ...t, done: false } : t)),
    },
  });
  expect(r.ok()).toBeTruthy();
  const work = await (
    await page.request.get(`/api/work?project=${p.id}`)
  ).json();
  expect(work.records.some((r: any) => r.id === reminder)).toBeFalsy();
});
test("cross-project moves are atomic and cross-project cycles are rejected", async ({
  page,
}) => {
  let a = await create(page, {
      tasks: [{ id: "one", title: "Movable", done: false }],
    }),
    b = await create(page, { tasks: [] });
  let r = await page.request.post("/api/work/transfer", {
    data: {
      source: a.id,
      target: b.id,
      sourceRevision: a.revision,
      targetRevision: b.revision + 1,
      ids: ["one"],
    },
  });
  expect(r.status()).toBe(409);
  expect(
    (await (await page.request.get(`/api/projects/${a.id}`)).json()).project
      .tasks,
  ).toHaveLength(1);
  r = await page.request.post("/api/work/transfer", {
    data: {
      source: a.id,
      target: b.id,
      sourceRevision: a.revision,
      targetRevision: b.revision,
      ids: ["one"],
    },
  });
  expect(r.ok(), await r.text()).toBeTruthy();
  a = (await (await page.request.get(`/api/projects/${a.id}`)).json()).project;
  b = (await (await page.request.get(`/api/projects/${b.id}`)).json()).project;
  expect(a.tasks).toHaveLength(0);
  expect(b.tasks).toHaveLength(1);
  r = await page.request.put(`/api/projects/${a.id}`, {
    data: {
      ...a,
      tasks: [
        {
          id: "two",
          title: "Linked",
          done: false,
          scheduleLinks: [
            { projectId: b.id, taskId: "one", type: "SS", lag: 0 },
          ],
        },
      ],
    },
  });
  expect(r.ok(), await r.text()).toBeTruthy();
  a = (await r.json()).project;
  r = await page.request.put(`/api/projects/${b.id}`, {
    data: {
      ...b,
      tasks: [
        {
          ...b.tasks[0],
          scheduleLinks: [
            { projectId: a.id, taskId: "two", type: "SS", lag: 0 },
          ],
        },
      ],
    },
  });
  expect(r.status()).toBe(400);
});
test("work studio UI saves fields, reports, shared notes and works on mobile", async ({
  page,
}) => {
  const p = await create(page);
  await page.goto(`/?project=${p.id}`);
  const dialog = page.getByRole("dialog");
  await dialog
    .getByRole("button", { name: "Work studio", exact: true })
    .click();
  await dialog.getByLabel("Field name", { exact: true }).fill("Impact");
  await dialog
    .getByRole("combobox", { name: "Field type", exact: true })
    .selectOption("number");
  await dialog
    .getByRole("button", { name: "Create field", exact: true })
    .click();
  await expect(
    dialog.getByText("number · [impact]", { exact: true }),
  ).toBeVisible();
  await dialog.getByRole("tab", { name: "Reports", exact: true }).click();
  await dialog.getByLabel("Widget name", { exact: true }).fill("Open work");
  await dialog
    .getByRole("combobox", { name: "Calculation", exact: true })
    .selectOption("count");
  await dialog.getByRole("button", { name: "Add dashboard widget" }).click();
  await expect(dialog.locator(".report-widget")).toHaveCount(1);
  await dialog.getByRole("tab", { name: "Live notes", exact: true }).click();
  await dialog
    .getByLabel("Block title", { exact: true })
    .fill("Launch context");
  await dialog
    .getByLabel("Shared note", { exact: true })
    .fill("A shared working note.");
  await dialog
    .getByRole("button", { name: "Add note block", exact: true })
    .click();
  await expect(
    dialog.getByText("A shared working note.", { exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 375, height: 900 });
  await dialog
    .getByRole("combobox", { name: "Work studio tool", exact: true })
    .selectOption("schedule");
  await expect(
    dialog.getByRole("heading", { name: "See the chain. Protect the finish." }),
  ).toBeVisible();
  const overflow = await dialog.evaluate(
    (el) => el.scrollWidth > el.clientWidth + 2,
  );
  expect(overflow).toBeFalsy();
  await page.screenshot({
    path: "/private/tmp/atlas-studio-mobile.png",
    fullPage: true,
  });
});
test("versioned playbooks preserve target progress and update reviewed task definitions", async ({
  page,
}) => {
  let source = await create(page, {
      tasks: [
        {
          id: "source-task",
          title: "Source task",
          description: "Before",
          done: false,
          estimateMinutes: 45,
        },
      ],
    }),
    target = await create(page, { tasks: [] });
  const id = crypto.randomUUID(),
    call = (data: any) =>
      page.request.post("/api/work", {
        data: { ...data, projectId: source.id },
      });
  expect(
    (
      await call({
        action: "template-save",
        id,
        revision: 0,
        projectRevision: source.revision,
        name: "Reusable pilot",
      })
    ).ok(),
  ).toBeTruthy();
  let response = await call({
    action: "template-apply",
    id,
    revision: 1,
    targetId: target.id,
    targetRevision: target.revision,
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  target = (await (await page.request.get(`/api/projects/${target.id}`)).json())
    .project;
  expect(target.tasks).toHaveLength(1);
  expect(target.tasks[0].templateRef?.version).toBe(1);
  response = await page.request.put(`/api/projects/${target.id}`, {
    data: {
      ...target,
      tasks: target.tasks.map((t) => ({
        ...t,
        done: true,
        dueDate: "2026-10-20",
      })),
    },
  });
  target = (await response.json()).project;
  response = await page.request.put(`/api/projects/${source.id}`, {
    data: {
      ...source,
      tasks: source.tasks.map((t) => ({
        ...t,
        title: "Updated source",
        estimateMinutes: 90,
      })),
    },
  });
  source = (await response.json()).project;
  expect(
    (
      await call({
        action: "template-save",
        id,
        revision: 1,
        projectRevision: source.revision,
        name: "Reusable pilot",
      })
    ).ok(),
  ).toBeTruthy();
  expect(
    (
      await call({
        action: "template-apply",
        id,
        revision: 2,
        targetId: target.id,
        targetRevision: target.revision,
      })
    ).ok(),
  ).toBeTruthy();
  target = (await (await page.request.get(`/api/projects/${target.id}`)).json())
    .project;
  expect(target.tasks).toHaveLength(1);
  expect(target.tasks[0]).toMatchObject({
    done: true,
    dueDate: "2026-10-20",
    title: "Updated source",
    estimateMinutes: 90,
    templateRef: { version: 2 },
  });
});
test("simultaneous linked-project edits cannot create a dependency cycle", async ({
  page,
}) => {
  const a = await create(page, {
      tasks: [{ id: "one", title: "A", done: false }],
    }),
    b = await create(page, { tasks: [{ id: "two", title: "B", done: false }] });
  const responses = await Promise.all([
    page.request.put(`/api/projects/${a.id}`, {
      data: {
        ...a,
        tasks: [
          {
            ...a.tasks[0],
            scheduleLinks: [
              { projectId: b.id, taskId: "two", type: "SS", lag: 0 },
            ],
          },
        ],
      },
    }),
    page.request.put(`/api/projects/${b.id}`, {
      data: {
        ...b,
        tasks: [
          {
            ...b.tasks[0],
            scheduleLinks: [
              { projectId: a.id, taskId: "one", type: "SS", lag: 0 },
            ],
          },
        ],
      },
    }),
  ]);
  expect(responses.filter((r) => r.ok())).toHaveLength(1);
  expect(
    responses.some((r) => r.status() === 409 || r.status() === 400),
  ).toBeTruthy();
});
test("task transfer preserves completed recurrence and blocks running timers or currency changes", async ({
  page,
}) => {
  let source = await create(page, {
      tasks: [
        {
          id: "repeat",
          title: "Weekly check",
          done: false,
          recurrence: "weekly",
        },
      ],
    }),
    target = await create(page, { tasks: [] });
  const token = crypto.randomUUID();
  let r = await page.request.post("/api/work", {
    data: {
      projectId: source.id,
      action: "start-timer",
      taskId: "repeat",
      token,
    },
  });
  expect(r.ok()).toBeTruthy();
  const move = () =>
    page.request.post("/api/work/transfer", {
      data: {
        source: source.id,
        target: target.id,
        sourceRevision: source.revision,
        targetRevision: target.revision,
        ids: ["repeat"],
      },
    });
  expect((await move()).status()).toBe(400);
  expect(
    (
      await page.request.post("/api/work", {
        data: { action: "discard-timer", token },
      })
    ).ok(),
  ).toBeTruthy();
  r = await page.request.put(`/api/projects/${source.id}`, {
    data: { ...source, tasks: [{ ...source.tasks[0], done: true }] },
  });
  expect(r.ok()).toBeTruthy();
  source = (await r.json()).project;
  expect(source.tasks).toHaveLength(2);
  const at = source.tasks[0].completedAt;
  r = await move();
  expect(r.ok(), await r.text()).toBeTruthy();
  target = (await (await page.request.get(`/api/projects/${target.id}`)).json())
    .project;
  expect(target.tasks).toHaveLength(1);
  expect(target.tasks[0].completedAt).toBe(at);
  const euro = await create(page, {
      tasks: [{ id: "rate", title: "Billed", done: false, hourlyRate: 100 }],
    }),
    usd = await create(page, {
      tasks: [],
      budget: { currency: "USD", approved: null, forecast: null, actual: null },
    });
  r = await page.request.post("/api/work/transfer", {
    data: {
      source: euro.id,
      target: usd.id,
      sourceRevision: euro.revision,
      targetRevision: usd.revision,
      ids: ["rate"],
    },
  });
  expect(r.status()).toBe(400);
  expect((await r.json()).error).toContain("currencies");
});
test("capacity drafts keep their original revision through automatic refresh", async ({
  page,
}) => {
  await page.goto("/?view=team");
  const initial = await (await page.request.get("/api/workspace")).json();
  try {
    await page.getByRole("button", { name: "Capacity", exact: true }).click();
    const hours = page.getByLabel("Hours per working week", { exact: true });
    await hours.fill("37");
    const update = await page.request.post("/api/workspace", {
      data: {
        action: "preferences",
        revision: initial.preferenceRevision,
        data: { ...initial.preferences, weeklyHours: 32 },
      },
    });
    expect(update.ok()).toBeTruthy();
    const refresh = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/workspace") && r.request().method() === "GET",
    );
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await refresh;
    await expect(hours).toHaveValue("37");
    await page
      .getByRole("button", { name: "Save capacity", exact: true })
      .click();
    await expect(
      page.getByText("Preferences changed. Reload and try again.", {
        exact: true,
      }),
    ).toBeVisible();
    const latest = await (await page.request.get("/api/workspace")).json();
    expect(latest.preferences.weeklyHours).toBe(32);
    await page
      .getByRole("button", { name: "Discard capacity changes" })
      .click();
    await expect(hours).toHaveValue("32");
  } finally {
    const current = await (await page.request.get("/api/workspace")).json();
    await page.request.post("/api/workspace", {
      data: {
        action: "preferences",
        revision: current.preferenceRevision,
        data: initial.preferences,
      },
    });
  }
});
