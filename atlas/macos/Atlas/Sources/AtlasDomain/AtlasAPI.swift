import Foundation

/// The Atlas API, as the native client uses it.
///
/// It speaks exactly the endpoints the web lane uses — the same JSON, the same
/// refusals — so the two surfaces cannot drift into different behaviour. The
/// client holds NO rules: which stages may pass, what is missing and whether a
/// person may pass a gate all arrive in the response.
public struct AtlasSnapshot: Codable, Equatable, Identifiable, Sendable {
  public struct Row: Codable, Equatable, Identifiable, Sendable {
    public let projectId: String
    public let name: String
    public let stage: String
    public let status: String
    public let revision: Int
    public let updatedAt: String
    public var id: String { projectId }
  }
  public struct Chain: Codable, Equatable, Sendable {
    public let ok: Bool
    public let length: Int?
    public let brokenAt: Int?
  }
  public struct Gate: Codable, Equatable, Sendable {
    public let stage: String
    public let decision: String
    public let at: String
  }
  public struct Evidence: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let kind: String
    public let source: String
    public let scanState: String
    public let status: String
  }
  public struct Value: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let basis: String
    public let period: String
    public let sourceRef: String?
  }
  public struct StageState: Codable, Equatable, Sendable {
    public let current: String
    public let next: String?
    public let missing: [String]
    public let missingForNext: [String]
  }
  public struct Record: Codable, Equatable, Sendable {
    public let projectId: String
    public let name: String
    public let stage: String
    public let revision: Int
    public let entryType: String
  }
  public struct WorkspaceRef: Codable, Equatable, Sendable {
    public let id: String
    public let name: String
  }
  public struct Assignment: Codable, Equatable, Sendable {
    public let owner: String?
    public let processOwner: String?
    public let teoaApprover: String?
    public let visionApprover: String?
  }
  public let workspace: WorkspaceRef?
  public let assignments: Assignment?
  public let record: Record
  public let status: String
  public let stage: StageState
  public let chain: Chain
  public let gates: [Gate]
  public let evidence: [Evidence]
  public let values: [Value]
  public let canGate: [String: Bool]
  public var id: String { record.projectId }
  public var stageEnum: Stage? { Stage(rawValue: record.stage) }
  public var entryIsProcess: Bool { record.entryType == "process" }
}

public struct AtlasList: Codable, Equatable, Sendable {
  public let projects: [AtlasSnapshot.Row]
}

/// A workspace this person may create in. `role` is "admin" for a workspace
/// they administer, "super_admin" for the Super Admin, "member" otherwise.
public struct AtlasWorkspace: Codable, Equatable, Identifiable, Sendable {
  public let id: String
  public let name: String
  public let slug: String
  public let role: String?
  public var canCreate: Bool { role == "admin" || role == "super_admin" }
}

/// A refusal from the server, carrying the server's own words so the UI never
/// invents a message the API did not send.
public struct AtlasError: Error, Equatable, Sendable {
  public let status: Int
  public let message: String
  public let code: String?
  public var isUnauthorized: Bool { status == 401 || status == 403 }
}

public struct AtlasClient: Sendable {
  public let baseURL: URL
  public let token: String?
  private let session: URLSession

  public init(baseURL: URL, token: String? = nil, session: URLSession = .shared) {
    self.baseURL = baseURL
    self.token = token
    self.session = session
  }

