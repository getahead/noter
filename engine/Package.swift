// swift-tools-version:5.10
// The Noter engine (`noter-engine`): audio capture and on-device speech, a sandboxed sidecar
// that speaks the JSON Lines protocol of `contracts/engine.schema.json` on stdio.
import PackageDescription

let package = Package(
    name: "noter-engine",
    // macOS 14.2 brings the Core Audio process taps the system channel needs.
    platforms: [.macOS("14.2")],
    products: [
        .executable(name: "noter-engine", targets: ["noter-engine"]),
        // For the week-one spike (engine/spike), which runs the engine's own live source.
        .library(name: "NoterEngineKit", targets: ["NoterEngineKit"]),
    ],
    targets: [
        .target(name: "NoterEngineKit"),
        .executableTarget(
            name: "noter-engine", dependencies: ["NoterEngineKit"],
            // The Info.plist goes inside the binary, so TCC prompts name the engine.
            linkerSettings: [
                .unsafeFlags(["-Xlinker", "-sectcreate", "-Xlinker", "__TEXT", "-Xlinker", "__info_plist", "-Xlinker", "Resources/Info.plist"])
            ]),
        .testTarget(name: "NoterEngineKitTests", dependencies: ["NoterEngineKit"]),
    ]
)
