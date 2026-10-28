import XCTest

@testable import AtlasDomain

/// A stub transport: the client is exercised end to end (URL building, headers,
/// encoding, status handling) without a server.
final class StubProtocol: URLProtocol {
  nonisolated(unsafe) static var handler: ((URLRequest) throws -> (Int, Data))?
  nonisolated(unsafe) static var seen: [String] = []

  override class func canInit(with request: URLRequest) -> Bool { true }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

  override func startLoading() {
    StubProtocol.seen.append("\(request.httpMethod ?? "GET") \(request.url?.path ?? "")")
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
    let id = try await client.onboardNew(name: "Invoice matching", process: true)
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
}
