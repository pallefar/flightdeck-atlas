import {
  applyTemplate,
  templateSnapshot,
  type WorkTemplate,
} from "@/lib/work-templates";
import { processWorkMutation } from "@/lib/work-mutation";
import {
  validateWorkAccess,
  guardSQL,
  guardValues,
} from "@/lib/work-validation";
import { z } from "zod";
import { authorize } from "@/lib/access";
import {
  database,
  json,
  sameOrigin,
  recordChanges,
  newProject,
} from "@/lib/server-projects";
import { projectFor, activeProjectPeople } from "@/lib/project-access";
import { projectSchema, taskBlocked, validDate } from "@/lib/projects";
export const dynamic = "force-dynamic";
const key = z.string().min(1).max(80),
  uuid = z.string().uuid();
const formSchema = z.object({
  title: z.string().trim().min(1).max(100),
  description: z.string().max(1000),
  reviewer: z.string().email(),
  enabled: z.boolean(),
  questions: z.array(z.string().trim().min(1).max(160)).max(8),
});
const blockSchema = z.object({
  title: z.string().trim().min(1).max(100),
  body: z.string().max(5000),
});
const unpack = (r: Record<string, unknown>) => ({
  id: String(r.id),
  kind: String(r.kind),
  owner: String(r.owner),
  updated_at: String(r.updated_at),
  revision: Number(r.revision),
  available_at: String(r.available_at),
  closed: Number(r.closed),
  data: JSON.parse(r.data as string),
});
export async function GET(req: Request) {
  const a = await authorize("projects.read");
  if (a.error) return a.error;
  try {
    const url = new URL(req.url),
      db = database();
    if (url.searchParams.get("timer") === "active") {
      const row = await db
        .prepare(
          "SELECT * FROM atlas_work_records WHERE id=? AND kind='timer' AND closed=0",
        )
        .bind(`timer:${a.access.userId}`)
        .first();
      if (!row) return json({ timer: null });
      const p = await projectFor(a.access, String(row.project_id)),
        data = JSON.parse(String(row.data));
      return json({
        timer: {
          token: data.token,
          startedAt: data.startedAt,
          title: p ? data.title : "Project access changed",
          projectId: p ? row.project_id : null,
        },
      });
    }
    const pid = url.searchParams.get("project") || "",
      p = await projectFor(a.access, pid);
    if (!p) return json({ error: "Project not found." }, 404);
    const records: ReturnType<typeof unpack>[] = [],
      cutoff = new Date(Date.now() - 65000).toISOString();
    for (const kind of [
      "form",
      "block",
      "template",
      "timer",
      "reminder",
      "presence",
    ]) {
      const condition =
        kind === "timer" || kind === "reminder"
          ? " AND owner=? AND closed=0"
          : kind === "presence"
            ? " AND updated_at>?"
            : "";
      const values =
        kind === "timer" || kind === "reminder"
          ? [a.access.userId]
          : kind === "presence"
            ? [cutoff]
            : [];
      const rows = await db
        .prepare(
          `SELECT * FROM atlas_work_records WHERE project_id=? AND kind=?${condition} ORDER BY updated_at DESC LIMIT 100`,
        )
        .bind(pid, kind, ...values)
        .all();
      records.push(...rows.results.map(unpack));
    }
    let cursor: { at: string; id: string } | null = null;
    if (url.searchParams.has("requestsBefore"))
      cursor = z
        .object({ at: z.string().datetime(), id: uuid })
        .parse(JSON.parse(url.searchParams.get("requestsBefore")!));
    const visibility = p.rights.edit
        ? ""
        : " AND (owner=? OR json_extract(data,'$.reviewer')=?)",
      values = p.rights.edit ? [] : [a.access.userId, a.access.email];
    const rows = await db
        .prepare(
          `SELECT * FROM atlas_work_records WHERE project_id=? AND kind='request'${visibility}${cursor ? " AND (updated_at<? OR (updated_at=? AND id<?))" : ""} ORDER BY updated_at DESC,id DESC LIMIT 101`,
        )
        .bind(
          pid,
          ...values,
          ...(cursor ? [cursor.at, cursor.at, cursor.id] : []),
        )
        .all(),
      page = rows.results.slice(0, 100),
      last = page.at(-1);
    records.push(...page.map(unpack));
    return json({
      records,
      requestsCursor:
        rows.results.length > 100 && last
          ? JSON.stringify({ at: last.updated_at, id: last.id })
          : null,
      people: await activeProjectPeople(a.access, pid),
      email: a.access.email,
      canEdit: p.rights.edit,
      serverTime: new Date().toISOString(),
    });
  } catch {
    return json({ error: "Work tools could not be loaded." }, 503);
  }
}
export async function POST(req: Request) {
  if (!sameOrigin(req))
    return json({ error: "Request origin is not allowed." }, 403);
  const a = await authorize("projects.read");
  if (a.error) return a.error;
  try {
    const raw = await req.text();
    if (raw.length > 30000)
      return json({ error: "Request is too large." }, 400);
    const b = JSON.parse(raw);
    if (b.action === "discard-timer") {
      await database()
        .prepare(
          "UPDATE atlas_work_records SET closed=1,revision=revision+1 WHERE id=? AND kind='timer' AND json_extract(data,'$.token')=?",
        )
        .bind(`timer:${a.access.userId}`, uuid.parse(b.token))
        .run();
      return json({ success: true });
    }
    const pid = key.parse(b.projectId),
      p = await projectFor(a.access, pid);
    if (!p) return json({ error: "Project not found." }, 404);
    const db = database(),
      now = new Date().toISOString(),
      action = String(b.action);
    const store = async (
      id: string,
      kind: string,
      data: unknown,
      revision: number,
      owner = a.access.userId,
      available = "",
      projectRevision = 0,
      recordGuard?: { id: string; revision: number },
    ) => {
      const capacity =
        kind === "form"
          ? 50
          : kind === "block"
            ? 100
            : kind === "template"
              ? 20
              : kind === "reminder"
                ? 100
                : 0;
      const guards =
        (projectRevision
          ? " AND EXISTS(SELECT 1 FROM atlas_projects WHERE id=? AND revision=?)"
          : "") +
        (recordGuard
          ? " AND EXISTS(SELECT 1 FROM atlas_work_records WHERE id=? AND revision=?)"
          : "") +
        (capacity
          ? " AND (SELECT count(*) FROM atlas_work_records WHERE project_id=? AND kind=?" +
            (kind === "reminder" ? " AND owner=? AND closed=0" : "") +
            ")<?"
          : "");
      const bindings = [
        ...(projectRevision ? [pid, projectRevision] : []),
        ...(recordGuard ? [recordGuard.id, recordGuard.revision] : []),
        ...(capacity
          ? [pid, kind, ...(kind === "reminder" ? [owner] : []), capacity]
          : []),
      ];
      const result =
        revision === 0
          ? await db
              .prepare(
                "INSERT OR IGNORE INTO atlas_work_records(id,project_id,kind,owner,data,revision,updated_at,available_at,closed) SELECT ?,?,?,?,?,1,?,?,0 WHERE 1=1" +
                  guards,
              )
              .bind(
                id,
                pid,
                kind,
                owner,
                JSON.stringify(data),
                now,
                available,
                ...bindings,
              )
              .run()
          : await db
              .prepare(
                "UPDATE atlas_work_records SET data=?,revision=revision+1,updated_at=?,available_at=? WHERE id=? AND project_id=? AND kind=? AND revision=?" +
                  (projectRevision
                    ? " AND EXISTS(SELECT 1 FROM atlas_projects WHERE id=? AND revision=?)"
                    : ""),
              )
              .bind(
                JSON.stringify(data),
                now,
                available,
                id,
                pid,
                kind,
                revision,
                ...(projectRevision ? [pid, projectRevision] : []),
              )
              .run();
      return result.meta.changes
        ? json({ success: true, id })
        : json(
            {
              error:
                "This item changed. Refresh before saving; your draft is preserved.",
            },
            409,
          );
    };
    if (action === "presence") {
      const session = uuid.parse(b.session),
        id = `presence:${pid}:${a.access.userId}:${session}`;
      await db
        .prepare(
          "INSERT INTO atlas_work_records(id,project_id,kind,owner,data,revision,updated_at) VALUES(?,?,'presence',?,?,1,?) ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at",
        )
        .bind(
          id,
          pid,
          a.access.userId,
          JSON.stringify({ email: a.access.email }),
          now,
        )
        .run();
      await db
        .prepare(
          "DELETE FROM atlas_work_records WHERE kind='presence' AND updated_at<?",
        )
        .bind(new Date(Date.now() - 86400000).toISOString())
        .run();
      return json({ success: true });
    }
    if (action === "reminder") {
      const task = p.project.tasks.find((t) => t.id === b.taskId);
      if (!task || task.done || task.archived || p.project.archived)
        throw Error("Choose an active task.");
      const at = z.string().datetime().parse(b.at);
      if (at <= now || Date.parse(at) > Date.now() + 366 * 86400000)
        throw Error("Schedule within the next year.");
      return store(
        uuid.parse(b.id),
        "reminder",
        {
          taskId: task.id,
          title: task.title,
          dueDate: task.dueDate || "",
          timezone: z
            .string()
            .max(80)
            .parse(b.timezone || "UTC"),
        },
        0,
        a.access.userId,
        at,
        p.project.revision,
      );
    }
    if (action === "cancel-reminder") {
      await db
        .prepare(
          "UPDATE atlas_work_records SET closed=1,revision=revision+1 WHERE id=? AND project_id=? AND kind='reminder' AND owner=?",
        )
        .bind(key.parse(b.id), pid, a.access.userId)
        .run();
      return json({ success: true });
    }
    if (action === "start-timer") {
      if (!p.rights.edit)
        return json(
          { error: "Editing access is required to record time." },
          403,
        );
      const task = p.project.tasks.find((t) => t.id === b.taskId);
      if (
        !task ||
        task.done ||
        task.archived ||
        p.project.archived ||
        taskBlocked(task, p.project)
      )
        throw Error("Choose an active, unblocked task.");
      const data = {
        taskId: task.id,
        startedAt: now,
        token: uuid.parse(b.token),
        title: task.title,
      };
      const r = await db
        .prepare(
          "INSERT INTO atlas_work_records(id,project_id,kind,owner,data,revision,updated_at,closed) SELECT ?,?,'timer',?,?,1,?,0 WHERE EXISTS(SELECT 1 FROM atlas_projects WHERE id=? AND revision=?) ON CONFLICT(id) DO UPDATE SET project_id=excluded.project_id,data=excluded.data,revision=atlas_work_records.revision+1,updated_at=excluded.updated_at,closed=0 WHERE atlas_work_records.closed=1 AND EXISTS(SELECT 1 FROM atlas_projects WHERE id=? AND revision=?)",
        )
        .bind(
          `timer:${a.access.userId}`,
          pid,
          a.access.userId,
          JSON.stringify(data),
          now,
          pid,
          p.project.revision,
          pid,
          p.project.revision,
        )
        .run();
      if (!r.meta.changes) {
        const active = await db
          .prepare("SELECT project_id FROM atlas_work_records WHERE id=?")
          .bind(`timer:${a.access.userId}`)
          .first();
        return json(
          {
            error:
              "A timer is already running, or this project changed. Refresh and stop any active session before starting another.",
            activeProjectId: active?.project_id,
          },
          409,
        );
      }
      return json({ success: true });
    }
    if (action === "stop-timer") {
      if (!p.rights.edit)
        return json(
          { error: "Editing access is required to record time." },
          403,
        );
      const token = uuid.parse(b.token),
        row = await db
          .prepare(
            "SELECT * FROM atlas_work_records WHERE id=? AND project_id=? AND kind='timer'",
          )
          .bind(`timer:${a.access.userId}`, pid)
          .first();
      if (!row) throw Error("No timer found here.");
      const timer = JSON.parse(row.data as string);
      if (timer.token !== token)
        return json(
          { error: "The timer changed. Refresh before stopping it." },
          409,
        );
      if (row.closed) return json({ success: true });
      const task = p.project.tasks.find((t) => t.id === timer.taskId);
      if (!task)
        throw Error("This task was removed. Discard the timer to continue.");
      const elapsed = Math.max(
        1,
        Math.ceil((Date.now() - Date.parse(timer.startedAt)) / 60000),
      );
      if (elapsed > 1440 && !b.minutes)
        throw Error(
          "This timer exceeds 24 hours. Enter the minutes actually worked before stopping.",
        );
      const minutes =
          b.minutes === undefined
            ? elapsed
            : z
                .number()
                .int()
                .min(1)
                .max(Math.min(elapsed, 1440))
                .parse(b.minutes),
        note = z
          .string()
          .max(300)
          .parse(b.note || "Stopwatch session");
      const fields = projectSchema.parse({
        ...p.project,
        tasks: p.project.tasks.map((t) =>
          t.id !== task.id
            ? t
            : {
                ...t,
                timeEntries: [
                  ...(t.timeEntries || []),
                  {
                    id: token,
                    date: now.slice(0, 10),
                    minutes,
                    note,
                    author: a.access.email,
                  },
                ],
              },
        ),
      });
      const recorded = recordChanges(
        fields,
        p.project,
        `Recorded ${minutes} minutes with the task stopwatch.`,
        now,
      );
      const results = await db.batch([
        db
          .prepare(
            "UPDATE atlas_projects SET data=?,revision=revision+1,updated_at=? WHERE id=? AND revision=? AND EXISTS(SELECT 1 FROM atlas_work_records WHERE id=? AND revision=? AND closed=0)",
          )
          .bind(
            JSON.stringify(recorded),
            now,
            pid,
            p.project.revision,
            row.id,
            row.revision,
          ),
        db
          .prepare(
            "UPDATE atlas_work_records SET closed=1,revision=revision+1,updated_at=? WHERE id=? AND revision=? AND changes()>0",
          )
          .bind(now, row.id, row.revision),
      ]);
      return results[0].meta.changes
        ? json({ success: true, minutes })
        : json(
            { error: "Project or timer changed. Retry to record once." },
            409,
          );
    }
    if (action === "discard-timer") {
      await db
        .prepare(
          "UPDATE atlas_work_records SET closed=1,revision=revision+1 WHERE id=? AND project_id=? AND json_extract(data,'$.token')=?",
        )
        .bind(`timer:${a.access.userId}`, pid, uuid.parse(b.token))
        .run();
      return json({ success: true });
    }
    if (action === "submit-request") {
      const form = await db
        .prepare(
          "SELECT data,revision FROM atlas_work_records WHERE id=? AND project_id=? AND kind='form'",
        )
        .bind(key.parse(b.formId), pid)
        .first();
      if (!form) throw Error("Form not found.");
      const f = formSchema.parse(JSON.parse(form.data as string));
      if (!f.enabled) throw Error("This form is closed.");
      const title = z.string().trim().min(1).max(200).parse(b.title),
        description = z
          .string()
          .max(2000)
          .parse(b.description || ""),
        answers = z
          .array(z.string().trim().min(1).max(1000))
          .max(8)
          .parse(b.answers || []);
      if (answers.length !== f.questions.length)
        throw Error("Answer each form question.");
      return store(
        uuid.parse(b.id),
        "request",
        {
          formId: b.formId,
          title,
          description,
          answers,
          questions: f.questions,
          reviewer: f.reviewer,
          status: "submitted",
          submittedBy: a.access.email,
        },
        0,
        a.access.userId,
        "",
        0,
        { id: String(b.formId), revision: Number(form.revision) },
      );
    }
    if (!p.rights.edit)
      return json({ error: "Editing access is required." }, 403);
    if (action === "template-save") {
      const id = uuid.parse(b.id),
        revision = z.number().int().min(0).parse(b.revision),
        name = z.string().trim().min(1).max(80).parse(b.name);
      if (p.project.revision !== b.projectRevision)
        return json(
          {
            error:
              "Source project changed. Review the latest tasks before capturing a template.",
          },
          409,
        );
      const tasks = templateSnapshot(p.project.tasks);
      if (!tasks.length)
        throw Error("Add active tasks before capturing a playbook.");
      if (revision === 0) {
        const count = await db
          .prepare(
            "SELECT count(*) n FROM atlas_work_records WHERE project_id=? AND kind='template'",
          )
          .bind(pid)
          .first<{ n: number }>();
        if ((count?.n || 0) >= 20)
          throw Error(
            "This project already has 20 playbooks. Update an existing version.",
          );
      }
      return store(
        id,
        "template",
        { name, tasks },
        revision,
        a.access.userId,
        "",
        p.project.revision,
      );
    }
    if (action === "template-apply") {
      const template = await db
        .prepare(
          "SELECT * FROM atlas_work_records WHERE id=? AND project_id=? AND kind='template'",
        )
        .bind(uuid.parse(b.id), pid)
        .first();
      if (!template) throw Error("Playbook not found.");
      if (template.revision !== b.revision)
        return json({ error: "Playbook changed. Refresh the preview." }, 409);
      const target = await projectFor(a.access, key.parse(b.targetId));
      if (!target || !target.rights.edit)
        return json(
          { error: "Editing access to the target project is required." },
          403,
        );
      if (target.project.revision !== b.targetRevision)
        return json(
          { error: "Target project changed. Refresh the preview." },
          409,
        );
      if (target.project.id === pid)
        throw Error("Choose another project for this playbook.");
      const fields = projectSchema.parse({
          ...target.project,
          tasks: applyTemplate(
            target.project.tasks,
            JSON.parse(String(template.data)) as WorkTemplate,
            pid,
            String(template.id),
            Number(template.revision),
          ),
        }),
        processed = processWorkMutation(
          fields,
          target.project,
          "Applied reviewed playbook version.",
          now,
          a.access.email,
        ),
        guards = await validateWorkAccess(
          processed.recorded,
          target.project.id,
          a.access,
        );
      const statements = [
        db
          .prepare(
            "UPDATE atlas_projects SET data=?,revision=revision+1,updated_at=? WHERE id=? AND revision=? AND EXISTS(SELECT 1 FROM atlas_work_records WHERE id=? AND revision=?)" +
              guardSQL(guards),
          )
          .bind(
            JSON.stringify(processed.recorded),
            now,
            target.project.id,
            target.project.revision,
            template.id,
            template.revision,
            ...guardValues(guards),
          ),
      ];
      for (const notice of processed.notices)
        statements.push(
          db
            .prepare(
              "INSERT INTO atlas_notifications(id,recipient,project_id,text,created_at,read) SELECT ?,?,?,?,?,0 WHERE changes()>0",
            )
            .bind(
              crypto.randomUUID(),
              notice.recipient,
              target.project.id,
              notice.text,
              now,
            ),
        );
      const results = await db.batch(statements);
      return results[0].meta.changes
        ? json({ success: true })
        : json(
            { error: "Project or playbook changed. Refresh the preview." },
            409,
          );
    }
    if (action === "form" || action === "block") {
      const id = uuid.parse(b.id),
        revision = z.number().int().min(0).parse(b.revision),
        data =
          action === "form"
            ? formSchema.parse(b.data)
            : blockSchema.parse(b.data);
      if (action === "form") {
        const people = await activeProjectPeople(a.access, pid);
        if (
          !people.some(
            (m) => m.email === (data as z.infer<typeof formSchema>).reviewer,
          )
        )
          throw Error("Choose a reviewer with project access.");
      }
      if (revision === 0) {
        const count = await db
          .prepare(
            "SELECT count(*) as n FROM atlas_work_records WHERE project_id=? AND kind=?",
          )
          .bind(pid, action)
          .first<{ n: number }>();
        if ((count?.n || 0) >= (action === "form" ? 50 : 100))
          throw Error(
            "This project reached its limit. Edit an existing form or remove a note block.",
          );
      }
      return store(id, action, data, revision);
    }
    if (action === "delete-block") {
      const r = await db
        .prepare(
          "DELETE FROM atlas_work_records WHERE id=? AND project_id=? AND kind='block' AND revision=?",
        )
        .bind(uuid.parse(b.id), pid, z.number().int().min(1).parse(b.revision))
        .run();
      return r.meta.changes
        ? json({ success: true })
        : json(
            { error: "This block changed. Refresh before removing it." },
            409,
          );
    }
    if (action === "review-request") {
      const row = await db
        .prepare(
          "SELECT * FROM atlas_work_records WHERE id=? AND project_id=? AND kind='request'",
        )
        .bind(uuid.parse(b.id), pid)
        .first();
      if (!row) throw Error("Request not found.");
      const data = JSON.parse(row.data as string);
      if (data.reviewer !== a.access.email && !a.access.superAdmin)
        return json(
          {
            error:
              "Only the named reviewer or Super Admin can decide this request.",
          },
          403,
        );
      if (row.revision !== b.revision || data.status !== "submitted")
        return json(
          {
            error:
              "This request has already changed. Refresh to see its outcome.",
          },
          409,
        );
      const decision = z.enum(["reject", "task", "project"]).parse(b.decision),
        reason = z.string().trim().min(1).max(1000).parse(b.reason);
      if (decision === "reject")
        return store(
          String(row.id),
          "request",
          { ...data, status: "rejected", reason, reviewedBy: a.access.email },
          Number(row.revision),
          String(row.owner),
        );
      const newId = crypto.randomUUID(),
        nextData = {
          ...data,
          status: "approved",
          reason,
          reviewedBy: a.access.email,
          targetId: newId,
          targetType: decision,
        };
      const description = [
        data.description,
        ...data.questions.map(
          (q: string, i: number) => `${q}: ${data.answers[i]}`,
        ),
      ]
        .join("\n")
        .slice(0, 2000);
      if (decision === "task") {
        const fields = projectSchema.parse({
          ...p.project,
          tasks: [
            ...p.project.tasks,
            {
              id: newId,
              title: data.title,
              description,
              done: false,
              workflow: "todo",
              group: "Intake",
            },
          ],
        });
        const processed = processWorkMutation(
            fields,
            p.project,
            `Approved request: ${data.title}`,
            now,
            a.access.email,
          ),
          guards = await validateWorkAccess(processed.recorded, pid, a.access);
        const statements = [
          db
            .prepare(
              "UPDATE atlas_projects SET data=?,revision=revision+1,updated_at=? WHERE id=? AND revision=? AND EXISTS(SELECT 1 FROM atlas_work_records WHERE id=? AND revision=?)" +
                guardSQL(guards),
            )
            .bind(
              JSON.stringify(processed.recorded),
              now,
              pid,
              p.project.revision,
              row.id,
              row.revision,
              ...guardValues(guards),
            ),
          db
            .prepare(
              "UPDATE atlas_work_records SET data=?,revision=revision+1,updated_at=? WHERE id=? AND revision=? AND changes()>0",
            )
            .bind(JSON.stringify(nextData), now, row.id, row.revision),
        ];
        for (const notice of processed.notices)
          statements.push(
            db
              .prepare(
                "INSERT INTO atlas_notifications(id,recipient,project_id,text,created_at,read) SELECT ?,?,?,?,?,0 WHERE changes()>0",
              )
              .bind(
                crypto.randomUUID(),
                notice.recipient,
                pid,
                notice.text,
                now,
              ),
          );
        const results = await db.batch(statements);
        return results[0].meta.changes
          ? json({ success: true, targetId: newId })
          : json({ error: "Project changed. Retry the review." }, 409);
      }
      const createAuth = await authorize("projects.create");
      if (createAuth.error) return createAuth.error;
      const project = newProject(
        projectSchema.parse({
          name: String(data.title).slice(0, 100),
          description: description.slice(0, 1500),
          status: "Planning",
          category: p.project.category,
          location: "",
          latitude: null,
          longitude: null,
          dueDate: "",
          color: p.project.color,
          tasks: [],
        }),
      );
      project.id = newId;
      const results = await db.batch([
        db
          .prepare(
            "INSERT INTO atlas_projects(id,owner_id,data,source,updated_at,revision) SELECT ?,?,?,'atlas',?,1 WHERE EXISTS(SELECT 1 FROM atlas_work_records WHERE id=? AND revision=?)",
          )
          .bind(
            newId,
            a.access.userId,
            JSON.stringify(project),
            now,
            row.id,
            row.revision,
          ),
        db
          .prepare(
            "INSERT INTO atlas_project_shares(project_id,data,revision) SELECT ?,?,1 WHERE changes()>0",
          )
          .bind(newId, JSON.stringify({ visibility: "private", grants: [] })),
        db
          .prepare(
            "UPDATE atlas_work_records SET data=?,revision=revision+1,updated_at=? WHERE id=? AND revision=? AND changes()>0",
          )
          .bind(JSON.stringify(nextData), now, row.id, row.revision),
      ]);
      return results[0].meta.changes
        ? json({ success: true, targetId: newId })
        : json({ error: "Request changed. Refresh and retry." }, 409);
    }
    return json({ error: "Unknown work operation." }, 400);
  } catch (e) {
    if (e instanceof z.ZodError)
      return json({ error: e.issues[0]?.message || "Check your inputs." }, 400);
    return json(
      { error: e instanceof Error ? e.message : "Could not save this change." },
      400,
    );
  }
}
