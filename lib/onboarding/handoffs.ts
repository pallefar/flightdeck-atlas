// Hand-offs to the tools that do the work: KG, DiagramForge, Studio, and the
// Companion that runs the result (PRD §7.5, §7.6).
//
// Two halves, both testable without a network:
// 1. The payload builders. They are deliberately thin: Atlas sends REFERENCES
//    and CONTEXT, never evidence content and never a person. `meta.mapType`
//    and the process-step provenance follow the published contracts
//    (`wt-flightdeck-maps/docs/HANDOFF-CONTRACT.md`, KG-MAPS.md).
// 2. The outbox. A hand-off is reserved with an idempotency key and the exact
//    body before anything leaves Atlas, so a lost reply is retried with the
//    same bytes and can never file twice — the same discipline as
//    atlas_flightdeck_operations. `request_body` is cleared once the hand-off
//    is filed or refused, so Atlas keeps no second copy of it.
//
// What is NOT here: the transport. No live OS, KG, Studio or Companion
// endpoint is called by this module, and none is faked. Dispatch is added by
// the repository that owns each contract, against these bodies.
import { canonicalJson } from "../domain/digest";
import type { ChainDb } from "../audit/chain";
import type { Classification } from "../domain/classification";
import type { BuildDecision } from "../domain/stages";
export const HANDOFF_KINDS = ["kg", "diagramforge", "studio", "companion"] as const;
export type HandoffKind = (typeof HANDOFF_KINDS)[number];
export const HANDOFF_STATUSES = ["reserved", "sent", "filed", "refused", "abandoned"] as const;
export type HandoffStatus = (typeof HANDOFF_STATUSES)[number];
export const MAP_TYPES = ["as-is", "future"] as const;
export type MapType = (typeof MAP_TYPES)[number];
/** An evidence reference: id + hash, never content. Only accepted, cleared
 * evidence may travel, and a restricted class never does. */
export type EvidenceRef = {
  id: string;
  sha256: string;
  kind: string;
  classification: Classification;
};
const travelling = (item: EvidenceRef) =>
  item.classification === "public" ||
  item.classification === "internal" ||
  item.classification === "confidential";
/** The KG request: "extract the steps from these sources into the project's
 * step format". KG owns extraction, so Atlas sends no steps. */
export function mapsStepsRequest(input: {
  projectId: string;
  projectName: string;
  evidence: EvidenceRef[];
  mapType: MapType;
  stepFormatRevision: string | null;
}) {
  return {
    schema: "atlas-maps-steps-request/1",
    projectId: input.projectId,
    projectName: input.projectName,
    sourceRefs: input.evidence.filter(travelling).map((item) => ({
      id: item.id,
      sha256: item.sha256,
      kind: item.kind,
    })),
    stepFormatRevision: input.stepFormatRevision,
    meta: { mapType: input.mapType, requestedBy: "atlas" },
  } as const;
}
/** The DiagramForge hand-off: a `cowork-handoff/1` bundle with the map type,
 * the evidence references and the questions the answer must cover. */
export function diagramforgeHandoff(input: {
  projectId: string;
  projectName: string;
  mapType: MapType;
  evidence: EvidenceRef[];
  questions: string[];
}) {
  return {
    schema: "cowork-handoff/1",
    meta: {
      mapType: input.mapType,
      projectId: input.projectId,
      requestedBy: "atlas",
      mapTypeMeaning:
        input.mapType === "as-is" ? "current local process" : "to-be process",
    },
    inputs: input.evidence.filter(travelling).map((item) => ({
      kind: item.kind,
      ref: item.id,
      sha256: item.sha256,
    })),
    context: { projectName: input.projectName },
    requiredAnswers: input.questions.filter((q) => q.trim().length > 0).slice(0, 20),
  } as const;
}
/** The Studio spec: the to-be map, the process manifest hash and the project
 * context Studio needs, with the classification as a constraint. */
export function studioSpec(input: {
  projectId: string;
  projectName: string;
  decision: BuildDecision;
  toBeMapRef: string | null;
  processManifestHash: string | null;
  objective: string;
  successMeasure: string;
  classification: Classification;
  /** The draft's steps, when there is one: Studio needs to know which app does
   * which step, and which steps a person keeps. */
  steps?: { action: string; actor: string; app: string | null }[];
}) {
  return {
    schema: "atlas-studio-spec/1",
    projectId: input.projectId,
    projectName: input.projectName,
    decision: input.decision,
    toBeMapRef: input.toBeMapRef,
    processManifestHash: input.processManifestHash,
    context: {
      objective: input.objective,
      successMeasure: input.successMeasure,
    },
    // The steps travel as the draft has them, app included. Atlas does not
    // reinterpret them for Studio; it hands over what a person wrote.
    steps: (input.steps ?? []).slice(0, 10).map((step, index) => ({
      number: String((index + 1) * 10),
      action: step.action,
      actor: step.actor,
      app: step.app,
    })),
    constraints: {
      classification: input.classification,
      // The PRD's non-goal, restated where a builder can read it.
      drawsMaps: false,
      runsProcessSteps: false,
    },
  } as const;
}
/** What Atlas accepts back from Studio. Strict: a record that does not say
 * what ran and what passed is not evidence of anything. */
