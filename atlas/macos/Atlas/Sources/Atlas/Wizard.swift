import AtlasDomain
import SwiftUI

/// The front door: choose what you are onboarding from two large illustrated
/// cards, then name it and say where it belongs. Four steps, one decision each,
/// and a review before anything is created.
struct WizardFlow: View {
  @EnvironmentObject private var model: BrainModel
  @Environment(\.dismiss) private var dismiss
  @State private var step = 0
  @State private var kind = "project"
  @State private var quick = false
  @State private var name = ""
  @State private var problem = ""

  private let stepTitles = ["What", "Where", "Details", "Review"]

  var body: some View {
    VStack(spacing: 0) {
      header
      Divider().opacity(0.4)
      ScrollView {
        Group {
          switch step {
          case 0: kindStep
          case 1: whereStep
          case 2: detailsStep
          default: reviewStep
          }
        }
        .padding(.horizontal, 36)
        .padding(.vertical, 28)
        .frame(maxWidth: .infinity, alignment: .leading)
      }
      Divider().opacity(0.4)
      footer
    }
    .frame(minWidth: 860, minHeight: 640)
    .background(WizardBackground())
  }

  private var header: some View {
    HStack(spacing: 14) {
      VStack(alignment: .leading, spacing: 3) {
        Text("Onboard something new").font(.title2.bold())
        Text("Atlas keeps the brain: why, who, what it is worth, and where it stands.")
          .font(.callout)
          .foregroundStyle(.secondary)
      }
      Spacer()
      HStack(spacing: 6) {
        ForEach(0..<stepTitles.count, id: \.self) { index in
          Capsule()
            .fill(index <= step ? Color.accentColor : Color.secondary.opacity(0.25))
            .frame(width: index == step ? 26 : 10, height: 8)
            .animation(.snappy, value: step)
            .accessibilityLabel(stepTitles[index])
        }
      }
      Button {
        dismiss()
      } label: {
        Image(systemName: "xmark.circle.fill")
          .font(.title3)
          .foregroundStyle(.secondary)
      }
      .buttonStyle(.plain)
      .accessibilityLabel("Close")
    }
    .padding(.horizontal, 24)
    .padding(.vertical, 18)
  }

  // MARK: step 1 — the choice

  private var kindStep: some View {
    VStack(alignment: .leading, spacing: 20) {
      Text("What are you onboarding?")
        .font(.title3.weight(.semibold))
      HStack(spacing: 16) {
        KindCard(
          title: "A project",
          summary: "A piece of work with an outcome, a sponsor and a value case.",
          selected: kind == "project",
          illustration: { ProjectIllustration() }
        ) { kind = "project" }
        KindCard(
          title: "A process",
          summary: "How work runs today, captured before anyone automates it.",
          selected: kind == "process",
          illustration: { ProcessIllustration() }
        ) { kind = "process" }
        KindCard(
          title: "A workflow",
          summary: "One repeatable step, automated — a skill or a sub-app.",
          selected: kind == "workflow",
          illustration: { WorkflowIllustration() }
        ) { kind = "workflow" }
      }
      Toggle("Fast start (quick lane)", isOn: $quick)
        .toggleStyle(.checkbox)
      Text(
        quick
          ? "Starts at capture. The map, alignment and value sign-offs are recorded as deferred, with an owner and a date, in the audit chain."
          : "All three use the same pipeline: reuse check, capture, as-is, alignment, value, build, live."
      )
      .font(.caption)
      .foregroundStyle(.secondary)
        .font(.caption)
        .foregroundStyle(.secondary)
    }
  }

  // MARK: step 2 — where

