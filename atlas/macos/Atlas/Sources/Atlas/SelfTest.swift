import AtlasDomain
import Foundation

/// A headless pass over the app's own client, against a live Atlas:
/// workspaces → create a process → save the intake → record the reuse check →
/// pass the intake gate. It exercises exactly the calls the buttons make, so a
/// broken client is caught without clicking through the UI.
///
/// Runs only when `ATLAS_SELFTEST=1`; a normal launch never reaches it.
enum SelfTest {
  private static func step(_ message: String) {
    FileHandle.standardError.write(Data("selftest step: \(message)\n".utf8))
  }

  static func runIfRequested() async -> Bool? {
    guard ProcessInfo.processInfo.environment["ATLAS_SELFTEST"] == "1" else { return nil }
    guard let client = AtlasConnection.load().client() else {
      FileHandle.standardError.write(Data("selftest: no connection\n".utf8))
      return false
    }
    do {
      let workspaces = try await client.workspaces()
      step("workspaces: \(workspaces.map(\.name).joined(separator: ", "))")
      guard let workspace = workspaces.first(where: { $0.canCreate }) else {
        FileHandle.standardError.write(Data("selftest: no workspace to create in\n".utf8))
        return false
      }
      let name = "Self test \(Int(Date().timeIntervalSince1970))"
      let id = try await client.onboardNew(
        name: name, process: true, workspaceId: workspace.id, ownerEmail: nil
      )
      step("created \(id)")
      var snapshot = try await client.brain(id)
      step("read: stage \(snapshot.record.stage), revision \(snapshot.record.revision)")
      var draft = snapshot.data?.draft ?? IntakeDraft()
      draft.problem = "Self test problem"
      draft.requester = "Self test"
      draft.functionArea = "Quality"
      draft.site = "Bensheim"
      draft.classification = "internal"
      draft.classificationDeclared = true
      snapshot = try await client.saveIntake(snapshot, draft: draft)
      step("saved: revision \(snapshot.record.revision)")
      snapshot = try await client.recordReuse(snapshot, decision: "new", reason: "self test")
      step("reuse recorded")
      struct Decision: Encodable {
        let stage: String
        let decision: String
        let reason: String
        let revision: Int
      }
      snapshot = try await client.decideGate(
        snapshot,
        Decision(
          stage: snapshot.stage.current, decision: "pass",
          reason: "self test", revision: snapshot.record.revision
        )
      )
      let line = "selftest: project=\(id) stage=\(snapshot.record.stage) "
        + "chain=\(snapshot.chain.length ?? -1) workspace=\(workspace.name)\n"
      FileHandle.standardOutput.write(Data(line.utf8))
      return snapshot.record.stage == "reuse" && snapshot.chain.ok
    } catch {
      FileHandle.standardError.write(Data("selftest: \(error)\n".utf8))
      return false
    }
  }
}
