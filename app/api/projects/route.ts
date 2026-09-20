import { authorize, superAdminEmail } from "@/lib/access";
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
import { visibleProjects } from "@/lib/project-access";
import { stampTimeEntries } from "@/lib/work-management";
export const dynamic = "force-dynamic";
export async function GET() {
  const auth = await authorize("projects.read");
  if (auth.error) return auth.error;
  try {
    return json({
      access: auth.access,
      projects: await visibleProjects(auth.access),
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
    fields = stampTimeEntries(fields, undefined, auth.access.email);
  } catch (e) {
    return json({ error: (e as Error).message }, 400);
  }
  try {
    if (
      fields.tasks.some(
        (t) =>
          t.assigneeEmail &&
          ![auth.access.email, superAdminEmail()].includes(t.assigneeEmail),
      )
    )
      return json(
        {
          error:
            "Create the private project, share it with a member, then assign their tasks.",
        },
        400,
      );
    const project = newProject(fields);
    if (project.tasks.length > 200)
      return json(
        { error: "Recurring tasks would exceed the 200-task project limit." },
        400,
      );
    const db = database();
    await db.batch([
      db
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
          1,
        ),
      db
        .prepare(
          "INSERT INTO atlas_project_shares (project_id,data,revision) VALUES (?,?,1)",
        )
        .bind(
          project.id,
          JSON.stringify({ visibility: "private", grants: [] }),
        ),
    ]);
    return json(
      {
        project: {
          ...project,
          canShare: true,
          canComment: true,
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
