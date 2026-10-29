import Foundation

/// The direct link from the app into Atlas on the web.
///
/// It points at the same lane the app mirrors, and can name one project so a
/// person lands on *that* brain with the whole portfolio around it — the
/// overview the app cannot draw at the same density.
public enum AtlasLink {
  /// `/?view=brain` — the portfolio, pipeline and every project.
  public static func overview(base: URL) -> URL? {
    components(base: base, project: nil)?.url
  }

  /// `/?view=brain&project=<id>` — the same lane, focused on one project.
  public static func project(base: URL, id: String) -> URL? {
    components(base: base, project: id)?.url
  }

  private static func components(base: URL, project: String?) -> URLComponents? {
    guard var components = URLComponents(url: base, resolvingAgainstBaseURL: false) else {
      return nil
    }
    // The app's base may be an origin or carry a path; the lane lives at the
    // root of the Atlas app either way.
    var path = components.path
    while path.hasSuffix("/") { path.removeLast() }
    components.path = path + "/"
    var items = components.queryItems ?? []
    items.removeAll { $0.name == "view" || $0.name == "project" }
    items.append(URLQueryItem(name: "view", value: "brain"))
    if let project, !project.isEmpty {
      items.append(URLQueryItem(name: "project", value: project))
    }
    components.queryItems = items
    return components
  }
}
