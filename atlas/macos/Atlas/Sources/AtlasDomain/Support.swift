import Foundation

/// One feedback note. Structural context only — where you were and what you
/// were looking at — plus your own words. The Maps admin overlay's rule.
public struct FeedbackNote: Equatable, Sendable {
  public var screen: String
  public var projectId: String?
  public var stage: String?
  public var rating: String
  public var category: String?
  public var comment: String
  public var appVersion: String?

  public init(
    screen: String,
    projectId: String? = nil,
    stage: String? = nil,
    rating: String = "ok",
    category: String? = nil,
    comment: String = "",
    appVersion: String? = nil
  ) {
    self.screen = screen
    self.projectId = projectId
    self.stage = stage
    self.rating = rating
    self.category = category
    self.comment = comment
    self.appVersion = appVersion
  }

  /// The line this note becomes in a prompt, matching the web lane's format.
  public var promptLine: String {
    var where_ = [screen.isEmpty ? "app" : screen]
    if let projectId, !projectId.isEmpty { where_.append("project \(projectId)") }
    if let stage, !stage.isEmpty { where_.append("stage \(stage)") }
    let tag = category.map { "\(rating)/\($0)" } ?? rating
    return "- [\(tag)] \(where_.joined(separator: " · ")): \(comment.isEmpty ? "(no comment)" : comment)"
  }
}

/// The prompt one or more notes become — the same text the web overlay copies.
public func feedbackPrompt(_ notes: [FeedbackNote]) -> String {
  guard !notes.isEmpty else { return "" }
  return (["Feedback from the Atlas apps:"]
    + notes.map(\.promptLine)
    + ["", "Please address these points."]).joined(separator: "\n")
}

/// The update verdict the server reports. A refusal carries a CODE and is
/// never shown as "up to date" — the OS updates contract's rule.
public struct UpdateVerdict: Codable, Equatable, Sendable {
  public struct Release: Codable, Equatable, Sendable {
    public let version: String
    public let releasedAt: String
    public let notes: String
    public let url: String
    public let sha256: String
  }
  public let status: String
  public let current: String?
  public let latest: Release?
  public let downloadable: Bool?
  public let code: String?

  public var isUpToDate: Bool { status == "up_to_date" }
  public var isAhead: Bool { status == "ahead_of_release" }
  public var hasUpdate: Bool { status == "update_available" }
  public var isRefused: Bool { status == "refused" }
  public var downloadURL: URL? {
    guard let latest, downloadable == true, !latest.url.isEmpty else { return nil }
    return URL(string: latest.url)
  }
  public var headline: String {
    switch status {
    case "up_to_date": return "You are up to date (v\(current ?? "?"))."
    case "ahead_of_release": return "This build is ahead of the published release (v\(current ?? "?"))."
    case "update_available":
      return "Version \(latest?.version ?? "?") is available."
    default: return "Could not check for updates: \(code ?? "UNKNOWN")."
    }
  }
}
