// The onboarding lifecycle: stages, allowed moves, and what a stage demands
// before its gate can pass.
//
// Pure and shared by web, the native clients and the tests, so the three
// surfaces cannot disagree about what "stage 4" means. The route enforces it
// (409 prerequisite_missing) and the UI only *shows* it — the server is the
// authority, never the button.
//
// Two rules from the PRD are load-bearing here:
// - a material change reopens stage 4 (the existing Vision digest approach);
// - a "reuse" decision takes the fast path and skips to-be and build, so a
//   team that found an existing solution is not forced through a build.
export const STAGES = [
  "intake",
  "reuse",
  "capture",
  "as-is",
  "aligned",
  "value",
  "to-be",
  "build",
  "live",
  "measured",
] as const;
export type Stage = (typeof STAGES)[number];
/** Terminal, outside the ladder: a retired project is read-only. */
export const RETIRED = "retired" as const;
export type StageOrRetired = Stage | typeof RETIRED;
export const stageIndex = (s: Stage) => STAGES.indexOf(s);
export const isStage = (value: unknown): value is Stage =>
  typeof value === "string" && (STAGES as readonly string[]).includes(value);
export const isStageOrRetired = (value: unknown): value is StageOrRetired =>
  value === RETIRED || isStage(value);
/** The one forward step from each stage; `measured` is the last. */
export const NEXT: Partial<Record<Stage, Stage>> = {
  intake: "reuse",
  reuse: "capture",
  capture: "as-is",
  "as-is": "aligned",
  aligned: "value",
  value: "to-be",
  "to-be": "build",
  build: "live",
  live: "measured",
};
/** Stages a project can be moved back to. Only aligned: a material change
 * re-asks for alignment, it does not undo captured evidence. */
export const REOPEN_STAGE: Stage = "aligned";
export const REUSE_DECISIONS = ["reuse", "extend", "new"] as const;
export type ReuseDecision = (typeof REUSE_DECISIONS)[number];
export const BUILD_DECISIONS = ["cowork", "sub-app", "studio"] as const;
export type BuildDecision = (typeof BUILD_DECISIONS)[number];
export type MoveContext = {
  /** Recorded at stage 1. `reuse` enables the fast path value -> live. */
  reuseDecision?: ReuseDecision | null;
};
/**
 * Every stage a project may move to from `from` (`null` = not started yet).
 * The list is exhaustive on purpose: a caller picks from it or is refused,
 * so an unknown jump can never be written to the audit chain.
 */
export function allowedMoves(
  from: Stage | null,
  ctx: MoveContext = {},
): StageOrRetired[] {
  if (from === null) return ["intake"];
  const moves: StageOrRetired[] = [];
  const next = NEXT[from];
  if (next) moves.push(next);
  // The reuse fast path (PRD §13 mitigation): a project that will reuse an
  // existing solution skips the to-be map and the build stages entirely.
  if (from === "value" && ctx.reuseDecision === "reuse") moves.push("live");
  // A material change reopens alignment from anything past it.
  if (stageIndex(from) > stageIndex(REOPEN_STAGE)) moves.push(REOPEN_STAGE);
  // Retirement is allowed once a project has been started.
  moves.push(RETIRED);
  return moves;
}
export const canMove = (
  from: Stage | null,
  to: StageOrRetired,
  ctx: MoveContext = {},
) => allowedMoves(from, ctx).includes(to);
/** Whether `to` is a step back (which needs a stated reason). */
export function isReopen(from: Stage, to: StageOrRetired) {
  return to !== RETIRED && stageIndex(to) < stageIndex(from);
}
/**
 * What the route knows about a project when a gate is asked to pass. Every
 * field is a fact already stored elsewhere; this module never invents one.
 */
export type StageFacts = {
  classificationDeclared: boolean;
  problemStated: boolean;
  requesterNamed: boolean;
  functionArea: string | null;
  site: string | null;
  reuseDecision: ReuseDecision | null;
  reuseReason: string | null;
  evidenceAccepted: number;
  scanCleared: boolean;
  asIsMapRef: string | null;
  asIsSignedOff: boolean;
  osProjectId: string | null;
  teoaScopeId: string | null;
  visionObjectiveId: string | null;
  visionDeliveryCommitted: boolean;
  baselineValue: boolean;
  toBeMapRef: string | null;
  buildDecision: BuildDecision | null;
  complianceRecordId: string | null;
  shippedRef: string | null;
  operatorBundleRef: string | null;
  realizedValue: boolean;
  retireReason: string | null;
};
/** Requirement codes, not sentences: the UI translates them under
 * `brain.requirement.<code>`. A code is stable enough to be asserted in a
 * test and shown in an error body. */
