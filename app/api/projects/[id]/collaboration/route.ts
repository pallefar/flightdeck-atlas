import { authorize } from "@/lib/access";
import { projectFor, activeProjectPeople } from "@/lib/project-access";
import { database, json, sameOrigin } from "@/lib/server-projects";
import { recordSchema } from "@/lib/collaboration";
export const dynamic = "force-dynamic";
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const a = await authorize("projects.read");
  if (a.error) return a.error;
  try {
    const id = (await params).id,
      p = await projectFor(a.access, id);
    if (!p) return json({ error: "Project not found." }, 404);
    const u = new URL(req.url),
      kind = u.searchParams.get("kind") || "comment",
      offset = Math.max(
        0,
        Math.min(100000, Number(u.searchParams.get("offset")) || 0),
      );
    if (
      !["comment", "meeting", "decision", "approval", "benefit"].includes(kind)
    )
      return json({ error: "Unknown record type." }, 400);
    const rows = await database()
      .prepare(
        "SELECT * FROM atlas_collaboration WHERE project_id=? AND kind=? ORDER BY updated_at DESC,id DESC LIMIT 101 OFFSET ?",
      )
      .bind(id, kind, offset)
      .all();
    const files = await database()
      .prepare(
        "SELECT * FROM atlas_files WHERE project_id=? ORDER BY created_at DESC",
      )
      .bind(id)
      .all();
    return json({
      nextOffset: rows.results.length > 100 ? offset + 100 : null,
      records: rows.results
        .slice(0, 100)
        .map((r) => ({
          ...JSON.parse(r.data as string),
          id: r.id,
          author: r.author,
          updatedAt: r.updated_at,
          revision: r.revision,
        })),
      files: files.results,
      people: await activeProjectPeople(a.access, id),
      email: a.access.email,
      canComment: p.rights.comment,
    });
  } catch {
    return json({ error: "Collaboration is unavailable." }, 503);
  }
}
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!sameOrigin(req))
    return json({ error: "Request origin is not allowed." }, 403);
  const a = await authorize("projects.read");
  if (a.error) return a.error;
  try {
    const projectId = (await params).id,
      p = await projectFor(a.access, projectId);
    if (!p) return json({ error: "Project not found." }, 404);
    const raw = await req.text();
    if (raw.length > 25000)
      return json({ error: "This update is too large." }, 400);
    const b = JSON.parse(raw),
      db = database(),
      now = new Date().toISOString();
    let data = recordSchema.parse(b.data),
      old = null;
    const id =
      typeof b.id === "string" && /^[a-zA-Z0-9-]{1,80}$/.test(b.id)
        ? b.id
        : crypto.randomUUID();
    if (b.revision) {
      old = await db
        .prepare(
          "SELECT * FROM atlas_collaboration WHERE id=? AND project_id=?",
        )
        .bind(id, projectId)
        .first();
      if (!old) return json({ error: "Record not found." }, 404);
      if (old.revision !== b.revision)
        return json({ error: "This record changed. Reload first." }, 409);
    }
    if (old) {
      const prev = recordSchema.parse(JSON.parse(old.data as string));
      if (prev.kind === "approval" && b.action === "review") {
        if (
          prev.reviewer !== a.access.email ||
          !["approved", "changes"].includes(data.status)
        )
          return json(
            { error: "Only the named reviewer can make this decision." },
            403,
          );
        if (prev.status !== "requested")
          return json({ error: "This review has already been decided." }, 409);
        data = {
          ...prev,
          status: data.status,
          body: `${prev.body}\n\nReview by ${a.access.email} · ${now}\n${data.body}`,
        };
      } else {
        if (
          !p.rights.edit &&
          !(
            prev.kind === "comment" &&
            p.rights.comment &&
            old.author === a.access.email
          )
        )
          return json({ error: "You cannot edit this record." }, 403);
        if (prev.kind !== data.kind)
          return json({ error: "Record type cannot change." }, 400);
        if (prev.kind === "approval")
          return json(
            { error: "Create a new request to repeat a review." },
            400,
          );
      }
    } else {
      if (data.kind === "comment" ? !p.rights.comment : !p.rights.edit)
        return json({ error: "You cannot add this record." }, 403);
      data = {
        ...data,
        status: data.kind === "approval" ? "requested" : "open",
      };
    }
    const people = await activeProjectPeople(a.access, projectId);
    const historical = old
      ? recordSchema.parse(JSON.parse(old.data as string))
      : null;
    if (
      [...data.mentions, ...(data.reviewer ? [data.reviewer] : [])].some(
        (e) =>
          !historical?.mentions.includes(e) &&
          historical?.reviewer !== e &&
          !people.some((m) => m.email === e),
      )
    )
      return json(
        { error: "Choose members who can currently access this project." },
        400,
      );
    if (data.kind === "approval" && !data.reviewer)
      return json({ error: "Choose a reviewer." }, 400);
    if (
      data.taskId &&
      historical?.taskId !== data.taskId &&
      !p.project.tasks.some((t) => t.id === data.taskId)
    )
      return json({ error: "Task not found in this project." }, 400);
    const stmt = old
      ? db
          .prepare(
            "UPDATE atlas_collaboration SET data=?,updated_at=?,revision=revision+1 WHERE id=? AND project_id=? AND revision=?",
          )
          .bind(JSON.stringify(data), now, id, projectId, b.revision)
      : db
          .prepare(
            "INSERT OR IGNORE INTO atlas_collaboration(id,project_id,kind,data,author,updated_at,revision) VALUES (?,?,?,?,?,?,1)",
          )
          .bind(
            id,
            projectId,
            data.kind,
            JSON.stringify(data),
            a.access.email,
            now,
          );
    const statements = [stmt];
    const recipients = new Set([
      ...data.mentions,
      ...(data.reviewer ? [data.reviewer] : []),
      ...(old && b.action === "review" ? [old.author as string] : []),
    ]);
    for (const e of recipients)
      if (e !== a.access.email && people.some((m) => m.email === e))
        statements.push(
          db
            .prepare(
              "INSERT INTO atlas_notifications(id,recipient,project_id,text,created_at,read) SELECT ?,?,?,?,?,0 WHERE changes()>0",
            )
            .bind(
              crypto.randomUUID(),
              e,
              projectId,
              `${data.kind}: ${data.title}`,
              now,
            ),
        );
    const [r] = await db.batch(statements);
    if (!r.meta.changes)
      return json(
        {
          error:
            "This record was already saved or changed. Reload before saving again.",
        },
        409,
      );
    return json({ success: true, id });
  } catch {
    return json(
      {
        error:
          "The update could not be saved. Check the required fields and retry.",
      },
      400,
    );
  }
}
