import AtlasDomain
import SwiftUI

/// Feedback, in the shape the Maps admin overlay established: write notes
/// while you work, then copy them as ONE prompt. Sending them to Atlas is a
/// second, explicit choice — a note is never transmitted by accident.
struct FeedbackSheet: View {
  @EnvironmentObject private var model: BrainModel
  @Environment(\.dismiss) private var dismiss
  @State private var rating = "ok"
  @State private var category = ""
  @State private var comment = ""
  @State private var copied = false

  private var note: FeedbackNote {
    FeedbackNote(
      screen: model.selected == nil ? "Overview" : "Project brain",
      projectId: model.selected?.record.projectId,
      stage: model.selected?.stage.current,
      rating: rating,
      category: category.trimmingCharacters(in: .whitespaces).isEmpty ? nil : category,
      comment: comment,
      appVersion: model.appVersion
    )
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 16) {
      HStack {
        VStack(alignment: .leading, spacing: 2) {
          Text("Feedback").font(.title2.bold())
          Text("What you were looking at is recorded; the app's content and your data are not.")
            .font(.caption)
            .foregroundStyle(.secondary)
        }
        Spacer()
        Button { dismiss() } label: {
          Image(systemName: "xmark.circle.fill").font(.title3).foregroundStyle(.secondary)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Close")
      }

      VStack(alignment: .leading, spacing: 4) {
        Text("Context").font(.caption).foregroundStyle(.secondary)
        Text("\(note.screen)\(note.projectId.map { " · project \($0)" } ?? "")\(note.stage.map { " · stage \($0)" } ?? "")")
          .font(.callout)
      }

      Picker("How is it?", selection: $rating) {
        Text("Works").tag("ok")
        Text("Minor issue").tag("minor_issue")
        Text("Major issue").tag("major_issue")
      }
      .pickerStyle(.segmented)

      TextField("Category (optional)", text: $category).textFieldStyle(.roundedBorder)
      TextEditor(text: $comment)
        .frame(height: 110)
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.secondary.opacity(0.3)))
        .accessibilityLabel("Your note")

      HStack(spacing: 10) {
        Button(copied ? "Copied" : "Copy as prompt") {
          model.addFeedbackNote(note)
          NSPasteboard.general.clearContents()
          NSPasteboard.general.setString(feedbackPrompt(model.feedbackNotes), forType: .string)
          copied = true
        }
        .disabled(comment.trimmingCharacters(in: .whitespaces).isEmpty)
        Button("Send to Atlas") {
          let outgoing = note
          Task {
            await model.sendFeedback(outgoing)
            if model.error == nil { dismiss() }
          }
        }
        .disabled(model.busy || comment.trimmingCharacters(in: .whitespaces).isEmpty)
        Spacer()
        Text("\(model.feedbackNotes.count) note(s) collected this session")
          .font(.caption)
          .foregroundStyle(.secondary)
      }
      if let error = model.error {
        Text(error).font(.caption).foregroundStyle(.red)
      }
      Spacer(minLength: 0)
    }
    .padding(24)
    .frame(minWidth: 560, minHeight: 480)
  }
}
