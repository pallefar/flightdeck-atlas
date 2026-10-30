// The onboarding audit chain.
//
// Every gate decision and stage move is appended here, chained by sha256 to
// its predecessor. The chain is what makes "audited" mean something: if a row
// is edited, deleted or reordered, verifyChain finds the first seq that no
// longer adds up, and the route reports it instead of pretending the history
// is intact.
//
// Two properties this module guarantees:
// - one writer path (appendGateEvent) and no update/delete anywhere;
// - a concurrent append cannot fork the chain: `(project_id, seq)` is unique,
//   so the loser of a race gets a constraint error and retries against the
//   new head instead of writing a second row with the same seq.
//
// The hash deliberately covers the payload and prevHash, never the row id:
// the id is random, and a chain you cannot recompute from the row is not a
// chain. It uses WebCrypto via lib/domain/digest, so the same code runs in a
// Worker, in Node tests and in a browser fixture check.
import { canonicalJson, sha256Hex } from "../domain/digest";
import type { GateDecision } from "../domain/gates";
import type { StageOrRetired } from "../domain/stages";
/** The minimum of a D1 database this module needs. Injected so the tests run
 * this exact code over node:sqlite built from the real migrations. */
export type ChainDb = {
  prepare(query: string): {
    bind(...values: unknown[]): {
      first<T = Record<string, unknown>>(): Promise<T | null>;
      all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
      run(): Promise<{ meta: { changes: number } }>;
    };
  };
};
/** What the first row chains to: 64 zeros, the canonical empty predecessor. */
export const GENESIS = "0".repeat(64);
export type GateEventInput = {
  projectId: string;
  /** "governed" or "quick"; the chain records which path the project took. */
  lane?: "governed" | "quick";
  /** The sign-offs this event leaves deferred (stage names). */
  deferred?: string[];
  stage: StageOrRetired;
  fromStage: StageOrRetired | null;
  toStage: StageOrRetired | null;
  actor: string;
  role: string;
  decision: GateDecision;
  reason?: string;
  evidenceRef?: string | null;
  materialDigest?: string | null;
  /** Injected by the tests; a route passes nothing and gets the real clock. */
  at?: string;
  id?: string;
};
export type StoredGateEvent = {
  id: string;
  projectId: string;
  seq: number;
  stage: string;
  fromStage: string | null;
  toStage: string | null;
  actor: string;
  role: string;
  decision: string;
  lane: string;
  deferred: string;
  reason: string;
  evidenceRef: string | null;
  materialDigest: string | null;
  prevHash: string;
  hash: string;
  createdAt: string;
};
/** The exact object that is hashed. Exported so a verifier (or a second
 * implementation) can recompute a row without guessing field order. */
export function hashPayload(event: {
  projectId: string;
  lane: string;
  deferred: string;
  seq: number;
  stage: string;
  fromStage: string | null;
  toStage: string | null;
  actor: string;
  role: string;
  decision: string;
  reason: string;
  evidenceRef: string | null;
  materialDigest: string | null;
  createdAt: string;
  prevHash: string;
}) {
  return canonicalJson(event);
}
export const eventHash = (payload: ReturnType<typeof hashPayload>) =>
  sha256Hex(payload);
type LastRow = { seq: number; hash: string } | null;
async function head(db: ChainDb, projectId: string): Promise<LastRow> {
  return db
    .prepare(
      "SELECT seq, hash FROM atlas_gate_events WHERE project_id = ? ORDER BY seq DESC LIMIT 1",
    )
    .bind(projectId)
    .first<LastRow>();
}
export type AppendResult =
  | { ok: true; event: StoredGateEvent }
  | { ok: false; code: "chain_conflict" | "storage_unavailable" };
/**
 * Append one event. Retries once on a seq conflict: the other writer moved
 * the head, so the retry reads it again and chains onto that. Never loops
 * forever — a persistent conflict is reported, not hidden.
 */
