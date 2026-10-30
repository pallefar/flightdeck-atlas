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
export type RiskKind = "process_owner" | "approvers" | "evidence" | "scan" | "chain";
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
export function analyseBrain(view: BrainView): BrainAnalysis {
  const assigned = view.assignments;
  const rolesFilled = roleKeys.filter((key) => {
    const email = assigned?.[key];
    return typeof email === "string" && email.trim().length > 0;
  }).length;
  const accepted = view.evidence.filter((item) =>
    ["accepted", "redacted"].includes(item.status),
  ).length;
  const pending = view.evidence.filter((item) => item.status === "pending").length;
  const review = view.evidence.filter((item) => item.scanState === "review").length;
  const baseline = view.values.some(
    (item) => item.period === "baseline" && item.basis !== "not-tracked",
  );
  const reuse = view.reuse !== null;
  const hasAnyEvidence = accepted + pending > 0;
  type Item = { met: boolean; risk: RiskKind | null; action: AnalysisAction | null };
  const items: Item[] = [
    {
      met: rolesFilled > 0,
      risk: null,
      action: { kind: "owner", anchor: "roles" },
    },
    {
      met: Boolean(assigned?.processOwner?.trim()),
      risk: "process_owner",
      action: { kind: "process_owner", anchor: "roles" },
    },
    {
      met: Boolean(assigned?.teoaApprover?.trim()) && Boolean(assigned?.visionApprover?.trim()),
      risk: "approvers",
      action: { kind: "approvers", anchor: "roles" },
    },
    {
      met: accepted > 0,
      risk: accepted === 0 ? "evidence" : null,
      action: { kind: "evidence", anchor: "evidence" },
    },
    {
      met: review === 0 && hasAnyEvidence,
      risk: review > 0 ? "scan" : null,
      action: review > 0
        ? { kind: "scan", anchor: "evidence" }
        : { kind: "scan_none", anchor: "evidence" },
    },
    {
      met: reuse,
      risk: null,
      action: { kind: "reuse", anchor: "reuse" },
    },
    {
      met: baseline,
      risk: null,
      action: { kind: "baseline", anchor: "value" },
    },
    {
      met: view.chain.ok,
      risk: "chain",
      action: { kind: "chain", anchor: "gate" },
    },
    ...view.stage.missing.map((code) => ({
      met: false,
      risk: null,
      action: { kind: "requirement" as const, requirement: code, anchor: "intake" as const },
    })),
  ];
  const met = items.filter((item) => item.met).length;
  const total = items.length;
  const actions = items
    .filter((item) => !item.met && item.action)
    .map((item) => item.action as AnalysisAction)
    // With nothing captured, "attach evidence, then clear the scan" would sit
    // next to "attach evidence": one action, said once.
    .filter(
      (action) =>
        hasAnyEvidence || action.kind !== "scan_none",
    );
  return {
    readiness: total === 0 ? 0 : Math.round((met / total) * 100),
    met,
    total,
    rolesFilled,
    evidenceAccepted: accepted,
    evidencePending: pending,
    evidenceNeedsReview: review,
    valueRecords: view.values.length,
    hasBaseline: baseline,
    hasReuseDecision: reuse,
    chainOk: view.chain.ok,
    chainLength: view.chain.length ?? 0,
    nextActions: actions,
    risks: items.filter((item) => !item.met).flatMap((item) => (item.risk ? [item.risk] : [])),
  };
}
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
