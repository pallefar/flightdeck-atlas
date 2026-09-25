// The /api/flightdeck/onboard handlers, with their dependencies passed in so
// the tests run exactly this code over a fake OS and a local database built
// from the migrations. The route files wire in the real authorisation, OS
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
// A retry does not re-check the destination: that was done when the key was
// reserved, and only a resend can tell whether the earlier attempt landed.
// When a retry can never succeed (FlightDeck refuses those bytes for good, or
// no longer knows a filed request), the Super Admin closes the send (CLOSE);
// the next send's fresh key meets FlightDeck's subject lock if it does hold
// the project's request, and Atlas follows that request.
import { z } from "zod";
import { json, sameOrigin } from "../http";
import type { Project } from "../projects";
import { isoSchema, type ContextState } from "./context";
import {
  chooseContext,
  type ContextReader,
  type SubmissionClient,
  type SubmitResult,
} from "./context-client";
import {
  buildOnboardingPayload,
  lockedStates,
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
import { applyObservedStage, type TransitionSource } from "./transitions";
import { NO_FEATURES, type InboundFeatures } from "./features";

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
  /** This credential's optional-feature flags from the OS whoami, at most
   * five minutes old (lib/flightdeck/features.ts). Read before each fresh
   * send; absent or failing, every flag is off and no gated field is sent. */
  features?(): Promise<InboundFeatures>;
  db(): OnboardDb;
  /** This Atlas installation's slug, or null when misconfigured. */
  installationId(): string | null;
  now?(): Date;
  newId?(): string;
};

/** A send and its link as stored; what projectStatus projects. */
export type OnboardSendRow = OperationRow;
export type OnboardLinkRow = LinkRow;
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
 * reads, so the open form checks its send at most once a minute, however
 * many tabs ask. */
const POLL_MS = 60_000;
/** The Super Admin's To FlightDeck list and dashboard check sends too, so a
 * status moves without anyone opening the form: at most LIST_BATCH sends a
 * call, each at most every LIST_POLL_MS. Atlas has no background job, so
 * nothing is checked while no Super Admin has Atlas open. */
const LIST_POLL_MS = 5 * 60_000;
const LIST_BATCH = 2;
/** reason_code of a filed send whose read-back FlightDeck answers 404. */
const NOT_FOUND = "submission_not_found";
/** reason_code of a send the Super Admin closed before it was confirmed. */
const ABANDONED = "abandoned";
const ATLAS_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const sendSchema = z
  .object({
    destinationWorkspaceId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
    revision: z.number().int().positive(),
  })
  .strict();
/** Names the send the Super Admin saw, by its last change, so a close never
 * lands on a send that changed (a retry, a new send) since. */
const closeSchema = z.object({ updatedAt: isoSchema }).strict();

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
  " An earlier attempt may already have been filed, so Atlas keeps this request and its key. Retry send once FlightDeck accepts requests again: it resends the same request. If FlightDeck keeps refusing it, close this unconfirmed send and send the project again.";
/** What closing an unconfirmed send means, for the refusals that need it. */
const CLOSE_HINT =
  "Close this unconfirmed send to send the project again: if FlightDeck did file it, the new send follows that request and nothing is filed twice.";

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

/** A send Atlas still reads back from FlightDeck. The list row says when
 * each of these was last checked, through movingStages: the test pins the
 * two together so the stage list cannot drift from this one. */
export const isPollable = (op: Pick<OperationRow, "state" | "setup_state">) =>
  op.state === "filed" ||
  op.state === "promoted" ||
  (op.state === "linked" && op.setup_state !== "complete");
/** A send the Super Admin may close: one FlightDeck never confirmed, or one
 * it filed but no longer knows. Closing is safe because FlightDeck's subject
 * lock answers a fresh key for a project it holds with that request's id
 * (409 already_submitted), which the next send adopts. */
const isClosable = (op: OperationRow) =>
  op.state === "reserved" ||
  (op.state === "filed" && op.reason_code === NOT_FOUND);