  private func request(_ path: String, method: String = "GET", body: (any Encodable)? = nil) throws -> URLRequest {
    guard let url = URL(string: path, relativeTo: baseURL) else { throw AtlasError(status: 0, message: "Bad base URL.", code: "bad_url") }
    var request = URLRequest(url: url)
    request.httpMethod = method
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    if let token, !token.isEmpty { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
    if let body {
      request.setValue("application/json", forHTTPHeaderField: "Content-Type")
      request.httpBody = try JSONEncoder().encode(AnyEncodable(body))
    }
    return request
  }

  private func send<T: Decodable>(_ request: URLRequest, as type: T.Type) async throws -> T {
    let (data, response) = try await session.data(for: request)
    let status = (response as? HTTPURLResponse)?.statusCode ?? 0
    guard (200..<300).contains(status) else {
      let failure = try? JSONDecoder().decode(ServerError.self, from: data)
      throw AtlasError(status: status, message: failure?.error ?? "HTTP \(status)", code: failure?.code)
    }
    return try JSONDecoder().decode(type, from: data)
  }

  public func list() async throws -> [AtlasSnapshot.Row] {
    try await send(try request("/api/onboarding"), as: AtlasList.self).projects
  }

  public func workspaces() async throws -> [AtlasWorkspace] {
    struct Body: Decodable { let workspaces: [AtlasWorkspace] }
    return try await send(try request("/api/workspaces"), as: Body.self).workspaces
  }

  public func brain(_ projectId: String) async throws -> AtlasSnapshot {
    try await send(try request("/api/onboarding/\(projectId)"), as: AtlasSnapshot.self)
  }

  /// Create the project, then open its intake. The two calls are the same two
  /// the web lane makes, in the same order, so a failure leaves the project
  /// created and says the intake did not open.
  public func onboardNew(
    name: String,
    process: Bool,
    workspaceId: String,
    ownerEmail: String?
  ) async throws -> String {
    struct Body: Encodable {
      let name: String, description: String, status: String, category: String
      let location: String, latitude: Double?, longitude: Double?, dueDate: String
      let color: String, tasks: [String]
    }
    struct Created: Decodable { struct Project: Decodable { let id: String }; let project: Project }
    let body = Body(
      name: name, description: "", status: "In progress",
      category: process ? "Process" : "Project", location: "",
      latitude: nil, longitude: nil, dueDate: "", color: "orange", tasks: []
    )
    let created = try await send(try request("/api/projects", method: "POST", body: body), as: Created.self)
    struct Intake: Encodable {
      let entryType: String
      let workspaceId: String
      let ownerEmail: String?
    }
    _ = try await send(
      try request(
        "/api/onboarding/\(created.project.id)", method: "POST",
        body: Intake(
          entryType: process ? "process" : "project",
          workspaceId: workspaceId,
          ownerEmail: ownerEmail
        )
      ),
      as: AtlasSnapshot.self
    )
    return created.project.id
  }

  /// Start the intake on a project that already exists.
  public func startIntake(
    _ projectId: String,
    process: Bool,
    workspaceId: String
  ) async throws -> AtlasSnapshot {
    struct Intake: Encodable {
      let entryType: String
      let workspaceId: String
    }
    return try await send(
      try request(
        "/api/onboarding/\(projectId)", method: "POST",
        body: Intake(entryType: process ? "process" : "project", workspaceId: workspaceId)
      ),
      as: AtlasSnapshot.self
    )
  }

  public func passGate(_ snapshot: AtlasSnapshot, reason: String) async throws -> AtlasSnapshot {
    struct Decision: Encodable { let stage: String; let decision: String; let reason: String; let revision: Int }
    return try await send(
      try request(
        "/api/onboarding/\(snapshot.record.projectId)/gate", method: "POST",
        body: Decision(stage: snapshot.stage.current, decision: "pass", reason: reason, revision: snapshot.record.revision)
      ),
      as: AtlasSnapshot.self
    )
  }
}

private struct ServerError: Decodable {
  let error: String?
  let code: String?
}

/// Encode any payload through a concrete encoder, so the client can accept a
/// heterogeneous body without exposing an existential to callers.
private struct AnyEncodable: Encodable {
  private let encodeBody: (Encoder) throws -> Void
  init(_ wrapped: any Encodable) { encodeBody = wrapped.encode }
  func encode(to encoder: Encoder) throws { try encodeBody(encoder) }
}
