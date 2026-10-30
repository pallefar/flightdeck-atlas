// The four contracts Atlas v1 defines. Strict zod schemas, versioned by id,
// with one parser per contract that tells the caller *why* a body was
// refused instead of a generic "invalid".
//
// Flat on purpose: every field is a primitive, an enum or a flat array, so the
// same shape can be expressed as JSON Schema (schema/atlas-*.schema.json) and
// generated into Swift Codable models for the macOS client without a special
// case per contract. tests/domain-contracts.spec.ts holds the TS schema and
// the JSON Schema in step, so a field added here without the schema fails.
import { z } from "zod";
import {
  CLASSIFICATIONS,
  EVIDENCE_KINDS,
  EVIDENCE_STATUSES,
  SCAN_VERDICTS,
} from "./classification";
import { GATE_DECISIONS } from "./gates";
import { RETIRED, STAGES } from "./stages";
import { CONFIDENCE, VALUE_BASES, VALUE_PERIODS } from "./value";
export const CONTRACT_IDS = {
  evidence: "atlas-evidence/1",
  gateEvent: "atlas-gate-event/1",
  value: "atlas-value/1",
  record: "atlas-onboarding-record/1",
  steps: "atlas-process-steps/1",
  workflow: "atlas-workflow-draft/1",
  receipt: "atlas-handoff-receipt/1",
} as const;
const hex64 = z.string().regex(/^[0-9a-f]{64}$/, "Expected a sha256 hex digest.");
const id = z.string().min(1).max(80);
const at = z.string().datetime({ offset: true });
/** A finding is a CODE, never a matched value: the pattern refuses anything
 * that looks like prose, an email or a path, so a leaked sample cannot hide
 * in a findings array. */
const findingCode = z
  .string()
  .regex(/^[a-z][a-z0-9._-]{0,59}$/, "Findings travel as codes only.");
const optionalNumber = z.number().finite().nonnegative().nullable();
const optionalText = z.string().trim().max(2000).nullable();
export const evidenceContract = z
  .object({
    contract: z.literal(CONTRACT_IDS.evidence),
    id,
    projectId: id,
    kind: z.enum(EVIDENCE_KINDS),
    source: z.string().trim().min(1).max(200),
    sha256: hex64,
    bytes: z.number().int().nonnegative().max(2_147_483_648),
    classification: z.enum(CLASSIFICATIONS),
    scanState: z.enum(SCAN_VERDICTS),
    findings: z.array(findingCode).max(20),
    reviewer: optionalText,
    status: z.enum(EVIDENCE_STATUSES),
    createdAt: at,
  })
  .strict();
export type EvidenceContract = z.infer<typeof evidenceContract>;
export const gateEventContract = z
  .object({
    contract: z.literal(CONTRACT_IDS.gateEvent),
    id,
    projectId: id,
    seq: z.number().int().positive(),
    stage: z.enum([...STAGES, RETIRED]),
    fromStage: z.enum([...STAGES, RETIRED]).nullable(),
    toStage: z.enum([...STAGES, RETIRED]).nullable(),
    /** A hash of the actor is enough for the chain; the readable name lives
     * in Atlas's own access log. */
    actor: z.string().trim().min(1).max(200),
    role: z.string().trim().min(1).max(80),
    decision: z.enum(GATE_DECISIONS),
    /** Which path the project took. A quick-lane pass is still a pass; the
     * sign-offs it left open travel with it, by name. */
    lane: z.enum(["governed", "quick"]).default("governed"),
    deferred: z.array(z.enum([...STAGES, RETIRED])).max(10).default([]),
    reason: z.string().trim().max(500),
    evidenceRef: optionalText,
    materialDigest: hex64.nullable(),
    prevHash: hex64,
    hash: hex64,
    createdAt: at,
  })
  .strict();
