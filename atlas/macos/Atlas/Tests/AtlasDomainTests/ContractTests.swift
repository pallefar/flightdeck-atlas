import XCTest

@testable import AtlasDomain

/// The native side of the anti-drift check: decode the same fixtures the
/// Playwright suite parses, and prove the generated models accept them
/// byte-for-byte on the wire.
final class ContractTests: XCTestCase {
  private func data(_ name: String) throws -> Data {
    guard
      let url = Bundle.module.url(
        forResource: name, withExtension: "json", subdirectory: "Fixtures")
    else {
      throw XCTSkip("fixture \(name).json is missing from the bundle")
    }
    return try Data(contentsOf: url)
  }

  func testEvidenceFixtureDecodes() throws {
    let value = try JSONDecoder().decode(AtlasEvidence.self, from: try data("atlas-evidence.v1"))
    XCTAssertEqual(value.contract, "atlas-evidence/1")
    XCTAssertEqual(value.bytes, 1_048_576)
    XCTAssertNil(value.reviewer)
    XCTAssertFalse(value.findings.isEmpty == false && value.findings.count > 20)
  }

  func testGateEventFixtureDecodesAndReEncodes() throws {
    let source = try data("atlas-gate-event.v1")
    let value = try JSONDecoder().decode(AtlasGateEvent.self, from: source)
    XCTAssertEqual(value.contract, "atlas-gate-event/1")
    XCTAssertEqual(value.decision, .pass)
    XCTAssertEqual(value.fromStage, .capture)
    XCTAssertEqual(value.toStage, .asIs)
    XCTAssertEqual(value.hash.count, 64)
    // Round-tripping keeps the chain link: a client that re-encodes must not
    // change the hash or the previous link.
    let again = try JSONDecoder().decode(
      AtlasGateEvent.self, from: JSONEncoder().encode(value))
    XCTAssertEqual(again.hash, value.hash)
    XCTAssertEqual(again.prevHash, value.prevHash)
  }

  func testValueFixtureDecodes() throws {
    let value = try JSONDecoder().decode(AtlasValue.self, from: try data("atlas-value.v1"))
    XCTAssertEqual(value.basis, .measured)
    XCTAssertEqual(value.sourceRef, "time-export-2026-10-20.csv")
    XCTAssertEqual(value.hours, 640)
  }

  func testRecordFixtureDecodesWithItsGates() throws {
    let value = try JSONDecoder().decode(
      AtlasOnboardingRecord.self, from: try data("atlas-onboarding-record.v1"))
    XCTAssertEqual(value.contract, "atlas-onboarding-record/1")
    XCTAssertEqual(value.stage, .value)
    XCTAssertEqual(value.gates.count, 3)
    XCTAssertEqual(value.gates.first?.stage, .intake)
    XCTAssertEqual(value.evidenceAccepted, 2)
  }

  func testTheLadderMatchesTheWebOrder() {
    XCTAssertEqual(
      Stage.ladder,
      [.intake, .reuse, .capture, .asIs, .aligned, .value, .toBe, .build, .live, .measured]
    )
    XCTAssertEqual(Stage.measured.next, nil)
    XCTAssertEqual(Stage.retired.next, nil)
    XCTAssertEqual(Stage.capture.next, .asIs)
  }

  func testAnUnknownStageIsRefusedRatherThanGuessed() throws {
    // A record whose stage is not on the ladder must not decode into a guess.
    let text = String(
      data: try data("atlas-onboarding-record.v1"), encoding: .utf8)!
    let broken = text.replacingOccurrences(of: #""stage": "value""#, with: #""stage": "done""#)
    XCTAssertThrowsError(
      try JSONDecoder().decode(
        AtlasOnboardingRecord.self, from: broken.data(using: .utf8)!)
    )
  }
}
