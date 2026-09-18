import { authorize } from "@/lib/access";
import { projectFor, directory, teamList } from "@/lib/project-access";
import { database, json, sameOrigin } from "@/lib/server-projects";
import { sharingSchema } from "@/lib/collaboration";
export const dynamic = "force-dynamic";
export async function GET(
  _: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const a = await authorize("projects.read");
  if (a.error) return a.error;
  try {
    const p = await projectFor(a.access, (await params).id);
    if (!p) return json({ error: "Project not found." }, 404);
    if (!p.rights.share)
      return json(
        { error: "Only the owner or Super Admin manages sharing." },
        403,
      );
    return json({
      sharing: p.rights.sharing,
      people: await directory(a.access),
      teams: (await teamList()).map((t) => ({ id: t.id, name: t.name })),
    });
  } catch {
    return json({ error: "Sharing is unavailable." }, 503);
  }
}
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!sameOrigin(req))
    return json({ error: "Request origin is not allowed." }, 403);
  const a = await authorize("projects.read");
  if (a.error) return a.error;
  try {
    const id = (await params).id,
      p = await projectFor(a.access, id);
    if (!p) return json({ error: "Project not found." }, 404);
    if (!p.rights.share)
      return json(
        { error: "Only the owner or Super Admin manages sharing." },
        403,
      );
    const text = await req.text();
    if (text.length > 40000) return json({ error: "Too many grants." }, 400);
    const b = JSON.parse(text),
      s = sharingSchema.parse(b),
      people = await directory(a.access),
      teams = await teamList();
    if (s.visibility !== "shared") s.grants = [];
    if (
      s.grants.some(
        (g) =>
          !p.rights.sharing.grants.some(
            (old) =>
              old.type === g.type &&
              old.target === g.target &&
              old.role === g.role,
          ) &&
          (g.type === "person"
            ? !people.some((m) => m.email === g.target)
            : !teams.some((t) => t.id === g.target)),
      )
    )
      return json(
        {
          error:
            "Choose existing members or teams. Dashboard admission is managed separately.",
        },
        400,
      );
    if (b.revision !== p.rights.sharing.revision)
      return json({ error: "Sharing changed. Reload before saving." }, 409);
    const db = database(),
      stmt =
        b.revision === 0
          ? db
              .prepare(
                "INSERT OR IGNORE INTO atlas_project_shares(project_id,data,revision) VALUES (?,?,1)",
              )
              .bind(id, JSON.stringify(s))
          : db
              .prepare(
                "UPDATE atlas_project_shares SET data=?,revision=revision+1 WHERE project_id=? AND revision=?",
              )
              .bind(JSON.stringify(s), id, b.revision);
    const [r] = await db.batch([
      stmt,
      db
        .prepare(
          "INSERT INTO atlas_access_events(id,actor,action,target,created_at) SELECT ?,?,?,?,? WHERE changes()>0",
        )
        .bind(
          crypto.randomUUID(),
          a.access.userId,
          `Project sharing: ${s.visibility}`,
          id,
          new Date().toISOString(),
        ),
    ]);
    if (!r.meta.changes)
      return json({ error: "Sharing changed. Reload before saving." }, 409);
    return json({ sharing: { ...s, revision: b.revision + 1 } });
  } catch {
    return json(
      {
        error:
          "Sharing could not be saved. Check the selected people and roles.",
      },
      400,
    );
  }
}
