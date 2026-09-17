import { authorize } from "@/lib/access";
import { canChangeProject } from "@/lib/access-policy";
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
  const auth = await authorize("projects.read");
  if (auth.error) return auth.error;
  try {
    const result = await database()
      .prepare("SELECT * FROM atlas_projects ORDER BY updated_at DESC")
      .all();
    return json({
      access: auth.access,
      projects: result.results.map((row) => ({
        ...fromRow(row),
        canEdit: canChangeProject(auth.access, row.owner_id as string),
        canArchive: canChangeProject(auth.access, row.owner_id as string, true),
        ownedByMe: row.owner_id === auth.access.userId,
      })),
    });
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
  const auth = await authorize("projects.create");
  if (auth.error) return auth.error;
  const user = auth.access.userId;
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
        JSON.stringify({
          ...fields,
          tasks: project.tasks,
          activity: project.activity,
        }),
        project.source,
        project.updatedAt,
        project.revision,
      )
      .run();
    return json(
      {
        project: {
          ...project,
          canEdit: canChangeProject(auth.access, user),
          canArchive: canChangeProject(auth.access, user, true),
          ownedByMe: true,
        },
      },
      201,
    );
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
