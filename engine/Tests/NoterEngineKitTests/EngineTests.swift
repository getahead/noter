import Foundation
import XCTest

@testable import NoterEngineKit

/// Collects what the engine writes to stdout, one decoded JSON object per line.
final class Lines: @unchecked Sendable {
    private let lock = NSLock()
    private var data = Data()

    func write(_ chunk: Data) {
        lock.lock()
        data.append(chunk)
        lock.unlock()
    }

    var objects: [[String: Any]] {
        lock.lock()
        defer { lock.unlock() }
        return String(decoding: data, as: UTF8.self)
            .split(separator: "\n")
            .compactMap { try? JSONSerialization.jsonObject(with: Data($0.utf8)) as? [String: Any] }
    }

    var events: [[String: Any]] { objects.compactMap { $0["event"] as? [String: Any] } }
    var types: [String] { events.compactMap { $0["type"] as? String } }

    func waitFor(_ type: String, timeout: TimeInterval = 5) -> [String: Any]? {
        let end = Date().addingTimeInterval(timeout)
        while Date() < end {
            if let e = events.first(where: { $0["type"] as? String == type }) { return e }
            Thread.sleep(forTimeInterval: 0.01)
        }
        return nil
    }
}

func writer(_ lines: Lines) -> EventWriter {
    EventWriter(clock: { 1_000 }, out: lines.write)
}

/// A WAV file of `seconds` at 16 kHz mono, PCM 16-bit or float 32-bit.
func wav(_ name: String, seconds: Double, amplitude: Float, float: Bool = false) throws -> URL {
    let rate = 16_000
    let n = Int(Double(rate) * seconds)
    let samples = (0..<n).map { i in amplitude * sin(Float(i) * 2 * .pi * 440 / Float(rate)) }
    let url = FileManager.default.temporaryDirectory.appendingPathComponent("\(UUID().uuidString)-\(name).wav")
    try WAV.encode(samples: samples, sampleRate: rate, float: float).write(to: url)
    return url
}

