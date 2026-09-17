import {
  database,
  owner,
  json,
  sameOrigin,
  readFields,
  fromRow,
} from "@/lib/server-projects";
export const dynamic = "force-dynamic";
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!sameOrigin(request))
    return json({ error: "Request origin is not allowed." }, 403);
  const user = await owner();
  if (!user) return json({ error: "Sign in to delete projects." }, 401);
  const { id } = await params;
  const revision = Number(new URL(request.url).searchParams.get("revision"));
  if (!Number.isInteger(revision) || revision < 1)
    return json({ error: "A current project revision is required." }, 400);
  try {
    const db = database();
    const result = await db
      .prepare(
        "DELETE FROM atlas_projects WHERE id = ? AND owner_id = ? AND revision = ?",
      )
      .bind(id, user, revision)
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
  const user = await owner();
  if (!user) return json({ error: "Sign in to edit projects." }, 401);
  const { id } = await params;
  let fields, revision;
  try {
    ({ fields, revision } = await readFields(request));
    if (!Number.isInteger(revision) || revision < 1)
      throw Error("A project revision is required.");
  } catch (e) {
    return json({ error: (e as Error).message }, 400);
  }
  try {
    const db = database();
    const updatedAt = new Date().toISOString();
    const result = await db
      .prepare(
        "UPDATE atlas_projects SET data = ?, updated_at = ?, revision = revision + 1 WHERE id = ? AND owner_id = ? AND revision = ?",
      )
      .bind(JSON.stringify(fields), updatedAt, id, user, revision)
      .run();
    if (!result.meta.changes) {
      const row = await db
        .prepare("SELECT id FROM atlas_projects WHERE id = ? AND owner_id = ?")
        .bind(id, user)
        .first();
      return json(
        {
          error: row
            ? "This project changed in another session. Reload before editing."
            : "Project not found.",
        },
        row ? 409 : 404,
      );
    }
    const row = await db
      .prepare("SELECT * FROM atlas_projects WHERE id = ? AND owner_id = ?")
      .bind(id, user)
      .first();
    return json({ project: fromRow(row!) });
  } catch {
    console.error("Atlas project update unavailable");
    return json(
      { error: "Your changes could not be saved. Please try again." },
      503,
    );
  }
}
