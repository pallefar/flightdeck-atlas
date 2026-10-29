import AtlasDomain
import SwiftUI

/// Gives the first window a real size. Relying on SwiftUI's default sizing
/// opened the app collapsed to about 90×105, which is not a usable window; the
/// delegate sets the content size once, after launch.
final class AtlasWindowDelegate: NSObject, NSApplicationDelegate {
  func applicationDidFinishLaunching(_ notification: Notification) {
    DispatchQueue.main.async {
      guard let window = NSApp.windows.first else { return }
      window.setContentSize(NSSize(width: 1100, height: 760))
      window.center()
      window.makeKeyAndOrderFront(nil)
    }
  }
}

@main
struct AtlasApp: App {
  @NSApplicationDelegateAdaptor(AtlasWindowDelegate.self) private var windowDelegate
  @StateObject private var model = BrainModel()
  var body: some Scene {
    // A usable window on first launch: without a default size macOS fits the
    // window to its smallest content, which made the app open collapsed.
    WindowGroup {
      RootView()
        .environmentObject(model)
        .frame(minWidth: 900, minHeight: 600)
        .task { await model.refresh() }
    }
    .defaultSize(width: 1100, height: 760)
  }
}

/// Everything the app knows. One place, so the views stay free of policy: the
/// model only calls the API and stores what came back.
@MainActor
final class BrainModel: ObservableObject {
  @Published var connection = AtlasConnection.load()
  @Published var rows: [AtlasSnapshot.Row] = []
  @Published var workspaces: [AtlasWorkspace] = []
  @Published var workspaceId = ""
  @Published var ownerEmail = ""
  @Published var selected: AtlasSnapshot?
  @Published var error: String?
  @Published var notice: String?
  @Published var busy = false
  /// True only after a fetch actually succeeded: a configured address is not
  /// a connection, and the window must not claim one.
  @Published var verified = false

  var client: AtlasClient? { connection.client() }
  var connected: Bool { verified }

  func refresh() async {
    guard let client else { return }
    busy = true
    defer { busy = false }
    do {
      rows = try await client.list()
      workspaces = try await client.workspaces()
      if workspaceId.isEmpty || !workspaces.contains(where: { $0.id == workspaceId }) {
        workspaceId = workspaces.first(where: { $0.canCreate })?.id ?? workspaces.first?.id ?? ""
      }
      verified = true
      error = nil
      connection.lastChecked = ISO8601DateFormatter().string(from: Date())
      connection.save()
    } catch let failure as AtlasError {
      verified = false
      error = failure.message
    } catch {
      verified = false
      // Written to stderr so a failed fetch is diagnosable without a debugger.
      FileHandle.standardError.write(Data("atlas: list failed: \(error)\n".utf8))
      self.error = "Atlas could not be reached."
    }
  }

  func open(_ id: String) async {
    guard let client else { return }
    busy = true
    defer { busy = false }
    do {
      selected = try await client.brain(id)
      error = nil
    } catch let failure as AtlasError {
      error = failure.message
    } catch {
      self.error = "That project's brain could not be loaded."
    }
  }

  func onboardNew(name: String, process: Bool) async {
    guard let client else { return }
    busy = true
    defer { busy = false }
    do {
      let id = try await client.onboardNew(
        name: name,
        process: process,
        workspaceId: workspaceId,
        ownerEmail: ownerEmail.trimmingCharacters(in: .whitespaces).isEmpty ? nil : ownerEmail
      )
      await refresh()
      selected = try await client.brain(id)
      notice = "Project created and its intake is open."
      error = nil
    } catch let failure as AtlasError {
      error = failure.message
    } catch {
      self.error = "The project could not be created."
    }
  }

  func passGate(reason: String) async {
    guard let client, let current = selected else { return }
    busy = true
    defer { busy = false }
    do {
      selected = try await client.passGate(current, reason: reason)
      await refresh()
      notice = "Stage recorded."
      error = nil
    } catch let failure as AtlasError {
      error = failure.message
    } catch {
      self.error = "The gate could not be recorded."
    }
  }

  func connect(url: String, token: String) {
    var next = connection
    next.baseURL = url
    next.hasToken = !token.isEmpty
    next.save()
    if token.isEmpty { Keychain.delete(.token) } else { Keychain.save(token, for: .token) }
    connection = next
  }
}