export type RequirementCode =
  | "classification"
  | "problem"
  | "requester"
  | "function"
  | "site"
  | "reuse-decision"
  | "reuse-reason"
  | "evidence"
  | "scan"
  | "as-is-map"
  | "as-is-signoff"
  | "os-project"
  | "teoa-scope"
  | "vision-objective"
  | "vision-delivery"
  | "baseline-value"
  | "to-be-map"
  | "build-decision"
  | "compliance-record"
  | "shipped"
  | "operator-bundle"
  | "realized-value"
  | "retire-reason";
/** The facts a stage's gate requires. Order is the order the UI lists them. */
export function requirementsFor(
  stage: StageOrRetired,
  facts: StageFacts,
): RequirementCode[] {
  const has = (value: unknown) =>
    value !== null && value !== undefined && value !== "" && value !== false;
  const need: [RequirementCode, boolean][] = [];
  switch (stage) {
    case "intake":
      need.push(
        ["classification", facts.classificationDeclared],
        ["problem", facts.problemStated],
        ["requester", facts.requesterNamed],
        ["function", has(facts.functionArea)],
        ["site", has(facts.site)],
      );
      break;
    case "reuse":
      need.push(
        ["reuse-decision", facts.reuseDecision !== null],
        ["reuse-reason", has(facts.reuseReason)],
      );
      break;
    case "capture":
      need.push(
        ["evidence", facts.evidenceAccepted > 0],
        ["scan", facts.scanCleared],
      );
      break;
    case "as-is":
      need.push(
        ["as-is-map", has(facts.asIsMapRef)],
        ["as-is-signoff", facts.asIsSignedOff],
      );
      break;
    case "aligned":
      // No orphans (PRD G2): one OS project, one TEOA scope, one Vision
      // objective, and the delivery commit actually acknowledged.
      need.push(
        ["os-project", has(facts.osProjectId)],
        ["teoa-scope", has(facts.teoaScopeId)],
        ["vision-objective", has(facts.visionObjectiveId)],
        ["vision-delivery", facts.visionDeliveryCommitted],
      );
      break;
    case "value":
      need.push(["baseline-value", facts.baselineValue]);
      break;
    case "to-be":
      need.push(["to-be-map", has(facts.toBeMapRef)]);
      break;
    case "build":
      need.push(["build-decision", facts.buildDecision !== null]);
      break;
    case "live":
      // A reused solution ships as an existing sub-app or skill, so only a
      // fresh build needs a compliance record and a shipped ref.
      if (facts.buildDecision === "studio") {
        need.push(
          ["compliance-record", has(facts.complianceRecordId)],
          ["shipped", has(facts.shippedRef)],
        );
      }
      need.push(["operator-bundle", has(facts.operatorBundleRef)]);
      break;
    case "measured":
      need.push(["realized-value", facts.realizedValue]);
      break;
    case RETIRED:
      need.push(["retire-reason", has(facts.retireReason)]);
      break;
  }
  return need.filter(([, met]) => !met).map(([code]) => code);
}
/** Every fact, as the empty project has them. Tests and the route start here
 * so a missing fact is visible rather than defaulted to "fine". */
export const emptyFacts = (): StageFacts => ({
  classificationDeclared: false,
  problemStated: false,
  requesterNamed: false,
  functionArea: null,
  site: null,
  reuseDecision: null,
  reuseReason: null,
  evidenceAccepted: 0,
  scanCleared: false,
  asIsMapRef: null,
  asIsSignedOff: false,
  osProjectId: null,
  teoaScopeId: null,
  visionObjectiveId: null,
  visionDeliveryCommitted: false,
  baselineValue: false,
  toBeMapRef: null,
  buildDecision: null,
  complianceRecordId: null,
  shippedRef: null,
  operatorBundleRef: null,
  realizedValue: false,
  retireReason: null,
});