  private var whereStep: some View {
    VStack(alignment: .leading, spacing: 18) {
      Text("Where does it belong?").font(.title3.weight(.semibold))
      if model.workspaces.isEmpty {
        Label(
          "No workspace is available to you. A workspace admin creates projects; ask the Super Admin for one.",
          systemImage: "exclamationmark.triangle"
        )
        .foregroundStyle(.orange)
      } else {
        Picker("Workspace", selection: $model.workspaceId) {
          ForEach(model.workspaces) { workspace in
            Text("\(workspace.name) · \(workspace.role ?? "member")").tag(workspace.id)
          }
        }
        .pickerStyle(.radioGroup)
        .frame(maxWidth: 460, alignment: .leading)
      }
      VStack(alignment: .leading, spacing: 4) {
        Text("Owner").font(.caption).foregroundStyle(.secondary)
        TextField("owner@te.com", text: $model.ownerEmail)
          .textFieldStyle(.roundedBorder)
          .frame(maxWidth: 360)
        Text("The person who works on it. They can edit it and pass the intake gates; you can change it later.")
          .font(.caption)
          .foregroundStyle(.secondary)
      }
    }
  }

  // MARK: step 3 — details

  private var detailsStep: some View {
    VStack(alignment: .leading, spacing: 18) {
      Text("Name it, and say what is wrong today.").font(.title3.weight(.semibold))
      VStack(alignment: .leading, spacing: 4) {
        Text("Name").font(.caption).foregroundStyle(.secondary)
        TextField(
          kind == "process" ? "Billing dispute process"
            : kind == "workflow" ? "Exception handling skill"
            : "Contract intake",
          text: $name
        )
          .textFieldStyle(.roundedBorder)
          .frame(maxWidth: 460)
      }
      VStack(alignment: .leading, spacing: 4) {
        Text("Problem").font(.caption).foregroundStyle(.secondary)
        TextEditor(text: $problem)
          .frame(height: 90)
          .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.secondary.opacity(0.3)))
        Text("You can add the rest — requester, function, site, classification — in the project's brain after it is created.")
          .font(.caption)
          .foregroundStyle(.secondary)
      }
    }
  }

  // MARK: step 4 — review

  private var reviewStep: some View {
    VStack(alignment: .leading, spacing: 14) {
      Text("Check and create").font(.title3.weight(.semibold))
      VStack(alignment: .leading, spacing: 8) {
        row("Kind", kindTitle)
        row("Workspace", model.workspaces.first { $0.id == model.workspaceId }?.name ?? "—")
        row("Owner", model.ownerEmail.isEmpty ? "you" : model.ownerEmail)
        row("Name", name.isEmpty ? "—" : name)
        if !problem.isEmpty { row("Problem", problem) }
      }
      .padding(16)
      .frame(maxWidth: 560, alignment: .leading)
      .background(RoundedRectangle(cornerRadius: 12).fill(Color.secondary.opacity(0.08)))
      Text("Creating it opens its intake: the first stage of the pipeline, with an owner already assigned.")
        .font(.caption)
        .foregroundStyle(.secondary)
    }
  }

  private func row(_ title: String, _ value: String) -> some View {
    HStack(alignment: .top) {
      Text(title).font(.caption).foregroundStyle(.secondary).frame(width: 90, alignment: .leading)
      Text(value).font(.callout)
    }
  }

  private var footer: some View {
    HStack(spacing: 10) {
      if step > 0 {
        Button("Back") { step -= 1 }
      }
      Spacer()
      Button(step == 3 ? "Create the \(kindTitle.lowercased())" : "Continue") {
        Task { await advance() }
      }
      .keyboardShortcut(.defaultAction)
      .disabled(!canContinue || model.busy)
    }
    .padding(.horizontal, 24)
    .padding(.vertical, 16)
  }

  private var kindTitle: String {
    switch kind {
    case "process": return "A process"
    case "workflow": return "A workflow"
    default: return "A project"
    }
  }

  private var canContinue: Bool {
    switch step {
    case 0: return true
    case 1: return !model.workspaceId.isEmpty
    case 2: return !name.trimmingCharacters(in: .whitespaces).isEmpty
    default: return true
    }
  }

  private func advance() async {
    if step < 3 {
      step += 1
      return
    }
    await model.onboardNew(
      name: name, kind: kind, problem: problem, lane: quick ? "quick" : "governed"
    )
    dismiss()
  }
}