export type GateEventContract = z.infer<typeof gateEventContract>;
export const valueContract = z
  .object({
    contract: z.literal(CONTRACT_IDS.value),
    id,
    projectId: id,
    basis: z.enum(VALUE_BASES),
    period: z.enum(VALUE_PERIODS),
    tier: z.string().trim().max(60).nullable(),
    hours: optionalNumber,
    cost: optionalNumber,
    errorRate: z.number().finite().nonnegative().max(1).nullable(),
    volume: optionalNumber,
    targetHours: optionalNumber,
    targetCost: optionalNumber,
    method: z.string().trim().min(1).max(120),
    methodVersion: z.string().trim().min(1).max(40),
    confidence: z.enum(CONFIDENCE),
    sourceRef: optionalText,
    notes: z.string().trim().max(500),
    createdAt: at,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.basis === "measured" && !value.sourceRef?.trim())
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sourceRef"],
        message: "A measured value needs a source.",
      });
    if (
      value.basis === "not-tracked" &&
      [value.hours, value.cost, value.volume].some((v) => v !== null)
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["hours"],
        message: "A not-tracked value carries no figures.",
      });
  });
export type ValueContract = z.infer<typeof valueContract>;
/** What the native clients read. One fixture drives the web test too, so the
 * three surfaces cannot drift apart on the shape of a project's brain. */
export const recordContract = z
  .object({
    contract: z.literal(CONTRACT_IDS.record),
    projectId: id,
    name: z.string().trim().min(1).max(200),
    stage: z.enum([...STAGES, RETIRED]),
    revision: z.number().int().positive(),
    gates: z
      .array(
        z
          .object({
            stage: z.enum([...STAGES, RETIRED]),
            decision: z.enum(GATE_DECISIONS),
            at,
          })
          .strict(),
      )
      .max(200),
    evidenceAccepted: z.number().int().nonnegative(),
    evidencePending: z.number().int().nonnegative(),
    osProjectId: z.string().max(80).nullable(),
    teoaScopeId: z.string().max(80).nullable(),
    visionObjectiveId: z.string().max(80).nullable(),
    reuseDecision: z.enum(["reuse", "extend", "new"]).nullable(),
    buildDecision: z.enum(["cowork", "sub-app", "studio"]).nullable(),
    entryType: z.enum(["project", "process", "workflow"]),
    valueBasis: z.enum(VALUE_BASES).nullable(),
    updatedAt: at,
  })
  .strict();
export type RecordContract = z.infer<typeof recordContract>;

/** The steps of a process, as KG extracts them and as a person edits them.
 * One shape for both, so a draft workflow can be built from either. */
export const stepsContract = z
  .object({
    contract: z.literal(CONTRACT_IDS.steps),
    projectId: id,
    provenance: z.enum(["kg", "atlas", "manual"]),
    source: z
      .object({
        filename: z.string().trim().min(1).max(200),
        sha256: hex64,
        documentType: z.string().trim().max(80).nullable(),
      })
      .strict(),
    steps: z
      .array(
        z
          .object({
            /** The source's own label ("10.", "20a"), never renumbered. */
            number: z.string().trim().min(1).max(20),
            action: z.string().trim().min(1).max(500),
            actor: z.string().trim().max(120).nullable(),
            inputs: z.string().trim().max(300).nullable(),
            outputs: z.string().trim().max(300).nullable(),
            notes: z.string().trim().max(300).nullable(),
          })
          .strict(),
      )
      .min(1)
      .max(60),
    createdAt: at,
  })
  .strict();
export type StepsContract = z.infer<typeof stepsContract>;
/** A workflow a person can test. Atlas owns its meaning; Studio owns the
 * implementation of the complex ones. */
export const workflowContract = z
  .object({
    contract: z.literal(CONTRACT_IDS.workflow),
    projectId: id,
    name: z.string().trim().min(1).max(120),
    trigger: z.enum(["new-case", "form", "schedule", "on-demand"]),
    inputs: z
      .array(
        z
          .object({
            name: z.string().trim().min(1).max(80),
            classification: z.enum(CLASSIFICATIONS),
          })
          .strict(),
      )
      .max(10),
    steps: z
      .array(
        z
          .object({
            action: z.string().trim().min(1).max(300),
            actor: z.enum(["person", "workflow"]),
            system: z.string().trim().max(80).nullable(),
            /** The suite app that does this step, if one does. Studio is one of
             * them: a step that needs it is why a workflow is complex. */
            app: z
              .enum(["advantage", "pdf", "maps", "studio", "vision"])
              .nullable()
              .default(null),
          })
          .strict(),
      )
      .min(1)
      .max(10),
    decisions: z
      .array(
        z
          .object({
            question: z.string().trim().min(1).max(200),
            /** The step number it branches to, or null for "carry on". */
            thenStep: z.string().trim().max(20).nullable(),
          })
          .strict(),
      )
      .max(5),
    signOff: z
      .object({
        role: z.enum(["process_owner", "workspace_admin"]),
        email: z.string().trim().min(3).max(160),
      })
      .strict(),
    complexity: z.enum(["simple", "studio"]),
    testReport: z
      .object({
        ranAt: at,
        cases: z.number().int().nonnegative().max(50),
        wroteAnything: z.boolean(),
        notes: z.string().trim().max(500),
      })
      .strict()
      .nullable(),
    createdAt: at,
  })
  .strict()
  .superRefine((draft, ctx) => {
    // A workflow that writes nothing during its test is the only kind that may
    // claim to be tested; a run that wrote something is a real run, not a test.
    if (draft.testReport && draft.testReport.wroteAnything)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["testReport", "wroteAnything"],
        message: "A test run writes nothing.",
      });
    // Complex work is not Atlas's to implement: it goes to Studio, and a
    // simple workflow may not carry a Studio step count.
    if (draft.complexity === "studio" && draft.steps.length <= 3)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["complexity"],
        message: "Three steps or fewer is a simple workflow.",
      });
  });