async function latestOperation(db: OnboardDb, atlasProjectId: string) {
  // The open send, if any; otherwise the most recent closed one.
  return db
    .prepare(
      "SELECT * FROM atlas_flightdeck_operations WHERE atlas_project_id=? ORDER BY (state IN ('reserved','filed','promoted','linked')) DESC, updated_at DESC, rowid DESC LIMIT 1",
    )
    .bind(atlasProjectId)
    .first<OperationRow>();
}
/** The unconfirmed send that must be resolved before its project may be
 * deleted, or null. `reserved` is the only state that still holds
 * `request_body` — the exact envelope, free text and all — so deleting the
 * project under it would strand a verbatim copy of the summary and success
 * measure in a row no route can reach: POST, GET and CLOSE all answer 404
 * once the project is gone, and the list sweep never selects `reserved`.
 * Nothing is deleted automatically here (owner decision 6): these are exactly
 * the states the form offers "Close this unconfirmed send" for, so the Super
 * Admin closes it — which clears the body — and the delete goes through. */
export async function unconfirmedSend(db: OnboardDb, atlasProjectId: string) {
  const op = await latestOperation(db, atlasProjectId);
  return op && isClosable(op) ? op : null;
}
/** The sends that stop a delete, as SQL over atlas_flightdeck_operations:
 * exactly the rows `isClosable` accepts. */
const CLOSABLE_SQL = `(state='reserved' OR (state='filed' AND reason_code='${NOT_FOUND}'))`;
/** Deletes an Atlas project unless a send of it is still unconfirmed, then
 * forgets its send history and link. The check and the delete are one
 * statement, and the reservation in POST is conditional on the project
 * existing, so a send and a delete racing each other cannot both win: either
 * the row is reserved first and the delete is refused, or the project is gone
 * first and nothing is reserved or sent. */
export async function deleteProject(
  db: OnboardDb,
  atlasProjectId: string,
  revision: number,
): Promise<"deleted" | "unconfirmed" | "changed"> {
  const result = await db
    .prepare(
      `DELETE FROM atlas_projects WHERE id=? AND revision=? AND NOT EXISTS(SELECT 1 FROM atlas_flightdeck_operations WHERE atlas_project_id=? AND ${CLOSABLE_SQL})`,
    )
    .bind(atlasProjectId, revision, atlasProjectId)
    .run();
  if (!result.meta.changes)
    return (await unconfirmedSend(db, atlasProjectId))
      ? "unconfirmed"
      : "changed";
  await forgetProject(db, atlasProjectId);
  return "deleted";
}
const HELD_SQL = `state IN (${lockedStates.map((s) => `'${s}'`).join(",")})`;
/** Appended to the project UPDATE when a save changes the onboarding draft:
 * the save lands only while no send FlightDeck may hold is open, in the same
 * statement, so a send reserved between the check and the write still wins. */
export const DRAFT_NOT_HELD_SQL = ` AND NOT EXISTS(SELECT 1 FROM atlas_flightdeck_operations WHERE atlas_project_id=atlas_projects.id AND ${HELD_SQL})`;
/** Whether a send FlightDeck may hold is open for this project, so its
 * draft must stay exactly as it was sent: the server's side of the lock the
 * form and the To FlightDeck row show (isDraftLocked). */
export async function draftHeld(db: OnboardDb, atlasProjectId: string) {
  return !!(await db
    .prepare(
      `SELECT 1 AS held FROM atlas_flightdeck_operations WHERE atlas_project_id=? AND ${HELD_SQL} LIMIT 1`,
    )
    .bind(atlasProjectId)
    .first());
}
/** Atlas's own record of a project that is being deleted: every send of it
 * and its FlightDeck link. Both are keyed by the Atlas project id alone, so
 * once the project is gone no route can read, close or clear them. Call it
 * only after the project row is really gone, and only once `unconfirmedSend`
 * is null, so no request body can outlive its project. Dropping the link also
 * frees the OS project: `uniq_atlas_project_links_os` would otherwise hold it
 * against a deleted Atlas project for good, and every later promotion onto
 * that OS project would answer `link_conflict` with no way to clear it. */
