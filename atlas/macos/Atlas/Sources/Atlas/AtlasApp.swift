import AtlasDomain
import SwiftUI

/// The native client's first screen.
///
/// Honest about its state: this build ships the contract models, the stage
/// vocabulary and the signed app shell. Live sync, screen capture and
/// on-device transcription are NOT built, and the window says so rather than
/// showing an empty list that looks connected.
@main
struct AtlasApp: App {
  var body: some Scene {
    WindowGroup {
      BrainWindow()
        .frame(minWidth: 720, minHeight: 520)
    }
  }
}

struct BrainWindow: View {
  @State private var selected: Stage = .intake

  var body: some View {
    NavigationSplitView {
      List(Stage.allCases, id: \.self, selection: $selected) { stage in
        Text(stage.title).tag(stage)
      }
      .navigationTitle("Stages")
    } detail: {
      VStack(alignment: .leading, spacing: 16) {
        Text(selected.title).font(.largeTitle)
        Text(
          selected.next.map { "Next: \($0.title)" }
            ?? "No further stage."
        )
        .foregroundStyle(.secondary)
        Divider()
        Text("Contract models: \(AtlasEvidence.self), \(AtlasGateEvent.self), \(AtlasValue.self), \(AtlasOnboardingRecord.self)")
          .font(.callout)
          .foregroundStyle(.secondary)
        Text(
          "Not built in this version: project sync, screen capture, on-device transcription. Atlas does not report a connection it does not have."
        )
        .font(.footnote)
        .foregroundStyle(.secondary)
        Spacer()
      }
      .padding(28)
    }
  }
}
