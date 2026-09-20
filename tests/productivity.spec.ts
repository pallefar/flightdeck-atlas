import { test, expect } from "@playwright/test";
import {
  examples,
  projectSchema,
  kpiProgress,
  type Project,
} from "../lib/projects";
import { portfolioPlan } from "../lib/portfolio-plan";
import { dailyAllocation, portfolioAdvice } from "../lib/advisor";
import { briefingMarkdown, localDate } from "../lib/briefing";

test("planner handles due tasks, completed projects and week boundaries; KPI validation supports reductions", () => {
  const p = {
    ...examples[0],
    dueDate: "2026-09-18",
    updatedAt: "2026-09-01",
    tasks: [{ id: "one", title: "Review", done: false, dueDate: "2026-09-16" }],
  };
  const plan = portfolioPlan(
    [
      p,
      { ...p, id: "done", status: "Completed", tasks: [] },
      { ...p, id: "archived", archived: true },
    ],
    0,
    new Date(2026, 8, 17),
  );
  expect(plan.deadlines).toHaveLength(2);
  expect(plan.overdue).toHaveLength(1);
  expect(plan.attention).toHaveLength(1);
  expect(portfolioPlan([], 1, new Date(2026, 8, 28)).days[0].key).toBe(
    "2026-10-05",
  );
  const k = {
    id: "metric",
    name: "Lead time",
    baseline: 20,
    current: 15,
    target: 10,
    objectiveId: "",
    unit: "days",
  };
  expect(kpiProgress(k)).toBe(50);
  expect(kpiProgress({ ...k, current: 8 })).toBe(100);
  expect(
    projectSchema.safeParse({ ...p, kpis: [{ ...k, baseline: 10 }] }).success,
  ).toBe(false);
  expect(
    projectSchema.safeParse({ ...p, kpis: [{ ...k, objectiveId: "missing" }] })
      .success,
  ).toBe(false);
});

