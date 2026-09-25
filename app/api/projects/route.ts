import {
  validateWorkAccess,
  guardSQL,
  guardValues,
} from "@/lib/work-validation";
import { authorize, superAdminEmail } from "@/lib/access";
import { canChangeProject } from "@/lib/access-policy";
import {
  database,
  owner,
  json,
  sameOrigin,
  readFields,
  lockedAiAgents,
  fromRow,
  newProject,
  requesterRequestsOn,
  onboardingMetricsEnabled,
} from "@/lib/server-projects";
import { resolveSendRequest } from "@/lib/flightdeck/onboarding";
import { recordDraftSave } from "@/lib/flightdeck/metrics";
import { visibleProjects } from "@/lib/project-access";
import { stampTimeEntries } from "@/lib/work-management";
import { env } from "cloudflare:workers";
import { requesterRequestsOn as cardRequesterRequestsOn } from "@/lib/flightdeck/project-card";
export const dynamic = "force-dynamic";
export async function GET() {
  const auth = await authorize("projects.read");
  if (auth.error) return auth.error;
  try {
    return json({
      access: auth.access,
      projects: await visibleProjects(auth.access),
      // Whether editors see the project page's FlightDeck card (D-037
      // item 4). Default off; it only shows a card, and every onboarding
      // route keeps its own checks.
      requesterRequests: cardRequesterRequestsOn(env.ATLAS_REQUESTER_REQUESTS),
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
  const agents = await lockedAiAgents(request);
  if (agents)
    return json({ error: agents.error, code: agents.code }, agents.status);
  let fields;
  try {
    ({ fields } = await readFields(request));
    fields = stampTimeEntries(fields, undefined, auth.access.email);
  } catch (e) {
    return json({ error: (e as Error).message }, 400);
  }
  // A new project may carry a send request marker only under the same rules
  // as a save: refused while ATLAS_REQUESTER_REQUESTS is off, made only in
  // the creator's own name, and with no client-sent `stale`.
  const marker = resolveSendRequest({
    previous: undefined,
    next: fields.onboarding,
    enabled: requesterRequestsOn(),
    actor: auth.access.email,
  });
  if (!marker.ok)
    return json({ error: marker.error, code: marker.code }, marker.status);
  fields = { ...fields, onboarding: marker.onboarding };
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
    let dependencyGuards;
    try {
      dependencyGuards = await validateWorkAccess(
        fields,
        project.id,
        auth.access,
        true,
      );
    } catch (e) {
      return json({ error: (e as Error).message }, 400);
    }
    if (project.tasks.length > 200)
      return json(
        { error: "Recurring tasks would exceed the 200-task project limit." },
        400,
      );
    const db = database();
    const results = await db.batch([
      db
        .prepare(
          "INSERT INTO atlas_projects (id, owner_id, data, source, updated_at, revision) SELECT ?, ?, ?, ?, ?, ? WHERE 1=1" +
            guardSQL(dependencyGuards),
        )
        .bind(
          project.id,
          user,
          JSON.stringify({
            ...fields,
            onboardingRevision: 1,
            tasks: project.tasks,
            activity: project.activity,
          }),
          project.source,
          project.updatedAt,
          1,
          ...guardValues(dependencyGuards),
        ),
      db
        .prepare(
          "INSERT INTO atlas_project_shares (project_id,data,revision) SELECT ?,?,1 WHERE changes()>0",
        )
        .bind(
          project.id,
          JSON.stringify({ visibility: "private", grants: [] }),
        ),
    ]);
    if (!results[0].meta.changes)
      return json(
        { error: "A dependency changed. Retry creating this project." },
        409,
      );
    // Measure (default off): a project created with onboarding details is
    // its draft's first save.
    await recordDraftSave(
      db,
      onboardingMetricsEnabled(),
      project.id,
      {},
      fields,
      project.updatedAt,
    );
    return json(
      {
        project: {
          ...project,
          onboardingRevision: 1,
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
