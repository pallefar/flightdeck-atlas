import type { Project } from "./projects";
export function localDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function briefing(
  projects: Project[],
  period: "day" | "week",
  now = new Date(),
) {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (period === "week")
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  const end = new Date(start);
  end.setDate(end.getDate() + (period === "week" ? 7 : 1));
  const today = localDate(now),
    through = localDate(new Date(end.getTime() - 1));
  const live = projects.filter((p) => !p.archived);
  const actions = live.flatMap((p) =>
    p.tasks
      .filter((t) => !t.done)
      .map((t) => ({
        p,
        t,
        due: t.dueDate || "",
        overdue: !!t.dueDate && t.dueDate < today,
      })),
  );
  actions.sort(
    (a, b) =>
      Number(b.overdue) - Number(a.overdue) ||
      Number(b.t.priority === "High") - Number(a.t.priority === "High") ||
      (a.due || "9999").localeCompare(b.due || "9999"),
  );
  const completed = projects.flatMap((p) =>
    p.tasks
      .filter(
        (t) =>
          t.done &&
          t.completedAt &&
          new Date(t.completedAt) >= start &&
          new Date(t.completedAt) <= now,
      )
      .map((t) => ({ p, t })),
  );
  const events = projects
    .flatMap((p) =>
      (p.activity || [])
        .filter((e) => new Date(e.at) >= start && new Date(e.at) <= now)
        .map((e) => ({ p, e })),
    )
    .sort((a, b) => b.e.at.localeCompare(a.e.at));
  const deadlines = live
    .filter(
      (p) => p.status !== "Completed" && p.dueDate && p.dueDate <= through,
    )
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  return {
    start,
    end,
    today,
    through,
    live,
    actions,
    completed,
    events,
    deadlines,
    overdue: actions.filter((a) => a.overdue),
    blocked: live.filter((p) => p.blocker),
    needsNext: live.filter(
      (p) =>
        p.status !== "Completed" &&
        !p.nextAction &&
        !p.tasks.some((t) => !t.done),
    ),
    due: actions.filter((a) => a.due && a.due <= through),
  };
}
export function briefingMarkdown(
  projects: Project[],
  period: "day" | "week",
  now = new Date(),
) {
  const b = briefing(projects, period, now);
  const lines = [
    `# Atlas ${period === "day" ? "daily" : "weekly"} briefing`,
    `${localDate(b.start)} – ${localDate(now)} · local time`,
    "",
    `${b.live.length} unarchived projects · ${b.completed.length} tasks completed · ${b.overdue.length} overdue tasks · ${b.blocked.length} blocked projects`,
    "",
    "## Next actions",
    ...b.actions
      .slice(0, 15)
      .map(
        ({ p, t, due }) =>
          `- [ ] ${t.title} — ${p.name}${due ? ` · due ${due}` : ""}`,
      ),
    ...b.live
      .filter((p) => p.nextAction)
      .map((p) => `- ${p.nextAction} — ${p.name}`),
    "",
    "## Blockers",
    ...b.blocked.map((p) => `- ${p.name}: ${p.blocker}`),
    "",
    "## Project deadlines",
    ...b.deadlines.map((p) => `- ${p.name}: ${p.dueDate}`),
    "",
    "## Completed",
    ...b.completed.map(({ p, t }) => `- ${t.title} — ${p.name}`),
    "",
    "## Recent updates",
    ...b.events
      .slice(0, 30)
      .map(
        ({ p, e }) =>
          `- ${new Date(e.at).toLocaleString()}: ${p.name} — ${e.text}`,
      ),
    "",
    "Based on saved Atlas projects and recorded activity. FlightDeck and TEOA Advantage are not connected yet.",
  ];
  return lines.join("\n");
}
export function downloadText(name: string, content: string) {
  const url = URL.createObjectURL(
    new Blob([content], { type: "text/markdown;charset=utf-8" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