enum Tab: String, CaseIterable, Identifiable {
  case overview = "Overview"
  case pipeline = "Pipeline"
  case settings = "Settings"
  var id: String { rawValue }
  var icon: String {
    switch self {
    case .overview: return "square.grid.2x2"
    case .pipeline: return "rectangle.split.3x1"
    case .settings: return "gearshape"
    }
  }
}

struct RootView: View {
  @EnvironmentObject private var model: BrainModel
  @State private var tab: Tab = .overview
  var body: some View {
    NavigationSplitView {
      List(Tab.allCases, selection: $tab) { item in
        Label(item.rawValue, systemImage: item.icon).tag(item)
      }
      .navigationTitle("Atlas")
      .navigationSplitViewColumnWidth(min: 170, ideal: 190)
    } detail: {
      VStack(spacing: 0) {
        if let error = model.error {
          Banner(text: error, tone: .bad)
        } else if let notice = model.notice {
          Banner(text: notice, tone: .good)
        }
        switch tab {
        case .overview:
          OverviewView(open: { id in
            Task { await model.open(id) }
          })
        case .pipeline:
          PipelineView(open: { id in Task { await model.open(id) } })
        case .settings:
          SettingsView()
        }
      }
    }
    .sheet(item: $model.selected) { snapshot in
      ProjectBrainView(snapshot: snapshot)
        .environmentObject(model)
        .frame(minWidth: 620, minHeight: 560)
    }
  }
}

struct Banner: View {
  enum Tone { case good, bad }
  let text: String
  let tone: Tone
  var body: some View {
    Text(text)
      .font(.callout)
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding(.horizontal, 16)
      .padding(.vertical, 8)
      .background(tone == .bad ? Color.red.opacity(0.12) : Color.green.opacity(0.12))
      .foregroundStyle(tone == .bad ? Color.red : Color.green)
  }
}

/// The portfolio view: what is onboarded, where it stands, and the one form
/// that creates a project and opens its intake.
struct OverviewView: View {
  @EnvironmentObject private var model: BrainModel
  let open: (String) -> Void
  @State private var name = ""
  @State private var process = false

  private var counts: [(Stage, Int)] {
    Stage.allCases.map { stage in
      (stage, model.rows.filter { $0.stage == stage.rawValue }.count)
    }
  }

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 20) {
        header
        stats
        onboardForm
        recent
      }
      .padding(24)
      .frame(maxWidth: .infinity, alignment: .leading)
    }
    .navigationTitle("Overview")
  }

  private var header: some View {
    VStack(alignment: .leading, spacing: 4) {
      Text("Onboarding brain").font(.largeTitle.bold())
      Text("Every project and process from intake to measured value.")
        .foregroundStyle(.secondary)
      if model.connected {
        Text("Connected to \(model.connection.baseURL)")
          .font(.footnote)
          .foregroundStyle(.secondary)
      } else {
        Text("Not connected to \(model.connection.baseURL) yet. Set the address and a device token in Settings — this app does not invent data.")
          .font(.footnote)
          .foregroundStyle(.orange)
      }
    }
  }

  private var stats: some View {
    HStack(spacing: 12) {
      ForEach(counts.filter { $0.1 > 0 }, id: \.0) { stage, count in
        VStack(alignment: .leading, spacing: 2) {
          Text("\(count)").font(.title2.bold())
          Text(stage.title).font(.caption).foregroundStyle(.secondary)
        }
        .padding(12)
        .frame(minWidth: 110, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 10).fill(Color.secondary.opacity(0.08)))
      }
      if counts.allSatisfy({ $0.1 == 0 }) {
        Text("No project has started onboarding yet.")
          .foregroundStyle(.secondary)
      }
      Spacer()
    }
  }

  private var onboardForm: some View {
    VStack(alignment: .leading, spacing: 10) {
      Text("Onboard a new project or process").font(.headline)
      // Two rows with the label above each control: a single row squeezed the
      // kind picker's label into a vertical column at this window width.
      HStack(alignment: .bottom, spacing: 12) {
        labelled("Name") {
          TextField("Name", text: $name)
            .textFieldStyle(.roundedBorder)
            .frame(minWidth: 200)
        }
        labelled("Workspace") {
          Picker("Workspace", selection: $model.workspaceId) {
            ForEach(model.workspaces) { workspace in
              Text(workspace.name).tag(workspace.id)
            }
          }
          .labelsHidden()
          .frame(width: 190)
        }
        labelled("Owner (email)") {
          TextField("owner@te.com", text: $model.ownerEmail)
            .textFieldStyle(.roundedBorder)
            .frame(minWidth: 190)
        }
      }
      HStack(alignment: .bottom, spacing: 12) {
        labelled("What are you onboarding?") {
          Picker("What are you onboarding?", selection: $process) {
            Text("A project").tag(false)
            Text("A process").tag(true)
          }
          .pickerStyle(.segmented)
          .labelsHidden()
          .frame(width: 240)
        }
        Button("Onboard it") {
          Task { await model.onboardNew(name: name, process: process) }
        }
        .disabled(!model.connected || model.busy || name.trimmingCharacters(in: .whitespaces).isEmpty || model.workspaceId.isEmpty)
        .keyboardShortcut(.defaultAction)
        if model.connected && model.workspaces.isEmpty {
          Text("No workspace is available to you; ask the Super Admin for one.")
            .font(.caption)
            .foregroundStyle(.orange)
        }
      }
    }
    .padding(14)
    .background(RoundedRectangle(cornerRadius: 12).fill(Color.secondary.opacity(0.06)))
  }

  @ViewBuilder
  private func labelled<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
    VStack(alignment: .leading, spacing: 3) {
      Text(title).font(.caption).foregroundStyle(.secondary)
      content()
    }
  }

  private var recent: some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack {
        Text("Recently updated").font(.headline)
        Spacer()
        Button("Refresh") { Task { await model.refresh() } }
          .disabled(!model.connected || model.busy)
      }
      if model.rows.isEmpty {
        Text(model.connected ? "Nothing onboarded yet." : "Connect to Atlas to see its projects.")
          .foregroundStyle(.secondary)
      } else {
        ForEach(model.rows.prefix(8)) { row in
          Button {
            open(row.projectId)
          } label: {
            HStack {
              Text(row.name)
              Spacer()
              Text(stageTitle(row.stage)).font(.caption).foregroundStyle(.secondary)
              Text("rev \(row.revision)").font(.caption2).foregroundStyle(.tertiary)
            }
            .contentShape(Rectangle())
          }
          .buttonStyle(.plain)
          .padding(.vertical, 6)
          Divider()
        }
      }
    }
  }
}

