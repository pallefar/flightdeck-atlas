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
      return (200, Data(#"{"projects":[{"projectId":"p-1","name":"Contract intake","stage":"capture","status":"active","revision":4,"updatedAt":"2026-10-28T10:00:00.000Z","readiness":43,"met":3,"total":7,"kind":"process","lane":"quick","deferred":3,"deferredOverdue":1}]}"#.utf8))
    }
    let rows = try await client.list()
    XCTAssertEqual(rows.count, 1)
    XCTAssertEqual(rows.first?.name, "Contract intake")
    XCTAssertEqual(rows.first?.stage, "capture")
    // A card can show readiness without opening the project.
    XCTAssertEqual(rows.first?.readiness, 43)
    XCTAssertEqual(rows.first?.met, 3)
    XCTAssertEqual(rows.first?.total, 7)
    XCTAssertEqual(rows.first?.kind, "process")
    XCTAssertEqual(rows.first?.lane, "quick")
    XCTAssertEqual(rows.first?.deferred, 3)
    XCTAssertEqual(rows.first?.deferredOverdue, 1)
    XCTAssertEqual(authorization, "Bearer secret-token")
  }

  func testTheBrainDecodesItsStageChainAndGateRights() async throws {
    respond(200, #"""
    {"record":{"projectId":"p-1","name":"Contract intake","stage":"capture","revision":4,"entryType":"workflow"},
     "status":"active",
     "stage":{"current":"capture","next":"as-is","missing":["scan"],"missingForNext":["as-is-map"]},
     "chain":{"ok":true,"length":4},
     "gates":[{"stage":"intake","decision":"pass","at":"2026-10-01T08:00:00.000Z"}],
     "evidence":[],"values":[],"canGate":{"capture":false}}
    """#)
    let snapshot = try await client.brain("p-1")
    XCTAssertEqual(snapshot.stageEnum, .capture)
    XCTAssertEqual(snapshot.entryKind, "workflow")
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
      kind: "workflow",
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
    let json = #"{"record":{"projectId":"p-1","name":"Purchase orders","stage":"intake","revision":3,"entryType":"workflow"},"status":"active","stage":{"current":"intake","next":"reuse","missing":[],"missingForNext":[]},"chain":{"ok":true,"length":1},"gates":[],"evidence":[],"values":[],"canGate":{"intake":true},"data":{"problem":"Email","requester":"Procurement","site":"Bensheim","classification":"internal","classificationDeclared":true},"access":{"canEdit":true,"canAssignRoles":true,"canView":true},"workspace":{"id":"general","name":"General"},"assignments":{"owner":"owner@example.test","processOwner":null,"teoaApprover":null,"visionApprover":null}}"#
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
  // Analysis is a checklist over facts the server sent, so it is pure and
  // testable: no category of "score" is invented beyond what is counted.
  private func snapshotJSON(stage: String, missing: [String], evidence: String, roles: String, reuse: String, values: String, chainOK: Bool) -> String {
    let missingJSON = missing.map { "\"\($0)\"" }.joined(separator: ",")
    return #"{"record":{"projectId":"p-1","name":"P","stage":"\#(stage)","revision":2,"entryType":"process"},"status":"active","stage":{"current":"\#(stage)","next":"capture","missing":[\#(missingJSON)],"missingForNext":[]},"chain":{"ok":\#(chainOK),"length":2},"gates":[],"evidence":[\#(evidence)],"values":[\#(values)],"canGate":{},"data":{},"access":{"canEdit":true,"canAssignRoles":true,"canView":true},"workspace":{"id":"general","name":"General"},"assignments":\#(roles),"reuse":\#(reuse)}"#
  }

  func testAnalysisCountsOnlyWhatTheServerSaid() throws {
    let empty = try JSONDecoder().decode(AtlasSnapshot.self, from: Data(snapshotJSON(
      stage: "intake", missing: ["classification", "problem"], evidence: "",
      roles: #"{"owner":"me@example.test","processOwner":null,"teoaApprover":null,"visionApprover":null}"#,
      reuse: "null", values: "", chainOK: true).utf8))
    let bare = analyse(empty)
    XCTAssertLessThan(bare.readiness, 50)
    XCTAssertEqual(bare.rolesFilled, 1)
    XCTAssertEqual(bare.evidenceAccepted, 0)
    XCTAssertTrue(bare.nextActions.contains { $0.label == "State the problem" && $0.anchor == .intake })
    XCTAssertTrue(bare.risks.contains { $0.contains("process owner") }, "\(bare.risks)")

    let ready = try JSONDecoder().decode(AtlasSnapshot.self, from: Data(snapshotJSON(
      stage: "value", missing: [],
      evidence: #"{"id":"e1","kind":"document","source":"a.docx","scanState":"clear","status":"accepted"}"#,
      roles: #"{"owner":"me@example.test","processOwner":"po@example.test","teoaApprover":"t@example.test","visionApprover":"v@example.test"}"#,
      reuse: #"{"decision":"extend","reason":"sub-app exists"}"#,
      values: #"{"id":"v1","basis":"measured","period":"baseline","sourceRef":"export.csv"}"#,
      chainOK: true).utf8))
    let full = analyse(ready)
    XCTAssertEqual(full.readiness, 100)
    XCTAssertEqual(full.rolesFilled, 4)
    XCTAssertEqual(full.evidenceAccepted, 1)
    XCTAssertTrue(full.hasBaseline)
    XCTAssertTrue(full.hasReuseDecision)
    XCTAssertTrue(full.nextActions.isEmpty)
  }

  func testAnalysisFlagsAReviewAndABrokenChain() throws {
    let snapshot = try JSONDecoder().decode(AtlasSnapshot.self, from: Data(snapshotJSON(
      stage: "capture", missing: ["scan"],
      evidence: #"{"id":"e1","kind":"voice","source":"a.m4a","scanState":"review","status":"pending"}"#,
      roles: #"{"owner":"me@example.test","processOwner":null,"teoaApprover":null,"visionApprover":null}"#,
      reuse: "null", values: "", chainOK: false).utf8))
    let analysis = analyse(snapshot)
    XCTAssertEqual(analysis.evidenceNeedsReview, 1)
    XCTAssertFalse(analysis.chainOk)
    XCTAssertTrue(analysis.risks.contains { $0.contains("review") })
    XCTAssertTrue(analysis.risks.contains { $0.contains("chain") })
  }

  func testFeedbackNoteBecomesTheSameLineTheWebBuilds() {
    let note = FeedbackNote(
      screen: "Project brain", projectId: "p-1", stage: "capture",
      rating: "minor_issue", category: "wording", comment: "Unclear."
    )
    XCTAssertEqual(note.promptLine, "- [minor_issue/wording] Project brain · project p-1 · stage capture: Unclear.")
    XCTAssertTrue(feedbackPrompt([note]).hasPrefix("Feedback from the Atlas apps:"))
    XCTAssertEqual(feedbackPrompt([]), "")
  }

  func testTheUpdateHeadlineCannotDressARefusalAsUpToDate() {
    let refused = UpdateVerdict(status: "refused", current: nil, latest: nil, downloadable: nil, code: "RELEASE_METADATA_INVALID")
    XCTAssertTrue(refused.isRefused)
    XCTAssertFalse(refused.isUpToDate)
    XCTAssertTrue(refused.headline.contains("RELEASE_METADATA_INVALID"))
    let available = UpdateVerdict(
      status: "update_available", current: "0.1.0",
      latest: UpdateVerdict.Release(
        version: "0.2.0", releasedAt: "2026-10-30T00:00:00.000Z", notes: "n",
        url: "https://example.test/a.dmg", sha256: String(repeating: "a", count: 64)),
      downloadable: true, code: nil)
    XCTAssertNotNil(available.downloadURL)
  }
  func testAnIntegrationTemplateIsResolvedOrLeftUnconfigured() {
    XCTAssertNil(resolvedIntegrationURL(template: "   ", projectId: "p-1"))
    let url = resolvedIntegrationURL(
      template: "https://os.example.test/console/apps/advantage?fdProject={project}",
      projectId: "p-1")
    XCTAssertEqual(url?.absoluteString, "https://os.example.test/console/apps/advantage?fdProject=p-1")
    // A template without the placeholder still opens; it just has no id.
    XCTAssertNotNil(resolvedIntegrationURL(template: "https://os.example.test/apps/maps", projectId: "p-1"))
    // The three apps this client adds are the three the owner named.
    XCTAssertEqual(
      Integration.allCases.map({ $0.title }),
      ["TEOA Advantage", "PDF app", "FlightDeck Maps", "FlightDeck Studio", "Vision"]
    )
  }

  func testTheScanActionIsNotOfferedWhenNothingWasCaptured() throws {
    let snapshot = try JSONDecoder().decode(AtlasSnapshot.self, from: Data(snapshotJSON(
      stage: "capture", missing: ["evidence"], evidence: "",
      roles: #"{"owner":"me@example.test","processOwner":null,"teoaApprover":null,"visionApprover":null}"#,
      reuse: "null", values: "", chainOK: true).utf8))
    let analysis = analyse(snapshot)
    XCTAssertFalse(analysis.nextActions.contains { $0.label == "Review the flagged evidence, or redact it" })
    XCTAssertTrue(analysis.nextActions.contains { $0.label == "Attach evidence and have it accepted" && $0.anchor == .evidence })
  }
  func testAHandoffRequestPostsTheKindAndTheMapType() async throws {
    respond(200, String(decoding: try JSONEncoder().encode(try snapshot()), as: UTF8.self))
    _ = try await client.requestHandoff(try snapshot(), kind: "diagramforge", mapType: "future")
    XCTAssertEqual(StubProtocol.seen, ["POST /api/onboarding/p-1/handoff"])
    let body = StubProtocol.bodies.last ?? ""
    XCTAssertTrue(body.contains("diagramforge"), body)
    XCTAssertTrue(body.contains("future"), body)
  }
  func testTheThreeKindsAreTheOnesTheWizardOffers() throws {
    for kind in ["project", "process", "workflow"] {
      let json = #"{"record":{"projectId":"p-1","name":"P","stage":"intake","revision":1,"entryType":"\#(kind)"},"status":"active","stage":{"current":"intake","next":"reuse","missing":[],"missingForNext":[]},"chain":{"ok":true,"length":1},"gates":[],"evidence":[],"values":[],"canGate":{}}"#
      let decoded = try JSONDecoder().decode(AtlasSnapshot.self, from: Data(json.utf8))
      XCTAssertEqual(decoded.entryKind, kind)
    }
  }

  func testTheAttestationBodyKeepsTheKeysTheContractRequires() throws {
    let body = AtlasSnapshot.WorkflowAttestation(
      projectId: "p-1", name: "Exception triage", trigger: "new-case", inputs: [],
      steps: [.init(action: "Read the email", actor: "workflow", system: nil, app: "maps")],
      decisions: [],
      signOff: .init(role: "process_owner", email: "po@example.test"),
      complexity: "simple",
      testReport: .init(ranAt: "2026-10-30T09:00:00.000Z", cases: 1, wroteAnything: false, notes: "dry"),
      createdAt: "2026-10-30T09:00:00.000Z"
    )
    let data = try JSONEncoder().encode(body)
    let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]
    XCTAssertEqual(json?["contract"] as? String, "atlas-workflow-draft/1")
    let steps = json?["steps"] as? [[String: Any]]
    // A nil optional is written as null: Swift would otherwise omit the key and
    // the contract would refuse the body.
    XCTAssertTrue(steps?[0].keys.contains("system") ?? false)
    XCTAssertEqual(steps?[0]["app"] as? String, "maps")
    XCTAssertEqual((json?["testReport"] as? [String: Any])?["wroteAnything"] as? Bool, false)
  }
}
