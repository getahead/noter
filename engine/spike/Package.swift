// swift-tools-version:5.10
// The week-one spike (cpt-noter-flow-core-engine-foundation-spike): throwaway. A CLI that runs
// the engine's live audio source and WhisperKit Turbo, and a stand-in host app that spawns it
// as a sandboxed child, so the owner can answer Q4 (prompt attribution) and the latency budget.
// Not part of the engine build; see .plans/engine-spike-runbook.md.
import PackageDescription

let package = Package(
    name: "noter-spike",
    platforms: [.macOS("14.2")],
    dependencies: [
        .package(path: ".."),
        .package(url: "https://github.com/argmaxinc/WhisperKit", exact: "1.1.1"),
    ],
    targets: [
        .executableTarget(
            name: "noter-spike",
            dependencies: [
                .product(name: "NoterEngineKit", package: "engine"),
                .product(name: "WhisperKit", package: "WhisperKit"),
            ],
            linkerSettings: [
                .unsafeFlags(["-Xlinker", "-sectcreate", "-Xlinker", "__TEXT", "-Xlinker", "__info_plist", "-Xlinker", "Resources/Spike-Info.plist"])
            ]),
        .executableTarget(name: "SpikeHost"),
    ]
)
