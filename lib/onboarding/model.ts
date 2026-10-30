// The brain's stored shape, and the pure mapping from stored rows to the
// facts the stage rules and the client projection need.
//
// One deliberate asymmetry: the facts that prove a hand-off actually happened
// (osProjectId, visionDeliveryCommitted, complianceRecordId, shippedRef,
// realizedValue) are NOT editable fields. They are derived from the tables
// that record the real event — a project link, the Vision outbox, a hand-off
// receipt, a value record — so a PATCH cannot claim an alignment that never
// occurred.
import { z } from "zod";
import { CLASSIFICATIONS, type EvidenceStatus, type ScanVerdict } from "../domain/classification";
import type { RecordContract } from "../domain/contracts";
import {
  BUILD_DECISIONS,
  REUSE_DECISIONS,
  type BuildDecision,
  type ReuseDecision,
  type Stage,
  type StageFacts,
  type StageOrRetired,
} from "../domain/stages";
import type { Confidence, ValueBasis, ValueFigures, ValuePeriod } from "../domain/value";
const text = (max: number) => z.string().trim().max(max);
/** What is being onboarded: a project, a process that runs inside one, or a
 * workflow that automates a step of one.
 * Both use the same pipeline; the distinction changes the wording and the
 * hand-off defaults (a process usually needs KG and a map). */
export const ENTRY_TYPES = ["project", "process", "workflow"] as const;
export type EntryType = (typeof ENTRY_TYPES)[number];
export const brainDataSchema = z
  .object({
    entryType: z.enum(ENTRY_TYPES).default("project"),
    classificationDeclared: z.boolean().default(false),
    classification: z.enum(CLASSIFICATIONS).nullable().default(null),
    /** Who asked, in the requester's own words. A name, not an account. */
    requester: text(120).default(""),
    /** The problem framing (TEOA): what is wrong today, for whom. */
    problem: text(1000).default(""),
    objective: text(500).default(""),
    successMeasure: text(500).default(""),
    functionArea: text(80).default(""),
    site: text(80).default(""),
    volume: text(120).default(""),
    frequency: text(80).default(""),
    intakeNotes: text(2000).default(""),
    /** Set by the Vision integration, never by a save. */
    teoaScopeId: z.string().trim().max(80).nullable().default(null),
    visionObjectiveId: z.string().trim().max(80).nullable().default(null),
    asIsMapRef: z.string().trim().max(120).nullable().default(null),
    asIsSignedOff: z.boolean().default(false),
    toBeMapRef: z.string().trim().max(120).nullable().default(null),
    buildDecision: z.enum(BUILD_DECISIONS).nullable().default(null),
    /** Set by a Studio hand-off receipt, never by a save. */
    complianceRecordId: z.string().trim().max(120).nullable().default(null),
    shippedRef: z.string().trim().max(120).nullable().default(null),
    operatorBundleRef: z.string().trim().max(120).nullable().default(null),
    retireReason: text(500).default(""),
    /** The digest of the material fields as last accepted at stage 4. A save
     * that changes them reopens alignment (PRD §6). */
    materialDigest: z.string().regex(/^[0-9a-f]{64}$/).nullable().default(null),
    /** Sign-offs the quick lane left open: who owes them and by when. */
    deferredGates: z
      .array(
        z
          .object({
            stage: z.enum(["as-is", "aligned", "value"]),
            owner: z.string().trim().min(1).max(160),
            dueAt: z.string().datetime({ offset: true }),
          })
          .strict(),
      )
      .max(3)
      .default([]),
  })
  .strict();
export type BrainData = z.infer<typeof brainDataSchema>;
/** Fields a PATCH may write. Everything else is derived from a real event, so
 * a client cannot assert an alignment or a ship that has not happened. */
export const EDITABLE_FIELDS = [
  "entryType",
  "classificationDeclared",
  "classification",
  "requester",
  "problem",
  "objective",
  "successMeasure",
  "functionArea",
  "site",
  "volume",
  "frequency",
  "intakeNotes",
  "teoaScopeId",
  "visionObjectiveId",
  "asIsMapRef",
  "asIsSignedOff",
  "toBeMapRef",
  "buildDecision",
  "operatorBundleRef",
  "retireReason",
] as const;
export type EditableField = (typeof EDITABLE_FIELDS)[number];
const editable = new Set<string>(EDITABLE_FIELDS);
/** Keep only the editable keys of a body. An unknown key is refused by the
 * caller (the strict schema would drop it silently otherwise). */
export function pickEditable(input: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(input).filter(([key]) => editable.has(key)),
  );
}
export const defaultBrainData = (): BrainData => brainDataSchema.parse({});
export function parseBrainData(json: string): BrainData {
  return brainDataSchema.parse(JSON.parse(json));
}
/** Facts as stored: every derived truth is passed in by the caller, which is
 * the only place allowed to read the tables that prove it. */
