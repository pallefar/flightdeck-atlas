import {
  database,
  owner,
  json,
  sameOrigin,
  readFields,
  fromRow,
  newProject,
} from "@/lib/server-projects";
export const dynamic = "force-dynamic";
export async function GET() {
  const user = await owner();
  if (!user) return json({ error: "Sign in to load your projects." }, 401);
  try {
    const result = await database()
      .prepare(
        "SELECT * FROM atlas_projects WHERE owner_id = ? ORDER BY updated_at DESC",
      )
      .bind(user)
      .all();
    return json({ projects: result.results.map(fromRow) });
  } catch {
    console.error("Atlas project list unavailable");
    return json(
      { error: "Project storage is unavailable. Please try again shortly." },
      503,
    );
  }
}
export async function POST(request: Request) {
  if (!sameOrigin(request))
    return json({ error: "Request origin is not allowed." }, 403);
  const user = await owner();
  if (!user) return json({ error: "Sign in to create a project." }, 401);
  let fields;
  try {
    ({ fields } = await readFields(request));
  } catch (e) {
    return json({ error: (e as Error).message }, 400);
  }
  try {
    const project = newProject(fields);
    await database()
      .prepare(
        "INSERT INTO atlas_projects (id, owner_id, data, source, updated_at, revision) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .bind(
        project.id,
        user,
        JSON.stringify(fields),
        project.source,
        project.updatedAt,
        project.revision,
      )
      .run();
    return json({ project }, 201);
  } catch {
    console.error("Atlas project creation unavailable");
    return json(
      {
        error:
          "Your project could not be saved. Your form is still here; please try again.",
      },
      503,
    );
  }
}
