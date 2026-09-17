import type { Project } from "./projects";
import { localDate } from "./briefing";
import { projectSignals } from "./project-scan";

export function portfolioPlan(
  projects: Project[],
  offset = 0,
  now = new Date(),
) {
  const today = localDate(now);
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  start.setDate(start.getDate() + offset * 7);
  const days = Array.from({ length: 7 }, (_, i) => {
    const date = new Date(start);
    date.setDate(date.getDate() + i);
    return { key: localDate(date), date };
  });
  const active = projects.filter((p) => !p.archived);
  const deadlines = active
    .flatMap((p) => [
      ...(p.dueDate && p.status !== "Completed"
        ? [
            {
              id: `${p.id}:project`,
              p,
              title: p.name,
              date: p.dueDate,
              kind: "Project",
            },
          ]
        : []),
      ...p.tasks
        .filter((t) => !t.done && t.dueDate)
        .map((t) => ({
          id: `${p.id}:${t.id}`,
          p,
          title: t.title,
          date: t.dueDate!,
          kind: "Task",
        })),
    ])
    .sort(
      (a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title),
    );
  const staleBefore = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  );
  staleBefore.setDate(staleBefore.getDate() - 7);
  const attention = active
    .filter((p) => p.status !== "Completed")
    .map((p) => {
      const signal = projectSignals(p, today);
      return {
        p,
        reason: signal.blocked
          ? "Blocked"
          : signal.late || signal.overdue
            ? "Overdue work"
            : p.updatedAt.slice(0, 10) < localDate(staleBefore)
              ? "No update in 7+ days"
              : "",
      };
    })
    .filter((x) => x.reason);
  return {
    today,
    days,
    deadlines,
    overdue: deadlines.filter((d) => d.date < today),
    attention,
  };
}
