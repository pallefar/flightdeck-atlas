// The /api/flightdeck/onboard handlers, with their dependencies passed in so
// the tests run exactly this code over a fake OS and a local database built
// from migration 0004. The route files wire in the real authorisation, OS
// clients and D1 binding. No Worker bindings are imported here.
//
// Sending files a proposal of kind "project-onboarding" in the OS; an OS
// admin decides. The order below is the contract (PROJECT-BRIDGE-CONTRACT.md
// "Reserve before the remote call"): Super Admin, then the destination from
// this request re-checked against fresh OS lists, then a reserved operation
// row with its idempotency key and the exact request body, and only then the
// one remote write. A lost response keeps the row, its key and its body, so a
// retry resends the same bytes and can never file twice. FlightDeck answers a
// same-key retry with the ORIGINAL submission whatever the body says ("what
// was filed stays filed", proposal §8b), so rebuilding the body from an
// edited project would make Atlas record a revision FlightDeck never got.
import { z } from "zod";
import { json, sameOrigin } from "../http";
import type { Project } from "../projects";
import type { ContextState } from "./context";
import {
  chooseContext,
  type ContextReader,
  type SubmissionClient,
  type SubmitResult,
} from "./context-client";
import {
  buildOnboardingPayload,
  onboardingEnvelope,
  onboardingEnvelopeSchema,
  onboardingSubject,
  personalDataIn,
  projectOnboardingPayloadSchema,
  readiness,
  type OnboardingEnvelope,
  stageFor,
  type OnboardingStage,
  type OnboardingStatus,
  type OperationState,
  type OsSubmissionStatus,
  type SetupState,
} from "./onboarding";

export type OnboardAccess = { userId: string; superAdmin: boolean };
export type OnboardAuth<A extends OnboardAccess> =
  { access: A; error?: never } | { access?: never; error: Response };
/** The part of a D1 binding these handlers use. */
export type OnboardDb = {
  prepare(query: string): {
    bind(...values: unknown[]): {
      first<T = Record<string, unknown>>(): Promise<T | null>;
      all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
      run(): Promise<{ meta: { changes: number } }>;
    };
  };
};
export type OnboardDeps<A extends OnboardAccess> = {
  authorize(): Promise<OnboardAuth<A>>;
  loadProject(
    access: A,
    id: string,
  ): Promise<{ project: Project; canEdit: boolean } | null>;
  visibleProjectIds(access: A): Promise<string[]>;
  /** The OS context reader, or null when FlightDeck is not configured. */
  reader(fresh: boolean): ContextReader | null;
  submissions(): SubmissionClient | null;
  db(): OnboardDb;
  /** This Atlas installation's slug, or null when misconfigured. */
  installationId(): string | null;
  now?(): Date;
  newId?(): string;
};

type OperationRow = {
  id: string;
  atlas_project_id: string;
  atlas_revision: number;
  idempotency_key: string;
  destination_workspace_id: string;
  proposed_label: string;
  proposed_project_id: string | null;
  state: OperationState;
  submission_id: string | null;
  received_at: string | null;
  payload_sha256: string | null;
  reason_code: string | null;
  setup_state: SetupState | null;
  created_by: string;
  updated_at: string;
  checked_at: string | null;
  /** The reserved envelope as sent; null once FlightDeck confirmed or
   * refused it. */
  request_body: string | null;
  /** 1 when Atlas adopted a request FlightDeck already held. */
  adopted: number;
};
type LinkRow = {
  installation_id: string;
  os_instance_id: string;
  workspace_id: string;
  os_project_id: string;
  atlas_project_id: string;
  submission_id: string | null;
  linked_at: string;
  linked_by: string;
  source_revision: number | null;
  last_checked_at: string;
  access_state: "active" | "disabled";
};

const SENT: OperationState[] = ["filed", "promoted", "linked"];
/** Read-backs share the credential's 30 requests a minute with the context
 * reads, so each send is checked at most once a minute, however many tabs
 * ask. */