test("task workflow, estimates, checklists, goals and KPI measurements persist together", async ({
  page,
}) => {
  await page.goto("/");
  const created = await page.evaluate(
    async (p) =>
      (
        (await (
          await fetch("/api/projects", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(p),
          })
        ).json()) as { project: Project }
      ).project,
    {
      ...examples[0],
      name: "Productivity QA",
      tasks: [
        {
          id: "qa-task",
          title: "Prepare decision",
          done: false,
          priority: "High",
        },
      ],
    },
  );
  expect(created.id).toBeTruthy();
  try {
    await page.reload();
    await page
      .locator(".project-card")
      .filter({ hasText: "Productivity QA" })
      .click();
    await page.getByRole("button", { name: "Task board", exact: true }).click();
    await page
      .getByLabel("Workflow for Prepare decision")
      .selectOption("blocked");
    await expect(
      page
        .locator(".task-kanban > section")
        .filter({ has: page.getByRole("heading", { name: "Blocked" }) }),
    ).toContainText("Prepare decision");
    await page.getByLabel("Edit Prepare decision").click();
    await page
      .getByLabel("Task description")
      .fill("Agree a measurable outcome with Quality.");
    await page
      .getByRole("button", { name: "Strategy & KPIs", exact: true })
      .click();
    await page.getByRole("button", { name: /Tasks ·/ }).click();
    await expect(page.getByLabel("Task description")).toHaveValue(
      "Agree a measurable outcome with Quality.",
    );
    await page.getByLabel("Estimate (minutes)").fill("45");
    await page.getByLabel("Task owner", { exact: true }).fill("Quality lead");
    await page.getByLabel("Checklist step").fill("Collect baseline");
    await page.getByRole("button", { name: "Add step", exact: true }).click();
    await page.getByRole("checkbox", { name: "Collect baseline" }).check();
    await page.getByRole("button", { name: "Save task", exact: true }).click();
    await expect(
      page.getByText("45 min estimate", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Strategy & KPIs", exact: true })
      .click();
    await page.getByRole("button", { name: "Add goal", exact: true }).click();
    await page
      .getByLabel("Goal title", { exact: true })
      .fill("Reduce handover delays");
    await page.getByLabel("Goal owner", { exact: true }).fill("Quality");
    await page.getByRole("button", { name: "Save goal", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Reduce handover delays" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Add KPI", exact: true }).click();
    await page.getByLabel("KPI name", { exact: true }).fill("Lead time");
    await page.getByLabel("Unit", { exact: true }).fill("days");
    await page.getByLabel("Baseline", { exact: true }).fill("20");
    await page.getByLabel("Current", { exact: true }).fill("15");
    await page.getByLabel("Current", { exact: true }).fill("");
    await expect(
      page.getByRole("button", { name: "Save KPI", exact: true }),
    ).toBeDisabled();
    await page.getByLabel("Current", { exact: true }).pressSequentially("-5");
    await expect(page.getByLabel("Current", { exact: true })).toHaveValue("-5");
    await page.getByLabel("Current", { exact: true }).fill("15");
    await page.getByLabel("Target", { exact: true }).fill("10");
    await page
      .getByLabel("Linked goal", { exact: true })
      .selectOption({ label: "Reduce handover delays" });
    await page.getByRole("button", { name: "Save KPI", exact: true }).click();
    await expect(
      page.getByRole("progressbar", { name: "Lead time target progress" }),
    ).toHaveAttribute("aria-valuenow", "50");
    await page.reload();
    await page
      .locator(".project-card")
      .filter({ hasText: "Productivity QA" })
      .click();
    await expect(page.getByLabel("Workflow for Prepare decision")).toHaveValue(
      "blocked",
    );
    await expect(
      page.getByText("1/1 checklist steps", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Strategy & KPIs", exact: true })
      .click();
    await expect(
      page.getByRole("progressbar", { name: "Lead time target progress" }),
    ).toHaveAttribute("aria-valuenow", "50");
    const check = await page.evaluate(async (id) => {
      const p = (
        (await (await fetch("/api/projects")).json()) as { projects: Project[] }
      ).projects.find((p: { id: string }) => p.id === id);
      if (!p?.kpis?.length || !p.activity)
        throw Error("Missing saved KPI fixture");
      const bad = await fetch(`/api/projects/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...p,
          kpis: [{ ...p.kpis[0], objectiveId: "bad" }],
        }),
      });
      return {
        task: p.tasks[0],
        status: bad.status,
        activity: p.activity.map((e: { text: string }) => e.text),
      };
    }, created.id);
    expect(check.task.estimateMinutes).toBe(45);
    expect(check.task.description).toContain("Quality");
    expect(check.status).toBe(400);
    expect(check.activity).toContain("KPI measurements updated");
  } finally {
    await page.evaluate(async (id) => {
      const p = (
        (await (await fetch("/api/projects")).json()) as { projects: Project[] }
      ).projects.find((p: { id: string }) => p.id === id);
      if (p)
        await fetch(`/api/projects/${id}?revision=${p.revision}`, {
          method: "DELETE",
        });
    }, created.id);
  }
});

test("command menu and dashboard board work on mobile without overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.getByRole("button", { name: "Board", exact: true }).click();
  await expect(page.getByLabel("Project status board")).toBeVisible();
  await page.getByLabel("Open search and commands").click();
  await page.getByLabel("Search Atlas", { exact: true }).fill("Project Eye");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Project Eye", exact: true })
    .click();
  await expect(page.locator(".sidebar")).toBeHidden();
  await page.getByLabel("Open search and commands").click();
  await page.getByLabel("Search Atlas", { exact: true }).fill("wellbeing");
  await page
    .getByRole("button", { name: "Wellbeing & focus timer", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Work well. Feel better." }),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    375,
  );
});

test("circular zoom can be stopped and respects instant motion", async ({
  page,
}) => {
  await page.goto("/?view=globe");
  await page
    .getByLabel("Zoom in", { exact: true })
    .waitFor({ state: "visible", timeout: 20000 });
  await page.getByLabel("Zoom in", { exact: true }).click();
  await expect(page.getByLabel("Camera flight")).toBeVisible();
  await page.getByRole("button", { name: "Stop flight", exact: true }).click();
  await expect(page.getByLabel("Camera flight")).toHaveCount(0);
  await page.getByLabel("Open Project Eye settings").click();
  await page
    .getByLabel("Camera & workspace journey", { exact: true })
    .selectOption("instant");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByLabel("Zoom in", { exact: true }).click();
  await expect(page.getByLabel("Camera flight")).toHaveCount(0);
});

test("advisor flags blocked tasks and declining KPIs with evidence, excluding archived work", () => {
  const p = {
    ...examples[0],
    updatedAt: "2026-09-17",
    tasks: [
      {
        id: "blocked",
        title: "Await review",
        done: false,
        workflow: "blocked" as const,
      },
    ],
    kpis: [
      {
        id: "k",
        name: "Yield",
        baseline: 80,
        current: 75,
        target: 95,
        unit: "%",
        objectiveId: "",
      },
    ],
  };
  const advice = portfolioAdvice(
    [p, { ...p, id: "archived", archived: true }],
    "2026-09-17",
  );
  expect(
    advice.watchouts.some(
      (w) =>
        w.title === "Clear the blocker" && w.evidence.includes("Await review"),
    ),
  ).toBe(true);
  expect(
    advice.watchouts.some((w) => w.title === "A KPI is behind its baseline"),
  ).toBe(true);
  expect(advice.watchouts.every((w) => w.projectId === p.id)).toBe(true);
  expect(advice.actions[0].blocked).toBe(true);
  expect(
    dailyAllocation(
      [
        {
          ...p,
          tasks: [
            {
              id: "done",
              title: "Done",
              done: true,
              plannedDate: "2026-09-17",
              completedAt: "2026-09-17T12:00:00Z",
              estimateMinutes: 60,
            },
          ],
        },
      ],
      "2026-09-17",
    ),
  ).toMatchObject({ total: 60, completed: 60 });
  expect(briefingMarkdown([p], "day", new Date(2026, 8, 17))).toContain(
    "Blocked task: Await review",
  );
});

test("Today captures tasks and plans work without moving deadlines", async ({
  page,
}) => {
  await page.goto("/");
  const fixture = {
    ...examples[0],
    name: "Today QA",
    tasks: [
      {
        id: "focus",
        title: "Review focus plan",
        done: false,
        dueDate: "2026-12-01",
        estimateMinutes: 60,
      },
    ],
  };
  const created = await page.evaluate(
    async (p) =>
      (await (
        await fetch("/api/projects", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(p),
        })
      ).json()) as { project: Project },
    fixture,
  );
  expect(created.project?.id).toBeTruthy();
  try {
    await page.reload();
    await page.getByRole("button", { name: "Archived", exact: true }).click();
    await page
      .getByRole("button", { name: "Today and advisor", exact: true })
      .click();
    await page.getByLabel("Capture project").selectOption(created.project.id);
    await page.getByLabel("Quick capture task").fill("Call project owner");
    await page
      .getByRole("button", { name: "Add to today", exact: true })
      .click();
    await expect(page.locator(".today-tasks")).toContainText(
      "Call project owner",
    );
    await page.getByRole("button", { name: "All open", exact: true }).click();
    await page
      .locator(".today-tasks article")
      .filter({ hasText: "Review focus plan" })
      .getByRole("button", { name: "Plan today", exact: true })
      .click();
    await expect(page.locator(".today-capacity strong")).toContainText("90");
    await page.reload();
    await expect(page.locator(".today-tasks")).toContainText(
      "Review focus plan",
    );
    await expect(page.locator(".ai-pending")).toContainText(
      "Awaiting FlightDeck OS",
    );
    const saved = await page.evaluate(
      async (id) =>
        (
          (await (await fetch("/api/projects")).json()) as {
            projects: Project[];
          }
        ).projects.find((p) => p.id === id),
      created.project.id,
    );
    expect(saved?.tasks[0].dueDate).toBe("2026-12-01");
    expect(saved?.tasks[0].plannedDate).toBe(localDate());
    expect(saved?.tasks[1].plannedDate).toBe(localDate());
    await page.getByLabel("Daily focus budget").selectOption("60");
    await page.getByLabel("Complete Call project owner").click();
    await expect(page.getByLabel("Complete Call project owner")).toHaveCount(0);
    await expect(page.locator(".today-capacity strong")).toContainText("90");
    await page.getByRole("tab", { name: "Dashboard", exact: true }).click();
    await page
      .getByRole("button", { name: "Today and advisor", exact: true })
      .click();
    await expect(page.getByLabel("Daily focus budget")).toHaveValue("60");
    await expect(page.locator(".today-capacity strong")).toContainText("90");
    await page.setViewportSize({ width: 375, height: 667 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(375);
  } finally {
    await page.evaluate(async (id) => {
      const p = (
        (await (await fetch("/api/projects")).json()) as { projects: Project[] }
      ).projects.find((p) => p.id === id);
      if (p)
        await fetch(`/api/projects/${id}?revision=${p.revision}`, {
          method: "DELETE",
        });
    }, created.project.id);
  }
});
