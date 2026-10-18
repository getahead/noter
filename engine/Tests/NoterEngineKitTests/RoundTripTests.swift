import Foundation
import XCTest

@testable import NoterEngineKit

/// Lines exactly as noter-protocol's serde writes them (`EngineCommandLine`, `EngineEventLine`
/// from crates/noter-protocol/src/engine.rs, printed with serde_json), so the Swift side is
/// checked against the Rust source of truth, not against itself.
private let rustCommands = [
    #"{"id":1,"cmd":{"type":"ping"}}"#,
    #"{"id":2,"cmd":{"type":"set_detection","enabled":true,"known_bundle_ids":["us.zoom.xos"]}}"#,
    #"{"id":3,"cmd":{"type":"self_test","play_clip":false,"timeout_ms":10000}}"#,
    #"{"id":4,"cmd":{"type":"shutdown"}}"#,
    #"{"id":5,"cmd":{"type":"stop","call_id":"call_1"}}"#,
]

private let rustEvents = [
    #"{"seq":1,"at":1790000000000,"event":{"type":"ready","protocol_version":"2.0","engine_version":"0.1.0","models":["whisper-turbo"],"sandboxed":true}}"#,
    #"{"seq":2,"at":1790000000000,"event":{"type":"ack","cmd_id":2}}"#,
    #"{"seq":3,"at":1790000000000,"event":{"type":"error","cmd_id":null,"code":"device_unavailable","message":"mic.wav"}}"#,
    #"{"seq":4,"at":1790000000000,"event":{"type":"pong"}}"#,
    #"{"seq":5,"at":1790000000000,"event":{"type":"levels","call_id":null,"mic_db":-20.5,"sys_db":-160.0}}"#,
    #"{"seq":6,"at":1790000000000,"event":{"type":"self_test_stream","channel":"sys"}}"#,
    #"{"seq":7,"at":1790000000000,"event":{"type":"self_test_result","passed":false,"failure":"zero_buffers","own_sounds_leak":false}}"#,
    #"{"seq":8,"at":1790000000000,"event":{"type":"session_stopped","call_id":"call_file","timeline_path":"","mic_path":"mic.wav","sys_path":null}}"#,
]

final class RoundTripTests: XCTestCase {
    func testRustCommandLinesDecode() throws {
        let decoded = try rustCommands.map { try JSONDecoder().decode(EngineCommandLine.self, from: Data($0.utf8)) }
        XCTAssertEqual(
            decoded.map(\.cmd),
            [
                .ping, .setDetection(enabled: true, knownBundleIds: ["us.zoom.xos"]),
                .selfTest(playClip: false, timeoutMs: 10_000), .shutdown, .other(type: "stop"),
            ])
        XCTAssertEqual(decoded.map(\.id), [1, 2, 3, 4, 5])
    }

    func testSwiftEventsEncodeAsRustWritesThem() throws {
        let lines = Lines()
        let w = EventWriter(clock: { 1_790_000_000_000 }, out: lines.write)
        let events: [EngineEvent] = [
            .ready(protocolVersion: engineProtocolVersion, engineVersion: "0.1.0", models: ["whisper-turbo"], sandboxed: true),
            .ack(cmdId: 2),
            .error(cmdId: nil, code: .deviceUnavailable, message: "mic.wav"),
            .pong,
            .levels(callId: nil, micDb: -20.5, sysDb: -160),
            .selfTestStream(channel: .sys),
            .selfTestResult(passed: false, failure: .zeroBuffers, ownSoundsLeak: false),
            .sessionStopped(callId: "call_file", timelinePath: "", micPath: "mic.wav", sysPath: nil),
        ]
        events.forEach(w.emit)
        let ours = lines.objects.map { NSDictionary(dictionary: $0) }
        let theirs = try rustEvents.map {
            NSDictionary(dictionary: try XCTUnwrap(JSONSerialization.jsonObject(with: Data($0.utf8)) as? [String: Any]))
        }
        XCTAssertEqual(ours.count, theirs.count)
        for (i, (a, b)) in zip(ours, theirs).enumerated() {
            XCTAssertEqual(a, b, "line \(i + 1)")
        }
    }
}

final class ModelsTests: XCTestCase {
    func testInstalledModelsComeFromTheAppGroupContainer() throws {
        let container = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let models = container.appendingPathComponent("models")
        try FileManager.default.createDirectory(at: models, withIntermediateDirectories: true)
        // A download in progress (the core writes <name>.partial) is not an installed model.
        for name in ["whisper-turbo", "bge-m3", ".partial-junk", "fluid-audio.partial"] {
            FileManager.default.createFile(atPath: models.appendingPathComponent(name).path, contents: Data())
        }
        let env = ["NOTER_APP_GROUP_DIR": container.path]
        XCTAssertEqual(Models.installed(container: Models.container(environment: env)), ["bge-m3", "whisper-turbo"])
        XCTAssertEqual(Models.installed(container: Models.container(environment: [:])), [])
    }

    func testFileModeReportsTheInstalledModelsSoItsSelfTestCanPass() throws {
        let lines = Lines()
        let mic = try wav("mic", seconds: 0.2, amplitude: 0.3)
        let sys = try wav("sys", seconds: 0.2, amplitude: 0.1)
        _ = FileMode(mic: mic, sys: sys, realtime: false)
            .run(writer: writer(lines), engineVersion: "test", models: ["whisper-turbo"])
        XCTAssertEqual(lines.events.first?["models"] as? [String], ["whisper-turbo"])
    }
}
