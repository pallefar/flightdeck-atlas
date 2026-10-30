import Foundation

/// What the app can say about a project without inventing anything.
///
/// Every figure below is counted from the snapshot the server sent: the
/// missing requirements, the evidence states, the assigned roles, the value
/// records and the audit chain. The readiness number is a CHECKLIST score —
/// how many of the onboarding facts are in place — and it is labelled that way
/// everywhere it is shown. It is not a judgement of the project's worth, and
/// it never claims a fact the project does not have.
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
  public let nextActions: [String]
  public let risks: [String]
}

/// The checklist. Each item is a fact the project may or may not have.
private struct Item {
  let label: String
  let met: Bool
  let risk: String?
  let action: String
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
      label: "Owner assigned", met: rolesFilled > 0, risk: nil,
      action: "Assign an owner"
    ),
    Item(
      label: "Process owner assigned", met: (assignments?.processOwner ?? "").isEmpty == false,
      risk: "No process owner: the as-is, value and go-live gates have nobody to pass them",
      action: "Assign a process owner"
    ),
    Item(
      label: "Both alignment approvers named",
      met: (assignments?.teoaApprover ?? "").isEmpty == false
        && (assignments?.visionApprover ?? "").isEmpty == false,
      risk: "Stage 4 cannot pass until both approvers are assigned",
      action: "Assign the TEOA and Vision approvers"
    ),
    Item(
      label: "At least one accepted evidence item", met: accepted > 0,
      risk: accepted == 0 ? "Capture has no evidence: the process is described, not shown" : nil,
      action: "Attach evidence and have it accepted"
    ),
    Item(
      label: "Governance scan clear", met: review == 0 && hasAnyEvidence,
      risk: review > 0 ? "\(review) evidence item(s) need a review before AI drafting" : nil,
      // With nothing captured there is nothing to review, so the scan action
      // would be noise next to "attach evidence".
      action: review > 0
        ? "Review the flagged evidence, or redact it"
        : "Attach evidence, then clear the scan"
    ),
    Item(label: "Reuse decision recorded", met: reuse, risk: nil,
         action: "Record the reuse decision (reuse / extend / new)"),
    Item(label: "Value baseline recorded", met: baseline, risk: nil,
         action: "Record the value baseline before build"),
    Item(label: "Audit chain verified", met: snapshot.chain.ok, risk: "The audit chain is broken",
         action: "Investigate the broken audit event"),
  ]
  // The current stage's own facts come from the server's requirement codes.
  for code in snapshot.stage.missing {
    items.append(
      Item(
        label: "Stage fact: \(code)", met: false, risk: nil,
        action: requirementLabel(code)
      )
    )
  }
  let met = items.filter(\.met).count
  let total = items.count
  // Actions keep the checklist order, so the list reads like a plan.
  let actions = items
    .filter { !$0.met }
    .map(\.action)
    .filter { !(!hasAnyEvidence && $0 == "Attach evidence, then clear the scan") }
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
