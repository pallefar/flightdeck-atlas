import AtlasDomain
import CryptoKit
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
        .task {
          if let passed = await SelfTest.runIfRequested() {
            exit(passed ? 0 : 1)
          }
          await model.refresh()
        }
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
  /// The onboarding wizard, as a sheet. Opened by the front-door button, and
  /// once on a first run, because the choice is the first thing to make.
  @Published var wizardOpen = false
  @Published var feedbackOpen = false
  @Published var feedbackNotes: [FeedbackNote] = []
  @Published var updateVerdict: UpdateVerdict?
  @Published var checkingUpdates = false
  /// The build's version, as the bundle reports it.
  let appVersion = (Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String) ?? "0.1.0"
  /// Stored URL templates for the three apps this client adds (see Integration).
  @Published var integrationTemplates: [String: String] = Integration.allCases.reduce(into: [:]) { result, item in
    result[item.rawValue] = UserDefaults.standard.string(forKey: item.defaultsKey) ?? ""
  }

  func setIntegration(_ item: Integration, template: String) {
    UserDefaults.standard.set(template, forKey: item.defaultsKey)
    integrationTemplates[item.rawValue] = template
  }

  func integrationURL(_ item: Integration) -> URL? {
    resolvedIntegrationURL(
      template: integrationTemplates[item.rawValue] ?? "",
      projectId: selected?.record.projectId
    )
  }
  /// True only after a fetch actually succeeded: a configured address is not
  /// a connection, and the window must not claim one.
  @Published var verified = false

  var client: AtlasClient? { connection.client() }
  var baseURL: URL? { connection.client()?.baseURL }
  var atlasOverviewURL: URL? { baseURL.flatMap { AtlasLink.overview(base: $0) } }
  func atlasProjectURL(_ id: String) -> URL? {
    baseURL.flatMap { AtlasLink.project(base: $0, id: id) }
  }
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
      if rows.isEmpty && !UserDefaults.standard.bool(forKey: "atlas.wizardSeen") {
        wizardOpen = true
      }
      // Development only: open one project's brain on launch, so the full
      // onboarding surface can be driven without a click.
      if let target = ProcessInfo.processInfo.environment["ATLAS_OPEN_PROJECT"],
         !target.isEmpty,
         model_targetUnopened(target) {
        await open(target)
      }
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

  func onboardNew(
    name: String, kind: String, problem: String = "", lane: String = "governed"
  ) async {
    guard let client else { return }
    busy = true
    defer { busy = false }
    do {
      let id = try await client.onboardNew(
        name: name,
        kind: kind,
        workspaceId: workspaceId,
        ownerEmail: ownerEmail.trimmingCharacters(in: .whitespaces).isEmpty ? nil : ownerEmail,
        problem: problem,
        lane: lane
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

  private func model_targetUnopened(_ id: String) -> Bool {
    selected == nil || selected?.record.projectId != id
  }

  private func apply(_ update: AtlasSnapshot, notice message: String) {
    selected = update
    notice = message
    error = nil
  }

  private func run(
    _ work: (AtlasClient, AtlasSnapshot) async throws -> AtlasSnapshot,
    notice message: String,
    failure: String
  ) async {
    guard let client, let current = selected else { return }
    busy = true
    defer { busy = false }
    do {
      apply(try await work(client, current), notice: message)
      rows = try await client.list()
    } catch let refusal as AtlasError {
      error = refusal.message
    } catch {
      self.error = failure
    }
  }

  func saveIntake(_ draft: IntakeDraft) async {
    await run(
      { client, snapshot in try await client.saveIntake(snapshot, draft: draft) },
      notice: "Intake saved.",
      failure: "The intake could not be saved."
    )
  }

  func recordReuse(decision: String, reason: String) async {
    await run(
      { client, snapshot in
        try await client.recordReuse(snapshot, decision: decision, reason: reason)
      },
      notice: "Reuse decision recorded.",
      failure: "The reuse decision could not be recorded."
    )
  }

  func addEvidence(url: URL, kind: String, classification: String) async {
    guard let data = try? Data(contentsOf: url) else {
      error = "That file could not be read."
      return
    }
    let digest = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    await run(
      { client, snapshot in
        try await client.addEvidence(
          snapshot,
          kind: kind,
          source: url.lastPathComponent,
          sha256: digest,
          bytes: data.count,
          classification: classification
        )
      },
      notice: "Evidence recorded. The file itself was not uploaded.",
      failure: "The evidence could not be recorded."
    )
  }

  @Published var signInCode: String?
  @Published var signingIn = false

  /// The browser sign-in: show the code, wait for approval, keep the token.
  func signInWithBrowser() async {
    let current = connection
    guard let base = URL(string: current.baseURL) else { return }
    signingIn = true
    defer { signingIn = false }
    do {
      let issued = try await AtlasClient(
        baseURL: base, token: "pending", session: .shared
      ).startDeviceCode()
      signInCode = issued.code
      if let url = URL(string: "\(current.baseURL)/device?code=\(issued.code)") {
        NSWorkspace.shared.open(url)
      }
      // Ten minutes is the code's life; poll a little less than that.
      for _ in 0..<290 {
        try await Task.sleep(nanoseconds: 2_000_000_000)
        let state = try await AtlasClient(
          baseURL: base, token: "pending", session: .shared
        ).deviceCodeState(issued.code)
        if state.state == "approved" {
          let token = try await AtlasClient(
            baseURL: base, token: "pending", session: .shared
          ).collectDeviceToken(issued.code)
          Keychain.save(token, for: .token)
          var next = current
          next.hasToken = true
          next.save()
          self.connection = next
          signInCode = nil
          notice = "Signed in."
          await refresh()
          return
        }
        if state.state == "expired" || state.state == "unknown" {
          error = "The sign-in code expired. Ask for a new one."
          signInCode = nil
          return
        }
      }
      error = "The sign-in was not approved in time."
      signInCode = nil
    } catch {
      self.error = "The browser sign-in could not start."
      signInCode = nil
    }
  }

  /// Create or replace a workflow draft from the app. It is the same body the
  /// attestation writes, only with no test report yet — because it has not run.
  func saveWorkflow(name: String, trigger: String, steps: [String]) async {
    guard let snapshot = selected else { return }
    let now = ISO8601DateFormatter().string(from: Date())
    let body = AtlasSnapshot.WorkflowAttestation(
      projectId: snapshot.record.projectId,
      name: name,
      trigger: trigger,
      inputs: [],
      steps: steps.map { .init(action: $0, actor: "workflow", system: nil, app: nil) },
      decisions: [],
      signOff: .init(
        role: "process_owner",
        email: snapshot.assignments?.processOwner ?? snapshot.assignments?.owner ?? ""
      ),
      complexity: steps.count > 3 ? "studio" : "simple",
      testReport: nil,
      createdAt: now
    )
    await run(
      { client, _ in try await client.putWorkflow(snapshot, body: body) },
      notice: "Workflow draft saved.",
      failure: "The draft could not be saved."
    )
  }

  /// A person ran the workflow once and confirms nothing was written. Their
  /// word is the test report; Atlas never invents one.
  func attestWorkflowTest() async {
    guard let snapshot = selected, let draft = snapshot.data?.workflow else { return }
    let now = ISO8601DateFormatter().string(from: Date())
    let body = AtlasSnapshot.WorkflowAttestation(
      projectId: snapshot.record.projectId,
      name: draft.name,
      trigger: draft.trigger,
      inputs: [],
      steps: draft.steps.map {
        .init(action: $0.action, actor: $0.actor, system: $0.system, app: $0.app)
      },
      decisions: [],
      signOff: .init(
        role: "process_owner",
        email: snapshot.assignments?.processOwner ?? snapshot.assignments?.owner ?? ""
      ),
      complexity: draft.complexity,
      testReport: .init(
        ranAt: now, cases: 1, wroteAnything: false,
        notes: "One real case, dry run, nothing written."
      ),
      createdAt: now
    )
    await run(
      { client, _ in try await client.putWorkflow(snapshot, body: body) },
      notice: "Test run recorded.",
      failure: "The test run could not be recorded."
    )
  }

  /// Reserve a map request. The body is the server's, so the app cannot ask
  /// for something the lane could not have asked for.
  func requestHandoff(kind: String, mapType: String = "as-is") async {
    await run(
      { client, snapshot in
        try await client.requestHandoff(snapshot, kind: kind, mapType: mapType)
      },
      notice: "Map request recorded.",
      failure: "The map request could not be recorded."
    )
  }

  func addValue(
    basis: String,
    period: String,
    hours: Double?,
    cost: Double?,
    targetHours: Double? = nil,
    sourceRef: String?
  ) async {
    await run(
      { client, snapshot in
        try await client.addValue(
          snapshot, basis: basis, period: period, hours: hours, cost: cost,
          targetHours: targetHours, sourceRef: sourceRef
        )
      },
      notice: "Value recorded.",
      failure: "The value could not be recorded."
    )
  }

  func assignRole(role: String, email: String) async {
    await run(
      { client, snapshot in
        try await client.assignRole(snapshot, role: role, email: email)
      },
      notice: "Role assigned.",
      failure: "The role could not be assigned."
    )
  }

  func decideGate(_ decision: String, reason: String) async {
    guard let client, let current = selected else { return }
    busy = true
    defer { busy = false }
    do {
      struct Decision: Encodable {
        let stage: String
        let decision: String
        let reason: String
        let revision: Int
      }
      let updated: AtlasSnapshot = try await client.decideGate(
        current,
        Decision(
          stage: current.stage.current,
          decision: decision,
          reason: reason,
          revision: current.record.revision
        )
      )
      apply(updated, notice: decision == "pass" ? "Stage recorded." : "Decision recorded.")
      rows = try await client.list()
    } catch let refusal as AtlasError {
      error = refusal.message
    } catch {
      self.error = "The gate decision could not be recorded."
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

  func addFeedbackNote(_ note: FeedbackNote) {
    feedbackNotes.append(note)
  }

  func sendFeedback(_ note: FeedbackNote) async {
    guard let client else {
      error = "Connect to Atlas before sending feedback."
      return
    }
    busy = true
    defer { busy = false }
    do {
      try await client.sendFeedback(note)
      feedbackNotes.append(note)
      notice = "Feedback sent."
      error = nil
    } catch let refusal as AtlasError {
      error = refusal.message
    } catch {
      self.error = "The feedback could not be sent."
    }
  }

  func checkUpdates() async {
    guard let client else {
      error = "Connect to Atlas before checking for updates."
      return
    }
    checkingUpdates = true
    defer { checkingUpdates = false }
    do {
      updateVerdict = try await client.checkForUpdates(currentVersion: appVersion)
      error = nil
    } catch let refusal as AtlasError {
      error = refusal.message
    } catch {
      self.error = "Could not check for updates: NETWORK."
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
          Banner(text: error, tone: .bad) { model.error = nil }
        } else if let notice = model.notice {
          Banner(text: notice, tone: .good) { model.notice = nil }
        }
        // A project, when one is open, takes the whole detail area: it is a
        // workspace, not a sheet over a list.
        if model.selected != nil {
          ProjectWorkspace()
        } else {
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
    }
    .sheet(isPresented: $model.feedbackOpen) {
      FeedbackSheet()
        .environmentObject(model)
    }
    .sheet(isPresented: $model.wizardOpen) {
      WizardFlow()
        .environmentObject(model)
        .onDisappear {
          UserDefaults.standard.set(true, forKey: "atlas.wizardSeen")
        }
    }

  }
}

/// A one-line message that can be dismissed: an old error must not sit at the
/// top of the window until the next action happens to clear it.
struct Banner: View {
  enum Tone { case good, bad }
  let text: String
  let tone: Tone
  let dismiss: () -> Void
  var body: some View {
    HStack(alignment: .firstTextBaseline) {
      Text(text).font(.callout).frame(maxWidth: .infinity, alignment: .leading)
      Button(action: dismiss) {
        Image(systemName: "xmark").font(.caption2)
      }
      .buttonStyle(.plain)
      .accessibilityLabel("Dismiss")
    }
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
        lateDebt
        frontDoor
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
      HStack(spacing: 12) {
        if let url = model.atlasOverviewURL {
          Link("Open Atlas ↗", destination: url).font(.callout)
        }
        Button("Feedback") { model.feedbackOpen = true }
          .font(.callout)
          .disabled(!model.connected)
      }
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

  /// The debt that is late, across the portfolio. The lane has had this banner
  /// since the queue landed; the app says it too, from the same numbers.
  private var lateDebt: some View {
    let late = model.rows.reduce(0) { $0 + ($1.deferredOverdue ?? 0) }
    let projects = model.rows.filter { ($0.deferredOverdue ?? 0) > 0 }
    return Group {
      if late > 0 {
        Label(
          "\(late) deferred sign-off(s) are past due on \(projects.map(\.name).joined(separator: ", "))",
          systemImage: "exclamationmark.triangle.fill"
        )
        .font(.callout.weight(.medium))
        .foregroundStyle(.red)
        .padding(.vertical, 6)
        .accessibilityLabel("\(late) deferred sign-offs are past due")
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

  /// The front door: the wizard, and the direct link into Atlas for the whole
  /// portfolio at a density a window cannot match.
  private var frontDoor: some View {
    HStack(spacing: 14) {
      Button {
        model.wizardOpen = true
      } label: {
        HStack(spacing: 12) {
          Image(systemName: "plus.circle.fill")
            .font(.title2)
            .foregroundStyle(Color.accentColor)
          VStack(alignment: .leading, spacing: 2) {
            Text("Onboard a new project, process or workflow").font(.headline)
            Text("Four steps: choose, say where, name it, review.")
              .font(.caption)
              .foregroundStyle(.secondary)
          }
          Spacer()
          Image(systemName: "arrow.right")
            .foregroundStyle(.secondary)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 14).fill(Color.accentColor.opacity(0.12)))
        .overlay(
          RoundedRectangle(cornerRadius: 14)
            .stroke(Color.accentColor.opacity(0.35), lineWidth: 1)
        )
        .contentShape(RoundedRectangle(cornerRadius: 14))
      }
      .buttonStyle(.plain)
      .disabled(!model.connected)
      .keyboardShortcut("n", modifiers: .command)

      if let url = model.atlasOverviewURL {
        Link(destination: url) {
          VStack(spacing: 4) {
            Image(systemName: "arrow.up.right.square").font(.title3)
            Text("Open Atlas").font(.caption)
          }
          .frame(width: 96, height: 66)
          .background(RoundedRectangle(cornerRadius: 12).fill(Color.secondary.opacity(0.10)))
          .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color.secondary.opacity(0.25)))
        }
        .buttonStyle(.plain)
        .help("Open the full Atlas portfolio in your browser")
        .accessibilityLabel("Open Atlas in the browser")
      }
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
              if let readiness = row.readiness {
                Text("\(readiness)%").font(.caption.weight(.semibold))
                  .foregroundStyle(Color.accentColor)
                  .accessibilityLabel("Readiness \(readiness) percent")
              }
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
                  HStack(spacing: 6) {
                    Text("rev \(card.revision)").font(.caption2).foregroundStyle(.secondary)
                    if card.lane == "quick", let deferred = card.deferred, deferred > 0 {
                      Text("quick · \(deferred) deferred").font(.caption2)
                        .foregroundStyle(.orange)
                    }
                    if let readiness = card.readiness {
                      Text("\(readiness)%").font(.caption2.weight(.semibold))
                        .foregroundStyle(Color.accentColor)
                        .accessibilityLabel(
                          "Readiness \(readiness) percent, \(card.met ?? 0) of \(card.total ?? 0) facts"
                        )
                    }
                  }
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

struct SettingsView: View {
  @EnvironmentObject private var model: BrainModel
  @State private var url = AtlasConnection.load().baseURL
  @State private var token = ""

  var body: some View {
    Form {
      Section("Atlas") {
        TextField("Base URL", text: $url)
          .textFieldStyle(.roundedBorder)
        HStack {
          Button("Sign in with the browser") {
            Task { await model.signInWithBrowser() }
          }
          .disabled(model.signingIn)
          if model.signingIn {
            ProgressView().controlSize(.small)
            if let code = model.signInCode {
              Text(code).font(.system(.callout, design: .monospaced)).textSelection(.enabled)
            }
          }
        }
        Text("Shows a code, opens Atlas in your browser, and keeps the token it hands back. No token needs typing.")
          .font(.caption)
          .foregroundStyle(.secondary)
        SecureField("Access token (optional)", text: $token)
          .textFieldStyle(.roundedBorder)
        Text("A token is kept in the Keychain, never in the app's preferences.")
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
      Section("Apps") {
        Text("This client adds three apps to the onboarding. Each link is yours to set; {project} is replaced with the project id.")
          .font(.caption)
          .foregroundStyle(.secondary)
        ForEach(Integration.allCases) { item in
          VStack(alignment: .leading, spacing: 3) {
            Text(item.title).font(.callout)
            TextField(
              "https://… (optional {project})",
              text: Binding(
                get: { model.integrationTemplates[item.rawValue] ?? "" },
                set: { model.setIntegration(item, template: $0) }
              )
            )
            .textFieldStyle(.roundedBorder)
          }
        }
      }
      Section("Updates") {
        Text("Atlas \(model.appVersion)").font(.callout)
        HStack {
          Button(model.checkingUpdates ? "Checking…" : "Check for updates") {
            Task { await model.checkUpdates() }
          }
          .disabled(!model.connected || model.checkingUpdates)
          if let verdict = model.updateVerdict {
            Text(verdict.headline).font(.callout)
          }
        }
        if let verdict = model.updateVerdict, verdict.hasUpdate, let latest = verdict.latest {
          Text(latest.notes).font(.caption).foregroundStyle(.secondary)
          if let url = verdict.downloadURL {
            Link("Download \(latest.version)", destination: url)
          } else {
            Text("No download is published for this release yet.").font(.caption).foregroundStyle(.secondary)
          }
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
