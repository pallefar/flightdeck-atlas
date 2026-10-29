import XCTest

@testable import AtlasDomain

/// A stub transport: the client is exercised end to end (URL building, headers,
/// encoding, status handling) without a server.
final class StubProtocol: URLProtocol {
  nonisolated(unsafe) static var handler: ((URLRequest) throws -> (Int, Data))?
  nonisolated(unsafe) static var seen: [String] = []
  nonisolated(unsafe) static var bodies: [String] = []

  override class func canInit(with request: URLRequest) -> Bool { true }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

  override func startLoading() {
    StubProtocol.seen.append("\(request.httpMethod ?? "GET") \(request.url?.path ?? "")")
    if let body = request.httpBody {
      StubProtocol.bodies.append(String(data: body, encoding: .utf8) ?? "")
    } else if let stream = request.httpBodyStream {
      stream.open()
      var data = Data()
      let size = 4096
      let buffer = UnsafeMutablePointer<UInt8>.allocate(capacity: size)
      while stream.hasBytesAvailable {
        let read = stream.read(buffer, maxLength: size)
        if read <= 0 { break }
        data.append(buffer, count: read)
      }
      buffer.deallocate()
      stream.close()
      StubProtocol.bodies.append(String(data: data, encoding: .utf8) ?? "")
    }
    guard let handler = StubProtocol.handler else {
      client?.urlProtocol(self, didFailWithError: URLError(.badServerResponse))
      return
    }
    do {
      let (status, data) = try handler(request)
      let response = HTTPURLResponse(
        url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: nil)!
      client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
      client?.urlProtocol(self, didLoad: data)
      client?.urlProtocolDidFinishLoading(self)
    } catch {
      client?.urlProtocol(self, didFailWithError: error)
    }
  }

  override func stopLoading() {}
}

final class ClientTests: XCTestCase {
  private var client: AtlasClient!

  override func setUp() {
    StubProtocol.seen = []
    StubProtocol.bodies = []
    let configuration = URLSessionConfiguration.ephemeral
    configuration.protocolClasses = [StubProtocol.self]
    client = AtlasClient(
      baseURL: URL(string: "http://atlas.test")!,
      token: "secret-token",
      session: URLSession(configuration: configuration)
    )
  }

  private func respond(_ status: Int, _ json: String) {
    StubProtocol.handler = { _ in (status, Data(json.utf8)) }
  }