export async function appendGateEvent(
  db: ChainDb,
  input: GateEventInput,
): Promise<AppendResult> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const last = await head(db, input.projectId);
    const seq = (last?.seq ?? 0) + 1;
    const prevHash = last?.hash ?? GENESIS;
    const createdAt = input.at ?? new Date().toISOString();
    const payload = hashPayload({
      projectId: input.projectId,
      seq,
      stage: input.stage,
      fromStage: input.fromStage,
      toStage: input.toStage,
      actor: input.actor,
      role: input.role,
      decision: input.decision,
      lane: input.lane ?? "governed",
      deferred: JSON.stringify(input.deferred ?? []),
      reason: input.reason ?? "",
      evidenceRef: input.evidenceRef ?? null,
      materialDigest: input.materialDigest ?? null,
      createdAt,
      prevHash,
    });
    const hash = await eventHash(payload);
    const event: StoredGateEvent = {
      id: input.id ?? crypto.randomUUID(),
      projectId: input.projectId,
      seq,
      stage: input.stage,
      fromStage: input.fromStage,
      toStage: input.toStage,
      actor: input.actor,
      role: input.role,
      decision: input.decision,
      lane: input.lane ?? "governed",
      deferred: JSON.stringify(input.deferred ?? []),
      reason: input.reason ?? "",
      evidenceRef: input.evidenceRef ?? null,
      materialDigest: input.materialDigest ?? null,
      prevHash,
      hash,
      createdAt,
    };
    try {
      const written = await db
        .prepare(
          `INSERT INTO atlas_gate_events
             (id, project_id, seq, stage, from_stage, to_stage, actor, role,
              decision, lane, deferred, reason, evidence_ref, material_digest,
              prev_hash, hash, created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .bind(
          event.id,
          event.projectId,
          event.seq,
          event.stage,
          event.fromStage,
          event.toStage,
          event.actor,
          event.role,
          event.decision,
          event.lane,
          event.deferred,
          event.reason,
          event.evidenceRef,
          event.materialDigest,
          event.prevHash,
          event.hash,
          event.createdAt,
        )
        .run();
      if (written.meta.changes === 1) return { ok: true, event };
      return { ok: false, code: "chain_conflict" };
    } catch (error) {
      // Only a unique violation on (project_id, seq) means another writer won
      // the head: retry once against it. Anything else (a CHECK refusal, a
      // missing table) is a bug or an outage and must surface, not be reported
      // as a harmless race.
      const message = error instanceof Error ? error.message : String(error);
      if (!/UNIQUE constraint failed/i.test(message)) throw error;
      if (attempt === 1) return { ok: false, code: "chain_conflict" };
    }
  }
  return { ok: false, code: "chain_conflict" };
}
export type VerifyResult =
  | { ok: true; length: number }
  | { ok: false; brokenAt: number; reason: "seq_gap" | "prev_mismatch" | "hash_mismatch" };
/**
 * Recompute the whole chain. O(n) on purpose: it is run on demand (a project
 * page, a test, a `?verify=1` read), not on every request.
 */
export async function verifyChain(
  db: ChainDb,
  projectId: string,
): Promise<VerifyResult> {
  const { results } = await db
    .prepare(
      "SELECT * FROM atlas_gate_events WHERE project_id = ? ORDER BY seq ASC",
    )
    .bind(projectId)
    .all<Record<string, unknown>>();
  let prev = GENESIS;
  let expected = 1;
  for (const row of results) {
    const event = {
      projectId: row.project_id as string,
      seq: Number(row.seq),
      stage: row.stage as string,
      fromStage: (row.from_stage as string | null) ?? null,
      toStage: (row.to_stage as string | null) ?? null,
      actor: row.actor as string,
      role: row.role as string,
      decision: row.decision as string,
      lane: (row.lane as string) ?? "governed",
      deferred: (row.deferred as string) ?? "[]",
      reason: row.reason as string,
      evidenceRef: (row.evidence_ref as string | null) ?? null,
      materialDigest: (row.material_digest as string | null) ?? null,
      createdAt: row.created_at as string,
      prevHash: row.prev_hash as string,
    };
    if (event.seq !== expected)
      return { ok: false, brokenAt: event.seq, reason: "seq_gap" };
    if (event.prevHash !== prev)
      return { ok: false, brokenAt: event.seq, reason: "prev_mismatch" };
    const recomputed = await eventHash(hashPayload(event));
    if (recomputed !== (row.hash as string))
      return { ok: false, brokenAt: event.seq, reason: "hash_mismatch" };
    prev = row.hash as string;
    expected += 1;
  }
  return { ok: true, length: results.length };
}
/** The events for a project, newest last, for the timeline view. */
export async function gateEventsFor(db: ChainDb, projectId: string) {
  const { results } = await db
    .prepare(
      "SELECT * FROM atlas_gate_events WHERE project_id = ? ORDER BY seq ASC",
    )
    .bind(projectId)
    .all<Record<string, unknown>>();
  return results.map(
    (row): StoredGateEvent => ({
      id: row.id as string,
      projectId: row.project_id as string,
      seq: Number(row.seq),
      stage: row.stage as string,
      fromStage: (row.from_stage as string | null) ?? null,
      toStage: (row.to_stage as string | null) ?? null,
      actor: row.actor as string,
      role: row.role as string,
      decision: row.decision as string,
      lane: (row.lane as string) ?? "governed",
      deferred: (row.deferred as string) ?? "[]",
      reason: row.reason as string,
      evidenceRef: (row.evidence_ref as string | null) ?? null,
      materialDigest: (row.material_digest as string | null) ?? null,
      prevHash: row.prev_hash as string,
      hash: row.hash as string,
      createdAt: row.created_at as string,
    }),
  );
}