/// One large, illustrated choice. The whole card is the button; it lifts on
/// hover and shows a ring when selected.
struct KindCard<Illustration: View>: View {
  let title: String
  let summary: String
  let selected: Bool
  @ViewBuilder let illustration: () -> Illustration
  let choose: () -> Void
  @State private var hover = false

  var body: some View {
    Button(action: choose) {
      VStack(alignment: .leading, spacing: 12) {
        illustration()
          .frame(height: 132)
          .frame(maxWidth: .infinity)
          .background(
            RoundedRectangle(cornerRadius: 14)
              .fill(Color.accentColor.opacity(selected ? 0.18 : 0.10))
          )
          .overlay(
            RoundedRectangle(cornerRadius: 14)
              .stroke(Color.accentColor.opacity(selected ? 0.55 : 0.2), lineWidth: 1)
          )
        Text(title).font(.headline)
        Text(summary)
          .font(.callout)
          .foregroundStyle(.secondary)
          .fixedSize(horizontal: false, vertical: true)
        Spacer(minLength: 0)
        HStack(spacing: 6) {
          Image(systemName: selected ? "checkmark.circle.fill" : "circle")
            .foregroundStyle(selected ? Color.accentColor : Color.secondary)
          Text(selected ? "Selected" : "Choose")
            .font(.caption)
            .foregroundStyle(selected ? Color.accentColor : Color.secondary)
        }
      }
      .padding(18)
      .frame(maxWidth: .infinity, minHeight: 280, alignment: .topLeading)
      .background(
        RoundedRectangle(cornerRadius: 18)
          .fill(Color.secondary.opacity(hover ? 0.14 : 0.08))
      )
      .overlay(
        RoundedRectangle(cornerRadius: 18)
          .stroke(
            selected ? Color.accentColor : Color.secondary.opacity(hover ? 0.45 : 0.2),
            lineWidth: selected ? 2 : 1
          )
      )
      .scaleEffect(hover ? 1.012 : 1)
      .animation(.snappy(duration: 0.18), value: hover)
      .contentShape(RoundedRectangle(cornerRadius: 18))
    }
    .buttonStyle(.plain)
    .onHover { hover = $0 }
    .accessibilityLabel(title)
    .accessibilityHint(summary)
    .accessibilityAddTraits(selected ? [.isSelected] : [])
  }
}

/// Three overlapping cards with a tick: a piece of work with an outcome.
struct ProjectIllustration: View {
  var body: some View {
    GeometryReader { geometry in
      let width = geometry.size.width
      let card = min(width * 0.42, 118)
      ZStack {
        RoundedRectangle(cornerRadius: 10)
          .fill(Color.accentColor.opacity(0.18))
          .frame(width: card, height: card * 0.62)
          .rotationEffect(.degrees(-8))
          .offset(x: -card * 0.28, y: 6)
        RoundedRectangle(cornerRadius: 10)
          .fill(Color.accentColor.opacity(0.30))
          .frame(width: card, height: card * 0.62)
          .rotationEffect(.degrees(-2))
          .offset(x: -card * 0.06, y: 2)
        VStack(alignment: .leading, spacing: 6) {
          RoundedRectangle(cornerRadius: 2).fill(Color.accentColor.opacity(0.45)).frame(width: card * 0.5, height: 5)
          RoundedRectangle(cornerRadius: 2).fill(Color.accentColor.opacity(0.25)).frame(width: card * 0.68, height: 5)
          RoundedRectangle(cornerRadius: 2).fill(Color.accentColor.opacity(0.25)).frame(width: card * 0.34, height: 5)
        }
        .padding(12)
        .frame(width: card, height: card * 0.62, alignment: .topLeading)
        .background(RoundedRectangle(cornerRadius: 10).fill(Color(nsColor: .controlBackgroundColor)))
        .rotationEffect(.degrees(3))
        .offset(x: card * 0.16, y: -4)
        Image(systemName: "checkmark.seal.fill")
          .font(.system(size: 26))
          .foregroundStyle(Color.accentColor)
          .offset(x: card * 0.42, y: card * 0.30)
      }
      .frame(width: geometry.size.width, height: geometry.size.height)
    }
    .accessibilityHidden(true)
  }
}