  func testTheListDecodesAndCarriesTheBearerToken() async throws {
    var authorization: String?
    StubProtocol.handler = { request in
      authorization = request.value(forHTTPHeaderField: "Authorization")
      return (200, Data(#"{"projects":[{"projectId":"p-1","name":"Contract intake","stage":"capture","status":"active","revision":4,"updatedAt":"2026-10-28T10:00:00.000Z"}]}"#.utf8))
    }
    let rows = try await client.list()
    XCTAssertEqual(rows.count, 1)
    XCTAssertEqual(rows.first?.name, "Contract intake")
    XCTAssertEqual(rows.first?.stage, "capture")
    XCTAssertEqual(authorization, "Bearer secret-token")
  }

  func testTheBrainDecodesItsStageChainAndGateRights() async throws {
    respond(200, #"""
    {"record":{"projectId":"p-1","name":"Contract intake","stage":"capture","revision":4,"entryType":"process"},
     "status":"active",
     "stage":{"current":"capture","next":"as-is","missing":["scan"],"missingForNext":["as-is-map"]},
     "chain":{"ok":true,"length":4},
     "gates":[{"stage":"intake","decision":"pass","at":"2026-10-01T08:00:00.000Z"}],
     "evidence":[],"values":[],"canGate":{"capture":false}}
    """#)
    let snapshot = try await client.brain("p-1")
    XCTAssertEqual(snapshot.stageEnum, .capture)
    XCTAssertTrue(snapshot.entryIsProcess)
    XCTAssertEqual(snapshot.stage.missing, ["scan"])
    XCTAssertEqual(snapshot.canGate["capture"], false)
    XCTAssertEqual(StubProtocol.seen, ["GET /api/onboarding/p-1"])
  }

  func testTheWorkspacesCarryWhetherThisPersonMayCreateThere() async throws {
    let json = #"{"workspaces":[{"id":"general","name":"General","slug":"general","role":"admin"},{"id":"hr-emea","name":"HR EMEA","slug":"hr-emea","role":"member"}]}"#
    respond(200, json)
    let list = try await client.workspaces()
    XCTAssertEqual(list.count, 2)
    XCTAssertTrue(list[0].canCreate)
    XCTAssertFalse(list[1].canCreate)
  }

  func testOnboardingCreatesTheProjectThenOpensItsIntakeInThatOrder() async throws {
    StubProtocol.handler = { request in
      if request.url?.path == "/api/projects" {
        return (201, Data(#"{"project":{"id":"p-9","name":"Invoice matching"}}"#.utf8))
      }
      return (200, Data(#"""
      {"record":{"projectId":"p-9","name":"Invoice matching","stage":"intake","revision":1,"entryType":"process"},
       "status":"active","stage":{"current":"intake","next":"reuse","missing":[],"missingForNext":[]},
       "chain":{"ok":true,"length":1},"gates":[],"evidence":[],"values":[],"canGate":{}}
      """#.utf8))
    }
    let id = try await client.onboardNew(
      name: "Invoice matching",
      process: true,
      workspaceId: "general",
      ownerEmail: "owner@example.test"
    )
    XCTAssertEqual(id, "p-9")
    XCTAssertEqual(StubProtocol.seen, ["POST /api/projects", "POST /api/onboarding/p-9"])
  }

  func testARefusalKeepsTheServersOwnWordsAndCode() async {
    respond(409, #"{"error":"This stage still has unmet requirements.","code":"prerequisite_missing"}"#)
    do {
      _ = try await client.brain("p-1")
      XCTFail("expected a refusal")
    } catch let failure as AtlasError {
      XCTAssertEqual(failure.status, 409)
      XCTAssertEqual(failure.code, "prerequisite_missing")
      XCTAssertTrue(failure.message.contains("unmet requirements"))
      XCTAssertFalse(failure.isUnauthorized)
    } catch {
      XCTFail("unexpected error \(error)")
    }
  }

  func testAnUnauthorizedAnswerIsRecognised() async {
    respond(401, #"{"error":"Sign in to continue."}"#)
    do {
      _ = try await client.list()
      XCTFail("expected a refusal")
    } catch let failure as AtlasError {
      XCTAssertTrue(failure.isUnauthorized)
    } catch {
      XCTFail("unexpected error \(error)")
    }
  }
  // The write actions the app offers. Each one is the same call the web lane
  // makes, so a person can complete an onboarding in the app alone.
  private func snapshot() throws -> AtlasSnapshot {
    let json = #"{"record":{"projectId":"p-1","name":"Purchase orders","stage":"intake","revision":3,"entryType":"process"},"status":"active","stage":{"current":"intake","next":"reuse","missing":[],"missingForNext":[]},"chain":{"ok":true,"length":1},"gates":[],"evidence":[],"values":[],"canGate":{"intake":true},"data":{"problem":"Email","requester":"Procurement","site":"Bensheim","classification":"internal","classificationDeclared":true},"access":{"canEdit":true,"canAssignRoles":true,"canView":true},"workspace":{"id":"general","name":"General"},"assignments":{"owner":"owner@example.test","processOwner":null,"teoaApprover":null,"visionApprover":null}}"#
    return try JSONDecoder().decode(AtlasSnapshot.self, from: Data(json.utf8))
  }

  func testSaveIntakeSendsTheRevisionAndTheFields() async throws {
    respond(200, String(decoding: try JSONEncoder().encode(try snapshot()), as: UTF8.self))
    var draft = try snapshot().data!.draft
    draft.site = "Prague"
    _ = try await client.saveIntake(try snapshot(), draft: draft)
    XCTAssertEqual(StubProtocol.seen, ["PATCH /api/onboarding/p-1"])
    let body = StubProtocol.bodies.last ?? ""
    XCTAssertTrue(body.contains("\"revision\":3"), body)
    XCTAssertTrue(body.contains("Prague"), body)
    XCTAssertTrue(body.contains("classificationDeclared"), body)
  }

  func testReuseEvidenceValueAndRolesEachPostTheirOwnRoute() async throws {
    respond(200, String(decoding: try JSONEncoder().encode(try snapshot()), as: UTF8.self))
    _ = try await client.recordReuse(try snapshot(), decision: "extend", reason: "sub-app exists")
    _ = try await client.addEvidence(try snapshot(), kind: "document", source: "sop.docx", sha256: String(repeating: "a", count: 64), bytes: 10, classification: "internal")
    _ = try await client.addValue(try snapshot(), basis: "measured", period: "baseline", hours: 640, cost: nil, sourceRef: "export.csv")
    _ = try await client.assignRole(try snapshot(), role: "process_owner", email: "process@example.test")
    XCTAssertEqual(StubProtocol.seen, [
      "POST /api/onboarding/p-1/reuse",
      "POST /api/onboarding/p-1/evidence",
      "POST /api/onboarding/p-1/value",
      "POST /api/onboarding/p-1/roles",
    ])
    XCTAssertTrue(StubProtocol.bodies[0].contains("extend"))
    XCTAssertTrue(StubProtocol.bodies[2].contains("measured"))
    XCTAssertTrue(StubProtocol.bodies[2].contains("export.csv"))
  }

  func testAGateDecisionCarriesTheStageAndTheReason() async throws {
    respond(200, String(decoding: try JSONEncoder().encode(try snapshot()), as: UTF8.self))
    struct Decision: Encodable {
      let stage: String, decision: String, reason: String, revision: Int
    }
    _ = try await client.decideGate(
      try snapshot(),
      Decision(stage: "intake", decision: "reject", reason: "problem too thin", revision: 3)
    )
    XCTAssertEqual(StubProtocol.seen, ["POST /api/onboarding/p-1/gate"])
    let body = StubProtocol.bodies.last ?? ""
    XCTAssertTrue(body.contains("reject"), body)
    XCTAssertTrue(body.contains("problem too thin"), body)
  }
  func testAnEmptyEnumFieldIsSentAsNullNotFound() {
    // The regression the self-test caught: the project schema required
    // latitude/longitude even when null, and "" is not a valid buildDecision.
    var draft = IntakeDraft()
    XCTAssertEqual(draft.fields["buildDecision"], .null)
    draft.buildDecision = "studio"
    XCTAssertEqual(draft.fields["buildDecision"], .string("studio"))
    // A declared classification with no class is not sent at all.
    XCTAssertNil(draft.fields["classification"])
    draft.classification = "internal"
    draft.classificationDeclared = true
    XCTAssertEqual(draft.fields["classification"], .string("internal"))
  }
  func testTheAtlasLinksPointAtTheBrainLaneAndOneProject() throws {
    let base = try XCTUnwrap(URL(string: "http://localhost:5173"))
    let overview = try XCTUnwrap(AtlasLink.overview(base: base)).absoluteString
    XCTAssertEqual(overview, "http://localhost:5173/?view=brain")
    let project = try XCTUnwrap(
      AtlasLink.project(base: base, id: "p-1")
    ).absoluteString
    XCTAssertEqual(project, "http://localhost:5173/?view=brain&project=p-1")
    // A base that already carries a trailing slash or a query is not doubled.
    let messy = try XCTUnwrap(URL(string: "http://atlas.test/atlas/?x=1"))
    let link = try XCTUnwrap(AtlasLink.project(base: messy, id: "p 2")).absoluteString
    XCTAssertTrue(link.hasPrefix("http://atlas.test/atlas/?"), link)
    XCTAssertTrue(link.contains("view=brain"), link)
    XCTAssertTrue(link.contains("project=p%202"), link)
  }
}
