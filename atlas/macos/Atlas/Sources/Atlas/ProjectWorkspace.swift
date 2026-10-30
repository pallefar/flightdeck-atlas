import AtlasDomain
import Charts
import CryptoKit
import SwiftUI

/// The project workspace: the redesign's centre.
///
/// A project used to open as one long sheet of everything. Now it is a
/// workspace with a header that says where it stands, a stage rail you can read
/// at a glance, six tabs that each answer one question — what is the state, how
/// is it mapped, what is it worth, what proves it, who answers for it, and what
/// happened — and the gate pinned at the bottom, because the gate is the action.
struct ProjectWorkspace: View {
  @EnvironmentObject private var model: BrainModel
  @Environment(\.dismiss) private var dismiss
  @State private var tab: Tab = .summary
  @State private var draft = IntakeDraft()
  @State private var seededRevision = -1
  @State private var reuseDecision = "new"
  @State private var reuseReason = ""
  @State private var gateReason = ""
  @State private var evidenceKind = "document"
  @State private var evidenceClassification = "internal"
  @State private var importing = false
  @State private var valueBasis = "estimate"
  @State private var valuePeriod = "baseline"
  @State private var valueHours = ""
  @State private var valueCost = ""
  @State private var valueTarget = ""
  @State private var valueSource = ""
  @State private var role = "process_owner"
  @State private var roleEmail = ""

  enum Tab: String, CaseIterable, Identifiable {
    case summary = "Summary"
    case map = "Map"
    case measure = "Measure"
    case evidence = "Evidence"
    case roles = "Roles"
    case audit = "Audit"
    var id: String { rawValue }
  }

  private let classifications = [
    "public", "internal", "confidential", "export-restricted", "itar", "cui", "customer-pii",
  ]
  private let kinds = ["document", "recording", "voice", "interview", "connector", "capture"]

  var body: some View {
    Group {
      if let snapshot = model.selected {
        VStack(spacing: 0) {
          header(snapshot)
          stageRail(snapshot)
          tabs
          Divider().opacity(0.4)
          ScrollView {
            Group {
              switch tab {
              case .summary: summaryTab(snapshot)
              case .map: mapTab(snapshot)
              case .measure: measureTab(snapshot)
              case .evidence: evidenceTab(snapshot)
              case .roles: rolesTab(snapshot)
              case .audit: auditTab(snapshot)
              }
            }
            .padding(24)
            .frame(maxWidth: .infinity, alignment: .leading)
          }
          Divider().opacity(0.4)
          gateBar(snapshot)
        }
        .task(id: snapshot.record.revision) {
          if seededRevision != snapshot.record.revision {
            draft = snapshot.data?.draft ?? IntakeDraft()
            seededRevision = snapshot.record.revision
          }
        }
      } else {
        ContentUnavailableView(
          "No project open", systemImage: "square.stack.3d.up",
          description: Text("Pick a project on the Overview or the Pipeline.")
        )
      }
    }
    .fileImporter(isPresented: $importing, allowedContentTypes: [.item]) { result in
      guard case .success(let url) = result else { return }
      let kind = evidenceKind
      let classification = evidenceClassification
      Task { await model.addEvidence(url: url, kind: kind, classification: classification) }
    }
  }

  // MARK: header and rail