export async function forgetProject(db: OnboardDb, atlasProjectId: string) {
  const operations = await db
    .prepare("DELETE FROM atlas_flightdeck_operations WHERE atlas_project_id=?")
    .bind(atlasProjectId)
    .run();
  const links = await db
    .prepare("DELETE FROM atlas_project_links WHERE atlas_project_id=?")
    .bind(atlasProjectId)
    .run();
  return {
    operations: operations.meta.changes,
    links: links.meta.changes,
  };
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
/** Inserts a row: false on a UNIQUE violation, and "skipped" when `where`
 * (a condition on other tables) does not hold. */
async function insert(
  db: OnboardDb,
  table: string,
  row: object,
  where?: { sql: string; values: unknown[] },
): Promise<boolean | "skipped"> {
  const keys = Object.keys(row);
  try {
    const result = await db
      .prepare(
        where
          ? `INSERT INTO ${table} (${keys.join(",")}) SELECT ${keys.map(() => "?").join(",")} WHERE ${where.sql}`
          : `INSERT INTO ${table} (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`,
      )
      .bind(...Object.values(row), ...(where?.values ?? []))
      .run();
    return where && !result.meta.changes ? "skipped" : true;
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

/** The reason codes an editor may see: FlightDeck's decision reasons,
 * whether FlightDeck could be reached, and Atlas's own closing and waiting
 * words. Anything else (Atlas's credential and scopes, workspace sharing,
 * operator-only lock, key and link faults) is the Super Admin's and is
 * projected as no reason at all: an unknown code fails closed. */
const EDITOR_REASONS: ReadonlySet<string> = new Set([
  "needs-more-info",
  "duplicate",
  "out-of-scope",
  "other",
  "abandoned",
  "os_unreachable",
  "rate_limited",
  "project_not_visible",
]);
/** The editor's reason for a send FlightDeck holds but has not yet turned
 * into a linked project (plan J4 "Sent, waiting for FlightDeck to file it"). */
export const WAITING_TO_BE_FILED = "waiting_to_be_filed";

/** The approved status projection per viewer (plan 2026-09-25 J4). `null`
 * viewer: no view rights, so there is nothing to project (the route answers
 * 404). The Atlas Super Admin gets the full status body. Anyone else with
 * view rights gets an allowlisted projection built key by key: the stage,
 * the revision sent and the times, never the destination workspace, the
 * link, the reserved request, a notice or a reason that describes Atlas's
 * credential or FlightDeck's workspaces. It never reads FlightDeck: the
 * editor's freshness is the Super Admin's poll (plan §7). */
export function projectStatus(
  viewer: { superAdmin: boolean } | null,
  send: { operation?: OperationRow | null; link?: LinkRow | null },
  notice: string | null = null,
  retryAfter: number | null = null,
): OnboardingStatus | null {
  if (!viewer) return null;
  const op = send.operation ?? null;
  if (viewer.superAdmin)
    return statusBody(op, send.link ?? null, notice, retryAfter);
  const stage = op
    ? stageFor({
        state: op.state,
        reasonCode: op.reason_code,
        setupState: op.setup_state,
      })
    : null;
  const reasonCode =
    op?.reason_code && EDITOR_REASONS.has(op.reason_code)
      ? op.reason_code
      : op && stage === "submitted"
        ? WAITING_TO_BE_FILED
        : null;
  return {
    operation:
      op && stage
        ? {
            state: op.state,
            stage,
            destinationWorkspaceId: null,
            submittedAt: op.received_at,
            reasonCode,
            setupState: op.setup_state,
            atlasRevision: op.adopted ? null : op.atlas_revision,
            adopted: !!op.adopted,
            updatedAt: op.updated_at,
            checkedAt: op.checked_at,
          }
        : null,
    link: null,
    pendingPayload: null,
    canSend: !op || ["reserved", "rejected", "refused"].includes(op.state),
    canClose: false,
    retryPending: op?.state === "reserved",
    pollable: !!op && isPollable(op),
    notice: null,
    retryAfter: null,
  };
}

/** The Atlas Super Admin's status body (projectStatus). */
function statusBody(
  op: OperationRow | null,
  link: LinkRow | null,
  notice: string | null,
  retryAfter: number | null,
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
          destinationWorkspaceId: op.adopted
            ? null
            : op.destination_workspace_id,
          submittedAt: op.received_at,
          reasonCode: op.reason_code,
          setupState: op.setup_state,
          atlasRevision: op.adopted ? null : op.atlas_revision,
          adopted: !!op.adopted,
          updatedAt: op.updated_at,
          checkedAt: op.checked_at,
        }
      : null,
    link: link
      ? {
          workspaceId: link.workspace_id,
          osProjectId: link.os_project_id,
          linkedAt: link.linked_at,
          accessState: link.access_state,
        }
      : null,
    pendingPayload:
      op?.state === "reserved" ? (reservedEnvelope(op)?.payload ?? null) : null,
    canSend: !op || ["reserved", "rejected", "refused"].includes(op.state),
    canClose: !!op && isClosable(op),
    retryPending: op?.state === "reserved",
    pollable: !!op && isPollable(op),
    notice,
    retryAfter,
  };
}

/** What one read-back found. `stop`: FlightDeck did not answer (unreachable,
 * busy, refused), so a list refresh checks no further sends this round. */
type Check = {
  notice: string | null;
  retryAfter: number | null;
  stop: boolean;
};

export function createOnboardRoute<A extends OnboardAccess>(
  deps: OnboardDeps<A>,
) {
  const now = () => deps.now?.() ?? new Date();
  const newId = () => deps.newId?.() ?? crypto.randomUUID();

  /** Logs the stage send `id` is at now, as Atlas just saw it (the
   * transition log, lib/flightdeck/transitions.ts). Called after every
   * write that may move a send: the send's own answer, a close, and each
   * read-back. It records the stored stage rather than the change, so a
   * write whose log entry was lost is caught up by the next one. The log is
   * a record of what Atlas saw, never what decides the send, so a failure
   * to write it does not fail the request that moved it. */
  async function observe(
    db: OnboardDb,
    id: string,
    source: Exclude<TransitionSource, "backfill">,
  ) {
    try {
      const row = await db
        .prepare(
          "SELECT state,reason_code,setup_state FROM atlas_flightdeck_operations WHERE id=?",
        )
        .bind(id)
        .first<Pick<OperationRow, "state" | "reason_code" | "setup_state">>();
      if (!row) return;
      await applyObservedStage(
        db,
        id,
        stageFor({
          state: row.state,
          reasonCode: row.reason_code,
          setupState: row.setup_state,
        }),
        now().toISOString(),
        source,
      );
    } catch {
      // Caught up by the next observation of this send.
    }
  }

  async function currentStatus(
    db: OnboardDb,
    atlasProjectId: string,
    superAdmin: boolean,
    notice: string | null = null,
    retryAfter: number | null = null,
  ) {
    const installationId = deps.installationId();
    // An editor's projection never shows the link, so it is not read.
    return projectStatus(
      { superAdmin },
      {
        operation: await latestOperation(db, atlasProjectId),
        link:
          superAdmin && installationId
            ? await linkFor(db, installationId, atlasProjectId)
            : null,
      },
      notice,
      retryAfter,
    )!;
  }

  /** Stores the OS answer to the one remote write. `retry`: the call
   * resent a reservation an earlier attempt made, whatever that attempt
   * recorded (it may have stopped before recording anything). */
  async function settle(
    db: OnboardDb,
    op: OperationRow,
    result: SubmitResult,
    submissions: SubmissionClient,
    retry: boolean,
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
      case "lock_unreadable":
        // FlightDeck cannot read its own lock for this request, so it cannot
        // say whether it holds it: keep the reservation, and a retry reuses
        // the key once an operator has fixed the lock.
        await patch(
          db,
          op.id,
          { reason_code: "lock_unreadable", updated_at: stamp },
          ["reserved"],
        );
        return refuse(
          409,
          "lock_unreadable",
          "FlightDeck needs an operator to inspect this request's lock. Ask the OS admin to check it, then Retry send: Atlas keeps this request and its key, so it resends the same request.",
          { status: await status() },
        );
      case "idempotency_key_conflict":
        // FlightDeck holds this key for another Atlas project, so nothing of
        // this project was filed under it, on a first attempt or a retry
        // (a key it holds for this project is answered as a duplicate).
        // Close it: the next send takes a fresh key.
        await patch(
          db,
          op.id,
          {
            state: "refused",
            reason_code: "idempotency_key_conflict",
            request_body: null,
            updated_at: stamp,
          },
          ["reserved"],
        );
        return refuse(
          409,
          "idempotency_key_conflict",
          "FlightDeck holds this request's key for a different Atlas project, so nothing was filed for this one. Send again: the next send uses a fresh key.",
          { status: await status() },
        );
      case "invalid_submission":
      case "unauthorized":
      case "refused":
        // The first attempt refused outright: nothing was filed, so close
        // it, and a corrected draft gets a fresh key. A refused RETRY is
        // different: an earlier attempt of this key ended unknown and
        // FlightDeck may hold it, so the reservation stays and the next
        // retry reuses the key (PROJECT-BRIDGE-CONTRACT.md: never a fresh
        // key after a lost reply). The row cannot tell a retry: an attempt
        // that stopped before storing the OS answer (a failed receipt write,
        // a stopped Worker) leaves no reason code, so the caller says.
        if (retry) {
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
          isClosable(existing)
            ? `FlightDeck does not know the earlier send of this project. ${CLOSE_HINT}`
            : "This project has already been sent to FlightDeck.",
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
            `A send to ${reuse.destination_workspace_id} is waiting for FlightDeck to confirm it. Retry that send, or close it, first.`,
            { destinationWorkspaceId: reuse.destination_workspace_id },
          );
        if (revision !== reuse.atlas_revision)
          return refuse(
            409,
            "pending_send_changed",
            `FlightDeck may already hold revision ${reuse.atlas_revision} of this project. Retry send resends revision ${reuse.atlas_revision} exactly as it was first sent; later edits are not included. Review it and retry, or close it to send the current revision.`,
            { atlasRevision: reuse.atlas_revision },
          );
        const stored = reservedEnvelope(reuse);
        if (!stored)
          return refuse(
            409,
            "pending_send_unreadable",
            `Atlas cannot read the request it reserved, so it cannot retry it safely. Nothing was sent. ${CLOSE_HINT}`,
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
        // The OS refuses a field whose feature is off for this credential
        // (400 FEATURE_OFF), so the flags are read before every fresh send.
        // A failed read fails closed: no gated field travels.
        let features: InboundFeatures = NO_FEATURES;
        try {
          if (deps.features) features = await deps.features();
        } catch {
          features = NO_FEATURES;
        }
        const built = projectOnboardingPayloadSchema.safeParse(
          buildOnboardingPayload({
            project,
            destinationWorkspaceId,
            idempotencyKey: newId(),
            installationId,
            requestedBy: await sha256Hex(access.userId),
            features,
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
      }
      // A retry skips that check. Its destination was checked when the key
      // was reserved, and FlightDeck answers a key it knows before it looks
      // at the target, so resending these bytes is the only way to learn
      // whether the earlier attempt was filed, even if the workspace has been
      // disabled or unshared since. What FlightDeck may create stays an OS
      // admin's decision (decision 8).
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
        // one open send per project, so a second tab loses here. And only
        // while the project still exists: it was loaded before the OS lists
        // were read, and a delete in between would otherwise leave this
        // request text in a row no route can reach (see deleteProject).
        const reserved = await insert(db, "atlas_flightdeck_operations", op, {
          sql: "EXISTS(SELECT 1 FROM atlas_projects WHERE id=?)",
          values: [project.id],
        });
        if (reserved === "skipped")
          return refuse(404, "not_found", "Project not found.");
        if (!reserved)
          return refuse(
            409,
            "send_in_progress",
            "A send for this project is already in progress.",
          );
      }
      const result = await submissions.submit(envelope);
      const response = await settle(
        db,
        op,
        result,
        submissions,
        reuse !== null,
      );
      await observe(db, op.id, "atlas");
      return response;
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
    const hold = async (reason: string, notice: string): Promise<Check> => {
      await patch(db, op.id, { reason_code: reason }, ["promoted"]);
      return { notice, retryAfter: null, stop: false };
    };
    const later = (state: string, retryAfter?: number): Check => ({
      notice:
        "Atlas could not confirm the project in FlightDeck yet. It will check again.",
      retryAfter: state === "rate_limited" ? (retryAfter ?? null) : null,
      stop: true,
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
    return { notice: null, retryAfter: null, stop: false };
  }

  /** One read-back, then whatever it allows: rejected, promoted, linked. */
  async function reconcile(
    db: OnboardDb,
    op: OperationRow,
    reader: ContextReader,
    submissions: SubmissionClient,
    installationId: string,
    userId: string,
  ): Promise<Check> {
    const stamp = now().toISOString();
    const touch = (
      extra: Partial<OperationRow> = {},
      from?: OperationState[],
    ) => patch(db, op.id, { checked_at: stamp, ...extra }, from);
    const read = await submissions.readSubmission(op.submission_id ?? "");
    if (read.state === "not_found") {
      // FlightDeck answers 404 for an id it never had and for one that is
      // not Atlas's. A filed send it does not know may be closed, so a new
      // send can go (its subject lock catches a request it does hold).
      if (op.state === "filed") {
        await touch({ reason_code: NOT_FOUND }, ["filed"]);
        return {
          notice:
            "FlightDeck does not know this request. Ask the OS admin whether it arrived. If it did not, the Atlas Super Admin can close this send and send the project again: if FlightDeck does hold it, the new send follows it.",
          retryAfter: null,
          stop: false,
        };
      }
      await touch();
      return {
        notice:
          "FlightDeck no longer knows this request. Ask the OS admin what happened to it.",
        retryAfter: null,
        stop: false,
      };
    }
    if (read.state !== "ok") {
      await touch();
      return {
        notice: "Atlas could not check FlightDeck just now. It will try again.",
        retryAfter:
          read.state === "rate_limited" ? (read.retryAfter ?? null) : null,
        stop: true,
      };
    }
    const s = read.data;
    if (s.subject !== onboardingSubject(op.atlas_project_id)) {
      await touch();
      return {
        notice:
          "FlightDeck answered for a different request. Nothing was changed.",
        retryAfter: null,
        stop: false,
      };
    }
    const receipt = {
      received_at: op.received_at ?? s.receivedAt,
      payload_sha256: op.payload_sha256 ?? s.payloadSha256,
      // FlightDeck knows the request again.
      ...(op.reason_code === NOT_FOUND ? { reason_code: null } : {}),
    };
    const none: Check = { notice: null, retryAfter: null, stop: false };
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
          stop: false,
        };
      case "promoted": {
        if (!s.promoted) {
          // FlightDeck withholds the outcome and says why: the two causes
          // need different fixes. An OS from before `outcomeWithheld` sends
          // neither word, and the old reading stands.
          if (s.outcomeWithheld === "scope") {
            await touch({ ...receipt, reason_code: "credential_scope" });
            return {
              notice:
                "FlightDeck accepted the request, but Atlas's FlightDeck credential lacks read:context, so Atlas cannot see the outcome. Ask the OS admin to re-mint Atlas's credential with read:context.",
              retryAfter: null,
              stop: false,
            };
          }
          await touch({ ...receipt, reason_code: "destination_not_shared" });
          return {
            notice:
              "FlightDeck accepted the request, but its workspace is not shared with Atlas, so Atlas cannot confirm the project.",
            retryAfter: null,
            stop: false,
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

  /** Claims one read-back of `op`: only one caller (tab, list or form) wins
   * each `minAge`, so the per-send limit holds however many ask at once. */
  async function claimCheck(db: OnboardDb, op: OperationRow, minAge: number) {
    const at = now();
    if (op.checked_at && at.getTime() - Date.parse(op.checked_at) < minAge)
      return false;
    const result = await db
      .prepare(
        "UPDATE atlas_flightdeck_operations SET checked_at=? WHERE id=? AND (checked_at IS NULL OR checked_at<=?)",
      )
      .bind(
        at.toISOString(),
        op.id,
        new Date(at.getTime() - minAge).toISOString(),
      )
      .run();
    return result.meta.changes > 0;
  }
  /** The OS clients for a read-back, or null when FlightDeck is not
   * configured. */
  function osClients() {
    const reader = deps.reader(true);
    const submissions = deps.submissions();
    const installationId = deps.installationId();
    return reader && submissions && installationId
      ? { reader, submissions, installationId }
      : null;
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
        const os = osClients();
        if (!os)
          notice =
            "FlightDeck is not configured, so Atlas cannot check this request.";
        else if (await claimCheck(db, op, POLL_MS)) {
          ({ notice, retryAfter } = await reconcile(
            db,
            op,
            os.reader,
            os.submissions,
            os.installationId,
            access.userId,
          ));
          await observe(db, op.id, "poll");
        }
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

  /** Stored stages, and when each send was last read back, for the projects
   * the caller can see. With `?refresh=1` (same-origin, Super Admin only)
   * it first reads back the sends that are due, longest unchecked first:
   * at most LIST_BATCH a call, each at most every LIST_POLL_MS, stopping at
   * the first answer that is not FlightDeck's. That keeps the To FlightDeck
   * list, the dashboard and every editor's view moving without the form. */
  async function LIST(request: Request) {
    const refresh = new URL(request.url).searchParams.get("refresh") === "1";
    if (refresh && !sameOrigin(request))
      return json({ error: "Request origin is not allowed." }, 403);
    const auth = await deps.authorize();
    if (auth.error) return auth.error;
    const { access } = auth;
    try {
      const visible = new Set(await deps.visibleProjectIds(access));
      const db = deps.db();
      let retryAfter: number | null = null;
      const os = refresh && access.superAdmin ? osClients() : null;
      if (os) {
        const due = await db
          .prepare(
            "SELECT * FROM atlas_flightdeck_operations WHERE (state IN ('filed','promoted') OR (state='linked' AND (setup_state IS NULL OR setup_state<>'complete'))) AND (checked_at IS NULL OR checked_at<=?) ORDER BY (checked_at IS NOT NULL), checked_at, rowid",
          )
          .bind(new Date(now().getTime() - LIST_POLL_MS).toISOString())
          .all<OperationRow>();
        let checked = 0;
        for (const op of due.results) {
          if (checked >= LIST_BATCH) break;
          if (!visible.has(op.atlas_project_id)) continue;
          if (!(await claimCheck(db, op, LIST_POLL_MS))) continue;
          checked++;
          const result = await reconcile(
            db,
            op,
            os.reader,
            os.submissions,
            os.installationId,
            access.userId,
          );
          await observe(db, op.id, "poll");
          if (result.stop) {
            retryAfter = result.retryAfter;
            break;
          }
        }
      }
      const rows = await db
        .prepare(
          "SELECT atlas_project_id,state,reason_code,setup_state,checked_at FROM atlas_flightdeck_operations ORDER BY (state IN ('reserved','filed','promoted','linked')), updated_at, rowid",
        )
        .bind()
        .all<
          Pick<
            OperationRow,
            | "atlas_project_id"
            | "state"
            | "reason_code"
            | "setup_state"
            | "checked_at"
          >
        >();
      const stages: Record<string, OnboardingStage> = {};
      const checkedAt: Record<string, string | null> = {};
      // Open sends sort last, so they win over older closed ones.
      for (const row of rows.results)
        if (visible.has(row.atlas_project_id)) {
          stages[row.atlas_project_id] = stageFor({
            state: row.state,
            reasonCode: row.reason_code,
            setupState: row.setup_state,
          });
          checkedAt[row.atlas_project_id] = row.checked_at;
        }
      return json({ stages, checked: checkedAt, retryAfter });
    } catch {
      return refuse(
        503,
        "storage_unavailable",
        "Onboarding status is unavailable. Try again shortly.",
      );
    }
  }

  /** Closes a send FlightDeck never confirmed (reserved), or one it filed
   * but no longer knows, so the project can be sent again. Same-origin,
   * Atlas Super Admin only, and only the send the caller saw. Nothing is
   * sent and the OS is not read. The row keeps its key and any receipt;
   * the reserved body is dropped. The next send takes a fresh key: if
   * FlightDeck holds this project's request after all, its subject lock
   * answers 409 already_submitted with that request's id, and Atlas follows
   * it (settle), so nothing is filed twice. */
  async function CLOSE(request: Request, atlasProjectId: string) {
    if (!sameOrigin(request))
      return json({ error: "Request origin is not allowed." }, 403);
    const auth = await deps.authorize();
    if (auth.error) return auth.error;
    const { access } = auth;
    if (!access.superAdmin)
      return refuse(
        403,
        "not_permitted",
        "Only the Atlas Super Admin can close a send to FlightDeck.",
      );
    if (!request.headers.get("content-type")?.includes("application/json"))
      return refuse(
        415,
        "unsupported_media_type",
        "Name the send to close as JSON.",
      );
    const raw = await request.text();
    let parsed;
    try {
      parsed = closeSchema.safeParse(raw.length > 500 ? null : JSON.parse(raw));
    } catch {
      parsed = null;
    }
    if (!parsed?.success)
      return refuse(400, "invalid_request", "Name the send to close.");
    try {
      const loaded = await deps.loadProject(access, atlasProjectId);
      if (!loaded) return refuse(404, "not_found", "Project not found.");
      if (!loaded.canEdit)
        return refuse(403, "not_permitted", "You cannot onboard this project.");
      const db = deps.db();
      const op = await latestOperation(db, atlasProjectId);
      const status = () => currentStatus(db, atlasProjectId, true);
      if (!op || !isClosable(op))
        return refuse(
          409,
          "not_closable",
          "There is no unconfirmed send of this project to close.",
          { status: await status() },
        );
      const changed = async () =>
        refuse(
          409,
          "status_changed",
          "This send changed since you looked at it. Review it again before closing it.",
          { status: await status() },
        );
      if (op.updated_at !== parsed.data.updatedAt) return changed();
      const done = await db
        .prepare(
          "UPDATE atlas_flightdeck_operations SET state='refused',reason_code=?,request_body=NULL,updated_at=? WHERE id=? AND updated_at=? AND (state='reserved' OR (state='filed' AND reason_code=?))",
        )
        .bind(ABANDONED, now().toISOString(), op.id, op.updated_at, NOT_FOUND)
        .run();
      if (!done.meta.changes) return changed();
      await observe(db, op.id, "atlas");
      return json(await status());
    } catch {
      return refuse(
        503,
        "storage_unavailable",
        "Onboarding storage is unavailable. Nothing was closed. Try again.",
      );
    }
  }

  return { POST, GET, LIST, CLOSE };
}
