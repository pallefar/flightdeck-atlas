import { test, expect } from "@playwright/test";
import { examples, projectSchema, type Project } from "../lib/projects";
import {
  applyWorkRules,
  filteredTasks,
  stampTimeEntries,
  loggedMinutes,
  scheduleConflicts,
} from "../lib/work-management";
import { leadershipReview } from "../lib/leadership";
import { localDate } from "../lib/briefing";
const cleanup: string[] = [];
test.afterEach(async ({ page }) => {
  const api = page.context().request;
  for (const id of cleanup.splice(0)) {
    const response = await api.get(`/api/projects/${id}`);
    if (response.ok()) {
      const p = (await response.json()).project;
      await api.delete(`/api/projects/${id}?revision=${p.revision}`);
    }
  }
});
const seed: Project = {
  ...examples[0],
  name: "Work management QA",
  tasks: [
    {
      id: "scope",
      title: "Agree scope",
      done: false,
      priority: "High",
      assigneeEmail: "seedy@sites.test",
      startDate: "2026-09-20",
      dueDate: "2026-09-23",
      estimateMinutes: 60,
      group: "Discover",
    },
    {
      id: "build",
      title: "Build pilot",
      done: false,
      dependsOn: ["scope"],
      startDate: "2026-09-22",
      dueDate: "2026-09-28",
      group: "Execute",
    },
    {
      id: "launch",
      title: "Launch review",
      done: false,
      dependsOn: ["build"],
      dueDate: "2026-09-30",
      milestone: true,
    },
    { id: "followup", title: "Follow up with sponsor", done: false },
  ],
  automations: { readyToDoing: true, blockedToHigh: true },
};
test("role reviews use evidence and recipes enforce transition semantics", () => {
  const next = applyWorkRules(
    {
      ...seed,
      tasks: seed.tasks.map((t) =>
        t.id === "scope" ? { ...t, done: true } : t,
      ),
    },
    seed,
  );
  expect(next.fields.tasks.find((t) => t.id === "build")?.workflow).toBe(
    "doing",
  );
  expect(next.applied).toHaveLength(1);
  expect(
    applyWorkRules(next.fields, { ...seed, ...next.fields }).applied,
  ).toHaveLength(0);
  const blocked = applyWorkRules(
    {
      ...seed,
      tasks: seed.tasks.map((t) =>
        t.id === "followup" ? { ...t, workflow: "blocked" as const } : t,
      ),
    },
    seed,
  );
  expect(blocked.fields.tasks.find((t) => t.id === "followup")?.priority).toBe(
    "High",
  );
  expect(
    applyWorkRules(
      {
        ...blocked.fields,
        automations: { readyToDoing: false, blockedToHigh: false },
      },
      seed,
    ).applied,
  ).toHaveLength(0);
  expect(
    projectSchema.safeParse({
      ...seed,
      tasks: [{ ...seed.tasks[0], startDate: "2026-09-25" }],
    }).success,
  ).toBe(false);
  expect(scheduleConflicts(seed)).toHaveLength(1);
  expect(
    projectSchema.safeParse({
      ...seed,
      tasks: [{ ...seed.tasks[0], startDate: "2026-99-20" }],
    }).success,
  ).toBe(false);
  const large = {
    ...seed,
    objectives: Array.from({ length: 30 }, (_, i) => ({
      id: `goal${i}`,
      title: "Goal".repeat(50),
      description: "",
      owner: "",
      dueDate: "",
      status: "Planned" as const,
    })),
    kpis: Array.from({ length: 40 }, (_, i) => ({
      id: `kpi${i}`,
      name: "K".repeat(100),
      unit: "U".repeat(30),
      baseline: 0,
      current: 20,
      target: 100,
      objectiveId: "",
    })),
  };
  const largeReview = leadershipReview(large, "VP", "gate", "2026-09-25");
  expect(largeReview.text.length).toBeLessThanOrEqual(12000);
  expect(largeReview.items.every((x) => x.evidence.length < 1000)).toBe(true);

  const review = leadershipReview(
    {
      ...seed,
      budget: { currency: "EUR", approved: 100, forecast: 130, actual: null },
    },
    "CEO",
    "now",
    "2026-09-25",
  );
  expect(review.posture).toBe("Intervention to consider");
  expect(review.text).toContain("EUR 130");
  expect(review.gaps).toContain("Sponsor");
  expect(
    leadershipReview(seed, "Director", "gate", "2026-09-25").text,
  ).toContain("Agree scope (2026-09-23)");
  expect(leadershipReview(seed, "VP", "week", "2026-09-25").text).toContain(
    "This review covers this project only",
  );
  expect(
    filteredTasks(
      seed,
      {
        layout: "table",
        query: "",
        filter: "overdue",
        group: "Discover",
        sort: "due",
        owner: "seedy@sites.test",
        priority: "High",
        state: "",
      },
      "2026-09-25",
      "seedy@sites.test",
    ).map((t) => t.id),
  ).toEqual(["scope"]);
  expect(() =>
    stampTimeEntries(
      {
        ...seed,
        tasks: [
          {
            ...seed.tasks[0],
            timeEntries: [
              { id: "t", date: "2099-01-01", minutes: 20, note: "" },
            ],
          },
        ],
      },
      undefined,
      "actual@test.example",
    ),
  ).toThrow();
  const stamped = stampTimeEntries(
    {
      ...seed,
      tasks: [
        {
          ...seed.tasks[0],
          timeEntries: [
            {
              id: "t",
              date: "2026-09-01",
              minutes: 20,
              note: "Work",
              author: "forged",
            },
          ],
        },
      ],
    },
    undefined,
    "actual@test.example",
  );
  expect(stamped.tasks[0].timeEntries?.[0].author).toBe("actual@test.example");
  expect(loggedMinutes(stamped.tasks[0])).toBe(20);
});
test("work management persists dates, views, effort and exactly-once recipe effects", async ({
  page,
}) => {
  await page.goto("/");
  const api = page.context().request;
  const create = await api.post("/api/projects", {
    data: { ...seed, name: `Gauntlet API ${Date.now()}` },
  });
  expect(create.status()).toBe(201);
  let p = (await create.json()).project;
  cleanup.push(p.id);
  try {
    const payload = {
      ...p,
      tasks: p.tasks.map((t: any) =>
        t.id === "scope"
          ? {
              ...t,
              done: true,
              timeEntries: [
                {
                  id: "time-1",
                  date: localDate(),
                  minutes: 45,
                  note: "Scope review",
                  author: "forged",
                },
              ],
            }
          : t,
      ),
      budget: {
        currency: "EUR",
        approved: 10000,
        forecast: 12000,
        actual: 3000,
      },
      taskViews: [
        {
          id: "view1",
          name: "High discovery",
          layout: "table",
          query: "",
          filter: "all",
          group: "Discover",
          sort: "due",
          owner: "",
          priority: "High",
          state: "",
        },
      ],
    };
    const result = await api.put(`/api/projects/${p.id}`, { data: payload });
    expect(result.status()).toBe(200);
    p = (await result.json()).project;
    expect(p.tasks.find((t: any) => t.id === "build").workflow).toBe("doing");
    expect(p.tasks[0].timeEntries[0].author).toBe("seedy@sites.test");
    expect(
      p.activity.filter((e: any) => e.text.startsWith("Automation:")),
    ).toHaveLength(1);
    expect(
      (await api.put(`/api/projects/${p.id}`, { data: payload })).status(),
    ).toBe(409);
    const retry = await api.put(`/api/projects/${p.id}`, { data: p });
    p = (await retry.json()).project;
    expect(
      p.activity.filter((e: any) => e.text.startsWith("Automation:")),
    ).toHaveLength(1);
    expect(p.taskViews[0].name).toBe("High discovery");
    const before = p.revision;
    expect(
      (
        await api.put(`/api/projects/${p.id}`, {
          data: {
            ...p,
            tasks: p.tasks.map((t: any) =>
              t.id === "scope" ? { ...t, startDate: "2026-10-01" } : t,
            ),
          },
        })
      ).status(),
    ).toBe(400);
    expect(
      (await (await api.get(`/api/projects/${p.id}`)).json()).project.revision,
    ).toBe(before);
  } finally {
  }
});
test("table, timeline, leadership actions and time correction work on desktop and mobile", async ({
  page,
}) => {
  test.setTimeout(45000);
  await page.goto("/");
  const api = page.context().request;
  const create = await api.post("/api/projects", {
    data: { ...seed, name: `Gauntlet UI ${Date.now()}` },
  });
  let p = (await create.json()).project;
  cleanup.push(p.id);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    await page.goto(`/?project=${p.id}`);
    const dialog = page.locator(".management-page");
    const nav = page.getByRole("navigation");
    await expect(dialog).toBeVisible();
    await dialog
      .getByRole("button", { name: "Task table", exact: true })
      .click();
    await dialog.getByLabel("Select Agree scope", { exact: true }).check();
    await dialog
      .getByRole("combobox", { name: "Bulk change", exact: true })
      .selectOption("group");
    await dialog.getByLabel("New value", { exact: true }).fill("Discovery");
    await dialog.getByRole("button", { name: "Apply to 1 tasks" }).click();
    await expect(dialog.getByText("0 selected", { exact: true })).toBeVisible();
    await dialog.getByText("Refine & save this view", { exact: true }).click();
    await dialog
      .getByLabel("View name", { exact: true })
      .fill("My review table");
    await dialog
      .getByRole("button", { name: "Save view", exact: true })
      .click();
    await expect(
      dialog.getByRole("button", { name: "My review table", exact: true }),
    ).toBeVisible();
    await dialog.getByRole("button", { name: "Timeline", exact: true }).click();
    await expect(
      dialog.getByText("Dependency schedule conflicts", { exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: "/private/tmp/atlas-monday-timeline.png",
      fullPage: true,
    });
    await dialog
      .getByRole("button", { name: "Timeline task Agree scope", exact: true })
      .click();
    await dialog.getByLabel("Minutes worked", { exact: true }).fill("30");
    await dialog
      .getByLabel("Session note", { exact: true })
      .fill("Baseline review");
    await dialog
      .getByRole("button", { name: "Add time entry to draft" })
      .click();
    await dialog
      .getByRole("button", { name: "Save task", exact: true })
      .click();
    await dialog
      .getByRole("button", { name: "Timeline task Agree scope", exact: true })
      .click();
    await dialog.getByRole("button", { name: /Correct time entry/ }).click();
    await dialog.getByLabel("Minutes worked", { exact: true }).fill("40");
    await expect(
      dialog.getByRole("button", { name: "Save task", exact: true }),
    ).toBeDisabled();
    await dialog.getByRole("button", { name: "Apply time correction" }).click();
    await dialog
      .getByRole("button", { name: "Save task", exact: true })
      .click();
    p = (await (await api.get(`/api/projects/${p.id}`)).json()).project;
    expect(p.tasks[0].timeEntries).toHaveLength(1);
    expect(p.tasks[0].timeEntries[0].minutes).toBe(40);
    await nav
      .getByRole("button", { name: "Delivery & budget", exact: true })
      .click();
    await dialog.getByLabel("Approved budget", { exact: true }).fill("5000");
    await dialog
      .getByLabel("Forecast total cost", { exact: true })
      .fill("6000");
    await dialog
      .getByRole("button", { name: "Save budget", exact: true })
      .click();
    await expect(
      dialog.getByRole("button", { name: "Save budget", exact: true }),
    ).toBeDisabled();
    await nav
      .getByRole("button", { name: "Think like a CEO", exact: true })
      .click();
    await expect(
      dialog.getByText("Intervention to consider", { exact: true }),
    ).toBeVisible();
    await dialog
      .getByRole("button", { name: "Review & add action", exact: true })
      .first()
      .click();
    await dialog
      .getByRole("button", { name: "Add reviewed action", exact: true })
      .click();
    await expect(
      dialog.getByRole("button", {
        name: "Action already captured",
        exact: true,
      }),
    ).toBeDisabled();
    await dialog
      .getByRole("button", { name: "Save review snapshot", exact: true })
      .click();
    await expect(
      dialog.getByText("Saved reviews · 1", { exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: "/private/tmp/atlas-monday-leadership.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 375, height: 812 });
    await dialog
      .getByRole("button", { name: "Think like a Director", exact: true })
      .click();
    await page.screenshot({
      path: "/private/tmp/atlas-monday-mobile.png",
      fullPage: true,
    });
    expect(
      await dialog.evaluate((e) => e.scrollWidth <= e.clientWidth + 1),
    ).toBe(true);
    await page.goto(`/?project=${p.id}`);
    await page.getByRole("button", { name: "Open navigation" }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Think like a CEO", exact: true })
      .click();
    await expect(
      page.getByText("Saved reviews · 1", { exact: true }),
    ).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
  }
});
test("Eat the Frog persists a private plan, reserves time and starts the real focus timer", async ({
  page,
}) => {
  await page.goto("/");
  const api = page.context().request;
  const before = (await (await api.get("/api/workspace")).json()).preferences;
  const create = await api.post("/api/projects", {
    data: {
      ...seed,
      name: `Frog QA ${Date.now()}`,
      tasks: [
        {
          id: "frog",
          title: "Write the difficult decision brief",
          done: false,
          priority: "High",
        },
      ],
    },
  });
  const p = (await create.json()).project;
  cleanup.push(p.id);
  try {
    await page.goto("/?view=today");
    await page
      .getByRole("button", {
        name: /Choose today’s frog|Choose or change frog/,
      })
      .click();
    await page
      .getByLabel("Your most important difficult task")
      .selectOption(`${p.id}/frog`);
    await page
      .getByLabel("Make the first step small")
      .fill("Write the three decisions we need");
    await page.getByLabel("Focus minutes", { exact: true }).fill("45");
    await page
      .getByRole("button", { name: "Save today’s frog", exact: true })
      .click();
    await expect(page.locator(".frog-commitment")).toContainText(
      "Write the three decisions",
    );
    await expect(page.locator(".today-capacity")).toContainText(
      "45 additional minutes",
    );
    await page.reload();
    await expect(page.locator(".frog-commitment")).toContainText(
      "Write the three decisions",
    );
    await page
      .getByRole("button", { name: "Start frog focus", exact: true })
      .click();
    await expect(page.locator(".topbar-right .focus-badge")).toContainText(
      "44:",
    );
    await page.screenshot({
      path: "/private/tmp/atlas-monday-frog.png",
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Mark frog complete", exact: true })
      .click();
    await expect(
      page.getByRole("heading", {
        name: "Your frog is done. Keep the momentum.",
      }),
    ).toBeVisible();
    expect(
      (await (await api.get(`/api/projects/${p.id}`)).json()).project.tasks[0]
        .done,
    ).toBe(true);
  } finally {
    test.setTimeout(test.info().timeout + 10000);
    const w = await (await api.get("/api/workspace")).json();
    await api.post("/api/workspace", {
      data: {
        action: "preferences",
        revision: w.preferenceRevision,
        data: before,
      },
    });
    const latest = (await (await api.get(`/api/projects/${p.id}`)).json())
      .project;
    await api.delete(`/api/projects/${p.id}?revision=${latest.revision}`);
  }
});