func stageTitle(_ raw: String) -> String {
  Stage(rawValue: raw)?.title ?? raw
}

struct PipelineView: View {
  @EnvironmentObject private var model: BrainModel
  let open: (String) -> Void
  var body: some View {
    ScrollView(.horizontal) {
      HStack(alignment: .top, spacing: 12) {
        ForEach(Stage.allCases, id: \.self) { stage in
          let cards = model.rows.filter { $0.stage == stage.rawValue }
          VStack(alignment: .leading, spacing: 8) {
            HStack {
              Text(stage.title.uppercased()).font(.caption.bold()).foregroundStyle(.secondary)
              Spacer()
              Text("\(cards.count)").font(.caption).foregroundStyle(.secondary)
            }
            ForEach(cards) { card in
              Button { open(card.projectId) } label: {
                VStack(alignment: .leading, spacing: 2) {
                  Text(card.name).font(.callout.weight(.semibold))
                  Text("rev \(card.revision)").font(.caption2).foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(8)
                .background(RoundedRectangle(cornerRadius: 8).fill(Color.secondary.opacity(0.08)))
              }
              .buttonStyle(.plain)
            }
            if cards.isEmpty {
              Text("—").font(.caption).foregroundStyle(.tertiary).padding(.vertical, 6)
            }
            Spacer()
          }
          .frame(width: 190, alignment: .topLeading)
          .padding(10)
          .background(RoundedRectangle(cornerRadius: 12).fill(Color.secondary.opacity(0.04)))
        }
      }
      .padding(20)
    }
    .navigationTitle("Pipeline")
  }
}

struct ProjectBrainView: View {
  let snapshot: AtlasSnapshot
  @EnvironmentObject private var model: BrainModel
  @State private var reason = ""
  @State private var openId: String?

