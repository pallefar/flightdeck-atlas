import Foundation

/// What the app can say about a project without inventing anything.
///
/// Every figure below is counted from the snapshot the server sent: the
/// missing requirements, the evidence states, the assigned roles, the value
/// records and the audit chain. The readiness number is a CHECKLIST score —
/// how many of the onboarding facts are in place — and it is labelled that way
/// everywhere it is shown. It is not a judgement of the project's worth, and
/// it never claims a fact the project does not have.
/// Where an action is carried out, so the panel can take you there.
public enum AnalysisAnchor: String, Equatable, Sendable {
  case intake, reuse, evidence, value, roles, gate
}
/// One next action: what to do, and which section does it.
public struct AnalysisAction: Hashable, Sendable {
  public let label: String
  public let anchor: AnalysisAnchor
}
public struct BrainAnalysis: Equatable, Sendable {
  public struct Requirement: Equatable, Sendable {
    public let code: String
    public let met: Bool
  }
  /// 0–100, checklist items met over checklist items known.
  public let readiness: Int
  public let met: Int
  public let total: Int
  public let rolesFilled: Int
  public let evidenceAccepted: Int
  public let evidencePending: Int
  public let evidenceNeedsReview: Int
  public let valueRecords: Int
  public let hasBaseline: Bool
  public let hasReuseDecision: Bool
  public let chainOk: Bool
  public let chainLength: Int
  public let nextActions: [AnalysisAction]
  public let risks: [String]
}

/// The checklist. Each item is a fact the project may or may not have.
private struct Item {
  let met: Bool
  let risk: String?
  let action: AnalysisAction?
}

public func analyse(_ snapshot: AtlasSnapshot) -> BrainAnalysis {
  let assignments = snapshot.assignments
  let roles = [assignments?.owner, assignments?.processOwner,
               assignments?.teoaApprover, assignments?.visionApprover]
  let rolesFilled = roles.filter { ($0 ?? "").isEmpty == false }.count
  let accepted = snapshot.evidence.filter { ["accepted", "redacted"].contains($0.status) }.count
  let pending = snapshot.evidence.filter { $0.status == "pending" }.count
  let review = snapshot.evidence.filter { $0.scanState == "review" }.count
  let baseline = snapshot.values.contains { $0.period == "baseline" && $0.basis != "not-tracked" }
  let reuse = snapshot.reuse != nil
  let hasAnyEvidence = accepted + pending > 0

  var items: [Item] = [
    Item(
      met: rolesFilled > 0, risk: nil,
      action: AnalysisAction(label: "Assign an owner", anchor: .roles)
    ),
    Item(
      met: (assignments?.processOwner ?? "").isEmpty == false,
      risk: "No process owner: the as-is, value and go-live gates have nobody to pass them",
      action: AnalysisAction(label: "Assign a process owner", anchor: .roles)
    ),
    Item(
      met: (assignments?.teoaApprover ?? "").isEmpty == false
        && (assignments?.visionApprover ?? "").isEmpty == false,
      risk: "Stage 4 cannot pass until both approvers are assigned",
      action: AnalysisAction(label: "Assign the TEOA and Vision approvers", anchor: .roles)
    ),
    Item(
      met: accepted > 0,
      risk: accepted == 0 ? "Capture has no evidence: the process is described, not shown" : nil,
      action: AnalysisAction(label: "Attach evidence and have it accepted", anchor: .evidence)
    ),
    Item(
      met: review == 0 && hasAnyEvidence,
      risk: review > 0 ? "\(review) evidence item(s) need a review before AI drafting" : nil,
      // With nothing captured there is nothing to review, so the scan action
      // would be noise next to "attach evidence".
      action: AnalysisAction(
        label: review > 0
          ? "Review the flagged evidence, or redact it"
          : "Attach evidence, then clear the scan",
        anchor: .evidence
      )
    ),
    Item(met: reuse, risk: nil,
         action: AnalysisAction(label: "Record the reuse decision (reuse / extend / new)", anchor: .reuse)),
    Item(met: baseline, risk: nil,
         action: AnalysisAction(label: "Record the value baseline before build", anchor: .value)),
    Item(met: snapshot.chain.ok, risk: "The audit chain is broken",
         action: AnalysisAction(label: "Investigate the broken audit event", anchor: .gate)),
  ]
  // The current stage's own facts come from the server's requirement codes.
  for code in snapshot.stage.missing {
    items.append(
      Item(
        met: false, risk: nil,
        action: AnalysisAction(label: requirementLabel(code), anchor: .intake)
      )
    )
  }
  let met = items.filter(\.met).count
  let total = items.count
  // Actions keep the checklist order, so the list reads like a plan.
  let actions = items
    .filter { !$0.met }
    .compactMap(\.action)
    .filter { !(!hasAnyEvidence && $0.label == "Attach evidence, then clear the scan") }
  let risks = items.compactMap { $0.met ? nil : $0.risk }
  return BrainAnalysis(
    readiness: total == 0 ? 0 : Int((Double(met) / Double(total) * 100).rounded()),
    met: met,
    total: total,
    rolesFilled: rolesFilled,
    evidenceAccepted: accepted,
    evidencePending: pending,
    evidenceNeedsReview: review,
    valueRecords: snapshot.values.count,
    hasBaseline: baseline,
    hasReuseDecision: reuse,
    chainOk: snapshot.chain.ok,
    chainLength: snapshot.chain.length ?? 0,
    nextActions: actions,
    risks: risks
  )
}

/// The readable form of a requirement code. Kept beside the analysis so a new
/// code added on the server shows up here rather than rendering raw.
public func requirementLabel(_ code: String) -> String {
  switch code {
  case "classification": return "Declare a data classification"
  case "problem": return "State the problem"
  case "requester": return "Name the requester"
  case "function": return "Name the function"
  case "site": return "Name the site"
  case "reuse-decision": return "Record the reuse decision"
  case "reuse-reason": return "Give the reason for the decision"
  case "evidence": return "Attach at least one accepted evidence item"
  case "scan": return "Clear the governance scan"
  case "as-is-map": return "Link the as-is map"
  case "as-is-signoff": return "Record the as-is sign-off"
  case "os-project": return "Link the OS project"
  case "teoa-scope": return "Link the TEOA scope"
  case "vision-objective": return "Link the Vision objective"
  case "vision-delivery": return "Commit the Vision delivery"
  case "baseline-value": return "Record the value baseline"
  case "to-be-map": return "Link the to-be map"
  case "build-decision": return "Choose the build decision"
  case "compliance-record": return "Attach the Studio compliance record"
  case "shipped": return "Record the shipped sub-app"
  case "operator-bundle": return "Publish the operator bundle"
  case "realized-value": return "Record the realized value"
  case "retire-reason": return "Give the reason for retiring"
  default: return code
  }
}
