// What the lane can say about a project without inventing anything.
//
// The same checklist the macOS client computes (AtlasDomain/Analysis.swift):
// every figure is counted from the view the server sent — the missing
// requirements, the evidence states, the assigned roles, the value records and
// the audit chain. The readiness number is a CHECKLIST score, and it is
// labelled that way wherever it is shown: how many onboarding facts are in
// place, not what the project is worth.
import type { BrainView } from "./brain-view";
export type ActionKind =
  | "owner"
  | "process_owner"
  | "approvers"
  | "evidence"
  | "scan"
  | "scan_none"
  | "reuse"
  | "baseline"
  | "chain"
  | "requirement";
export type RiskKind =
  | "process_owner"
  | "approvers"
  | "evidence"
  | "scan"
  | "chain"
  | "deferred";
export type AnalysisAction = {
  /** What to do next as a KIND, so both surfaces translate it themselves. */
  kind: ActionKind;
  /** For `requirement`: the server's code, which names the i18n key. */
  requirement?: string;
  /** The section in the project panel that does it. */
  anchor: "intake" | "reuse" | "evidence" | "value" | "roles" | "gate";
};
export type BrainAnalysis = {
  readiness: number;
  met: number;
  total: number;
  rolesFilled: number;
  evidenceAccepted: number;
  evidencePending: number;
  evidenceNeedsReview: number;
  valueRecords: number;
  hasBaseline: boolean;
  hasReuseDecision: boolean;
  chainOk: boolean;
  chainLength: number;
  nextActions: AnalysisAction[];
  risks: RiskKind[];
};
const roleKeys = ["owner", "processOwner", "teoaApprover", "visionApprover"] as const;

/** The facts the readiness score counts — the same seven the list API can
 * count for every project without opening it. The audit chain and the stage's
 * own requirements are shown beside the score, never inside it. */
export type ReadinessFacts = {
  rolesFilled: number;
  processOwner: boolean;
  approvers: boolean;
  accepted: number;
  pending: number;
  review: number;
  reuse: boolean;
  baseline: boolean;
};
export function readinessFacts(view: BrainView): ReadinessFacts {
  const assigned = view.assignments;
  const accepted = view.evidence.filter((item) =>
    ["accepted", "redacted"].includes(item.status),
  ).length;
  return {
    rolesFilled: roleKeys.filter((key) => {
      const email = assigned?.[key];
      return typeof email === "string" && email.trim().length > 0;
    }).length,
    processOwner: Boolean(assigned?.processOwner?.trim()),
    approvers:
      Boolean(assigned?.teoaApprover?.trim()) && Boolean(assigned?.visionApprover?.trim()),
    accepted,
    pending: view.evidence.filter((item) => item.status === "pending").length,
    review: view.evidence.filter((item) => item.scanState === "review").length,
    reuse: view.reuse !== null,
    baseline: view.values.some(
      (item) => item.period === "baseline" && item.basis !== "not-tracked",
    ),
  };
}
/** The score, from the seven facts alone. Shared with the list route so a
 * project's badge and its detail can never disagree. */
