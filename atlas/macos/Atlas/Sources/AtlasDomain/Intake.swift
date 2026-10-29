import Foundation

/// A PATCH body value: the API takes a flat `fields` object of strings and booleans.
public enum FieldValue: Codable, Equatable, Sendable {
  case string(String)
  case bool(Bool)
  case null

  public func encode(to encoder: Encoder) throws {
    var container = encoder.singleValueContainer()
    switch self {
    case .string(let value): try container.encode(value)
    case .bool(let value): try container.encode(value)
    case .null: try container.encodeNil()
    }
  }

  public init(from decoder: Decoder) throws {
    let container = try decoder.singleValueContainer()
    if container.decodeNil() {
      self = .null
    } else if let value = try? container.decode(Bool.self) {
      self = .bool(value)
    } else {
      self = .string(try container.decode(String.self))
    }
  }
}

/// The intake facts the app may edit — the same editable set the web lane uses.
/// The facts that prove a hand-off (OS link, Vision delivery, Studio record)
/// are absent on purpose: the server refuses them from a save.
public struct IntakeDraft: Equatable, Sendable {
  public var classificationDeclared: Bool
  public var classification: String
  public var problem: String
  public var requester: String
  public var functionArea: String
  public var site: String
  public var objective: String
  public var successMeasure: String
  public var volume: String
  public var frequency: String
  public var teoaScopeId: String
  public var visionObjectiveId: String
  public var asIsMapRef: String
  public var asIsSignedOff: Bool
  public var toBeMapRef: String
  public var buildDecision: String
  public var operatorBundleRef: String
  public var retireReason: String

  public init(
    classificationDeclared: Bool = false,
    classification: String = "",
    problem: String = "",
    requester: String = "",
    functionArea: String = "",
    site: String = "",
    objective: String = "",
    successMeasure: String = "",
    volume: String = "",
    frequency: String = "",
    teoaScopeId: String = "",
    visionObjectiveId: String = "",
    asIsMapRef: String = "",
    asIsSignedOff: Bool = false,
    toBeMapRef: String = "",
    buildDecision: String = "",
    operatorBundleRef: String = "",
    retireReason: String = ""
  ) {
    self.classificationDeclared = classificationDeclared
    self.classification = classification
    self.problem = problem
    self.requester = requester
    self.functionArea = functionArea
    self.site = site
    self.objective = objective
    self.successMeasure = successMeasure
    self.volume = volume
    self.frequency = frequency
    self.teoaScopeId = teoaScopeId
    self.visionObjectiveId = visionObjectiveId
    self.asIsMapRef = asIsMapRef
    self.asIsSignedOff = asIsSignedOff
    self.toBeMapRef = toBeMapRef
    self.buildDecision = buildDecision
    self.operatorBundleRef = operatorBundleRef
    self.retireReason = retireReason
  }

  /// The fields to send. Empty strings are sent as "" so a person can clear a
  /// value; `classification` is sent only when one was declared, because the
  /// schema refuses a declared class with no class.
  public var fields: [String: FieldValue] {
    var body: [String: FieldValue] = [
      "classificationDeclared": .bool(classificationDeclared),
      "problem": .string(problem),
      "requester": .string(requester),
      "functionArea": .string(functionArea),
      "site": .string(site),
      "objective": .string(objective),
      "successMeasure": .string(successMeasure),
      "volume": .string(volume),
      "frequency": .string(frequency),
      "teoaScopeId": .string(teoaScopeId),
      "visionObjectiveId": .string(visionObjectiveId),
      "asIsMapRef": .string(asIsMapRef),
      "asIsSignedOff": .bool(asIsSignedOff),
      "toBeMapRef": .string(toBeMapRef),
      // An enum field is either a value or null: the schema refuses "".
      "buildDecision": buildDecision.isEmpty ? .null : .string(buildDecision),
      "operatorBundleRef": .string(operatorBundleRef),
      "retireReason": .string(retireReason),
    ]
    if classificationDeclared, !classification.isEmpty {
      body["classification"] = .string(classification)
    }
    return body
  }
}