export type WorkflowContract = z.infer<typeof workflowContract>;

/** What comes back from the app that did the work: Studio built the workflow,
 * Maps drew the map, Advantage replaced the scorecard. The receipt is what
 * closes the loop — without it a hand-off is a hope. */
export const receiptContract = z
  .object({
    contract: z.literal(CONTRACT_IDS.receipt),
    projectId: id,
    /** The app that did it, by its OS sub-app id. */
    kind: z.enum(["advantage", "pdf", "maps", "studio", "vision"]),
    status: z.enum(["built", "published", "failed"]),
    /** What was produced, by reference: a version, a document id, a map id. */
    artifactRef: z.string().trim().min(1).max(200),
    version: z.string().trim().max(40).nullable(),
    notes: z.string().trim().max(500).nullable(),
    at,
  })
  .strict()
  .superRefine((receipt, ctx) => {
    // A failed build must say what failed; a built one must name what exists.
    if (receipt.status === "failed" && !receipt.notes?.trim())
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["notes"],
        message: "A failure says what failed.",
      });
    if (receipt.status !== "failed" && !receipt.artifactRef.trim())
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["artifactRef"],
        message: "A build names what exists.",
      });
  });
export type ReceiptContract = z.infer<typeof receiptContract>;
export const parseReceipt = (input: unknown) =>
  parseContract(receiptContract, CONTRACT_IDS.receipt, input);

export type ContractProblem =
  | "wrong_version"
  | "unknown_key"
  | "invalid";
export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: ContractProblem; problems: string[] };
/**
 * Parse one contract body. An unknown version and an unknown key are refused
 * separately, because the caller's fix differs: upgrade the writer versus
 * stop sending that field.
 */
export function parseContract<S extends z.ZodTypeAny>(
  schema: S,
  expected: string,
  input: unknown,
): ParseResult<z.infer<S>> {
  if (!input || typeof input !== "object" || Array.isArray(input))
    return { ok: false, code: "invalid", problems: ["body"] };
  const version = (input as { contract?: unknown }).contract;
  if (version !== expected)
    return { ok: false, code: "wrong_version", problems: [String(version)] };
  const parsed = schema.safeParse(input);
  if (parsed.success) return { ok: true, value: parsed.data };
  const issues = parsed.error.issues;
  const unknown = issues.some((i) => i.code === "unrecognized_keys");
  return {
    ok: false,
    code: unknown ? "unknown_key" : "invalid",
    problems: issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`),
  };
}
export const parseEvidence = (input: unknown) =>
  parseContract(evidenceContract, CONTRACT_IDS.evidence, input);
export const parseGateEvent = (input: unknown) =>
  parseContract(gateEventContract, CONTRACT_IDS.gateEvent, input);
export const parseValue = (input: unknown) =>
  parseContract(valueContract, CONTRACT_IDS.value, input);
export const parseRecord = (input: unknown) =>
  parseContract(recordContract, CONTRACT_IDS.record, input);
export const parseSteps = (input: unknown) =>
  parseContract(stepsContract, CONTRACT_IDS.steps, input);
export const parseWorkflow = (input: unknown) =>
  parseContract(workflowContract, CONTRACT_IDS.workflow, input);