export function parseComplianceRecord(input: unknown):
  | { ok: true; value: { recordId: string; subAppId: string; version: string; passed: boolean } }
  | { ok: false; code: "wrong_schema" | "invalid" } {
  if (!input || typeof input !== "object" || Array.isArray(input))
    return { ok: false, code: "invalid" };
  const record = input as Record<string, unknown>;
  if (record.schema !== "studio-compliance-record/1")
    return { ok: false, code: "wrong_schema" };
  const allowed = new Set(["schema", "recordId", "subAppId", "version", "passed", "checks", "shippedRef"]);
  for (const key of Object.keys(record)) if (!allowed.has(key)) return { ok: false, code: "invalid" };
  const { recordId, subAppId, version, passed } = record;
  if (
    typeof recordId !== "string" ||
    typeof subAppId !== "string" ||
    typeof version !== "string" ||
    typeof passed !== "boolean"
  )
    return { ok: false, code: "invalid" };
  return { ok: true, value: { recordId, subAppId, version, passed } };
}
export type HandoffRow = {
  id: string;
  projectId: string;
  kind: HandoffKind;
  direction: string;
  idempotencyKey: string;
  status: HandoffStatus;
  receipt: string | null;
  attempts: number;
  createdAt: string;
  updatedAt: string;
};
/** Reserve one hand-off. The body is stored byte for byte; a second open
 * hand-off of the same kind for the same project is refused, so a double
 * click cannot send two bundles. */
export async function reserveHandoff(
  db: ChainDb,
  input: {
    id: string;
    projectId: string;
    kind: HandoffKind;
    body: unknown;
    at: string;
  },
): Promise<{ ok: true; row: HandoffRow } | { ok: false; code: "open_handoff" | "storage" }> {
  const open = await db
    .prepare(
      "SELECT id FROM atlas_handoffs WHERE project_id = ? AND kind = ? AND status IN ('reserved','sent') LIMIT 1",
    )
    .bind(input.projectId, input.kind)
    .first();
  if (open) return { ok: false, code: "open_handoff" };
  const key = crypto.randomUUID();
  const row: HandoffRow = {
    id: input.id,
    projectId: input.projectId,
    kind: input.kind,
    direction: "atlas->tool",
    idempotencyKey: key,
    status: "reserved",
    receipt: null,
    attempts: 0,
    createdAt: input.at,
    updatedAt: input.at,
  };
  await db
    .prepare(
      `INSERT INTO atlas_handoffs
         (id, project_id, kind, direction, idempotency_key, request_body, status,
          receipt, attempts, last_error, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .bind(
      row.id,
      row.projectId,
      row.kind,
      row.direction,
      row.idempotencyKey,
      canonicalJson(input.body),
      row.status,
      null,
      0,
      null,
      row.createdAt,
      row.updatedAt,
    )
    .run();
  return { ok: true, row };
}
/** Record what a dispatch saw, without ever rewriting the reserved body. */
export async function observeHandoff(
  db: ChainDb,
  id: string,
  status: Extract<HandoffStatus, "sent" | "filed" | "refused" | "abandoned">,
  receipt: unknown,
  at: string,
): Promise<boolean> {
  const settled = status === "filed" || status === "refused" || status === "abandoned";
  const written = await db
    .prepare(
      `UPDATE atlas_handoffs
          SET status = ?, receipt = ?, attempts = attempts + 1,
              request_body = CASE WHEN ? THEN '' ELSE request_body END,
              updated_at = ?
        WHERE id = ? AND status IN ('reserved','sent')`,
    )
    .bind(status, receipt ? canonicalJson(receipt) : null, settled ? 1 : 0, at, id)
    .run();
  return written.meta.changes === 1;
}
export async function handoffsFor(db: ChainDb, projectId: string) {
  const { results } = await db
    .prepare("SELECT * FROM atlas_handoffs WHERE project_id = ? ORDER BY created_at ASC")
    .bind(projectId)
    .all<Record<string, unknown>>();
  return results.map(
    (row): HandoffRow => ({
      id: row.id as string,
      projectId: row.project_id as string,
      kind: row.kind as HandoffKind,
      direction: row.direction as string,
      idempotencyKey: row.idempotency_key as string,
      status: row.status as HandoffStatus,
      receipt: (row.receipt as string | null) ?? null,
      attempts: Number(row.attempts),
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    }),
  );
}