/// A step that runs itself: a trigger, a skill tile and an outcome, wired.
struct WorkflowIllustration: View {
  var body: some View {
    GeometryReader { geometry in
      let width = geometry.size.width
      let tile = min(width * 0.22, 56)
      HStack(spacing: 0) {
        RoundedRectangle(cornerRadius: 7)
          .fill(Color.accentColor.opacity(0.18))
          .frame(width: tile * 0.9, height: tile * 0.55)
        Image(systemName: "arrow.right")
          .font(.system(size: 10, weight: .bold))
          .foregroundStyle(Color.accentColor.opacity(0.6))
          .frame(maxWidth: .infinity)
        RoundedRectangle(cornerRadius: 10)
          .fill(Color.accentColor.opacity(0.75))
          .frame(width: tile, height: tile * 0.9)
          .overlay(
            VStack(spacing: 4) {
              Capsule().fill(.white.opacity(0.9)).frame(width: tile * 0.55, height: 4)
              Capsule().fill(.white.opacity(0.6)).frame(width: tile * 0.38, height: 4)
            }
          )
        Image(systemName: "arrow.right")
          .font(.system(size: 10, weight: .bold))
          .foregroundStyle(Color.accentColor.opacity(0.6))
          .frame(maxWidth: .infinity)
        Circle()
          .fill(Color.accentColor.opacity(0.2))
          .frame(width: tile * 0.45, height: tile * 0.45)
      }
      .frame(width: geometry.size.width, height: geometry.size.height)
    }
    .accessibilityHidden(true)
  }
}

/// Three steps joined by arrows, one of them in focus: how work runs today.
struct ProcessIllustration: View {
  var body: some View {
    GeometryReader { geometry in
      let width = geometry.size.width
      let node = min(width * 0.13, 34)
      HStack(spacing: 0) {
        nodeView(node: node, filled: false)
        connector(width: width)
        nodeView(node: node, filled: true)
        connector(width: width)
        nodeView(node: node, filled: false)
      }
      .frame(width: geometry.size.width, height: geometry.size.height)
    }
    .accessibilityHidden(true)
  }

  private func nodeView(node: CGFloat, filled: Bool) -> some View {
    ZStack {
      Circle()
        .fill(filled ? Color.accentColor.opacity(0.9) : Color.accentColor.opacity(0.18))
        .frame(width: node, height: node)
      if filled {
        Circle().stroke(Color.accentColor, lineWidth: 3).frame(width: node + 10, height: node + 10)
        Image(systemName: "checkmark")
          .font(.system(size: node * 0.4, weight: .bold))
          .foregroundStyle(.white)
      }
    }
    .frame(width: node + 12, height: node + 12)
  }

  private func connector(width: CGFloat) -> some View {
    HStack(spacing: 0) {
      Rectangle()
        .fill(Color.accentColor.opacity(0.35))
        .frame(height: 2)
      Image(systemName: "chevron.right")
        .font(.system(size: 9, weight: .bold))
        .foregroundStyle(Color.accentColor.opacity(0.55))
    }
    .frame(maxWidth: .infinity)
    .padding(.horizontal, 4)
  }
}

struct WizardBackground: View {
  var body: some View {
    LinearGradient(
      colors: [
        Color(nsColor: .windowBackgroundColor),
        Color.accentColor.opacity(0.06),
        Color(nsColor: .windowBackgroundColor),
      ],
      startPoint: .topLeading,
      endPoint: .bottomTrailing
    )
  }
}
