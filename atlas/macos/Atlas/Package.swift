// swift-tools-version: 6.0
import PackageDescription

// The native macOS client for Atlas. One domain target (generated contract
// models plus the stage ladder), one thin app target, and tests that decode
// the SAME fixtures the web suite does.
//
// The client decides nothing about gates: lib/onboarding/routes.ts is the
// authority, and the server sends `canGate` and the missing requirements. This
// package holds the shapes and the vocabulary, not the policy.
let package = Package(
  name: "Atlas",
  platforms: [.macOS(.v14)],
  products: [.executable(name: "Atlas", targets: ["Atlas"])],
  targets: [
    .target(name: "AtlasDomain"),
    .executableTarget(name: "Atlas", dependencies: ["AtlasDomain"]),
    .testTarget(
      name: "AtlasDomainTests",
      dependencies: ["AtlasDomain"],
      resources: [.copy("Fixtures")]
    ),
  ]
)
