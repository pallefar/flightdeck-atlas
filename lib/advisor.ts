import { localDate } from "./briefing";
import { projectSignals } from "./project-scan";
import type { Project } from "./projects";
export type Watchout = {
  id: string;
  projectId: string;
  severity: "high" | "medium";
  title: string;
  evidence: string;
  action: string;
};
export function portfolioAdvice(projects: Project[], today = localDate()) {
  const live = projects.filter((p) => !p.archived && p.status !== "Completed");
  const watchouts: Watchout[] = [];
  for (const p of live) {
    const s = projectSignals(p, today);
    const add = (
      key: string,
      title: string,
      evidence: string,
      action: string,
      severity: Watchout["severity"] = "medium",
    ) =>
      watchouts.push({
        id: `${p.id}:${key}`,
        projectId: p.id,
        severity,
        title,
        evidence,
        action,
      });
    const blocked = p.tasks.filter((t) => !t.done && t.workflow === "blocked");
    if (s.blocked)
      add(
        "blocked",
        "Clear the blocker",
        p.blocker ||
          `${blocked.length} tasks marked Blocked: ${blocked
            .map((t) => t.title)
            .slice(0, 3)
            .join(", ")}`,
        "Agree an unblock action and an accountable owner.",
        "high",
      );
    if (s.late || s.overdue)
      add(
        "overdue",
        "Recover overdue work",
        `${s.overdue} overdue tasks${s.late ? `; project target ${p.dueDate} has passed` : ""}.`,
        "Review scope and owners before agreeing a new delivery date.",
        "high",
      );
    const unassigned = p.tasks.filter((t) => !t.done && !t.assignee?.trim());
    if (unassigned.length)
      add(
        "owner",
        "Assign the next hand-off",
        `${unassigned.length} open tasks have no named owner.`,
        "Assign an owner to the highest-priority action.",
      );
    const stale = new Date(`${today}T12:00:00`);
    stale.setDate(stale.getDate() - 7);
    if (p.updatedAt.slice(0, 10) < localDate(stale))
      add(
        "stale",
        "Check whether the plan changed",
        `Last project update: ${p.updatedAt.slice(0, 10)}.`,
        "Record a short progress update and confirm the next action.",
      );
    if (!p.tasks.some((t) => !t.done) && !p.nextAction?.trim())
      add(
        "next",
        "Define the next action",
        "This active project has no open tasks or recorded next action.",
        "Break the desired outcome into one concrete next step.",
      );
    for (const k of p.kpis || [])
      if ((k.current - k.baseline) / (k.target - k.baseline) < 0)
        add(
          `kpi:${k.id}`,
          "A KPI is behind its baseline",
          `${k.name}: ${k.current} ${k.unit}, baseline ${k.baseline}, target ${k.target}.`,
          "Validate the measurement and agree a corrective experiment.",
        );
  }
  watchouts.sort(
    (a, b) => Number(b.severity === "high") - Number(a.severity === "high"),
  );
  const actions = live.flatMap((p) =>
    p.tasks
      .filter((t) => !t.done)
      .map((t) => ({
        p,
        t,
        blocked: t.workflow === "blocked" || !!p.blocker?.trim(),
        reason:
          t.dueDate && t.dueDate < today
            ? `Overdue since ${t.dueDate}`
            : t.plannedDate && t.plannedDate <= today
              ? t.plannedDate === today
                ? "Planned for today"
                : `Carried from ${t.plannedDate}`
              : t.dueDate === today
                ? "Due today"
                : t.priority === "High" || p.priority === "High"
                  ? "High priority"
                  : t.dueDate
                    ? `Due ${t.dueDate}`
                    : "No deadline recorded",
      })),
  );
  actions.sort(
    (a, b) =>
      Number(a.blocked) - Number(b.blocked) ||
      Number(!!b.t.dueDate && b.t.dueDate < today) -
        Number(!!a.t.dueDate && a.t.dueDate < today) ||
      Number(b.t.plannedDate === today || b.t.dueDate === today) -
        Number(a.t.plannedDate === today || a.t.dueDate === today) ||
      Number(b.t.priority === "High" || b.p.priority === "High") -
        Number(a.t.priority === "High" || a.p.priority === "High") ||
      (a.t.dueDate || "9999").localeCompare(b.t.dueDate || "9999"),
  );
  return { watchouts, actions };
}

export function dailyAllocation(projects: Project[], today = localDate()) {
  const tasks = projects
    .flatMap((p) => p.tasks.filter((t) => !p.archived || t.done))
    .filter(
      (t) =>
        t.plannedDate === today &&
        (!t.done ||
          (!!t.completedAt && localDate(new Date(t.completedAt)) === today)),
    );
  return {
    total: tasks.reduce((n, t) => n + (t.estimateMinutes || 30), 0),
    completed: tasks
      .filter((t) => t.done)
      .reduce((n, t) => n + (t.estimateMinutes || 30), 0),
    missing: tasks.filter((t) => !t.estimateMinutes).length,
  };
}
