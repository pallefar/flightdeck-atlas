import { authorize } from "@/lib/access";
import {
  database,
  json,
  sameOrigin,
  readFields,
  recordChanges,
} from "@/lib/server-projects";
import { projectFor, activeProjectPeople } from "@/lib/project-access";
import { applyWorkRules, stampTimeEntries } from "@/lib/work-management";
import { projectSchema } from "@/lib/projects";
export const dynamic = "force-dynamic";
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!sameOrigin(request))
    return json({ error: "Request origin is not allowed." }, 403);
  const auth = await authorize(undefined, true);
  if (auth.error) return auth.error;
  const { id } = await params;
  const revision = Number(new URL(request.url).searchParams.get("revision"));
  if (!Number.isInteger(revision) || revision < 1)
    return json({ error: "A current project revision is required." }, 400);
  try {
    const db = database();
    const result = await db
      .prepare("DELETE FROM atlas_projects WHERE id = ? AND revision = ?")
      .bind(id, revision)
      .run();
    if (!result.meta.changes)
      return json(
        { error: "Project changed or was not found. Reload before deleting." },
        409,
      );
    return new Response(null, { status: 204 });
  } catch {
    return json(
      { error: "The project could not be deleted. Please try again." },
      503,
    );
  }
}
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!sameOrigin(request))
    return json({ error: "Request origin is not allowed." }, 403);
  const auth = await authorize("projects.read");
  if (auth.error) return auth.error;
  const { id } = await params;
  let fields, revision, updateNote;
  try {
    ({ fields, revision, updateNote } = await readFields(request));
    if (!Number.isInteger(revision) || revision < 1)
      throw Error("A project revision is required.");
  } catch (e) {
    return json({ error: (e as Error).message }, 400);
  }
  try {
    const db = database();
    const authorized = await projectFor(auth.access, id);
    if (!authorized) return json({ error: "Project not found." }, 404);
    const previous = authorized.project;
    if (
      !authorized.rights.edit ||
      (!!fields.archived !== !!previous.archived && !authorized.rights.archive)
    )
      return json(
        { error: "You do not have permission to change this project." },
        403,
      );
    const eligible = await activeProjectPeople(auth.access, id);
    if (
      fields.tasks.some(
        (t) =>
          t.assigneeEmail &&
          previous.tasks.find((x) => x.id === t.id)?.assigneeEmail !==
            t.assigneeEmail &&
          !eligible.some((m) => m.email === t.assigneeEmail),
      )
    )
      return json(
        { error: "Choose an active member with access to this project." },
        400,
      );
    if (previous.revision !== revision)
      return json(
        {
          error:
            "This project changed in another session. Reload before editing.",
        },
        409,
      );
    const updatedAt = new Date().toISOString();
    try {
      fields = stampTimeEntries(fields, previous, auth.access.email);
    } catch (e) {
      return json({ error: (e as Error).message }, 400);
    }
    const automated = applyWorkRules(fields, previous);
    const valid = projectSchema.safeParse(automated.fields);
    if (!valid.success)
      return json({ error: valid.error.issues[0].message }, 400);
    const recorded = recordChanges(valid.data, previous, updateNote, updatedAt);
    for (const text of automated.applied)
      recorded.activity.push({
        id: crypto.randomUUID(),
        at: updatedAt,
        kind: "project",
        text: `Automation: ${text}`,
      });
    recorded.activity = recorded.activity.slice(-200);
    if (recorded.tasks.length > 200)
      return json(
        {
          error:
            "This project has reached its 200-task limit. Remove completed tasks before adding another recurring task.",
        },
        400,
      );
    const statements = [
      db
        .prepare(
          "UPDATE atlas_projects SET data = ?, updated_at = ?, revision = revision + 1 WHERE id = ? AND revision = ?",
        )
        .bind(JSON.stringify(recorded), updatedAt, id, revision),
    ];
    for (const t of fields.tasks) {
      const old = previous.tasks.find((x) => x.id === t.id);
      if (
        t.assigneeEmail &&
        t.assigneeEmail !== auth.access.email &&
        old?.assigneeEmail !== t.assigneeEmail
      )
        statements.push(
          db
            .prepare(
              "INSERT INTO atlas_notifications (id,recipient,project_id,text,created_at,read) SELECT ?,?,?,?,?,0 WHERE changes()>0",
            )
            .bind(
              crypto.randomUUID(),
              t.assigneeEmail,
              id,
              `Assigned to you: ${t.title}`,
              updatedAt,
            ),
        );
    }
    const [result] = await db.batch(statements);
    if (!result.meta.changes)
      return json(
        {
          error:
            "This project changed in another session. Reload before editing.",
        },
        409,
      );
    return json({ project: (await projectFor(auth.access, id))!.project });
  } catch {
    console.error("Atlas project update unavailable");
    return json(
      { error: "Your changes could not be saved. Please try again." },
      503,
    );
  }
}

export async function GET(
  _: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const a = await authorize("projects.read");
  if (a.error) return a.error;
  try {
    const p = await projectFor(a.access, (await params).id);
    return p
      ? json({ project: p.project })
      : json({ error: "Project not found or access changed." }, 404);
  } catch {
    return json({ error: "Project could not be loaded." }, 503);
  }
}
