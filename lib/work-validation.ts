import type { ProjectFields } from "./projects";
import type { AccessProfile } from "./access-policy";
import { activeProjectPeople, projectFor } from "./project-access";
import { localLinks } from "./advanced-work";
export async function validateWorkAccess(
  fields: ProjectFields,
  projectId: string,
  access: AccessProfile,
  creating = false,
) {
  const people = creating
    ? [{ email: access.email }]
    : await activeProjectPeople(access, projectId);
  for (const r of fields.work?.rules || [])
    if (
      r.enabled &&
      ["notify", "assigneeEmail"].includes(r.action) &&
      !people.some((p) => p.email === r.value)
    )
      throw Error(
        "Automation recipients must have active access to this project.",
      );
  const guards: { id: string; revision: number }[] = [];
  const projects = new Map<string, ProjectFields>([[projectId, fields]]),
    state = new Map<string, number>();
  async function visit(pid: string, tid: string): Promise<void> {
    const key = `${pid}:${tid}`;
    if (state.get(key) === 1)
      throw Error("Dependencies cannot form a cycle across projects.");
    if (state.get(key) === 2) return;
    if (state.size > 3000)
      throw Error("This dependency network exceeds the supported size.");
    state.set(key, 1);
    let p = projects.get(pid);
    if (!p) {
      const available = await projectFor(access, pid);
      if (!available)
        throw Error(
          "A dependency project is unavailable. Remove the link or restore access.",
        );
      if (guards.length >= 30)
        throw Error(
          "A dependency network may span at most 30 linked projects.",
        );
      p = available.project;
      guards.push({ id: pid, revision: available.project.revision });
      projects.set(pid, p);
    }
    const t = p.tasks.find((x) => x.id === tid);
    if (!t)
      throw Error("A linked dependency task was removed. Update the link.");
    for (const l of [
      ...localLinks(t),
      ...(t.scheduleLinks || []).filter((l) => l.projectId),
    ])
      await visit(l.projectId || pid, l.taskId);
    state.set(key, 2);
  }
  for (const t of fields.tasks) await visit(projectId, t.id);
  return guards;
}

export const guardSQL = (guards: { id: string; revision: number }[]) =>
  guards
    .map(
      () =>
        " AND EXISTS(SELECT 1 FROM atlas_projects WHERE id=? AND revision=?)",
    )
    .join("");
export const guardValues = (guards: { id: string; revision: number }[]) =>
  guards.flatMap((g) => [g.id, g.revision]);
