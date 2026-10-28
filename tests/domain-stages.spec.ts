import { test, expect } from "@playwright/test";
import {
  STAGES,
  RETIRED,
  allowedMoves,
  canMove,
  emptyFacts,
  isReopen,
  isStageOrRetired,
  requirementsFor,
  stageIndex,
  type Stage,
  type StageFacts,
} from "../lib/domain/stages";
import {
  GATE_DECISIONS,
  gatePermissions,
  canPassGate,
  missingGatePermissions,
  reasonRequired,
} from "../lib/domain/gates";
import {
  CLASSIFICATIONS,
  BLOCKED_CLASSIFICATIONS,
  allowsUpload,
  allowsAi,
  blockedCode,
} from "../lib/domain/classification";
import {
  VALUE_TIER_CONFIG,
  rollUp,
  valueProblems,
  type ValueInput,
} from "../lib/domain/value";

// The lifecycle spine, as pure rules. These tests are the contract the route
// and the three clients are held to: no stage jump the matrix does not allow,
// no gate without its role, no restricted class on the upload path.
const stage = (s: Stage) => s;
const facts = (over: Partial<StageFacts> = {}): StageFacts => ({
  ...emptyFacts(),
  ...over,
});
const complete = (): StageFacts =>
  facts({
    classificationDeclared: true,
    problemStated: true,
    requesterNamed: true,
    functionArea: "HR Services",
    site: "Bensheim",
    reuseDecision: "new",
    reuseReason: "No matching sub-app or process.",
    evidenceAccepted: 2,
    scanCleared: true,
    asIsMapRef: "map-as-is-1",
    asIsSignedOff: true,
    osProjectId: "proj-1",
    teoaScopeId: "scope-1",
    visionObjectiveId: "obj-1",
    visionDeliveryCommitted: true,
    baselineValue: true,
    toBeMapRef: "map-to-be-1",
    buildDecision: "studio",
    complianceRecordId: "ccr-1",
    shippedRef: "subapp-1",
    operatorBundleRef: "bundle-1",
    realizedValue: true,
    retireReason: "Merged into another project.",
  });