export function portfolioReadiness(facts: ReadinessFacts): { met: number; total: number; readiness: number } {
  const hasAnyEvidence = facts.accepted + facts.pending > 0;
  const scored = [
    facts.rolesFilled > 0,
    facts.processOwner,
    facts.approvers,
    facts.accepted > 0,
    facts.review === 0 && hasAnyEvidence,
    facts.reuse,
    facts.baseline,
  ];
  const met = scored.filter(Boolean).length;
  const total = scored.length;
  return { met, total, readiness: Math.round((met / total) * 100) };
}
export function analyseBrain(view: BrainView): BrainAnalysis {
  const facts = readinessFacts(view);
  const score = portfolioReadiness(facts);
  type Extra = { risk: RiskKind | null; action: AnalysisAction | null };
  // Not scored, but shown beside the score: the chain's health and the stage's
  // own requirements. An unscored fact is why the badge and the card agree.
  const extras: Extra[] = [
    {
      risk: view.chain.ok ? null : "chain",
      action: { kind: "chain", anchor: "gate" },
    },
    ...view.stage.missing.map((code) => ({
      risk: null as RiskKind | null,
      action: { kind: "requirement" as const, requirement: code, anchor: "intake" as const },
    })),
  ];
  const nextActions = [
    ...(facts.rolesFilled > 0 ? [] : [{ kind: "owner" as const, anchor: "roles" as const }]),
    ...(facts.processOwner ? [] : [{ kind: "process_owner" as const, anchor: "roles" as const }]),
    ...(facts.approvers ? [] : [{ kind: "approvers" as const, anchor: "roles" as const }]),
    ...(facts.accepted > 0 ? [] : [{ kind: "evidence" as const, anchor: "evidence" as const }]),
    // With nothing captured the evidence action already covers the scan; a
    // second line saying "attach evidence, then clear the scan" is noise.
    ...(facts.review > 0 ? [{ kind: "scan" as const, anchor: "evidence" as const }] : []),
    ...(facts.reuse ? [] : [{ kind: "reuse" as const, anchor: "reuse" as const }]),
    ...(facts.baseline ? [] : [{ kind: "baseline" as const, anchor: "value" as const }]),
    ...extras
      .filter((extra) => extra.risk === "chain" || (extra.action?.kind === "requirement"))
      .flatMap((extra) => (extra.action ? [extra.action] : [])),
  ];
  return {
    readiness: score.readiness,
    met: score.met,
    total: score.total,
    rolesFilled: facts.rolesFilled,
    evidenceAccepted: facts.accepted,
    evidencePending: facts.pending,
    evidenceNeedsReview: facts.review,
    valueRecords: view.values.length,
    hasBaseline: facts.baseline,
    hasReuseDecision: facts.reuse,
    chainOk: view.chain.ok,
    chainLength: view.chain.length ?? 0,
    nextActions,
    risks: [
      ...(facts.processOwner ? [] : (["process_owner"] as RiskKind[])),
      ...(facts.approvers ? [] : (["approvers"] as RiskKind[])),
      ...(facts.accepted > 0 ? [] : (["evidence"] as RiskKind[])),
      ...(facts.review > 0 ? (["scan"] as RiskKind[]) : []),
      ...(view.chain.ok ? [] : (["chain"] as RiskKind[])),
      ...(deferredCount(view) > 0 ? (["deferred"] as RiskKind[]) : []),
    ],
  };
}
/** How many sign-offs the quick lane left open. Not part of the score: a
 * deferred sign-off is a governance debt, not a fact the project has. */
export const deferredCount = (view: BrainView) =>
  Array.isArray(view.data?.deferredGates) ? (view.data.deferredGates as unknown[]).length : 0;
/** The readable form of a requirement code, beside the analysis so a new code
 * shows up here rather than rendering raw. Mirrors requirementText in Swift. */
export function requirementText(code: string): string {
  const labels: Record<string, string> = {
    classification: "Declare a data classification",
    problem: "State the problem",
    requester: "Name the requester",
    function: "Name the function",
    site: "Name the site",
    "reuse-decision": "Record the reuse decision",
    "reuse-reason": "Give the reason for the decision",
    evidence: "Attach at least one accepted evidence item",
    scan: "Clear the governance scan",
    "as-is-map": "Link the as-is map",
    "as-is-signoff": "Record the as-is sign-off",
    "os-project": "Link the OS project",
    "teoa-scope": "Link the TEOA scope",
    "vision-objective": "Link the Vision objective",
    "vision-delivery": "Commit the Vision delivery",
    "baseline-value": "Record the value baseline",
    "to-be-map": "Link the to-be map",
    "build-decision": "Choose the build decision",
    "compliance-record": "Attach the Studio compliance record",
    shipped: "Record the shipped sub-app",
    "operator-bundle": "Publish the operator bundle",
    "realized-value": "Record the realized value",
    "retire-reason": "Give the reason for retiring",
  };
  return labels[code] ?? code;
}
