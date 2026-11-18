// swift-tools-version:5.10
// The Noter engine (`noter-engine`): audio capture and on-device speech, a sandboxed sidecar
// that speaks the JSON Lines protocol of `contracts/engine.schema.json` on stdio.
import PackageDescription

let package = Package(
    name: "noter-engine",
    // The supported process-tap capture and System Audio Recording boundary (PRD, Audio capture).
    platforms: [.macOS("14.4")],
    products: [.executable(name: "noter-engine", targets: ["noter-engine"])],
    // Pinned by revision (the M1 engine spec): a moved tag never changes what the engine runs.
    dependencies: [
        .package(url: "https://github.com/argmaxinc/WhisperKit", revision: "1bbc57cb7fe6410248a685b1c5a3c6d56adc2ed4")
    ],
    targets: [
        .target(name: "NoterEngineKit", dependencies: [.product(name: "WhisperKit", package: "WhisperKit")]),
        .executableTarget(
            name: "noter-engine", dependencies: ["NoterEngineKit"],
            // The Info.plist goes inside the binary, so TCC prompts name the engine.
            linkerSettings: [
                .unsafeFlags(["-Xlinker", "-sectcreate", "-Xlinker", "__TEXT", "-Xlinker", "__info_plist", "-Xlinker", "Resources/Info.plist"])
            ]),
        .testTarget(name: "NoterEngineKitTests", dependencies: ["NoterEngineKit"]),
    ]
)
