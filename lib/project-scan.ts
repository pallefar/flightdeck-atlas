import { taskBlocked, type Project } from "./projects";
import { localDay } from "./wellbeing";
export type ScanFilter = "all" | "attention" | "high" | "completed";
export const scanFilters: { value: ScanFilter; label: string }[] = [
  { value: "all", label: "All projects" },
  { value: "attention", label: "Needs attention" },
  { value: "high", label: "High priority" },
  { value: "completed", label: "Completed" },
];
const normalize = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
export function projectSignals(project: Project, today = localDay()) {
  const overdue = project.tasks.filter(
    (t) => !t.done && t.dueDate && t.dueDate < today,
  ).length;
  const late =
    !!project.dueDate &&
    project.dueDate < today &&
    project.status !== "Completed";
  return {
    overdue,
    late,
    blocked:
      !!project.blocker?.trim() ||
      project.tasks.some((t) => taskBlocked(t, project)),
    located: project.latitude !== null && project.longitude !== null,
  };
}
export function scanProjects(
  projects: Project[],
  query: string,
  filter: ScanFilter,
  today = localDay(),
) {
  const tokens = normalize(query).trim().split(/\s+/).filter(Boolean);
  return projects.filter((p) => {
    if (p.archived) return false;
    const signals = projectSignals(p, today);
    const fields = normalize(
      [
        p.name,
        p.description,
        p.location,
        p.category,
        p.functionArea,
        p.sponsor,
        p.nextAction,
        p.blocker,
        p.status,
        ...p.tasks.map((t) => `${t.title} ${t.assignee || ""}`),
      ]
        .filter(Boolean)
        .join(" "),
    );
    return (
      tokens.every((token) => fields.includes(token)) &&
      (filter === "all" ||
        (filter === "attention" &&
          (signals.blocked || signals.late || signals.overdue > 0)) ||
        (filter === "high" && p.priority === "High") ||
        (filter === "completed" && p.status === "Completed"))
    );
  });
}