test.describe("stage ladder", () => {
  test("every stage has exactly one forward step except the last", () => {
    for (const s of STAGES) {
      const moves = allowedMoves(s).filter((m) => m !== RETIRED);
      const forward = stageIndex(s) < STAGES.length - 1 ? 1 : 0;
      const back = stageIndex(s) > stageIndex("aligned") ? 1 : 0;
      expect(moves.length, s).toBe(forward + back);
    }
  });
  test("a project that has not started may only enter intake", () => {
    expect(allowedMoves(null)).toEqual(["intake"]);
    expect(canMove(null, "capture")).toBe(false);
  });
  test("the audit stage cannot be skipped: value is not reachable from capture", () => {
    expect(canMove("capture", "value")).toBe(false);
    expect(canMove("capture", "as-is")).toBe(true);
  });
  test("a reuse decision opens the fast path from value straight to live", () => {
    expect(canMove("value", "live")).toBe(false);
    expect(canMove("value", "live", { reuseDecision: "reuse" })).toBe(true);
    // extend / new still walk through to-be and build
    expect(canMove("value", "live", { reuseDecision: "extend" })).toBe(false);
    expect(canMove("value", "live", { reuseDecision: "new" })).toBe(false);
  });
  test("a material change reopens alignment from every later stage", () => {
    for (const s of ["value", "to-be", "build", "live", "measured"] as Stage[]) {
      expect(canMove(s, "aligned"), s).toBe(true);
      expect(isReopen(s, "aligned"), s).toBe(true);
    }
    expect(canMove("capture", "aligned")).toBe(false);
    expect(canMove("aligned", "aligned")).toBe(false);
  });
  test("retirement is allowed from every started stage, never from nothing", () => {
    for (const s of STAGES) expect(canMove(s, RETIRED), s).toBe(true);
    expect(canMove(null, RETIRED)).toBe(false);
  });
  test("an unknown stage string is not a stage", () => {
    expect(isStageOrRetired("done")).toBe(false);
    expect(isStageOrRetired("aligned")).toBe(true);
    expect(isStageOrRetired(RETIRED)).toBe(true);
  });
});
test.describe("stage requirements", () => {
  test("an empty project fails intake on every fact, in a stable order", () => {
    expect(requirementsFor("intake", emptyFacts())).toEqual([
      "classification",
      "problem",
      "requester",
      "function",
      "site",
    ]);
  });
  test("every stage's gate is satisfied by complete facts", () => {
    for (const s of [...STAGES, RETIRED] as const)
      expect(requirementsFor(s, complete()), s).toEqual([]);
  });
  test("alignment cannot pass without an OS project, a TEOA scope and a Vision objective", () => {
    expect(
      requirementsFor(
        "aligned",
        facts({
          osProjectId: "p",
          visionObjectiveId: "o",
          visionDeliveryCommitted: true,
        }),
      ),
    ).toEqual(["teoa-scope"]);
  });
  test("capture without accepted evidence is refused even if the scan is clear", () => {
    expect(requirementsFor("capture", facts({ scanCleared: true }))).toEqual([
      "evidence",
    ]);
  });
  test("a studio build needs a compliance record and a ship; a reused one does not", () => {
    const reused = facts({ buildDecision: "sub-app", operatorBundleRef: "b" });
    expect(requirementsFor("live", reused)).toEqual([]);
    const studio = facts({ buildDecision: "studio", operatorBundleRef: "b" });
    expect(requirementsFor("live", studio)).toEqual([
      "compliance-record",
      "shipped",
    ]);
  });
  test("retirement needs a stated reason", () => {
    expect(requirementsFor(RETIRED, facts())).toEqual(["retire-reason"]);
  });
});
test.describe("gate authority", () => {
  test("the requester's own role cannot pass a gate", () => {
    const ownerRole = ["projects.read", "projects.create", "onboarding.view"];
    for (const s of [...STAGES, RETIRED] as const)
      expect(canPassGate(ownerRole, s), s).toBe(false);
  });
  test("alignment needs BOTH alignment permissions, not one", () => {
    expect(canPassGate(["onboarding.gate.teoa"], "aligned")).toBe(false);
    expect(
      canPassGate(["onboarding.gate.teoa", "onboarding.gate.vision"], "aligned"),
    ).toBe(true);
  });
  test("a denial names exactly what is missing", () => {
    expect(missingGatePermissions(["onboarding.triage"], "value")).toEqual([
      "onboarding.gate.process_owner",
      "onboarding.value.edit",
    ]);
  });
  test("the matrix covers every stage and never grants an unknown permission", () => {
    for (const s of [...STAGES, RETIRED] as const) {
      const perms = gatePermissions(s);
      expect(perms.length, s).toBeGreaterThan(0);
      for (const p of perms) expect(p.startsWith("onboarding."), p).toBe(true);
    }
  });
  test("reject and reopen need a reason, pass does not", () => {
    expect(GATE_DECISIONS.map(reasonRequired)).toEqual([false, true, true]);
  });
});
test.describe("data classification", () => {
  test("the four restricted classes are blocked from upload and from AI", () => {
    for (const c of BLOCKED_CLASSIFICATIONS) {
      expect(allowsUpload(c), c).toBe(false);
      expect(allowsAi(c), c).toBe(false);
      expect(blockedCode(c), c).toBe(`classification.${c}`);
    }
  });
  test("the allowed classes are allowed, and carry no block code", () => {
    for (const c of CLASSIFICATIONS) {
      if ((BLOCKED_CLASSIFICATIONS as readonly string[]).includes(c)) continue;
      expect(allowsUpload(c), c).toBe(true);
      expect(blockedCode(c), c).toBeNull();
    }
  });
});
test.describe("value", () => {
  const record = (over: Partial<ValueInput> = {}): ValueInput => ({
    basis: "estimate",
    period: "baseline",
    figures: { hours: 100 },
    method: "ai-jam-value-case",
    methodVersion: "provisional-1",
    confidence: "medium",
    ...over,
  });
  test("a measured record without a source is refused", () => {
    expect(valueProblems(record({ basis: "measured" }))).toContain(
      "measured_without_source",
    );
    expect(
      valueProblems(record({ basis: "measured", sourceRef: "export.csv" })),
    ).toEqual([]);
  });
  test("a not-tracked record carries no figures", () => {
    expect(
      valueProblems(record({ basis: "not-tracked", figures: { hours: 1 } })),
    ).toContain("no_figures");
    expect(valueProblems(record({ basis: "not-tracked", figures: {} }))).toEqual(
      [],
    );
  });
  test("an error rate outside 0..1 is refused", () => {
    expect(
      valueProblems(record({ figures: { errorRate: 4 } })),
    ).toContain("error_rate_range");
  });
  test("the roll-up keeps measured and estimate apart and says when it is mixed", () => {
    const result = rollUp([
      record({ basis: "measured", figures: { hours: 10 }, sourceRef: "x" }),
      record({ basis: "estimate", figures: { hours: 5, cost: 50 } }),
      record({ basis: "not-tracked", figures: {} }),
    ]);
    expect(result.measured.hours).toBe(10);
    expect(result.estimate.hours).toBe(5);
    expect(result.notTracked).toBe(1);
    expect(result.mixed).toBe(true);
  });
  test("the tier config admits it is provisional", () => {
    expect(VALUE_TIER_CONFIG.provisional).toBe(true);
    expect(VALUE_TIER_CONFIG.version).toBe("provisional-1");
  });
  test("the ladder and the matrix agree on the stage names", () => {
    expect(gatePermissions(stage("aligned"))).toEqual([
      "onboarding.gate.teoa",
      "onboarding.gate.vision",
    ]);
  });
});
