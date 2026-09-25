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
  readScopedSave,
  lockedAiAgents,
  requesterRequestsOn,
  onboardingMetricsEnabled,
} from "@/lib/server-projects";
import { recordDraftSave } from "@/lib/flightdeck/metrics";
import { askSnapshot } from "@/lib/flightdeck/ask";
import { projectFor, activeProjectPeople } from "@/lib/project-access";
import {
  DRAFT_NOT_HELD_SQL,
  deleteProject,
  draftHeld,
} from "@/lib/flightdeck/onboard-route";
import {
  draftEdited,
  resolveSendRequest,
  sendRequestAction,
  settlePrefill,
  type OnboardingDraft,
} from "@/lib/flightdeck/onboarding";
import type { AccessProfile } from "@/lib/access-policy";
import { applyWorkRules, stampTimeEntries } from "@/lib/work-management";
import { projectSchema, type Project } from "@/lib/projects";
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
  const agents = await lockedAiAgents(request);
  if (agents)
    return json({ error: agents.error, code: agents.code }, agents.status);
  let scoped;
  try {
    scoped = await readScopedSave(request);
  } catch (e) {
    return json({ error: (e as Error).message }, 400);
  }
  if (scoped)
    return scoped.action
      ? sendRequestActionRoute(auth.access, id, scoped)
      : saveOnboarding(auth.access, id, scoped);
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
    // The send request marker is the server's to keep: refused while
    // ATLAS_REQUESTER_REQUESTS is off, kept when a save omits it, and marked
    // stale in this same write when the draft changes after the ask.
    const marker = resolveSendRequest({
      previous: previous.onboarding,
      next: fields.onboarding,
      enabled: requesterRequestsOn(),
      actor: auth.access.email,
      flightdeckDraft: {
        before: previous.flightdeckDraft,
        after: fields.flightdeckDraft,
      },
      profile: { before: previous, after: fields },
    });
    if (!marker.ok)
      return json({ error: marker.error, code: marker.code }, marker.status);
    // A field this save changed is the user's now, whichever editor sent
    // it, so its prefill provenance goes (the regular project editor sends
    // the onboarding details back as they were).
    fields = settlePrefill(previous, {
      ...fields,
      onboarding: marker.onboarding,
    });
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
    const recorded = {
      ...processed.recorded,
      // Server-kept, whatever the client sent: an onboarding-scoped save
      // relies on it to know whether its base has seen the latest onboarding.
      onboardingRevision: onboardingChanged(previous, processed.recorded)
        ? previous.revision + 1
        : previous.onboardingRevision,
    };
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
    // Measure (default off): the draft's first save, as a hash and a time.
    await recordDraftSave(
      db,
      onboardingMetricsEnabled(),
      id,
      previous,
      recorded,
      updatedAt,
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

const onboardingChanged = (
  previous: Pick<Project, "onboarding">,
  next: Pick<Project, "onboarding">,
) =>
  JSON.stringify(previous.onboarding ?? null) !==
  JSON.stringify(next.onboarding ?? null);

/** An onboarding-scoped save (the onboarding form's autosave): only the
 * onboarding field is written, so a save based on an older revision merges
 * over other people's edits to the rest of the project instead of
 * overwriting them. It is refused when the onboarding field itself changed
 * after its base, or when that cannot be told (a project saved before the
 * server kept `onboardingRevision`): the conflict fails closed. Same rights
 * as a whole-project save, and a draft FlightDeck may hold stays as sent. */
async function saveOnboarding(
  access: AccessProfile,
  id: string,
  {
    onboarding,
    baseRevision,
  }: { onboarding: OnboardingDraft; baseRevision: number },
) {
  try {
    const db = database();
    const authorized = await projectFor(access, id);
    if (!authorized) return json({ error: "Project not found." }, 404);
    if (!authorized.rights.edit)
      return json(
        { error: "You do not have permission to change this project." },
        403,
      );
    const previous = authorized.project;
    const marker = resolveSendRequest({
      previous: previous.onboarding,
      next: onboarding,
      enabled: requesterRequestsOn(),
      actor: access.email,
    });
    if (!marker.ok)
      return json({ error: marker.error, code: marker.code }, marker.status);
    onboarding =
      settlePrefill(previous, {
        ...previous,
        onboarding: marker.onboarding ?? {},
      }).onboarding ?? {};
    const seen =
      previous.revision === baseRevision ||
      (previous.onboardingRevision !== undefined &&
        previous.onboardingRevision <= baseRevision);
    if (baseRevision > previous.revision || !seen)
      return json(
        {
          error:
            "The onboarding details changed in another session. Reload before editing.",
          code: "onboarding_changed",
        },
        409,
      );
    if (await draftHeld(db, id))
      return json(
        {
          error:
            "FlightDeck may hold this project's onboarding draft, so it stays as it was sent. Nothing was saved.",
          code: "draft_locked",
        },
        409,
      );
    const updatedAt = new Date().toISOString();
    const changed = onboardingChanged(previous, { onboarding });
    const stored = JSON.parse(authorized.row.data as string);
    const data = {
      ...stored,
      onboarding,
      onboardingRevision: changed
        ? previous.revision + 1
        : previous.onboardingRevision,
      activity: recordChanges(
        { ...previous, onboarding },
        previous,
        "",
        updatedAt,
      ).activity.slice(-200),
    };
    const result = await db
      .prepare(
        "UPDATE atlas_projects SET data = ?, updated_at = ?, revision = revision + 1 WHERE id = ? AND revision = ?" +
          DRAFT_NOT_HELD_SQL,
      )
      .bind(JSON.stringify(data), updatedAt, id, previous.revision)
      .run();
    if (!result.meta.changes)
      return json(
        {
          error:
            "This project changed in another session. Reload before editing.",
        },
        409,
      );
    await recordDraftSave(
      db,
      onboardingMetricsEnabled(),
      id,
      previous,
      { onboarding },
      updatedAt,
    );
    return json({ project: (await projectFor(access, id))!.project });
  } catch {
    console.error("Atlas onboarding update unavailable");
    return json(
      { error: "Your changes could not be saved. Please try again." },
      503,
    );
  }
}

/** Ask the Super Admin to send revision r, or withdraw the open ask
 * (onb-atlas-ask-withdraw, plan J3): the onboarding-scoped PUT with
 * `action`. The rules are sendRequestAction()'s; this writes the result in
 * one UPDATE bound to the revision just read and to the draft lock, so an
 * edit or a send that lands in between makes it 409 instead of asking about
 * a revision nobody saw. The rights are projectFor()'s, like every save. */
async function sendRequestActionRoute(
  access: AccessProfile,
  id: string,
  { action, revision }: { action: "ask" | "withdraw"; revision: number },
) {
  try {
    const db = database();
    const authorized = await projectFor(access, id);
    if (!authorized) return json({ error: "Project not found." }, 404);
    const previous = authorized.project;
    const updatedAt = new Date().toISOString();
    const outcome = sendRequestAction({
      onboarding: previous.onboarding,
      projectRevision: previous.revision,
      action,
      revision,
      enabled: requesterRequestsOn(),
      actor: access.email,
      superAdmin: access.superAdmin,
      canEdit: authorized.rights.edit,
      held: await draftHeld(db, id),
      at: updatedAt,
      // The asked revision's sent fields, so a later change shows the Super
      // Admin a field diff before Send (onb-atlas-request-ui). Only an ask
      // for the current revision is written, so this is that revision.
      ...(action === "ask" ? { fields: askSnapshot(previous) } : {}),
    });
    if (!outcome.ok)
      return json(
        {
          error: outcome.error,
          code: outcome.code,
          ...(outcome.revision ? { revision: outcome.revision } : {}),
        },
        outcome.status,
      );
    const onboarding = outcome.onboarding;
    const stored = JSON.parse(authorized.row.data as string);
    const data = {
      ...stored,
      onboarding,
      // The marker is part of the onboarding JSON, so an onboarding-scoped
      // save based on an older revision is refused rather than merging an
      // old copy of the marker over this one.
      onboardingRevision: previous.revision + 1,
      activity: [
        ...(previous.activity ?? []),
        {
          id: crypto.randomUUID(),
          at: updatedAt,
          kind: "project",
          text:
            action === "ask"
              ? `Asked the Super Admin to send revision ${onboarding.sendRequest!.revision}`
              : `Withdrew the request to send revision ${onboarding.sendRequest!.revision}`,
        },
      ].slice(-200),
    };
    const result = await db
      .prepare(
        "UPDATE atlas_projects SET data = ?, updated_at = ?, revision = revision + 1 WHERE id = ? AND revision = ?" +
          DRAFT_NOT_HELD_SQL,
      )
      .bind(JSON.stringify(data), updatedAt, id, previous.revision)
      .run();
    if (!result.meta.changes)
      return json(
        {
          error:
            "This project changed in another session. Reload before asking again.",
          code: "revision_changed",
        },
        409,
      );
    return json({ project: (await projectFor(access, id))!.project });
  } catch {
    console.error("Atlas send request action unavailable");
    return json(
      { error: "The request could not be saved. Please try again." },
      503,
    );
  }
}