final class ProtocolTests: XCTestCase {
    func testCommandLinesDecodeAsTheCoreWritesThem() throws {
        let decode = { (s: String) in try JSONDecoder().decode(EngineCommandLine.self, from: Data(s.utf8)) }
        XCTAssertEqual(try decode(#"{"id":1,"cmd":{"type":"ping"}}"#), EngineCommandLine(id: 1, cmd: .ping))
        XCTAssertEqual(
            try decode(#"{"id":2,"cmd":{"type":"set_detection","enabled":false,"known_bundle_ids":["us.zoom.xos"]}}"#),
            EngineCommandLine(id: 2, cmd: .setDetection(enabled: false, knownBundleIds: ["us.zoom.xos"])))
        XCTAssertEqual(
            try decode(#"{"id":3,"cmd":{"type":"self_test","play_clip":true,"timeout_ms":10000}}"#),
            EngineCommandLine(id: 3, cmd: .selfTest(playClip: true, timeoutMs: 10_000)))
        XCTAssertEqual(try decode(#"{"id":4,"cmd":{"type":"shutdown"}}"#), EngineCommandLine(id: 4, cmd: .shutdown))
        XCTAssertEqual(
            try decode(#"{"id":5,"cmd":{"type":"stop","call_id":"call_1"}}"#),
            EngineCommandLine(id: 5, cmd: .other(type: "stop")))
        XCTAssertThrowsError(try decode(#"{"id":6}"#))
    }

    func testEventsEncodeAsTheCoreReadsThem() throws {
        let lines = Lines()
        let w = writer(lines)
        w.emit(.ready(protocolVersion: engineProtocolVersion, engineVersion: "0.1.0", models: [], sandboxed: true))
        w.emit(.error(cmdId: nil, code: .badCommand, message: "x"))
        w.emit(.selfTestResult(passed: false, failure: .zeroBuffers, ownSoundsLeak: false))
        let o = lines.objects
        XCTAssertEqual(o.map { $0["seq"] as? Int }, [1, 2, 3])
        XCTAssertEqual(o[0]["at"] as? Int, 1_000)
        XCTAssertEqual(lines.events[0]["protocol_version"] as? String, "2.0")
        XCTAssertEqual(lines.events[0]["sandboxed"] as? Bool, true)
        XCTAssertTrue(lines.events[1]["cmd_id"] is NSNull)
        XCTAssertEqual(lines.events[1]["code"] as? String, "bad_command")
        XCTAssertEqual(lines.types, ["ready", "error", "self_test_result"])
        XCTAssertEqual(lines.events[2]["failure"] as? String, "zero_buffers")
        XCTAssertEqual(lines.events[2]["own_sounds_leak"] as? Bool, false)
    }
}

final class SelfTestTests: XCTestCase {
    let loud = [Float](repeating: 0.2, count: 160)
    let zeros = [Float](repeating: 0, count: 160)

    func testBothChannelsWithSoundPass() {
        var m = SelfTestMonitor()
        XCTAssertEqual(m.feed(AudioChunk(channel: .mic, samples: loud)), [.selfTestStream(channel: .mic)])
        XCTAssertEqual(m.feed(AudioChunk(channel: .mic, samples: loud)), [])
        XCTAssertFalse(m.bothArrived)
        XCTAssertEqual(m.feed(AudioChunk(channel: .sys, samples: loud)), [.selfTestStream(channel: .sys)])
        XCTAssertTrue(m.bothArrived)
        XCTAssertEqual(m.result(modelsPresent: true), .selfTestResult(passed: true, failure: nil, ownSoundsLeak: false))
    }

    func testOnlyDigitalZerosOnSystemAudioIsZeroBuffers() {
        var m = SelfTestMonitor()
        _ = m.feed(AudioChunk(channel: .mic, samples: loud))
        _ = m.feed(AudioChunk(channel: .sys, samples: zeros))
        XCTAssertEqual(m.result(modelsPresent: true), .selfTestResult(passed: false, failure: .zeroBuffers, ownSoundsLeak: false))
    }

    func testNoBuffersAtAllIsDeviceUnavailable() {
        var m = SelfTestMonitor()
        _ = m.feed(AudioChunk(channel: .sys, samples: loud))
        XCTAssertEqual(m.result(modelsPresent: true), .selfTestResult(passed: false, failure: .deviceUnavailable, ownSoundsLeak: false))
    }

    func testAMissingLiveModelFails() {
        var m = SelfTestMonitor()
        _ = m.feed(AudioChunk(channel: .mic, samples: loud))
        _ = m.feed(AudioChunk(channel: .sys, samples: loud))
        XCTAssertEqual(m.result(modelsPresent: false), .selfTestResult(passed: false, failure: .modelMissing, ownSoundsLeak: false))
    }

    func testLevelsAreDecibelsWithAFloor() {
        XCTAssertEqual(Levels.db(zeros), -160)
        XCTAssertEqual(Levels.db([1, -1, 1, -1]), 0, accuracy: 0.001)
        XCTAssertEqual(Levels.db([0.1, -0.1]), -20, accuracy: 0.01)
    }
}

final class WAVTests: XCTestCase {
    func testReadsPCM16AndFloat32() throws {
        for float in [false, true] {
            let url = try wav("tone", seconds: 0.5, amplitude: 0.5, float: float)
            let audio = try WAV.read(url)
            XCTAssertEqual(audio.sampleRate, 16_000)
            XCTAssertEqual(audio.samples.count, 8_000)
            XCTAssertEqual(audio.samples.map(abs).max() ?? 0, 0.5, accuracy: 0.01)
        }
    }

    func testRejectsWhatIsNotAWAV() throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("\(UUID().uuidString).wav")
        try Data("not a wav".utf8).write(to: url)
        XCTAssertThrowsError(try WAV.read(url))
        XCTAssertThrowsError(try WAV.read(URL(fileURLWithPath: "/nonexistent.wav")))
    }
}

final class EngineLoopTests: XCTestCase {
    func engine(_ lines: Lines, source: AudioSource? = nil, models: [String] = ["whisper-turbo"]) -> EngineLoop {
        EngineLoop(writer: writer(lines), engineVersion: "test", models: models, sandboxed: false, source: { source })
    }

    func testAnswersTheM0Commands() {
        let lines = Lines()
        let e = engine(lines)
        e.start()
        XCTAssertTrue(e.handle(#"{"id":1,"cmd":{"type":"ping"}}"#))
        XCTAssertTrue(e.handle(#"{"id":2,"cmd":{"type":"set_detection","enabled":false,"known_bundle_ids":[]}}"#))
        XCTAssertTrue(e.handle(#"{"id":3,"cmd":{"type":"stop","call_id":"call_1"}}"#))
        XCTAssertTrue(e.handle("not json"))
        XCTAssertFalse(e.handle(#"{"id":4,"cmd":{"type":"shutdown"}}"#))
        XCTAssertEqual(lines.types, ["ready", "pong", "ack", "error", "error", "ack"])
        XCTAssertEqual(lines.events[1].count, 1, "pong carries only its type")
        XCTAssertEqual(lines.events[3]["cmd_id"] as? Int, 3)
        XCTAssertEqual(lines.events[3]["code"] as? String, "bad_command")
        XCTAssertTrue(lines.events[4]["cmd_id"] is NSNull)
        XCTAssertEqual(lines.events[5]["cmd_id"] as? Int, 4)
    }

    func testTheSelfTestStreamsArrivalThenItsResult() throws {
        let lines = Lines()
        let mic = try WAV.read(try wav("mic", seconds: 1, amplitude: 0.3))
        let sys = try WAV.read(try wav("sys", seconds: 1, amplitude: 0.3))
        let e = engine(lines, source: FileAudioSource(mic: mic, sys: sys, realtime: false))
        e.start()
        XCTAssertTrue(e.handle(#"{"id":7,"cmd":{"type":"self_test","play_clip":false,"timeout_ms":2000}}"#))
        let result = try XCTUnwrap(lines.waitFor("self_test_result"))
        XCTAssertEqual(result["passed"] as? Bool, true)
        let types = lines.types
        XCTAssertEqual(types.prefix(2), ["ready", "ack"])
        XCTAssertEqual(types.filter { $0 == "self_test_stream" }.count, 2)
        XCTAssertTrue(types.contains("levels"))
        XCTAssertEqual(types.last, "self_test_result")
    }

    func testTheSelfTestTimesOutWithoutAnAudioSource() throws {
        let lines = Lines()
        let e = engine(lines, source: nil)
        e.start()
        _ = e.handle(#"{"id":8,"cmd":{"type":"self_test","play_clip":false,"timeout_ms":100}}"#)
        let result = try XCTUnwrap(lines.waitFor("self_test_result"))
        XCTAssertEqual(result["passed"] as? Bool, false)
        XCTAssertEqual(result["failure"] as? String, "device_unavailable")
    }
}

final class FileModeTests: XCTestCase {
    func testReplaysAWAVPairAndEndsWithSessionStopped() throws {
        let lines = Lines()
        let mic = try wav("mic", seconds: 1, amplitude: 0.3)
        let sys = try wav("sys", seconds: 1, amplitude: 0.1)
        let code = FileMode(mic: mic, sys: sys, realtime: false).run(writer: writer(lines), engineVersion: "test")
        XCTAssertEqual(code, 0)
        let types = lines.types
        XCTAssertEqual(types.first, "ready")
        XCTAssertEqual(types.filter { $0 == "levels" }.count, 10, "one per 100 ms of file time")
        XCTAssertEqual(types.last, "session_stopped")
        let stopped = try XCTUnwrap(lines.events.last)
        XCTAssertEqual(stopped["mic_path"] as? String, mic.path)
        XCTAssertEqual(stopped["sys_path"] as? String, sys.path)
        let levels = try XCTUnwrap(lines.events.first { $0["type"] as? String == "levels" })
        XCTAssertEqual(levels["mic_db"] as? Double ?? 0, -13.5, accuracy: 0.5)
    }

    func testCommandsAreServedOnlyAfterReady() throws {
        let lines = Lines()
        let mic = try wav("mic", seconds: 0.3, amplitude: 0.3)
        let sys = try wav("sys", seconds: 0.3, amplitude: 0.1)
        var servedAfter: [String] = []
        _ = FileMode(mic: mic, sys: sys, realtime: false)
            .run(writer: writer(lines), engineVersion: "test") { servedAfter = lines.types }
        XCTAssertEqual(servedAfter, ["ready"])
    }

    func testAMissingFileIsDeviceUnavailable() throws {
        let lines = Lines()
        let sys = try wav("sys", seconds: 0.2, amplitude: 0.1)
        let code = FileMode(mic: URL(fileURLWithPath: "/nonexistent/mic.wav"), sys: sys, realtime: false)
            .run(writer: writer(lines), engineVersion: "test")
        XCTAssertNotEqual(code, 0)
        XCTAssertEqual(lines.types, ["error"])
        XCTAssertEqual(lines.events[0]["code"] as? String, "device_unavailable")
    }

    func testASilentSystemFileFailsTheSelfTestWithZeroBuffers() throws {
        let lines = Lines()
        let mic = try WAV.read(try wav("mic", seconds: 0.5, amplitude: 0.3))
        let sys = try WAV.read(try wav("sys", seconds: 0.5, amplitude: 0))
        let e = EngineLoop(
            writer: writer(lines), engineVersion: "test", models: ["whisper-turbo"], sandboxed: false,
            source: { FileAudioSource(mic: mic, sys: sys, realtime: false) })
        _ = e.handle(#"{"id":1,"cmd":{"type":"self_test","play_clip":false,"timeout_ms":300}}"#)
        let result = try XCTUnwrap(lines.waitFor("self_test_result"))
        XCTAssertEqual(result["failure"] as? String, "zero_buffers")
    }

    func testArguments() {
        XCTAssertEqual(
            Arguments.parse(["--mic", "a.wav", "--sys", "b.wav", "--fast"]),
            .file(mic: URL(fileURLWithPath: "a.wav"), sys: URL(fileURLWithPath: "b.wav"), realtime: false))
        XCTAssertEqual(
            Arguments.parse(["--mic", "a.wav", "--sys", "b.wav"]),
            .file(mic: URL(fileURLWithPath: "a.wav"), sys: URL(fileURLWithPath: "b.wav"), realtime: true))
        XCTAssertEqual(Arguments.parse([]), .live)
        XCTAssertEqual(Arguments.parse(["--mic", "a.wav"]), .invalid("file mode needs both --mic and --sys"))
        XCTAssertEqual(Arguments.parse(["--bogus"]), .invalid("unknown argument --bogus"))
    }
}
