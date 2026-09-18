import { authorize } from "@/lib/access";
import { projectFor } from "@/lib/project-access";
import { database, json, sameOrigin } from "@/lib/server-projects";
import { deckSchema, type Deck } from "@/lib/presentations";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const a = await authorize("projects.read");
  if (a.error) return a.error;
  try {
    const query = new URL(req.url).searchParams,
      id = query.get("id"),
      offset = Math.max(0, Math.min(100000, Number(query.get("offset")) || 0)),
      db = database(),
      rows = id
        ? await db
            .prepare("SELECT * FROM atlas_decks WHERE id=?")
            .bind(id)
            .all()
        : await db
            .prepare(
              "SELECT * FROM atlas_decks WHERE owner_id=? OR json_extract(data,'$.shared')=1 ORDER BY updated_at DESC,id DESC LIMIT 51 OFFSET ?",
            )
            .bind(a.access.userId, offset)
            .all(),
      decks = [];
    for (const row of rows.results.slice(0, 50)) {
      const d = deckSchema.parse(JSON.parse(row.data as string));
      if (row.owner_id !== a.access.userId && !d.shared) continue;
      let permitted = true;
      for (const pid of d.projectIds)
        if (!(await projectFor(a.access, pid))) {
          permitted = false;
          break;
        }
      if (permitted)
        decks.push({
          ...d,
          id: row.id,
          revision: row.revision,
          updatedAt: row.updated_at,
          canEdit: row.owner_id === a.access.userId,
        });
    }
    return id
      ? decks.length
        ? json({ deck: decks[0] })
        : json(
            { error: "Presentation not found or source access changed." },
            404,
          )
      : json({
          decks,
          nextOffset: rows.results.length > 50 ? offset + 50 : null,
        });
  } catch {
    return json({ error: "Presentations are unavailable." }, 503);
  }
}
export async function POST(req: Request) {
  if (!sameOrigin(req))
    return json({ error: "Request origin is not allowed." }, 403);
  const a = await authorize("projects.read");
  if (a.error) return a.error;
  try {
    const raw = await req.text();
    if (raw.length > 450000)
      return json({ error: "Presentation is too large." }, 400);
    const b = JSON.parse(raw),
      data = deckSchema.parse(b.data),
      db = database();
    for (const id of data.projectIds)
      if (!(await projectFor(a.access, id)))
        return json(
          { error: "Source project access changed. Reload before saving." },
          403,
        );
    if (data.snapshots.some((s) => !data.projectIds.includes(s.id)))
      return json({ error: "Invalid source snapshot." }, 400);
    const id = b.id || crypto.randomUUID(),
      at = new Date().toISOString();
    const r = b.revision
      ? await db
          .prepare(
            "UPDATE atlas_decks SET data=?,revision=revision+1,updated_at=? WHERE id=? AND owner_id=? AND revision=?",
          )
          .bind(JSON.stringify(data), at, id, a.access.userId, b.revision)
          .run()
      : await db
          .prepare(
            "INSERT OR IGNORE INTO atlas_decks(id,owner_id,data,revision,updated_at) VALUES (?,?,?,1,?)",
          )
          .bind(id, a.access.userId, JSON.stringify(data), at)
          .run();
    return r.meta.changes
      ? json({
          deck: {
            ...data,
            id,
            revision: (b.revision || 0) + 1,
            updatedAt: at,
            canEdit: true,
          },
        })
      : json(
          {
            error:
              "Presentation changed or is read-only. Reload before saving.",
          },
          409,
        );
  } catch {
    return json(
      {
        error:
          "Presentation could not be saved. Check slide lengths and source selection.",
      },
      400,
    );
  }
}
export async function DELETE(req: Request) {
  if (!sameOrigin(req))
    return json({ error: "Request origin is not allowed." }, 403);
  const a = await authorize("projects.read");
  if (a.error) return a.error;
  const u = new URL(req.url);
  try {
    const r = await database()
      .prepare(
        "DELETE FROM atlas_decks WHERE id=? AND owner_id=? AND revision=?",
      )
      .bind(
        u.searchParams.get("id"),
        a.access.userId,
        Number(u.searchParams.get("revision")),
      )
      .run();
    return r.meta.changes
      ? json({ success: true })
      : json({ error: "Presentation changed or is read-only." }, 409);
  } catch {
    return json({ error: "Presentation could not be removed." }, 503);
  }
}