export function factsFrom(input: {
  data: BrainData;
  evidenceAccepted: number;
  evidenceScan: ScanVerdict | null;
  osProjectId: string | null;
  visionDeliveryCommitted: boolean;
  baselineValue: boolean;
  realizedValue: boolean;
  reuse: { decision: ReuseDecision; reason: string } | null;
}): StageFacts {
  const { data } = input;
  return {
    classificationDeclared: data.classificationDeclared && data.classification !== null,
    problemStated: data.problem.trim().length > 0,
    requesterNamed: data.requester.trim().length > 0,
    functionArea: data.functionArea.trim() || null,
    site: data.site.trim() || null,
    reuseDecision: input.reuse?.decision ?? null,
    reuseReason: input.reuse?.reason.trim() || null,
    evidenceAccepted: input.evidenceAccepted,
    scanCleared: input.evidenceScan === "clear",
    asIsMapRef: data.asIsMapRef,
    asIsSignedOff: data.asIsSignedOff,
    osProjectId: input.osProjectId,
    teoaScopeId: data.teoaScopeId,
    visionObjectiveId: data.visionObjectiveId,
    visionDeliveryCommitted: input.visionDeliveryCommitted,
    baselineValue: input.baselineValue,
    toBeMapRef: data.toBeMapRef,
    buildDecision: data.buildDecision,
    complianceRecordId: data.complianceRecordId,
    shippedRef: data.shippedRef,
    operatorBundleRef: data.operatorBundleRef,
    realizedValue: input.realizedValue,
    retireReason: data.retireReason.trim() || null,
  };
}
export type GateRow = {
  stage: string;
  decision: string;
  at: string;
};
/** The read projection the three clients share (schema/atlas-onboarding-record). */
export function toRecord(input: {
  projectId: string;
  name: string;
  stage: StageOrRetired;
  revision: number;
  gates: GateRow[];
  evidenceAccepted: number;
  evidencePending: number;
  osProjectId: string | null;
  data: BrainData;
  reuseDecision: ReuseDecision | null;
  valueBasis: ValueBasis | null;
  updatedAt: string;
}): RecordContract {
  return {
    contract: "atlas-onboarding-record/1",
    projectId: input.projectId,
    name: input.name,
    stage: input.stage,
    revision: input.revision,
    gates: input.gates.map((g) => ({
      stage: g.stage as Stage,
      decision: g.decision as "pass" | "reject" | "reopen",
      at: g.at,
    })),
    evidenceAccepted: input.evidenceAccepted,
    evidencePending: input.evidencePending,
    osProjectId: input.osProjectId,
    teoaScopeId: input.data.teoaScopeId,
    visionObjectiveId: input.data.visionObjectiveId,
    reuseDecision: input.reuseDecision,
    buildDecision: input.data.buildDecision,
    entryType: input.data.entryType,
    valueBasis: input.valueBasis,
    updatedAt: input.updatedAt,
  };
}
export type EvidenceRow = {
  id: string;
  projectId: string;
  kind: string;
  source: string;
  sha256: string;
  bytes: number;
  classification: string;
  scanState: string;
  findings: string;
  reviewer: string | null;
  status: string;
  createdAt: string;
};
export function evidenceJson(row: EvidenceRow) {
  return {
    id: row.id,
    projectId: row.projectId,
    kind: row.kind,
    source: row.source,
    sha256: row.sha256,
    bytes: row.bytes,
    classification: row.classification,
    scanState: row.scanState,
    findings: JSON.parse(row.findings) as string[],
    reviewer: row.reviewer,
    status: row.status as EvidenceStatus,
    createdAt: row.createdAt,
  };
}
export type ValueRow = {
  id: string;
  projectId: string;
  basis: string;
  period: string;
  tier: string | null;
  figures: string;
  target: string;
  method: string;
  methodVersion: string;
  confidence: string;
  sourceRef: string | null;
  notes: string;
  createdAt: string;
};
export function valueJson(row: ValueRow) {
  return {
    id: row.id,
    projectId: row.projectId,
    basis: row.basis as ValueBasis,
    period: row.period as ValuePeriod,
    tier: row.tier,
    figures: JSON.parse(row.figures) as ValueFigures,
    target: JSON.parse(row.target) as ValueFigures,
    method: row.method,
    methodVersion: row.methodVersion,
    confidence: row.confidence as Confidence,
    sourceRef: row.sourceRef,
    notes: row.notes,
    createdAt: row.createdAt,
  };
}
export const STAGE_ORDER_LABEL = "brain.stage";
export const REUSE_DECISION_VALUES = REUSE_DECISIONS;
export const BUILD_DECISION_VALUES = BUILD_DECISIONS;
export type { BuildDecision };