const POLL_MS = 60_000;
const ATLAS_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const sendSchema = z
  .object({
    destinationWorkspaceId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
    revision: z.number().int().positive(),
  })
  .strict();

async function sha256Hex(text: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
function refuse(
  status: number,
  code: string,
  error: string,
  extra: Record<string, unknown> = {},
  retryAfter?: number | null,
) {
  return Response.json(
    { error, code, ...extra, ...(retryAfter ? { retryAfter } : {}) },
    {
      status,
      headers: {
        "Cache-Control": "private, no-store",
        ...(retryAfter ? { "Retry-After": String(retryAfter) } : {}),
      },
    },
  );
}
const contextRefusals: Record<
  Exclude<ContextState, "ok">,
  { status: number; error: string }
> = {
  not_permitted: {
    status: 403,
    error: "Only the Atlas Super Admin can send a project to FlightDeck.",
  },
  not_configured: {
    status: 503,
    error: "FlightDeck is not configured. Nothing was sent.",
  },
  os_unreachable: {
    status: 503,
    error: "FlightDeck is unreachable. Nothing was sent.",
  },
  unauthorized: {
    status: 502,
    error: "FlightDeck refused Atlas's credential. Nothing was sent.",
  },
  rate_limited: {
    status: 429,
    error: "FlightDeck is busy. Try again shortly. Nothing was sent.",
  },
  workspace_not_found: {
    status: 404,
    error:
      "That FlightDeck workspace is not available to Atlas. Nothing was sent.",
  },
  workspace_disabled: {
    status: 409,
    error: "That FlightDeck workspace is disabled. Nothing was sent.",
  },
  invalid_response: {
    status: 502,
    error: "FlightDeck sent an unexpected response. Nothing was sent.",
  },
};
const submitRefusals = {
  invalid_submission:
    "FlightDeck rejected the request format. Nothing was filed. Check the details and send again.",
  unauthorized: "FlightDeck refused Atlas's credential. Nothing was filed.",
  refused:
    "FlightDeck refused the request: project onboarding is not enabled for Atlas, or the credential lacks submit:proposal. Nothing was filed.",
} as const;
const NOT_CONFIRMED =
  "FlightDeck did not confirm the send. Nothing is lost: Retry send sends the same request again, with the same key.";
/** A refusal of a RETRY says nothing about the earlier attempt, which
 * FlightDeck may have filed: the reservation, its key and its body stay. */
const retryRefusals = {
  invalid_submission: "FlightDeck rejected the request format.",
  unauthorized: "FlightDeck refused Atlas's credential.",
  refused:
    "FlightDeck refused the request: project onboarding is not enabled for Atlas, or the credential lacks submit:proposal.",
} as const;
const KEPT =
  " An earlier attempt may already have been filed, so Atlas keeps this request and its key. Retry send once FlightDeck accepts requests again: it resends the same request.";

/** The envelope reserved with the key, or null if the row holds none. */
function reservedEnvelope(op: OperationRow): OnboardingEnvelope | null {
  if (!op.request_body) return null;
  try {
    const parsed = onboardingEnvelopeSchema.safeParse(
      JSON.parse(op.request_body),
    );
    return parsed.success &&
      parsed.data.payload.idempotencyKey === op.idempotency_key &&
      parsed.data.payload.atlasProjectId === op.atlas_project_id
      ? parsed.data
      : null;
  } catch {
    return null;
  }
}

const isPollable = (op: OperationRow) =>
  op.state === "filed" ||
  op.state === "promoted" ||
  (op.state === "linked" && op.setup_state !== "complete");

async function latestOperation(db: OnboardDb, atlasProjectId: string) {
  // The open send, if any; otherwise the most recent closed one.
  return db
    .prepare(
      "SELECT * FROM atlas_flightdeck_operations WHERE atlas_project_id=? ORDER BY (state IN ('reserved','filed','promoted','linked')) DESC, updated_at DESC, rowid DESC LIMIT 1",
    )
    .bind(atlasProjectId)
    .first<OperationRow>();
}
async function linkFor(
  db: OnboardDb,
  installationId: string,
  atlasProjectId: string,
) {
  return db
    .prepare(
      "SELECT * FROM atlas_project_links WHERE installation_id=? AND atlas_project_id=?",
    )
    .bind(installationId, atlasProjectId)
    .first<LinkRow>();
}
const uniqueViolation = (error: unknown) =>
  /UNIQUE constraint failed/i.test(String((error as Error)?.message));
async function insert(db: OnboardDb, table: string, row: object) {
  const keys = Object.keys(row);
  try {
    await db
      .prepare(
        `INSERT INTO ${table} (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`,
      )
      .bind(...Object.values(row))
      .run();
    return true;
  } catch (error) {
    if (uniqueViolation(error)) return false;
    throw error;
  }
}
/** Updates an operation, optionally only while it is still in one of the
 * given states, so two checks racing each other cannot move it backwards. */
async function patch(
  db: OnboardDb,
  id: string,
  fields: Partial<OperationRow>,
  onlyFrom?: OperationState[],
) {
  const keys = Object.keys(fields) as (keyof OperationRow)[];
  const guard = onlyFrom
    ? ` AND state IN (${onlyFrom.map(() => "?").join(",")})`
    : "";
  const result = await db
    .prepare(
      `UPDATE atlas_flightdeck_operations SET ${keys.map((k) => `${k}=?`).join(",")} WHERE id=?${guard}`,
    )
    .bind(...keys.map((k) => fields[k] ?? null), id, ...(onlyFrom ?? []))
    .run();
  return result.meta.changes > 0;
}

function statusBody(
  op: OperationRow | null,
  link: LinkRow | null,
  superAdmin: boolean,
  notice: string | null = null,
  retryAfter: number | null = null,
): OnboardingStatus {
  return {
    operation: op
      ? {
          state: op.state,
          stage: stageFor({
            state: op.state,
            reasonCode: op.reason_code,
            setupState: op.setup_state,
          }),
          // An adopted request's destination and revision are FlightDeck's;
          // the row only holds what the adopting request asked for.
          destinationWorkspaceId:
            superAdmin && !op.adopted ? op.destination_workspace_id : null,
          submittedAt: op.received_at,
          reasonCode: op.reason_code,
          setupState: op.setup_state,
          atlasRevision: op.adopted ? null : op.atlas_revision,
          adopted: !!op.adopted,
          updatedAt: op.updated_at,
          checkedAt: op.checked_at,
        }
      : null,
    link:
      superAdmin && link
        ? {
            workspaceId: link.workspace_id,
            osProjectId: link.os_project_id,
            linkedAt: link.linked_at,
            accessState: link.access_state,
          }
        : null,
    pendingPayload:
      superAdmin && op?.state === "reserved"
        ? (reservedEnvelope(op)?.payload ?? null)
        : null,
    canSend: !op || ["reserved", "rejected", "refused"].includes(op.state),
    retryPending: op?.state === "reserved",
    pollable: !!op && isPollable(op),
    notice,
    retryAfter,
  };
}

export function createOnboardRoute<A extends OnboardAccess>(
  deps: OnboardDeps<A>,
) {
  const now = () => deps.now?.() ?? new Date();
  const newId = () => deps.newId?.() ?? crypto.randomUUID();

  async function currentStatus(
    db: OnboardDb,
    atlasProjectId: string,
    superAdmin: boolean,
    notice: string | null = null,
    retryAfter: number | null = null,
  ) {
    const installationId = deps.installationId();
    return statusBody(
      await latestOperation(db, atlasProjectId),
      installationId ? await linkFor(db, installationId, atlasProjectId) : null,
      superAdmin,
      notice,
      retryAfter,
    );
  }

  /** Stores the OS answer to the one remote write. */
  async function settle(
    db: OnboardDb,
    op: OperationRow,
    result: SubmitResult,
    submissions: SubmissionClient,
  ) {
    const stamp = now().toISOString();
    const status = () => currentStatus(db, op.atlas_project_id, true);
    switch (result.state) {
      case "ok":
        await patch(
          db,
          op.id,
          {
            state: "filed",
            submission_id: result.data.submissionId,
            received_at: result.data.receivedAt,
            payload_sha256: result.data.payloadSha256,
            reason_code: null,
            request_body: null,
            updated_at: stamp,
            checked_at: stamp,
          },
          ["reserved"],
        );
        return json(await status(), 202);
      case "already_submitted": {
        // FlightDeck already holds an open or promoted request for this
        // subject under another key, one Atlas has no record of (a same-key
        // retry is answered as a duplicate instead). Adopt it only once the
        // read-back proves it is this project's; a slug or label match is
        // never enough. The read-back names neither its destination nor its
        // revision, so the row is flagged `adopted` and claims neither.
        const read = result.submissionId
          ? await submissions.readSubmission(result.submissionId)
          : null;
        if (read?.state === "ok") {
          if (read.data.subject === onboardingSubject(op.atlas_project_id)) {
            await patch(
              db,
              op.id,
              {
                state: "filed",
                submission_id: read.data.submissionId,
                received_at: read.data.receivedAt,
                payload_sha256: read.data.payloadSha256,
                reason_code: null,
                request_body: null,
                adopted: 1,
                updated_at: stamp,
                checked_at: stamp,
              },
              ["reserved"],
            );
            return json(await status(), 202);
          }
        } else if (read) {
          // Could not check: keep the reservation, a retry reuses the key.
          await patch(
            db,
            op.id,
            { reason_code: "already_submitted", updated_at: stamp },
            ["reserved"],
          );
          return refuse(502, "not_confirmed", NOT_CONFIRMED, {
            status: await status(),
          });
        }
        await patch(
          db,
          op.id,
          {
            state: "refused",
            reason_code: "already_submitted",
            request_body: null,
            updated_at: stamp,
          },
          ["reserved"],
        );
        return refuse(
          409,
          "already_submitted",
          "FlightDeck already holds a request for this project that Atlas cannot match. Nothing was sent. Ask the OS admin about it.",
          { status: await status() },
        );
      }
      case "invalid_submission":
      case "unauthorized":
      case "refused":
        // The first attempt refused outright: nothing was filed, so close
        // it, and a corrected draft gets a fresh key. A refused RETRY is
        // different: an earlier attempt of this key ended unknown (any
        // reason_code on a reserved row) and FlightDeck may hold it, so the
        // reservation stays and the next retry reuses the key
        // (PROJECT-BRIDGE-CONTRACT.md: never a fresh key after a lost reply).
        if (op.reason_code !== null) {
          await patch(
            db,
            op.id,
            { reason_code: result.state, updated_at: stamp },
            ["reserved"],
          );
          return refuse(502, result.state, retryRefusals[result.state] + KEPT, {
            status: await status(),
          });
        }
        await patch(
          db,
          op.id,
          {
            state: "refused",
            reason_code: result.state,
            request_body: null,
            updated_at: stamp,
          },
          ["reserved"],
        );
        return refuse(502, result.state, submitRefusals[result.state], {
          status: await status(),
        });
      case "rate_limited":
        await patch(
          db,
          op.id,
          { reason_code: "rate_limited", updated_at: stamp },
          ["reserved"],
        );
        return refuse(
          429,
          "rate_limited",
          "FlightDeck is busy. Retry send shortly: it reuses the same request.",
          { status: await status() },
          result.retryAfter ?? 60,
        );
      default:
        // os_unreachable or invalid_response: FlightDeck may have filed it.
        await patch(
          db,
          op.id,
          { reason_code: result.state, updated_at: stamp },
          ["reserved"],
        );
        return refuse(
          result.state === "os_unreachable" ? 503 : 502,
          "not_confirmed",
          NOT_CONFIRMED,
          { status: await status() },
        );
    }
  }

  async function POST(request: Request, atlasProjectId: string) {
    if (!sameOrigin(request))
      return json({ error: "Request origin is not allowed." }, 403);
    const auth = await deps.authorize();
    if (auth.error) return auth.error;
    const { access } = auth;
    // Decision 7: only the Atlas Super Admin presses Send.
    if (!access.superAdmin)
      return refuse(
        403,
        "not_permitted",
        "Only the Atlas Super Admin can send a project to FlightDeck.",
      );
    if (!request.headers.get("content-type")?.includes("application/json"))
      return refuse(
        415,
        "unsupported_media_type",
        "Send the destination workspace as JSON.",
      );
    const raw = await request.text();
    let parsed;
    try {
      parsed = sendSchema.safeParse(raw.length > 2000 ? null : JSON.parse(raw));
    } catch {
      parsed = null;
    }
    if (!parsed?.success)
      return refuse(
        400,
        "invalid_request",
        "Choose the FlightDeck workspace to send this project to.",
      );
    const { destinationWorkspaceId, revision } = parsed.data;
    try {
      const loaded = await deps.loadProject(access, atlasProjectId);
      if (!loaded) return refuse(404, "not_found", "Project not found.");
      const { project } = loaded;
      if (!loaded.canEdit)
        return refuse(403, "not_permitted", "You cannot onboard this project.");
      if (project.source !== "atlas" || !ATLAS_ID_RE.test(project.id))
        return refuse(
          400,
          "not_eligible",
          "Only projects created in Atlas can be sent to FlightDeck.",
        );
      const installationId = deps.installationId();
      const reader = deps.reader(true);
      const submissions = deps.submissions();
      if (!reader || !submissions || !installationId)
        return refuse(
          503,
          "not_configured",
          "FlightDeck is not configured. Nothing was sent.",
        );
      const db = deps.db();
      const existing = await latestOperation(db, project.id);
      if (existing && SENT.includes(existing.state))
        return refuse(
          409,
          "already_submitted",
          "This project has already been sent to FlightDeck.",
          { status: await currentStatus(db, project.id, true) },
        );
      const reuse = existing?.state === "reserved" ? existing : null;
      let envelope: OnboardingEnvelope;
      if (reuse) {
        // A retry resends the reserved request byte for byte: same key,
        // destination, revision, requester and text, whatever the project
        // says now and whoever presses Retry.
        if (reuse.destination_workspace_id !== destinationWorkspaceId)
          return refuse(
            409,
            "pending_send",
            `A send to ${reuse.destination_workspace_id} is waiting for FlightDeck to confirm it. Retry that send first.`,
            { destinationWorkspaceId: reuse.destination_workspace_id },
          );
        if (revision !== reuse.atlas_revision)
          return refuse(
            409,
            "pending_send_changed",
            `FlightDeck may already hold revision ${reuse.atlas_revision} of this project. Retry send resends revision ${reuse.atlas_revision} exactly as it was first sent; later edits are not included. Review it and retry.`,
            { atlasRevision: reuse.atlas_revision },
          );
        const stored = reservedEnvelope(reuse);
        if (!stored)
          return refuse(
            409,
            "pending_send_unreadable",
            "Atlas cannot read the request it reserved, so it cannot retry it safely. Nothing was sent. Ask the OS admin whether FlightDeck received it.",
          );
        envelope = stored;
      } else {
        if (project.revision !== revision)
          return refuse(
            409,
            "project_changed",
            "This project changed after you reviewed it. Review it again before sending.",
          );
        const missing = readiness(project, destinationWorkspaceId)
          .items.filter((item) => !item.done)
          .map((item) => item.key);
        if (missing.length)
          return refuse(
            400,
            "not_ready",
            "Complete the required FlightDeck details before sending.",
            { missing },
          );
        const built = projectOnboardingPayloadSchema.safeParse(
          buildOnboardingPayload({
            project,
            destinationWorkspaceId,
            idempotencyKey: newId(),
            installationId,
            requestedBy: await sha256Hex(access.userId),
          }),
        );
        if (!built.success)
          return refuse(
            400,
            "invalid_payload",
            "Some FlightDeck details are not in the agreed format. Check them, save and try again.",
          );
        // Decision 4: role titles, never people. Fields §3 classes as not
        // personal refuse an email or phone-number shape; the refusal names
        // the fields, never their values. Summary and success measure are
        // free text the owner chose to send (decision 5): warned in the form.
        const { refused: fields } = personalDataIn(built.data);
        if (fields.length)
          return refuse(
            400,
            "personal_data",
            "Remove the email address or phone number from these fields: FlightDeck receives role titles and system names, not personal details. Nothing was sent.",
            { fields },
          );
        envelope = onboardingEnvelope(built.data);
      }
      // The destination comes from this request only, never from saved
      // preferences or the planning note, and is re-checked against fresh
      // OS lists: it must be listed, enabled and readable.
      const view = await chooseContext(
        reader,
        { osWorkspaceId: destinationWorkspaceId },
        { superAdmin: true },
      );
      if (
        view.state !== "ok" ||
        view.selected?.osWorkspaceId !== destinationWorkspaceId
      ) {
        const state = view.state === "ok" ? "invalid_response" : view.state;
        const { status, error } = contextRefusals[state];
        return refuse(status, state, error, {}, view.retryAfter);
      }
      const stamp = now().toISOString();
      let op: OperationRow;
      if (reuse) {
        // Nothing about the reserved request changes, only the stamp; the
        // guard stops a retry racing a settled send.
        if (!(await patch(db, reuse.id, { updated_at: stamp }, ["reserved"])))
          return refuse(
            409,
            "send_in_progress",
            "A send for this project is already in progress.",
          );
        op = { ...reuse, updated_at: stamp };
      } else {
        const { payload } = envelope;
        op = {
          id: newId(),
          atlas_project_id: project.id,
          atlas_revision: payload.atlasRevision,
          idempotency_key: payload.idempotencyKey,
          destination_workspace_id: destinationWorkspaceId,
          proposed_label: payload.target.label,
          proposed_project_id: payload.target.projectId ?? null,
          state: "reserved",
          submission_id: null,
          received_at: null,
          payload_sha256: null,
          reason_code: null,
          setup_state: null,
          created_by: access.userId,
          updated_at: stamp,
          checked_at: null,
          request_body: JSON.stringify(envelope),
          adopted: 0,
        };
        // Reserved BEFORE the remote call. The partial unique index allows
        // one open send per project, so a second tab loses here.
        if (!(await insert(db, "atlas_flightdeck_operations", op)))
          return refuse(
            409,
            "send_in_progress",
            "A send for this project is already in progress.",
          );
      }
      const result = await submissions.submit(envelope);
      return await settle(db, op, result, submissions);
    } catch {
      return refuse(
        503,
        "storage_unavailable",
        "Onboarding storage is unavailable. Try again: a retry never files a second request.",
      );
    }
  }

  /** Writes the link only after read:context lists the promoted project. */
  async function confirmLink(
    db: OnboardDb,
    op: OperationRow,
    outcome: NonNullable<OsSubmissionStatus["promoted"]>,
    reader: ContextReader,
    installationId: string,
    userId: string,
    stamp: string,
  ) {
    const hold = async (reason: string, notice: string) => {
      await patch(db, op.id, { reason_code: reason }, ["promoted"]);
      return { notice, retryAfter: null };
    };
    const later = (state: string, retryAfter?: number) => ({
      notice:
        "Atlas could not confirm the project in FlightDeck yet. It will check again.",
      retryAfter: state === "rate_limited" ? (retryAfter ?? null) : null,
    });
    const ws = await reader.workspaces();
    if (ws.state !== "ok") return later(ws.state, ws.retryAfter);
    const instanceId = ws.data.instanceId;
    if (!instanceId)
      return hold(
        "instance_unknown",
        "FlightDeck does not publish its instance id yet, so Atlas cannot record the link. The project stays Submitted.",
      );
    if (!ws.data.workspaces.some((w) => w.id === outcome.workspaceId))
      return hold(
        "destination_not_shared",
        "FlightDeck accepted the request, but its workspace is not shared with Atlas, so Atlas cannot confirm the project.",
      );
    const pr = await reader.projects(outcome.workspaceId);
    if (pr.state !== "ok") return later(pr.state, pr.retryAfter);
    const found = pr.data.projects.find((p) => p.id === outcome.projectId);
    if (!found)
      return hold(
        "project_not_visible",
        "FlightDeck says the project was created, but its project list does not show it yet. Atlas will check again.",
      );
    const link: LinkRow = {
      installation_id: installationId,
      os_instance_id: instanceId,
      workspace_id: outcome.workspaceId,
      os_project_id: outcome.projectId,
      atlas_project_id: op.atlas_project_id,
      submission_id: op.submission_id,
      linked_at: stamp,
      linked_by: userId,
      // An adopted request's revision is unknown to Atlas.
      source_revision: op.adopted ? null : op.atlas_revision,
      last_checked_at: stamp,
      access_state: found.enabled ? "active" : "disabled",
    };
    if (!(await insert(db, "atlas_project_links", link))) {
      const mine = await linkFor(db, installationId, op.atlas_project_id);
      const same =
        mine &&
        mine.os_instance_id === instanceId &&
        mine.workspace_id === outcome.workspaceId &&
        mine.os_project_id === outcome.projectId;
      if (!same)
        return hold(
          "link_conflict",
          "That FlightDeck project is already linked to another Atlas project, or this project to another FlightDeck project. Atlas did not link it.",
        );
    }
    await patch(
      db,
      op.id,
      { state: "linked", reason_code: null, updated_at: stamp },
      ["promoted"],
    );
    return { notice: null, retryAfter: null };
  }

  /** One read-back, then whatever it allows: rejected, promoted, linked. */
  async function reconcile(
    db: OnboardDb,
    op: OperationRow,
    reader: ContextReader,
    submissions: SubmissionClient,
    installationId: string,
    userId: string,
  ): Promise<{ notice: string | null; retryAfter: number | null }> {
    const stamp = now().toISOString();
    const touch = (
      extra: Partial<OperationRow> = {},
      from?: OperationState[],
    ) => patch(db, op.id, { checked_at: stamp, ...extra }, from);
    const read = await submissions.readSubmission(op.submission_id ?? "");
    if (read.state !== "ok") {
      await touch();
      return {
        notice:
          read.state === "not_found"
            ? "FlightDeck does not know this request. Ask the OS admin before sending again."
            : "Atlas could not check FlightDeck just now. It will try again.",
        retryAfter:
          read.state === "rate_limited" ? (read.retryAfter ?? null) : null,
      };
    }
    const s = read.data;
    if (s.subject !== onboardingSubject(op.atlas_project_id)) {
      await touch();
      return {
        notice:
          "FlightDeck answered for a different request. Nothing was changed.",
        retryAfter: null,
      };
    }
    const receipt = {
      received_at: op.received_at ?? s.receivedAt,
      payload_sha256: op.payload_sha256 ?? s.payloadSha256,
    };
    const none = { notice: null, retryAfter: null };
    switch (s.state) {
      case "filed":
        await touch(receipt);
        return none;
      case "rejected":
        // Rejection releases the OS subject lock: the draft reopens and a
        // revised draft is sent with a fresh key.
        await touch(
          {
            ...receipt,
            state: "rejected",
            reason_code: s.reasonCode ?? "other",
            updated_at: stamp,
          },
          ["filed", "promoted"],
        );
        return none;
      case "promoted-or-withdrawn":
        await touch(receipt);
        return {
          notice:
            "FlightDeck no longer lists this request as open but did not say what happened. Ask the OS admin.",
          retryAfter: null,
        };
      case "promoted": {
        if (!s.promoted) {
          await touch({ ...receipt, reason_code: "destination_not_shared" });
          return {
            notice:
              "FlightDeck accepted the request, but its workspace is not shared with Atlas, so Atlas cannot confirm the project.",
            retryAfter: null,
          };
        }
        if (op.state === "linked") {
          await touch(
            { setup_state: s.promoted.setupState, updated_at: stamp },
            ["linked"],
          );
          await db
            .prepare(
              "UPDATE atlas_project_links SET last_checked_at=? WHERE installation_id=? AND atlas_project_id=?",
            )
            .bind(stamp, installationId, op.atlas_project_id)
            .run();
          return none;
        }
        await touch(
          {
            ...receipt,
            state: "promoted",
            setup_state: s.promoted.setupState,
            reason_code: null,
            updated_at: stamp,
          },
          ["filed", "promoted"],
        );
        return confirmLink(
          db,
          { ...op, state: "promoted" },
          s.promoted,
          reader,
          installationId,
          userId,
          stamp,
        );
      }
    }
  }

  async function GET(request: Request, atlasProjectId: string) {
    const refresh = new URL(request.url).searchParams.get("refresh") === "1";
    // A refresh can contact the OS, so it is same-origin only.
    if (refresh && !sameOrigin(request))
      return json({ error: "Request origin is not allowed." }, 403);
    const auth = await deps.authorize();
    if (auth.error) return auth.error;
    const { access } = auth;
    try {
      if (!(await deps.loadProject(access, atlasProjectId)))
        return refuse(404, "not_found", "Project not found.");
      const db = deps.db();
      const op = await latestOperation(db, atlasProjectId);
      let notice: string | null = null,
        retryAfter: number | null = null;
      // Only the Super Admin's view reads the OS: the machine credential
      // cannot filter per Atlas user (same rule as the context route).
      if (
        refresh &&
        access.superAdmin &&
        op &&
        isPollable(op) &&
        (!op.checked_at ||
          now().getTime() - Date.parse(op.checked_at) >= POLL_MS)
      ) {
        const reader = deps.reader(true);
        const submissions = deps.submissions();
        const installationId = deps.installationId();
        if (!reader || !submissions || !installationId)
          notice =
            "FlightDeck is not configured, so Atlas cannot check this request.";
        else
          ({ notice, retryAfter } = await reconcile(
            db,
            op,
            reader,
            submissions,
            installationId,
            access.userId,
          ));
      }
      return json(
        await currentStatus(
          db,
          atlasProjectId,
          access.superAdmin,
          notice,
          retryAfter,
        ),
      );
    } catch {
      return refuse(
        503,
        "storage_unavailable",
        "Onboarding status is unavailable. Try again shortly.",
      );
    }
  }

  /** Stored stages for the projects the caller can see. Never reads the OS. */
  async function LIST() {
    const auth = await deps.authorize();
    if (auth.error) return auth.error;
    try {
      const visible = new Set(await deps.visibleProjectIds(auth.access));
      const rows = await deps
        .db()
        .prepare(
          "SELECT atlas_project_id,state,reason_code,setup_state FROM atlas_flightdeck_operations ORDER BY (state IN ('reserved','filed','promoted','linked')), updated_at, rowid",
        )
        .bind()
        .all<
          Pick<
            OperationRow,
            "atlas_project_id" | "state" | "reason_code" | "setup_state"
          >
        >();
      const stages: Record<string, OnboardingStage> = {};
      // Open sends sort last, so they win over older closed ones.
      for (const row of rows.results)
        if (visible.has(row.atlas_project_id))
          stages[row.atlas_project_id] = stageFor({
            state: row.state,
            reasonCode: row.reason_code,
            setupState: row.setup_state,
          });
      return json({ stages });
    } catch {
      return refuse(
        503,
        "storage_unavailable",
        "Onboarding status is unavailable. Try again shortly.",
      );
    }
  }

  return { POST, GET, LIST };
}