  private var gateAllowed: Bool { snapshot.canGate[snapshot.stage.current] ?? false }

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 16) {
        VStack(alignment: .leading, spacing: 2) {
          Text(snapshot.record.name).font(.title2.bold())
          Text("\(snapshot.workspace.map { "\($0.name) · " } ?? "")\(snapshot.entryIsProcess ? "Process" : "Project") · \(stageTitle(snapshot.stage.current)) · rev \(snapshot.record.revision)")
            .foregroundStyle(.secondary)
        }
        section("Roles") {
          let assignments = snapshot.assignments
          let rows: [(String, String?)] = [
            ("Owner", assignments?.owner),
            ("Process owner", assignments?.processOwner),
            ("TEOA approver", assignments?.teoaApprover),
            ("Vision approver", assignments?.visionApprover),
          ]
          ForEach(rows.filter { $0.1 != nil }, id: \.0) { role, email in
            Text("\(role): \(email ?? "")").font(.callout)
          }
          if rows.allSatisfy({ $0.1 == nil }) {
            Text("No roles assigned yet.").foregroundStyle(.secondary)
          }
        }
        Text(snapshot.chain.ok
             ? "Audit chain verified (\(snapshot.chain.length ?? 0) events)"
             : "Audit chain broken at event \(snapshot.chain.brokenAt ?? 0)")
          .font(.caption)
          .padding(6)
          .background(RoundedRectangle(cornerRadius: 6).fill(snapshot.chain.ok ? Color.green.opacity(0.12) : Color.red.opacity(0.12)))

        section("Still needed for this stage") {
          if snapshot.stage.missing.isEmpty {
            Text("This stage's requirements are met.").foregroundStyle(.secondary)
          } else {
            ForEach(snapshot.stage.missing, id: \.self) { requirement in
              Label(requirementText(requirement), systemImage: "circle.dashed")
            }
          }
        }

        section("Stage gate") {
          TextField("Reason", text: $reason).textFieldStyle(.roundedBorder)
          HStack {
            Button("Pass this stage") { Task { await model.passGate(reason: reason) } }
              .disabled(!gateAllowed || model.busy)
            if !gateAllowed {
              Text("Your role cannot pass this stage.").font(.caption).foregroundStyle(.secondary)
            }
            if let next = snapshot.stage.next {
              Text("Next: \(stageTitle(next))").font(.caption).foregroundStyle(.secondary)
            }
          }
        }

        section("Evidence") {
          if snapshot.evidence.isEmpty {
            Text("No evidence attached yet.").foregroundStyle(.secondary)
          } else {
            ForEach(snapshot.evidence) { item in
              Text("\(item.source) · \(item.kind) · \(item.status)")
                .font(.callout)
            }
          }
        }

        section("Value") {
          if snapshot.values.isEmpty {
            Text("No value recorded yet.").foregroundStyle(.secondary)
          } else {
            ForEach(snapshot.values) { item in
              Text("\(item.basis) · \(item.period)\(item.sourceRef.map { " · \($0)" } ?? "")")
                .font(.callout)
            }
          }
        }

        section("Audit timeline") {
          if snapshot.gates.isEmpty {
            Text("No events yet.").foregroundStyle(.secondary)
          } else {
            ForEach(Array(snapshot.gates.enumerated()), id: \.offset) { _, gate in
              Text("\(stageTitle(gate.stage)) · \(gate.decision) · \(gate.at.prefix(10))")
                .font(.callout)
            }
          }
        }
      }
      .padding(24)
      .frame(maxWidth: .infinity, alignment: .leading)
    }
    .navigationTitle(snapshot.record.name)
  }

  private func section<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
    VStack(alignment: .leading, spacing: 6) {
      Text(title.uppercased()).font(.caption.bold()).foregroundStyle(.secondary)
      content()
      Divider()
    }
  }
}

struct SettingsView: View {
  @EnvironmentObject private var model: BrainModel
  @State private var url = AtlasConnection.load().baseURL
  @State private var token = ""

  var body: some View {
    Form {
      Section("Atlas") {
        TextField("Base URL", text: $url)
          .textFieldStyle(.roundedBorder)
        SecureField("Access token (optional)", text: $token)
          .textFieldStyle(.roundedBorder)
        Text("The token is kept in the Keychain, never in the app's preferences.")
          .font(.caption)
          .foregroundStyle(.secondary)
        HStack {
          Button("Save and test") {
            model.connect(url: url, token: token)
            Task { await model.refresh() }
          }
          Button("Refresh") { Task { await model.refresh() } }
            .disabled(!model.connected || model.busy)
        }
      }
      Section("State") {
        Text(model.connected ? "Connected to \(model.connection.baseURL)" : "Not connected")
        Text(model.error ?? "No error reported.")
          .foregroundStyle(model.error == nil ? Color.secondary : Color.red)
      }
    }
    .formStyle(.grouped)
    .padding(24)
    .navigationTitle("Settings")
  }
}

func requirementText(_ code: String) -> String {
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
  case "os-project": return "Link an OS project"
  case "teoa-scope": return "Link a TEOA scope"
  case "vision-objective": return "Link a Vision objective"
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
