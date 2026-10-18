// swift-tools-version:5.10
// The Noter engine (`noter-engine`): audio capture and on-device speech, a sandboxed sidecar
// that speaks the JSON Lines protocol of `contracts/engine.schema.json` on stdio.
import PackageDescription

let package = Package(
    name: "noter-engine",
    // macOS 14.2 brings the Core Audio process taps the system channel needs.
    platforms: [.macOS("14.2")],
    products: [.executable(name: "noter-engine", targets: ["noter-engine"])],
    targets: [
        .target(name: "NoterEngineKit"),
        .executableTarget(name: "noter-engine", dependencies: ["NoterEngineKit"]),
        .testTarget(name: "NoterEngineKitTests", dependencies: ["NoterEngineKit"]),
    ]
)
