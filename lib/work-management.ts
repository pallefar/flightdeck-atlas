import { matchesFilter } from "./advanced-work";
import {
  taskBlocked,
  type ProjectFields,
  type Project,
  type Task,
} from "./projects";
import type { TaskView } from "./work-model";
export function loggedMinutes(t: Task) {
  return (t.timeEntries || []).reduce((n, e) => n + e.minutes, 0);
}
export function stampTimeEntries(
  fields: ProjectFields,
  previous: Project | undefined,
  author: string,
  now = Date.now(),
) {
  // Allow the current local day anywhere on Earth; clients also cap the date to their local today.
  const latestDay = new Date(now + 14 * 3600000).toISOString().slice(0, 10);
  for (const task of fields.tasks) {
    const old = previous?.tasks.find((t) => t.id === task.id);
    task.timeEntries = task.timeEntries?.map((entry) => {
      const parsed = new Date(`${entry.date}T12:00:00Z`);
      if (
        !Number.isFinite(parsed.getTime()) ||
        parsed.toISOString().slice(0, 10) !== entry.date ||
        entry.date > latestDay
      )
        throw Error("Use a valid work date on or before today.");
      const before = old?.timeEntries?.find((e) => e.id === entry.id);
      const unchanged =
        before &&
        before.date === entry.date &&
        before.minutes === entry.minutes &&
        before.note === entry.note;
      return { ...entry, author: unchanged ? before.author || author : author };
    });
  }
  return fields;
}
export function applyWorkRules(fields: ProjectFields, previous: Project) {
  const applied: string[] = [];
  const tasks = fields.tasks.map((t) => {
    const old = previous.tasks.find((x) => x.id === t.id);
    if (!old || t.done) return t;
    const next = { ...t };
    if (
      fields.automations?.blockedToHigh &&
      t.workflow === "blocked" &&
      old.workflow !== "blocked" &&
      t.priority !== "High"
    ) {
      next.priority = "High";
      applied.push(`Blocked → High priority: ${t.title}`);
    }
    if (
      fields.automations?.readyToDoing &&
      (t.dependsOn?.length || 0) > 0 &&
      taskBlocked(old, previous) &&
      !taskBlocked(t, fields) &&
      (!t.workflow || t.workflow === "todo")
    ) {
      next.workflow = "doing";
      applied.push(`Prerequisites complete → Doing: ${t.title}`);
    }
    return next;
  });
  return { fields: { ...fields, tasks }, applied };
}
export function filteredTasks(
  p: Project,
  view: Omit<TaskView, "id" | "name">,
  today: string,
  myEmail: string,
) {
  const rows = p.tasks.filter(
    (t) =>
      !t.archived &&
      matchesFilter(t, view.advanced, p.work?.fields) &&
      `${t.title} ${t.assignee || ""} ${t.description || ""}`
        .toLowerCase()
        .includes(view.query.toLowerCase()) &&
      (!view.group || t.group === view.group) &&
      (!view.owner ||
        t.assigneeEmail === view.owner ||
        t.assignee === view.owner) &&
      (!view.priority || (t.priority || "Normal") === view.priority) &&
      (!view.state ||
        (t.done ? "done" : t.workflow || "todo") === view.state) &&
      (view.filter === "all" ||
        (view.filter === "mine" &&
          !!myEmail &&
          t.assigneeEmail === myEmail &&
          !t.done) ||
        (view.filter === "open" && !t.done) ||
        (view.filter === "overdue" &&
          !t.done &&
          !!t.dueDate &&
          t.dueDate < today) ||
        (view.filter === "high" && !t.done && t.priority === "High")),
  );
  const rank = { High: 0, Normal: 1, Low: 2 };
  return rows.sort((a, b) =>
    view.sort === "due"
      ? (a.dueDate || "9999").localeCompare(b.dueDate || "9999")
      : view.sort === "owner"
        ? (a.assigneeEmail || a.assignee || "~").localeCompare(
            b.assigneeEmail || b.assignee || "~",
          )
        : view.sort === "priority"
          ? rank[a.priority || "Normal"] - rank[b.priority || "Normal"]
          : 0,
  );
}
export function taskTemplate(
  kind: "delivery" | "improvement" | "launch",
): Task[] {
  const titles =
    kind === "improvement"
      ? [
          "Measure the baseline",
          "Find the root cause",
          "Pilot the improvement",
          "Validate benefits and standardize",
        ]
      : kind === "launch"
        ? [
            "Agree launch criteria",
            "Prepare the release",
            "Complete launch readiness review",
            "Launch and measure adoption",
          ]
        : [
            "Agree scope and success measures",
            "Build and validate the deliverable",
            "Review the acceptance criteria",
            "Handover and measure the outcome",
          ];
  const ids = titles.map(() => crypto.randomUUID());
  return titles.map((title, i) => ({
    id: ids[i],
    title,
    done: false,
    workflow: "todo",
    priority: i === 0 ? "High" : "Normal",
    group: i === 0 ? "Discover" : i === 3 ? "Deliver" : "Execute",
    dependsOn: i ? [ids[i - 1]] : [],
    milestone: i === 3,
  }));
}
export const dayNumber = (s: string) => Date.parse(`${s}T12:00:00Z`) / 86400000;
export function scheduleConflicts(p: Pick<Project, "tasks">) {
  return p.tasks.flatMap((t) =>
    (t.dependsOn || []).flatMap((id) => {
      const before = p.tasks.find((x) => x.id === id);
      return t.startDate && before?.dueDate && t.startDate < before.dueDate
        ? [{ task: t, before }]
        : [];
    }),
  );
}
