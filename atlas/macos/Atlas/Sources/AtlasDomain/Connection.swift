import Foundation

/// Where the app points at, and the token it sends.
///
/// The token is stored in the Keychain, not in UserDefaults: it is a
/// credential, and the native equivalent of Atlas's "never in the browser"
/// rule is "never in a plist".
public struct AtlasConnection: Codable, Equatable, Sendable {
  public var baseURL: String
  public var hasToken: Bool
  public var lastChecked: String?

  // `localhost`, not 127.0.0.1: the Atlas dev server listens on IPv6
  // loopback, and a literal IPv4 address is refused on this machine.
  public static let empty = AtlasConnection(baseURL: "http://localhost:5173", hasToken: false, lastChecked: nil)

  /// Development only: a terminal launch may point the app at a server and
  /// hand it a device token without going through Settings. The token lives in
  /// memory for that launch only; it is never written to preferences, and a
  /// normal launch (Finder, Dock) never sees it.
  public static func developmentOverride() -> (baseURL: String?, token: String?) {
    let environment = ProcessInfo.processInfo.environment
    let url = environment["ATLAS_BASE_URL"].flatMap { $0.isEmpty ? nil : $0 }
    let token = environment["ATLAS_DEVICE_TOKEN"].flatMap { $0.isEmpty ? nil : $0 }
    return (url, token)
  }

  public var url: URL? { URL(string: baseURL) }

  public static func load() -> AtlasConnection {
    if let override = developmentOverride().baseURL {
      var value = AtlasConnection.empty
      value.baseURL = override
      value.hasToken = developmentOverride().token != nil || Keychain.load(.token) != nil
      return value
    }
    guard let data = UserDefaults.standard.data(forKey: "atlas.connection"),
          let value = try? JSONDecoder().decode(AtlasConnection.self, from: data)
    else { return .empty }
    var copy = value
    copy.hasToken = Keychain.load(.token) != nil
    return copy
  }

  public func save() {
    if let data = try? JSONEncoder().encode(self) {
      UserDefaults.standard.set(data, forKey: "atlas.connection")
    }
  }

  public func client() -> AtlasClient? {
    let override = AtlasConnection.developmentOverride()
    guard let target = override.baseURL.flatMap(URL.init(string:)) ?? url else { return nil }
    return AtlasClient(baseURL: target, token: override.token ?? Keychain.load(.token))
  }
}

/// The smallest Keychain wrapper that does the job: one generic-password item.
public enum Keychain {
  public enum Key: String {
    case token = "com.flightdeck.atlas.token"
  }

  public static func save(_ value: String, for key: Key) {
    let data = Data(value.utf8)
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrAccount as String: key.rawValue,
    ]
    SecItemDelete(query as CFDictionary)
    var add = query
    add[kSecValueData as String] = data
    add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
    SecItemAdd(add as CFDictionary, nil)
  }

  public static func load(_ key: Key) -> String? {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrAccount as String: key.rawValue,
      kSecReturnData as String: true,
      kSecMatchLimit as String: kSecMatchLimitOne,
    ]
    var item: CFTypeRef?
    guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
          let data = item as? Data
    else { return nil }
    return String(data: data, encoding: .utf8)
  }

  public static func delete(_ key: Key) {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrAccount as String: key.rawValue,
    ]
    SecItemDelete(query as CFDictionary)
  }
}
