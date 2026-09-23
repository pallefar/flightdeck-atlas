import {
  processWorkMutation,
  cancellationStatement,
} from "@/lib/work-mutation";
import { evaluateRules } from "@/lib/advanced-work";
import {
  validateWorkAccess,
  guardSQL,
  guardValues,
} from "@/lib/work-validation";
import { authorize } from "@/lib/access";
import {
  database,
  json,
  sameOrigin,
  readFields,
  recordChanges,
} from "@/lib/server-projects";
import { projectFor, activeProjectPeople } from "@/lib/project-access";
import {
  DRAFT_NOT_HELD_SQL,
  deleteProject,
  draftHeld,
} from "@/lib/flightdeck/onboard-route";
import { draftEdited } from "@/lib/flightdeck/onboarding";
import { applyWorkRules, stampTimeEntries } from "@/lib/work-management";
import { projectSchema } from "@/lib/projects";
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
    // A send FlightDeck has not confirmed still holds the exact request body
    // it would resend, summary and success measure included. Deleting the
    // project would leave that copy in a row no route can reach, so the send
    // is closed first — the same lock the To FlightDeck row shows on the
    // draft, applied to the project the draft belongs to. The check is part
    // of the delete itself, and the send's reservation needs the project, so
    // a send pressed meanwhile cannot slip in between. A deleted project's
    // send history and FlightDeck link go with it: nothing else can read
    // them, and a link left behind would hold its OS project against every
    // later Atlas project for good.
    const outcome = await deleteProject(database(), id, revision);
    if (outcome === "unconfirmed")
      return json(
        {
          error:
            "FlightDeck has not confirmed this project's send. Close the unconfirmed send in Connections → To FlightDeck before deleting the project.",
        },
        409,
      );
    if (outcome === "changed")
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
    const authorized = await projectFor(auth.access, id);
    if (!authorized) return json({ error: "Project not found." }, 404);
    const previous = authorized.project;
    if (
      !authorized.rights.edit ||
      (!!fields.archived !== !!previous.archived && !authorized.rights.archive)
    )
      return json(
        { error: "You do not have permission to change this project." },
        403,
      );
    const eligible = await activeProjectPeople(auth.access, id);
    if (
      fields.tasks.some(
        (t) =>
          t.assigneeEmail &&
          previous.tasks.find((x) => x.id === t.id)?.assigneeEmail !==
            t.assigneeEmail &&
          !eligible.some((m) => m.email === t.assigneeEmail),
      )
    )
      return json(
        { error: "Choose an active member with access to this project." },
        400,
      );
    if (previous.revision !== revision)
      return json(
        {
          error:
            "This project changed in another session. Reload before editing.",
        },
        409,
      );
    // While FlightDeck may hold a send, the draft stays exactly as it was
    // sent. The form and the To FlightDeck row lock it too, but a form that
    // has not loaded its status knows nothing, so the save refuses on its
    // own, and the UPDATE below re-checks it in the same statement.
    const draftEdit = draftEdited(previous, fields);
    if (draftEdit && (await draftHeld(db, id)))
      return json(
        {
          error:
            "FlightDeck may hold this project's onboarding draft, so it stays as it was sent. Nothing was saved.",
          code: "draft_locked",
        },
        409,
      );
    const updatedAt = new Date().toISOString();
    try {
      fields = stampTimeEntries(fields, previous, auth.access.email);
    } catch (e) {
      return json({ error: (e as Error).message }, 400);
    }
    let dependencyGuards, processed;
    try {
      processed = processWorkMutation(
        fields,
        previous,
        updateNote,
        updatedAt,
        auth.access.email,
      );
      dependencyGuards = await validateWorkAccess(
        processed.recorded,
        id,
        auth.access,
      );
    } catch (e) {
      return json(
        { error: e instanceof Error ? e.message : "Check the work settings." },
        400,
      );
    }
    const recorded = processed.recorded;
    if (recorded.tasks.length > 200)
      return json(
        {
          error:
            "This project has reached its 200-task limit. Remove completed tasks before adding another recurring task.",
        },
        400,
      );
    const statements = [
      db
        .prepare(
          "UPDATE atlas_projects SET data = ?, updated_at = ?, revision = revision + 1 WHERE id = ? AND revision = ?" +
            (draftEdit ? DRAFT_NOT_HELD_SQL : "") +
            guardSQL(dependencyGuards),
        )
        .bind(
          JSON.stringify(recorded),
          updatedAt,
          id,
          revision,
          ...guardValues(dependencyGuards),
        ),
    ];
    for (const notice of processed.notices)
      statements.push(
        db
          .prepare(
            "INSERT INTO atlas_notifications (id,recipient,project_id,text,created_at,read) SELECT ?,?,?,?,?,0 WHERE changes()>0",
          )
          .bind(
            crypto.randomUUID(),
            notice.recipient,
            id,
            notice.text,
            updatedAt,
          ),
      );
    const cancel = cancellationStatement(db, previous, recorded);
    if (cancel) statements.push(cancel);
    const [result] = await db.batch(statements);
    if (!result.meta.changes)
      return json(
        {
          error:
            "This project changed in another session. Reload before editing.",
        },
        409,
      );
    return json({ project: (await projectFor(auth.access, id))!.project });
  } catch {
    console.error("Atlas project update unavailable");
    return json(
      { error: "Your changes could not be saved. Please try again." },
      503,
    );
  }
}

export async function GET(
  _: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const a = await authorize("projects.read");
  if (a.error) return a.error;
  try {
    const p = await projectFor(a.access, (await params).id);
    return p
      ? json({ project: p.project })
      : json({ error: "Project not found or access changed." }, 404);
  } catch {
    return json({ error: "Project could not be loaded." }, 503);
  }
}
