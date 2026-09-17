import { authorize } from "@/lib/access";
import { canChangeProject } from "@/lib/access-policy";
import {
  database,
  owner,
  json,
  sameOrigin,
  readFields,
  fromRow,
  recordChanges,
} from "@/lib/server-projects";
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
    const previousRow = await db
      .prepare("SELECT * FROM atlas_projects WHERE id = ?")
      .bind(id)
      .first();
    if (!previousRow) return json({ error: "Project not found." }, 404);
    const previous = fromRow(previousRow);
    if (
      !canChangeProject(auth.access, previousRow.owner_id as string) ||
      (!!fields.archived !== !!previous.archived &&
        !canChangeProject(auth.access, previousRow.owner_id as string, true))
    )
      return json(
        { error: "You do not have permission to change this project." },
        403,
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
    const recorded = recordChanges(fields, previous, updateNote, updatedAt);
    const result = await db
      .prepare(
        "UPDATE atlas_projects SET data = ?, updated_at = ?, revision = revision + 1 WHERE id = ? AND revision = ?",
      )
      .bind(JSON.stringify(recorded), updatedAt, id, revision)
      .run();
    if (!result.meta.changes) {
      const row = await db
        .prepare("SELECT id FROM atlas_projects WHERE id = ?")
        .bind(id)
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
      .prepare("SELECT * FROM atlas_projects WHERE id = ?")
      .bind(id)
      .first();
    return json({
      project: {
        ...fromRow(row!),
        canEdit: canChangeProject(auth.access, row!.owner_id as string),
        canArchive: canChangeProject(
          auth.access,
          row!.owner_id as string,
          true,
        ),
        ownedByMe: row!.owner_id === auth.access.userId,
      },
    });
  } catch {
    console.error("Atlas project update unavailable");
    return json(
      { error: "Your changes could not be saved. Please try again." },
      503,
    );
  }
}
