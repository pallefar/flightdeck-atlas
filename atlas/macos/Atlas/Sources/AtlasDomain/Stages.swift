import Foundation

/// The onboarding ladder, mirroring lib/domain/stages.ts.
///
/// Only the NAMES and the order live here. Which gate a person may pass, and
/// what a stage still requires, are decided by the Atlas server and arrive in
/// the project view (`canGate`, `stage.missing`), so a client can never invent
/// an approval the audit chain would not have.
public enum Stage: String, Codable, CaseIterable, Sendable {
  case intake
  case reuse
  case capture
  case asIs = "as-is"
  case aligned
  case value
  case toBe = "to-be"
  case build
  case live
  case measured
  case retired

  /// The one forward step, or nil at the end and after retirement.
  public var next: Stage? {
    switch self {
    case .intake: return .reuse
    case .reuse: return .capture
    case .capture: return .asIs
    case .asIs: return .aligned
    case .aligned: return .value
    case .value: return .toBe
    case .toBe: return .build
    case .build: return .live
    case .live: return .measured
    case .measured, .retired: return nil
    }
  }

  /// A human-readable name for the app's own chrome. The web app translates
  /// these; the native client reads the server's words for everything else.
  public var title: String {
    switch self {
    case .intake: return "Intake"
    case .reuse: return "Reuse check"
    case .capture: return "Capture"
    case .asIs: return "As-is mapped"
    case .aligned: return "Aligned"
    case .value: return "Value baseline"
    case .toBe: return "To-be + decision"
    case .build: return "Build"
    case .live: return "Live"
    case .measured: return "Measured"
    case .retired: return "Retired"
    }
  }

  /// The ladder without the terminal state, in order.
  public static var ladder: [Stage] {
    allCases.filter { $0 != .retired }
  }
}
