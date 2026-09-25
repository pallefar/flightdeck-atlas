import { authorize } from "@/lib/access";
import { projectFor } from "@/lib/project-access";
import { createDeckWriteRoute } from "@/lib/deck-policy";
import { database, json } from "@/lib/server-projects";
import { deckSchema } from "@/lib/presentations";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const a = await authorize("projects.read");
  if (a.error) return a.error;
  try {
    const query = new URL(req.url).searchParams,
      id = query.get("id"),
      projectId = query.get("project"),
      offset = Math.max(0, Math.min(100000, Number(query.get("offset")) || 0)),
      db = database(),
      rows = id
        ? await db
            .prepare("SELECT * FROM atlas_decks WHERE id=?")
            .bind(id)
            .all()
        : await db
            .prepare(
              "SELECT * FROM atlas_decks WHERE (owner_id=? OR json_extract(data,'$.shared')=1) AND (? IS NULL OR EXISTS (SELECT 1 FROM json_each(atlas_decks.data,'$.projectIds') WHERE value=?)) ORDER BY updated_at DESC,id DESC LIMIT 51 OFFSET ?",
            )
            .bind(a.access.userId, projectId, projectId, offset)
            .all(),
      decks = [];
    for (const row of rows.results.slice(0, 50)) {
      const d = deckSchema.parse(JSON.parse(row.data as string));
      if (projectId && !d.projectIds.includes(projectId)) continue;
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
// Writes go through the fail-closed deck write policy in lib/deck-policy.ts:
// create needs edit on every source project, update needs the owner and edit
// on every source project, delete needs the owner.
const writes = createDeckWriteRoute({
  authorize: () => authorize("projects.read"),
  database,
  sourceRights: async (access, id) =>
    (await projectFor(access, id))?.rights ?? null,
});
export function POST(req: Request) {
  return writes.POST(req);
}
export function DELETE(req: Request) {
  return writes.DELETE(req);
}