  private func header(_ snapshot: AtlasSnapshot) -> some View {
    VStack(alignment: .leading, spacing: 6) {
      HStack(alignment: .firstTextBaseline, spacing: 10) {
        Text(snapshot.record.name).font(.title2.bold())
        Spacer()
        if let url = model.atlasProjectURL(snapshot.record.projectId) {
          Link("Open in Atlas ↗", destination: url).font(.caption)
        }
        Button("Feedback") { model.feedbackOpen = true }.font(.caption)
        Button {
          model.selected = nil
        } label: {
          Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Close project")
      }
      Text(
        "\(snapshot.workspace.map { "\($0.name) · " } ?? "")\(kindTitle(snapshot.entryKind)) · \(stageTitle(snapshot.stage.current)) · rev \(snapshot.record.revision)"
      )
      .font(.callout)
      .foregroundStyle(.secondary)
      Text(
        snapshot.chain.ok
          ? "Audit chain verified (\(snapshot.chain.length ?? 0) events)"
          : "Audit chain broken at event \(snapshot.chain.brokenAt ?? 0)"
      )
      .font(.caption)
      .padding(.horizontal, 8)
      .padding(.vertical, 3)
      .background(
        Capsule().fill(snapshot.chain.ok ? Color.green.opacity(0.14) : Color.red.opacity(0.14))
      )
    }
    .padding(.horizontal, 24)
    .padding(.top, 18)
    .padding(.bottom, 10)
  }

  /// The ten stages, with what is passed, what is current and what is ahead.
  private func stageRail(_ snapshot: AtlasSnapshot) -> some View {
    let current = Stage(rawValue: snapshot.stage.current)
    let index = current.map { Stage.ladder.firstIndex(of: $0) ?? -1 } ?? -1
    return HStack(spacing: 4) {
      ForEach(Array(Stage.ladder.enumerated()), id: \.offset) { position, stage in
        VStack(spacing: 4) {
          Capsule()
            .fill(
              position < index
                ? Color.accentColor.opacity(0.8)
                : position == index ? Color.accentColor : Color.secondary.opacity(0.22)
            )
            .frame(height: position == index ? 6 : 4)
          Text(stage.title)
            .font(.system(size: 9))
            .foregroundStyle(position == index ? Color.primary : Color.secondary)
            .lineLimit(1)
            .minimumScaleFactor(0.7)
        }
        .frame(maxWidth: .infinity)
      }
    }
    .padding(.horizontal, 24)
    .padding(.bottom, 12)
    .accessibilityElement(children: .ignore)
    .accessibilityLabel("Stage \(index + 1) of \(Stage.ladder.count): \(stageTitle(snapshot.stage.current))")
  }

  private var tabs: some View {
    Picker("Section", selection: $tab) {
      ForEach(Tab.allCases) { item in Text(item.rawValue).tag(item) }
    }
    .pickerStyle(.segmented)
    .labelsHidden()
    .padding(.horizontal, 24)
    .padding(.bottom, 12)
  }

  // MARK: summary

  private func summaryTab(_ snapshot: AtlasSnapshot) -> some View {
    let analysis = analyse(snapshot)
    return VStack(alignment: .leading, spacing: 18) {
      readinessCard(analysis)
      requirements(snapshot)
      factsForm(snapshot)
      reuseForm
    }
  }

  private func readinessCard(_ analysis: BrainAnalysis) -> some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack(alignment: .firstTextBaseline) {
        Text("Readiness").font(.headline)
        Spacer()
        Text("\(analysis.readiness)%").font(.title2.bold())
      }
      ProgressView(value: Double(analysis.readiness), total: 100)
      Text("Checklist: \(analysis.met) of \(analysis.total) onboarding facts in place. A checklist score, not a judgement of value.")
        .font(.caption)
        .foregroundStyle(.secondary)
      HStack(spacing: 18) {
        fact("Roles", "\(analysis.rolesFilled)/4")
        fact("Evidence", "\(analysis.evidenceAccepted) ok · \(analysis.evidencePending) pending · \(analysis.evidenceNeedsReview) review")
        fact("Value", analysis.hasBaseline ? "baseline recorded" : "\(analysis.valueRecords) record(s)")
        fact("Audit", analysis.chainOk ? "ok · \(analysis.chainLength)" : "broken")
      }
      if !analysis.risks.isEmpty {
        ForEach(analysis.risks, id: \.self) { risk in
          Label(risk, systemImage: "exclamationmark.triangle")
            .font(.caption)
            .foregroundStyle(.orange)
        }
      }
      if !analysis.nextActions.isEmpty {
        VStack(alignment: .leading, spacing: 3) {
          Text("Next actions").font(.caption.bold()).foregroundStyle(.secondary)
          ForEach(analysis.nextActions.prefix(6), id: \.self) { action in
            Button {
              tab = tabFor(action.anchor)
            } label: {
              HStack(spacing: 5) {
                Image(systemName: "arrow.turn.down.right").font(.caption2)
                Text(action.label).font(.callout).multilineTextAlignment(.leading)
              }
            }
            .buttonStyle(.plain)
            .foregroundStyle(Color.accentColor)
            .accessibilityHint("Opens the section that does this")
          }
        }
      }
    }
    .padding(16)
    .background(RoundedRectangle(cornerRadius: 14).fill(Color.secondary.opacity(0.06)))
  }

  private func tabFor(_ anchor: AnalysisAnchor) -> Tab {
    switch anchor {
    case .roles: return .roles
    case .evidence: return .evidence
    case .value: return .measure
    case .gate, .intake, .reuse: return .summary
    }
  }

  private func fact(_ title: String, _ value: String) -> some View {
    VStack(alignment: .leading, spacing: 1) {
      Text(title).font(.caption2).foregroundStyle(.secondary)
      Text(value)
    }
  }

  private func requirements(_ snapshot: AtlasSnapshot) -> some View {
    section("Still needed for this stage") {
      if snapshot.stage.missing.isEmpty {
        Text("This stage's requirements are met.").foregroundStyle(.secondary)
      } else {
        ForEach(snapshot.stage.missing, id: \.self) { code in
          Label(requirementLabel(code), systemImage: "circle.dashed")
        }
      }
      Text("Stage requirements are what this gate needs. The readiness card is broader: roles, evidence, value and the audit chain.")
        .font(.caption)
        .foregroundStyle(.secondary)
    }
  }

  private func factsForm(_ snapshot: AtlasSnapshot) -> some View {
    section("Facts") {
      Picker("Data classification", selection: $draft.classification) {
        Text("—").tag("")
        ForEach(classifications, id: \.self) { Text($0).tag($0) }
      }
      .frame(maxWidth: 320)
      .onChange(of: draft.classification) { _, value in
        draft.classificationDeclared = !value.isEmpty
      }
      field("Problem", text: $draft.problem)
      field("Requester", text: $draft.requester)
      field("Function", text: $draft.functionArea)
      field("Site", text: $draft.site)
      field("Objective", text: $draft.objective)
      field("Success measure", text: $draft.successMeasure)
      field("TEOA scope id", text: $draft.teoaScopeId)
      field("Vision objective id", text: $draft.visionObjectiveId)
      field("Volume", text: $draft.volume)
      field("Frequency", text: $draft.frequency)
      Button("Save facts") {
        let copy = draft
        Task { await model.saveIntake(copy) }
      }
      .disabled(model.busy || snapshot.access?.canEdit == false)
    }
  }

  private var reuseForm: some View {
    section("Reuse check") {
      Picker("Decision", selection: $reuseDecision) {
        Text("Reuse existing").tag("reuse")
        Text("Extend existing").tag("extend")
        Text("New build").tag("new")
      }
      .pickerStyle(.segmented)
      .frame(maxWidth: 420)
      TextField("Why", text: $reuseReason).textFieldStyle(.roundedBorder)
      Button("Record the check") {
        let decision = reuseDecision
        let reason = reuseReason
        Task { await model.recordReuse(decision: decision, reason: reason) }
      }
      .disabled(model.busy || reuseReason.trimmingCharacters(in: .whitespaces).isEmpty)
    }
  }

  // MARK: map

  private func mapTab(_ snapshot: AtlasSnapshot) -> some View {
    VStack(alignment: .leading, spacing: 18) {
      section("The maps") {
        field("As-is map reference", text: $draft.asIsMapRef)
        Toggle("As-is signed off", isOn: $draft.asIsSignedOff)
        field("To-be map reference", text: $draft.toBeMapRef)
        Button("Save the map references") {
          let copy = draft
          Task { await model.saveIntake(copy) }
        }
        .disabled(model.busy || snapshot.access?.canEdit == false)
      }
      section("Ask for a map") {
        Text("Atlas reserves the request; DiagramForge does the drawing. Nothing is claimed to exist until its reference comes back.")
          .font(.caption)
          .foregroundStyle(.secondary)
        HStack(spacing: 10) {
          Button("Request the as-is map") {
            Task { await model.requestHandoff(kind: "diagramforge", mapType: "as-is") }
          }
          .disabled(model.busy)
          Button("Request the to-be map") {
            Task { await model.requestHandoff(kind: "diagramforge", mapType: "future") }
          }
          .disabled(model.busy)
        }
      }
      section("Requests") {
        if let handoffs = snapshot.handoffs, !handoffs.isEmpty {
          ForEach(handoffs) { item in
            HStack {
              Text(item.kind).font(.callout.weight(.medium))
              Text(item.status).font(.caption).foregroundStyle(.secondary)
              Spacer()
              Text(item.createdAt.prefix(10)).font(.caption2).foregroundStyle(.tertiary)
            }
          }
        } else {
          Text("No map has been requested yet.").foregroundStyle(.secondary)
        }
      }
      appsSection(snapshot)
    }
  }

  // MARK: measure

  private func measureTab(_ snapshot: AtlasSnapshot) -> some View {
    VStack(alignment: .leading, spacing: 18) {
      section("Recorded value") {
        if snapshot.values.isEmpty {
          Text("No value recorded yet.").foregroundStyle(.secondary)
        } else {
          Chart(snapshot.values.filter { $0.figures.hours != nil }) { item in
            BarMark(
              x: .value("Period", periodTitle(item.period)),
              y: .value("Hours", item.figures.hours ?? 0)
            )
            .foregroundStyle(item.basis == "measured" ? Color.accentColor : Color.accentColor.opacity(0.45))
            .annotation(position: .top) {
              Text(item.basis == "measured" ? "measured" : item.basis)
                .font(.system(size: 9))
                .foregroundStyle(.secondary)
            }
          }
          .frame(height: 160)
          ForEach(snapshot.values) { item in
            HStack {
              Text("\(item.basis) · \(periodTitle(item.period))").font(.callout)
              Spacer()
              if let hours = item.figures.hours { Text("\(Int(hours)) h").font(.callout) }
              if let cost = item.figures.cost { Text("· \(Int(cost))").font(.caption) }
              if let source = item.sourceRef, !source.isEmpty {
                Text("· \(source)").font(.caption2).foregroundStyle(.secondary)
              }
            }
          }
        }
      }
      section("Record a measurement") {
        HStack(spacing: 10) {
          Picker("Basis", selection: $valueBasis) {
            Text("Estimate").tag("estimate")
            Text("Measured").tag("measured")
            Text("Not tracked").tag("not-tracked")
          }
          .frame(maxWidth: 200)
          Picker("Period", selection: $valuePeriod) {
            Text("Baseline").tag("baseline")
            Text("30 days").tag("d30")
            Text("90 days").tag("d90")
          }
          .frame(maxWidth: 180)
        }
        HStack(spacing: 10) {
          TextField("Hours", text: $valueHours).textFieldStyle(.roundedBorder).frame(maxWidth: 100)
          TextField("Cost", text: $valueCost).textFieldStyle(.roundedBorder).frame(maxWidth: 100)
          TextField("Target hours", text: $valueTarget).textFieldStyle(.roundedBorder).frame(maxWidth: 120)
          TextField("Source reference", text: $valueSource).textFieldStyle(.roundedBorder)
        }
        Button("Add measurement") {
          let basis = valueBasis
          let period = valuePeriod
          let hours = Double(valueHours)
          let cost = Double(valueCost)
          let target = Double(valueTarget)
          let source = valueSource.trimmingCharacters(in: .whitespaces).isEmpty ? nil : valueSource
          Task {
            await model.addValue(
              basis: basis, period: period, hours: hours, cost: cost,
              targetHours: target, sourceRef: source
            )
          }
        }
        .disabled(model.busy)
        Text("A measured record without a source is refused: an estimate is never shown as measured.")
          .font(.caption)
          .foregroundStyle(.secondary)
      }
    }
  }

  private func periodTitle(_ period: String) -> String {
    switch period {
    case "baseline": return "Baseline"
    case "d30": return "30 days"
    case "d90": return "90 days"
    default: return period
    }
  }

  // MARK: evidence, roles, audit

  private func evidenceTab(_ snapshot: AtlasSnapshot) -> some View {
    section("Evidence") {
      if snapshot.evidence.isEmpty {
        Text("No evidence attached yet.").foregroundStyle(.secondary)
      } else {
        ForEach(snapshot.evidence) { item in
          HStack {
            Text(item.source).font(.callout)
            Text(item.kind).font(.caption).foregroundStyle(.secondary)
            Text(item.status).font(.caption).foregroundStyle(.secondary)
            Spacer()
            Text(item.scanState).font(.caption2).foregroundStyle(.secondary)
          }
        }
      }
      Picker("Kind", selection: $evidenceKind) {
        ForEach(kinds, id: \.self) { Text($0).tag($0) }
      }
      .frame(maxWidth: 260)
      Picker("Classification", selection: $evidenceClassification) {
        ForEach(classifications, id: \.self) { Text($0).tag($0) }
      }
      .frame(maxWidth: 260)
      Button("Add evidence from a file") { importing = true }.disabled(model.busy)
      Text("Atlas records the file's hash, size and classification. The file itself is not uploaded.")
        .font(.caption)
        .foregroundStyle(.secondary)
    }
  }

  private func rolesTab(_ snapshot: AtlasSnapshot) -> some View {
    section("Roles") {
      let rows: [(String, String?)] = [
        ("Owner", snapshot.assignments?.owner),
        ("Process owner", snapshot.assignments?.processOwner),
        ("TEOA approver", snapshot.assignments?.teoaApprover),
        ("Vision approver", snapshot.assignments?.visionApprover),
      ]
      ForEach(rows.filter { $0.1 != nil }, id: \.0) { role, email in
        Text("\(role): \(email ?? "")").font(.callout)
      }
      if rows.allSatisfy({ $0.1 == nil }) {
        Text("No roles assigned yet.").foregroundStyle(.secondary)
      }
      if snapshot.access?.canAssignRoles == true {
        HStack(spacing: 10) {
          Picker("Role", selection: $role) {
            Text("Owner").tag("owner")
            Text("Process owner").tag("process_owner")
            Text("TEOA approver").tag("teoa_approver")
            Text("Vision approver").tag("vision_approver")
          }
          .frame(maxWidth: 180)
          TextField("person@te.com", text: $roleEmail).textFieldStyle(.roundedBorder)
          Button("Assign") {
            let chosen = role
            let email = roleEmail
            Task { await model.assignRole(role: chosen, email: email) }
          }
          .disabled(model.busy || roleEmail.trimmingCharacters(in: .whitespaces).isEmpty)
        }
      } else {
        Text("Only a workspace admin assigns roles.").font(.caption).foregroundStyle(.secondary)
      }
    }
  }

  private func auditTab(_ snapshot: AtlasSnapshot) -> some View {
    section("Audit timeline") {
      if snapshot.gates.isEmpty {
        Text("No events yet.").foregroundStyle(.secondary)
      } else {
        ForEach(Array(snapshot.gates.enumerated()), id: \.offset) { _, gate in
          HStack {
            Text(stageTitle(gate.stage)).font(.callout.weight(.medium))
            Text(gate.decision).font(.callout).foregroundStyle(.secondary)
            Spacer()
            Text(gate.at.prefix(10)).font(.caption).foregroundStyle(.tertiary)
          }
        }
      }
    }
  }

  private func appsSection(_ snapshot: AtlasSnapshot) -> some View {
    section("Apps") {
      ForEach(Integration.allCases) { item in
        HStack(spacing: 10) {
          Image(systemName: item.icon).frame(width: 22)
          VStack(alignment: .leading, spacing: 1) {
            Text(item.title).font(.callout.weight(.medium))
            Text(item.purpose).font(.caption).foregroundStyle(.secondary)
          }
          Spacer()
          if let url = resolvedIntegrationURL(
            template: model.integrationTemplates[item.rawValue] ?? "",
            projectId: snapshot.record.projectId
          ) {
            Link("Open ↗", destination: url).font(.callout)
          } else {
            Text("Set the link in Settings").font(.caption).foregroundStyle(.secondary)
          }
        }
      }
    }
  }

  // MARK: the gate, always in reach

  private func gateBar(_ snapshot: AtlasSnapshot) -> some View {
    let allowed = snapshot.canGate[snapshot.stage.current] == true
    return VStack(spacing: 8) {
      HStack(spacing: 10) {
        Text("Stage gate").font(.caption.bold()).foregroundStyle(.secondary)
        if let next = snapshot.stage.next {
          Text("\(stageTitle(snapshot.stage.current)) → \(stageTitle(next))")
            .font(.caption)
            .foregroundStyle(.secondary)
        }
        Spacer()
        if !allowed {
          Text("Your role cannot pass this stage.")
            .font(.caption)
            .foregroundStyle(.secondary)
        }
      }
      HStack(spacing: 10) {
        TextField("Reason", text: $gateReason).textFieldStyle(.roundedBorder)
        Button("Reject") {
          let reason = gateReason
          Task { await model.decideGate("reject", reason: reason) }
        }
        .disabled(model.busy || !allowed)
        Button("Pass this stage") {
          let reason = gateReason
          Task { await model.decideGate("pass", reason: reason) }
        }
        .keyboardShortcut(.defaultAction)
        .disabled(model.busy || !allowed)
      }
    }
    .padding(.horizontal, 24)
    .padding(.vertical, 12)
    .background(.bar)
  }

  // MARK: shared bits

  private func field(_ title: String, text: Binding<String>) -> some View {
    HStack {
      Text(title).font(.caption).foregroundStyle(.secondary).frame(width: 150, alignment: .leading)
      TextField(title, text: text).textFieldStyle(.roundedBorder)
    }
  }

  private func section<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
    VStack(alignment: .leading, spacing: 8) {
      Text(title.uppercased()).font(.caption.bold()).foregroundStyle(.secondary)
      content()
      Divider()
    }
  }

  private func kindTitle(_ kind: String) -> String {
    switch kind {
    case "process": return "Process"
    case "workflow": return "Workflow"
    default: return "Project"
    }
  }
}
