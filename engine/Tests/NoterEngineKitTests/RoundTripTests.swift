import Foundation
import XCTest

@testable import NoterEngineKit

/// Every example line of the protocol as noter-protocol's serde writes them, generated into
/// `contracts/fixtures/engine-lines.json` by `just contract-regen`. The hand-written Swift types are
/// checked against them (D13), so the Rust source of truth, not the Swift side, says what a line is.
private let fixture: [String: [[String: Any]]] = {
    let url = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        .appendingPathComponent("contracts/fixtures/engine-lines.json")
    let json = try? JSONSerialization.jsonObject(with: Data(contentsOf: url))
    return json as? [String: [[String: Any]]] ?? [:]
}()

private func typeOf(_ line: [String: Any], _ key: String) -> String {
    (line[key] as? [String: Any])?["type"] as? String ?? ""
}

private func object(_ data: Data) throws -> NSDictionary {
    NSDictionary(dictionary: try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any]))
}

// The directions the engine itself never needs (it reads commands and writes events), test-only,
// so that every fixture line goes through the Swift types both ways.

extension EngineCommandLine: Encodable {
    private enum Keys: String, CodingKey { case id, cmd }
    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: Keys.self)
        try c.encode(id, forKey: .id)
        try c.encode(cmd, forKey: .cmd)
    }
}

extension EngineCommand: Encodable {
    private enum Keys: String, CodingKey { case type, enabled, known_bundle_ids, play_clip, timeout_ms }
    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: Keys.self)
        switch self {
        case .ping: try c.encode("ping", forKey: .type)
        case .shutdown: try c.encode("shutdown", forKey: .type)
        case let .setDetection(enabled, knownBundleIds):
            try c.encode("set_detection", forKey: .type)
            try c.encode(enabled, forKey: .enabled)
            try c.encode(knownBundleIds, forKey: .known_bundle_ids)
        case let .selfTest(playClip, timeoutMs):
            try c.encode("self_test", forKey: .type)
            try c.encode(playClip, forKey: .play_clip)
            try c.encode(timeoutMs, forKey: .timeout_ms)
        case let .other(type):
            throw EncodingError.invalidValue(type, .init(codingPath: [], debugDescription: "a command the engine does not answer"))
        }
    }
}

/// An event type the engine does not write yet (capture, offline, embeddings: M1 and later).
private struct NotWritten: Error {}

extension EngineEvent: Decodable {
    private enum Keys: String, CodingKey {
        case type, protocol_version, engine_version, models, sandboxed, cmd_id, code, message, call_id, mic_db, sys_db
        case channel, passed, failure, own_sounds_leak, timeline_path, mic_path, sys_path
    }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Keys.self)
        switch try c.decode(String.self, forKey: .type) {
        case "ready":
            self = .ready(
                protocolVersion: try c.decode(String.self, forKey: .protocol_version),
                engineVersion: try c.decode(String.self, forKey: .engine_version),
                models: try c.decode([String].self, forKey: .models), sandboxed: try c.decode(Bool.self, forKey: .sandboxed))
        case "ack": self = .ack(cmdId: try c.decode(UInt64.self, forKey: .cmd_id))
        case "error":
            self = .error(
                cmdId: try c.decode(UInt64?.self, forKey: .cmd_id), code: try c.decode(EngineErrorCode.self, forKey: .code),
                message: try c.decode(String.self, forKey: .message))
        case "pong": self = .pong
        case "levels":
            self = .levels(
                callId: try c.decode(String?.self, forKey: .call_id), micDb: try c.decode(Float.self, forKey: .mic_db),
                sysDb: try c.decode(Float.self, forKey: .sys_db))
        case "self_test_stream": self = .selfTestStream(channel: try c.decode(Channel.self, forKey: .channel))
        case "self_test_result":
            self = .selfTestResult(
                passed: try c.decode(Bool.self, forKey: .passed), failure: try c.decode(EngineErrorCode?.self, forKey: .failure),
                ownSoundsLeak: try c.decode(Bool.self, forKey: .own_sounds_leak))
        case "session_stopped":
            self = .sessionStopped(
                callId: try c.decode(String.self, forKey: .call_id), timelinePath: try c.decode(String.self, forKey: .timeline_path),
                micPath: try c.decode(String?.self, forKey: .mic_path), sysPath: try c.decode(String?.self, forKey: .sys_path))
        default: throw NotWritten()
        }
    }
}

/// The event line as `EventWriter` writes it.
private struct EventLine: Codable {
    let seq: UInt64
    let at: Int64
    let event: EngineEvent
}

final class RoundTripTests: XCTestCase {
    func testEveryFixtureCommandDecodesAndEveryAnsweredOneReencodesEqual() throws {
        let lines = try XCTUnwrap(fixture["commands"], "the engine-lines fixture has commands")
        var answered: [String] = []
        for line in lines {
            let type = typeOf(line, "cmd")
            let data = try JSONSerialization.data(withJSONObject: line)
            let decoded = try JSONDecoder().decode(EngineCommandLine.self, from: data)
            if decoded.cmd == .other(type: type) { continue } // refused with bad_command
            answered.append(type)
            XCTAssertEqual(try object(JSONEncoder().encode(decoded)), try object(data), type)
        }
        // The commands the engine answers: each has a fixture line, and none decoded as `.other`.
        XCTAssertEqual(answered.sorted(), ["ping", "self_test", "set_detection", "shutdown"])
    }

    func testEveryFixtureEventTheEngineWritesDecodesAndReencodesEqual() throws {
        let lines = try XCTUnwrap(fixture["events"], "the engine-lines fixture has events")
        var written: [String] = []
        for line in lines {
            let type = typeOf(line, "event")
            let data = try JSONSerialization.data(withJSONObject: line)
            let decoded: EventLine
            do {
                decoded = try JSONDecoder().decode(EventLine.self, from: data)
            } catch is NotWritten {
                continue
            }
            written.append(type)
            XCTAssertEqual(try object(JSONEncoder().encode(decoded)), try object(data), type)
        }
        // Every case of `EngineEvent` has a fixture line.
        XCTAssertEqual(
            written.sorted(),
            ["ack", "error", "levels", "pong", "ready", "self_test_result", "self_test_stream", "session_stopped"])
    }

    func testEventWriterWritesTheLineShapeOfTheFixture() throws {
        let lines = Lines()
        EventWriter(clock: { 1_790_000_000_000 }, out: lines.write).emit(.pong)
        let pong = try XCTUnwrap(fixture["events"]?.first { typeOf($0, "event") == "pong" })
        XCTAssertEqual(Set(try XCTUnwrap(lines.objects.first).keys), Set(pong.keys))
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
