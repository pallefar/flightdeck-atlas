import type { Task } from "./projects";
export type WorkTemplate = { name: string; tasks: Task[] };
export function templateSnapshot(tasks: Task[]): Task[] {
  const ids = new Set(tasks.filter((t) => !t.archived).map((t) => t.id));
  return tasks
    .filter((t) => ids.has(t.id))
    .map((t) => ({
      id: t.id,
      title: t.title,
      description: t.description || "",
      done: false,
      priority: t.priority || "Normal",
      estimateMinutes: t.estimateMinutes,
      group: t.group || "",
      milestone: !!t.milestone,
      parentId: ids.has(t.parentId || "") ? t.parentId : "",
      dependsOn: (t.dependsOn || []).filter((id) => ids.has(id)),
      scheduleLinks: (t.scheduleLinks || []).filter(
        (l) => !l.projectId && ids.has(l.taskId),
      ),
    }));
}
export function applyTemplate(
  tasks: Task[],
  template: WorkTemplate,
  sourceId: string,
  templateId: string,
  version: number,
) {
  const match = (t: Task) =>
    t.templateRef?.projectId === sourceId &&
    t.templateRef?.templateId === templateId;
  const ids = new Map(
    template.tasks.map((t) => [
      t.id,
      tasks.find((x) => match(x) && x.templateRef?.taskId === t.id)?.id ||
        crypto.randomUUID(),
    ]),
  );
  const updates = new Map(
    template.tasks.map((t) => {
      const existing = tasks.find(
          (x) => match(x) && x.templateRef?.taskId === t.id,
        ),
        ref = { projectId: sourceId, templateId, taskId: t.id, version };
      return [
        ids.get(t.id)!,
        existing
          ? {
              ...existing,
              title: t.title,
              description: t.description,
              estimateMinutes: t.estimateMinutes,
              priority: t.priority,
              group: t.group,
              milestone: t.milestone,
              templateRef: ref,
            }
          : {
              ...t,
              id: ids.get(t.id)!,
              parentId: t.parentId ? ids.get(t.parentId) || "" : "",
              dependsOn: t.dependsOn?.map((id) => ids.get(id)!).filter(Boolean),
              scheduleLinks: t.scheduleLinks
                ?.map((l) => ({ ...l, taskId: ids.get(l.taskId)! }))
                .filter((l) => l.taskId),
              templateRef: ref,
            },
      ];
    }),
  );
  return [
    ...tasks.map((t) => updates.get(t.id) || t),
    ...Array.from(updates.values()).filter(
      (t) => !tasks.some((x) => x.id === t.id),
    ),
  ];
}
