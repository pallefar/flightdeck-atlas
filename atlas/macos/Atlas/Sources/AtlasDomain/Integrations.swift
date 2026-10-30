import Foundation

/// The three apps this client adds to the onboarding, and nothing else: TEOA
/// Advantage, the PDF app and Maps.
///
/// Each is a URL template the person stores once (`{project}` is replaced with
/// the project id). No id or path is guessed here: an empty template shows as
/// "set the link" rather than as a button that opens the wrong place.
public enum Integration: String, CaseIterable, Identifiable, Sendable {
  case advantage
  case pdf
  case maps

  public var id: String { rawValue }

  public var title: String {
    switch self {
    case .advantage: return "TEOA Advantage"
    case .pdf: return "PDF app"
    case .maps: return "FlightDeck Maps"
    }
  }

  public var icon: String {
    switch self {
    case .advantage: return "chart.bar.doc.horizontal"
    case .pdf: return "doc.richtext"
    case .maps: return "map"
    }
  }

  /// What the app is for, in one line, so the row is not just a name.
  public var purpose: String {
    switch self {
    case .advantage: return "Value streams, scorecards and improvement work for this project."
    case .pdf: return "The documents this process runs on."
    case .maps: return "The as-is and to-be maps."
    }
  }

  public var defaultsKey: String { "atlas.integration.\(rawValue)" }
}

/// Turn a stored template and a project id into a URL. Missing `{project}`
/// simply leaves the URL without it; an empty template is no URL at all.
public func resolvedIntegrationURL(template: String, projectId: String?) -> URL? {
  let trimmed = template.trimmingCharacters(in: .whitespacesAndNewlines)
  guard !trimmed.isEmpty else { return nil }
  let filled = trimmed.replacingOccurrences(of: "{project}", with: projectId ?? "")
  return URL(string: filled)
}
