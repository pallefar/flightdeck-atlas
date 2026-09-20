import { z } from "zod";
import { authorize } from "@/lib/access";
import {
  database,
  json,
  sameOrigin,
  recordChanges,
} from "@/lib/server-projects";
import { projectFor, activeProjectPeople } from "@/lib/project-access";
import { projectSchema } from "@/lib/projects";
import { emptyWork, localLinks } from "@/lib/advanced-work";
import {
  validateWorkAccess,
  guardSQL,
  guardValues,
} from "@/lib/work-validation";
export async function POST(req: Request) {
  if (!sameOrigin(req))
    return json({ error: "Request origin is not allowed." }, 403);
  const a = await authorize("projects.read");
  if (a.error) return a.error;
  try {
    const raw = await req.text();
    if (raw.length > 10000) throw Error("Request is too large.");
    const b = z
      .object({
        source: z.string().max(80),
        target: z.string().max(80),
        sourceRevision: z.number().int().min(1),
        targetRevision: z.number().int().min(1),
        ids: z.array(z.string().max(80)).min(1).max(200),
      })
      .parse(JSON.parse(raw));
    if (b.source === b.target) throw Error("Choose another project.");
    const from = await projectFor(a.access, b.source),
      to = await projectFor(a.access, b.target);
    if (!from || !to) return json({ error: "A project is unavailable." }, 404);
    if (!from.rights.edit || !to.rights.edit)
      return json(
        { error: "Editing access to both projects is required." },
        403,
      );
    if (
      from.project.revision !== b.sourceRevision ||
      to.project.revision !== b.targetRevision
    )
      return json(
        { error: "A project changed. Refresh the transfer preview." },
        409,
      );
    const ids = new Set(b.ids),
      moved = from.project.tasks.filter((t) => ids.has(t.id)),
      remaining = from.project.tasks.filter((t) => !ids.has(t.id));
    if (moved.length !== ids.size)
      throw Error("A selected task is no longer available.");
    if (moved.some((t) => to.project.tasks.some((x) => x.id === t.id)))
      throw Error("A task ID conflicts with the destination.");
    for (const t of from.project.tasks) {
      const related = [
        ...(t.parentId ? [t.parentId] : []),
        ...localLinks(t).map((l) => l.taskId),
        ...(t.scheduleLinks || [])
          .filter((l) => l.projectId === b.source)
          .map((l) => l.taskId),
      ];
      if (related.some((id) => ids.has(t.id) !== ids.has(id)))
        throw Error(
          "Move a complete task family and its local dependency group together, or remove the links first.",
        );
    }
    const db = database();
    const timer = await db
      .prepare(
        "SELECT id FROM atlas_work_records WHERE project_id=? AND kind='timer' AND closed=0 AND json_extract(data,'$.taskId') IN(SELECT value FROM json_each(?)) LIMIT 1",
      )
      .bind(b.source, JSON.stringify(b.ids))
      .first();
    if (timer)
      throw Error("Stop active task timers before moving these tasks.");
    const rows = await db
      .prepare("SELECT data FROM atlas_projects WHERE id!=?")
      .bind(b.source)
      .all();
    if (
      rows.results.some((r) =>
        JSON.parse(String(r.data)).tasks?.some(
          (t: { scheduleLinks?: { projectId: string; taskId: string }[] }) =>
            t.scheduleLinks?.some(
              (l) => l.projectId === b.source && ids.has(l.taskId),
            ),
        ),
      )
    )
      throw Error(
        "Another project references a selected task. Remove its cross-project link before moving.",
      );
    if (
      (from.project.budget?.currency || "EUR") !==
        (to.project.budget?.currency || "EUR") &&
      moved.some((t) => t.hourlyRate !== undefined)
    )
      throw Error(
        "Projects use different currencies. Remove or explicitly convert task rates before moving.",
      );
    const people = await activeProjectPeople(a.access, b.target);
    if (
      moved.some(
        (t) =>
          t.assigneeEmail && !people.some((p) => p.email === t.assigneeEmail),
      )
    )
      throw Error(
        "A task owner lacks access to the destination. Share the project or unassign that task first.",
      );
    const targetWork = to.project.work || emptyWork(),
      fields = [...targetWork.fields];
    for (const f of from.project.work?.fields || []) {
      const existing = fields.find((x) => x.id === f.id);
      if (existing && JSON.stringify(existing) !== JSON.stringify(f))
        throw Error(
          "Custom field definitions differ. Align them before moving tasks.",
        );
      if (!existing) fields.push(f);
    }
    const source = projectSchema.parse({ ...from.project, tasks: remaining }),
      target = projectSchema.parse({
        ...to.project,
        tasks: [
          ...to.project.tasks,
          ...moved.map((t) => ({
            ...t,
            scheduleLinks: t.scheduleLinks?.map((l) =>
              l.projectId === b.source ? { ...l, projectId: "" } : l,
            ),
          })),
        ],
        work: { ...targetWork, fields },
      });
    const guards = await validateWorkAccess(target, b.target, a.access);
    const now = new Date().toISOString();
    const results = await db.batch([
      db
        .prepare(
          "UPDATE atlas_projects SET data=?,revision=revision+1,updated_at=? WHERE id=? AND revision=? AND EXISTS(SELECT 1 FROM atlas_projects WHERE id=? AND revision=?) AND NOT EXISTS(SELECT 1 FROM atlas_work_records WHERE project_id=? AND kind='timer' AND closed=0 AND json_extract(data,'$.taskId') IN(SELECT value FROM json_each(?))) AND NOT EXISTS(SELECT 1 FROM atlas_projects p,json_each(p.data,'$.tasks') t,json_each(t.value,'$.scheduleLinks') l WHERE p.id!=? AND json_extract(l.value,'$.projectId')=? AND json_extract(l.value,'$.taskId') IN(SELECT value FROM json_each(?)))" +
            guardSQL(guards),
        )
        .bind(
          JSON.stringify({
            ...recordChanges(
              source,
              from.project,
              `Moved ${moved.length} tasks to another project.`,
              now,
            ),
            tasks: source.tasks,
          }),
          now,
          b.source,
          b.sourceRevision,
          b.target,
          b.targetRevision,
          b.source,
          JSON.stringify(b.ids),
          b.source,
          b.source,
          JSON.stringify(b.ids),
          ...guardValues(guards),
        ),
      db
        .prepare(
          "UPDATE atlas_projects SET data=?,revision=revision+1,updated_at=? WHERE id=? AND revision=? AND changes()>0",
        )
        .bind(
          JSON.stringify({
            ...recordChanges(
              { ...target, tasks: to.project.tasks },
              to.project,
              `Received ${moved.length} tasks from another project.`,
              now,
            ),
            tasks: target.tasks,
          }),
          now,
          b.target,
          b.targetRevision,
        ),
      db
        .prepare(
          "UPDATE atlas_work_records SET closed=1,revision=revision+1 WHERE project_id=? AND kind='reminder' AND closed=0 AND json_extract(data,'$.taskId') IN(SELECT value FROM json_each(?)) AND changes()>0",
        )
        .bind(b.source, JSON.stringify(b.ids)),
    ]);
    return results[0].meta.changes
      ? json({ success: true })
      : json({ error: "A project changed. Refresh and retry." }, 409);
  } catch (e) {
    return json(
      {
        error:
          e instanceof z.ZodError ? e.issues[0]?.message : (e as Error).message,
      },
      400,
    );
  }
}
