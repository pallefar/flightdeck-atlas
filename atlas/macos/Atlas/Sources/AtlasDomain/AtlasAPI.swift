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
  public struct Intake: Codable, Equatable, Sendable {
    public let classificationDeclared: Bool?
    public let classification: String?
    public let problem: String?
    public let requester: String?
    public let functionArea: String?
    public let site: String?
    public let objective: String?
    public let successMeasure: String?
    public let volume: String?
    public let frequency: String?
    public let teoaScopeId: String?
    public let visionObjectiveId: String?
    public let asIsMapRef: String?
    public let asIsSignedOff: Bool?
    public let toBeMapRef: String?
    public let buildDecision: String?
    public let operatorBundleRef: String?
    public let retireReason: String?

    public var draft: IntakeDraft {
      IntakeDraft(
        classificationDeclared: classificationDeclared ?? false,
        classification: classification ?? "",
        problem: problem ?? "",
        requester: requester ?? "",
        functionArea: functionArea ?? "",
        site: site ?? "",
        objective: objective ?? "",
        successMeasure: successMeasure ?? "",
        volume: volume ?? "",
        frequency: frequency ?? "",
        teoaScopeId: teoaScopeId ?? "",
        visionObjectiveId: visionObjectiveId ?? "",
        asIsMapRef: asIsMapRef ?? "",
        asIsSignedOff: asIsSignedOff ?? false,
        toBeMapRef: toBeMapRef ?? "",
        buildDecision: buildDecision ?? "",
        operatorBundleRef: operatorBundleRef ?? "",
        retireReason: retireReason ?? ""
      )
    }
  }

  public struct Access: Codable, Equatable, Sendable {
    public let canEdit: Bool?
    public let canAssignRoles: Bool?
    public let canView: Bool?
  }

  public let data: Intake?
  public let access: Access?
  public struct Reuse: Codable, Equatable, Sendable {
    public let decision: String
    public let reason: String
  }
  public let workspace: WorkspaceRef?
  public let assignments: Assignment?
  public let reuse: Reuse?
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

  /// One feedback note: structural context and the person's own words only.
  public func sendFeedback(_ note: FeedbackNote) async throws {
    struct Body: Encodable {
      let source: String
      let screen: String
      let projectId: String?
      let stage: String?
      let rating: String
      let category: String?
      let comment: String
      let appVersion: String?
    }
    struct Ack: Decodable { let id: String }
    _ = try await send(
      try request(
        "/api/feedback", method: "POST",
        body: Body(
          source: "macos", screen: note.screen, projectId: note.projectId,
          stage: note.stage, rating: note.rating, category: note.category,
          comment: note.comment, appVersion: note.appVersion
        )
      ),
      as: Ack.self
    )
  }

  /// The update verdict for this build, or the server's refusal code.
  public func checkForUpdates(currentVersion: String) async throws -> UpdateVerdict {
    var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false)!
    let path = "/api/app-updates"
    components.path = path
    components.queryItems = [URLQueryItem(name: "version", value: currentVersion)]
    guard let url = components.url else { throw AtlasError(status: 0, message: "Bad URL", code: nil) }
    var request = URLRequest(url: url)
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    let (data, response) = try await session.data(for: request)
    let status = (response as? HTTPURLResponse)?.statusCode ?? 0
    guard (200..<300).contains(status) else {
      throw AtlasError(status: status, message: "HTTP \(status)", code: nil)
    }
    return try JSONDecoder().decode(UpdateVerdict.self, from: data)
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
    ownerEmail: String?,
    problem: String = ""
  ) async throws -> String {
    // `latitude` and `longitude` are required by the project schema and may be
    // null. Swift omits nil optionals when it encodes, which the server reads
    // as a missing field ("Required"), so nulls are written explicitly.
    struct Body: Encodable {
      let name: String, description: String, status: String, category: String
      let location: String, latitude: Double?, longitude: Double?, dueDate: String
      let color: String, tasks: [String]
      enum CodingKeys: String, CodingKey {
        case name, description, status, category, location, latitude, longitude, dueDate, color, tasks
      }
      func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(name, forKey: .name)
        try container.encode(description, forKey: .description)
        try container.encode(status, forKey: .status)
        try container.encode(category, forKey: .category)
        try container.encode(location, forKey: .location)
        if let latitude { try container.encode(latitude, forKey: .latitude) }
        else { try container.encodeNil(forKey: .latitude) }
        if let longitude { try container.encode(longitude, forKey: .longitude) }
        else { try container.encodeNil(forKey: .longitude) }
        try container.encode(dueDate, forKey: .dueDate)
        try container.encode(color, forKey: .color)
        try container.encode(tasks, forKey: .tasks)
      }
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
      let problem: String
    }
    _ = try await send(
      try request(
        "/api/onboarding/\(created.project.id)", method: "POST",
        body: Intake(
          entryType: process ? "process" : "project",
          workspaceId: workspaceId,
          ownerEmail: ownerEmail,
          problem: problem
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

  /// Save the editable intake facts. The revision is the one the snapshot
  /// carried, so a save cannot overwrite someone else's change.
  public func saveIntake(
    _ snapshot: AtlasSnapshot,
    draft: IntakeDraft
  ) async throws -> AtlasSnapshot {
    struct Body: Encodable {
      let revision: Int
      let fields: [String: FieldValue]
    }
    return try await send(
      try request(
        "/api/onboarding/\(snapshot.record.projectId)", method: "PATCH",
        body: Body(revision: snapshot.record.revision, fields: draft.fields)
      ),
      as: AtlasSnapshot.self
    )
  }

  public func recordReuse(
    _ snapshot: AtlasSnapshot,
    decision: String,
    reason: String
  ) async throws -> AtlasSnapshot {
    struct Body: Encodable {
      let decision: String
      let reason: String
      let matches: [String]
    }
    return try await send(
      try request(
        "/api/onboarding/\(snapshot.record.projectId)/reuse", method: "POST",
        body: Body(decision: decision, reason: reason, matches: [])
      ),
      as: AtlasSnapshot.self
    )
  }

  public func addEvidence(
    _ snapshot: AtlasSnapshot,
    kind: String,
    source: String,
    sha256: String,
    bytes: Int,
    classification: String
  ) async throws -> AtlasSnapshot {
    struct Body: Encodable {
      let kind: String
      let source: String
      let sha256: String
      let bytes: Int
      let classification: String
      let status: String
    }
    return try await send(
      try request(
        "/api/onboarding/\(snapshot.record.projectId)/evidence", method: "POST",
        body: Body(
          kind: kind, source: source, sha256: sha256, bytes: bytes,
          classification: classification, status: "pending"
        )
      ),
      as: AtlasSnapshot.self
    )
  }

  public func addValue(
    _ snapshot: AtlasSnapshot,
    basis: String,
    period: String,
    hours: Double?,
    cost: Double?,
    sourceRef: String?
  ) async throws -> AtlasSnapshot {
    struct Figures: Encodable {
      let hours: Double?
      let cost: Double?
    }
    struct Body: Encodable {
      let basis: String
      let period: String
      let figures: Figures
      let method: String
      let methodVersion: String
      let confidence: String
      let sourceRef: String?
    }
    return try await send(
      try request(
        "/api/onboarding/\(snapshot.record.projectId)/value", method: "POST",
        body: Body(
          basis: basis, period: period, figures: Figures(hours: hours, cost: cost),
          method: "ai-jam-value-case", methodVersion: "provisional-1",
          confidence: "medium", sourceRef: sourceRef
        )
      ),
      as: AtlasSnapshot.self
    )
  }

  public func assignRole(
    _ snapshot: AtlasSnapshot,
    role: String,
    email: String
  ) async throws -> AtlasSnapshot {
    struct Body: Encodable {
      let role: String
      let email: String
    }
    return try await send(
      try request(
        "/api/onboarding/\(snapshot.record.projectId)/roles", method: "POST",
        body: Body(role: role, email: email)
      ),
      as: AtlasSnapshot.self
    )
  }

  /// A gate decision of any kind (pass or reject), with the body the route
  /// expects. Kept generic so the app and the web lane send the same shape.
  public func decideGate<Body: Encodable>(
    _ snapshot: AtlasSnapshot,
    _ body: Body
  ) async throws -> AtlasSnapshot {
    try await send(
      try request(
        "/api/onboarding/\(snapshot.record.projectId)/gate", method: "POST", body: body
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
