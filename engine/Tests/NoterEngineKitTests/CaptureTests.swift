import AVFoundation
import Foundation
import XCTest

@testable import NoterEngineKit

/// An audio source the test drives: `push` delivers chunks as the taps would.
final class FakeSource: AudioSource, @unchecked Sendable {
    private let lock = NSLock()
    private var onChunk: (@Sendable (AudioChunk) -> Void)?
    private(set) var starts = 0
    private(set) var stops = 0
    var failStart = false

    func start(_ onChunk: @escaping @Sendable (AudioChunk) -> Void) throws {
        if failStart { throw LiveAudioSource.Failure(description: "no tap") }
        lock.withLock {
            self.onChunk = onChunk
            starts += 1
        }
    }

    func stop() {
        lock.withLock {
            onChunk = nil
            stops += 1
        }
    }

    var devices: (mic: String, output: String) { ("Test Mic", "Test Speakers") }

    /// `ms` of a 440 Hz tone on both channels at 16 kHz, in 100 ms chunks.
    func push(ms: Int, amplitude: Float = 0.3) {
        let deliver = lock.withLock { onChunk }
        for _ in 0..<(ms / 100) {
            let samples = (0..<1600).map { i in amplitude * sin(Float(i) * 2 * .pi * 440 / 16_000) }
            deliver?(AudioChunk(channel: .mic, samples: samples))
            deliver?(AudioChunk(channel: .sys, samples: samples))
        }
    }

    /// `chunks` IO cycles of 512 frames at 48 kHz on both channels, as a live device delivers them.
    func pushDevice(chunks: Int) {
        let deliver = lock.withLock { onChunk }
        let samples = (0..<512).map { i in 0.3 * sin(Float(i) * 2 * .pi * 440 / 48_000) }
        for _ in 0..<chunks {
            deliver?(AudioChunk(channel: .mic, samples: samples, sampleRate: 48_000))
            deliver?(AudioChunk(channel: .sys, samples: samples, sampleRate: 48_000))
        }
    }
}

/// A clock the test moves (epoch milliseconds).
final class TestClock: @unchecked Sendable {
    private let lock = NSLock()
    private var ms: Int64 = 1_790_000_000_000
    func now() -> Int64 { lock.withLock { ms } }
    func advance(_ by: Int64) { lock.withLock { ms += by } }
}

/// An encoder that fails on its first write (a full disk).
struct FullDisk: AudioEncoder {
    func append(_ samples: [Float]) throws { throw CocoaError(.fileWriteOutOfSpace) }
    func finish() {}
}

private func container() throws -> URL {
    let url = FileManager.default.temporaryDirectory.appendingPathComponent("noter-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    return url
}

private func startLine(id: Int, store: Bool = true, resumeFrom: Int? = nil) -> String {
    let resume = resumeFrom.map(String.init) ?? "null"
    return #"{"id":\#(id),"cmd":{"type":"start_session","call_id":"call_1","session_dir":"audio/call_1","store_audio":\#(store),"mic_device_uid":null,"exclude_bundle_ids":[],"languages":["en"],"backend":"whisper_turbo","glossary":[],"speaker_priors":[],"enrolled_embeddings_path":null,"resume_from_ms":\#(resume)}}"#
}

private func timeline(_ root: URL) throws -> [String: Any] {
    let data = try Data(contentsOf: root.appendingPathComponent("audio/call_1/timeline.json"))
    return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
}

private func gaps(_ t: [String: Any]) -> [[String: Any]] { t["gaps"] as? [[String: Any]] ?? [] }

private func seconds(_ url: URL) throws -> Double {
    let file = try AVAudioFile(forReading: url)
    return Double(file.length) / file.fileFormat.sampleRate
}

/// The file holds `audio` seconds, plus at most one AAC encoder delay per engine run's part,
/// less at most one unfinished packet per crashed run.
private func assertAudio(_ url: URL, _ audio: Double, parts: Int = 1, line: UInt = #line) throws {
    let s = try seconds(url)
    XCTAssertGreaterThanOrEqual(s, audio - 0.13 * Double(parts - 1), line: line)
    XCTAssertLessThanOrEqual(s, audio + 0.2 * Double(parts), line: line)
}

final class CaptureTests: XCTestCase {
    private func engine(
        _ lines: Lines, _ source: FakeSource, _ root: URL, _ clock: TestClock,
        encoder: ((URL) throws -> AudioEncoder)? = nil
    ) -> EngineLoop {
        let e = EngineLoop(
            writer: writer(lines), engineVersion: "test", models: ["whisper-turbo"], sandboxed: false,
            container: root, now: clock.now, encoder: encoder ?? { try ADTSEncoder(url: $0) }, source: { _ in source })
        e.start()
        return e
    }

    func testASessionStartsCapturesWithLevelsAndStopsWithItsFiles() throws {
        let (lines, source, root, clock) = (Lines(), FakeSource(), try container(), TestClock())
        let e = engine(lines, source, root, clock)
        XCTAssertTrue(e.handle(startLine(id: 1)))
        let started = try XCTUnwrap(lines.waitFor("session_started"))
        XCTAssertEqual(started["call_id"] as? String, "call_1")
        XCTAssertEqual(started["mic_device"] as? String, "Test Mic")
        XCTAssertEqual(started["output_device"] as? String, "Test Speakers")
        source.push(ms: 1000)
        let levels = lines.events.filter { $0["type"] as? String == "levels" }
        XCTAssertEqual(levels.count, 10, "one per 100 ms of audio")
        XCTAssertEqual(levels.first?["call_id"] as? String, "call_1")
        XCTAssertGreaterThan(try XCTUnwrap(levels.first?["mic_db"] as? Double), -20)

        XCTAssertTrue(e.handle(#"{"id":2,"cmd":{"type":"stop","call_id":"call_1"}}"#))
        let stopped = try XCTUnwrap(lines.waitFor("session_stopped"))
        XCTAssertEqual(stopped["timeline_path"] as? String, "audio/call_1/timeline.json")
        XCTAssertEqual(stopped["mic_path"] as? String, "audio/call_1/mic.m4a")
        XCTAssertEqual(stopped["sys_path"] as? String, "audio/call_1/sys.m4a")
        XCTAssertEqual(source.stops, 1)
        try assertAudio(root.appendingPathComponent("audio/call_1/mic.m4a"), 1.0)
        try assertAudio(root.appendingPathComponent("audio/call_1/sys.m4a"), 1.0)
        let t = try timeline(root)
        XCTAssertEqual(t["call_id"] as? String, "call_1")
        XCTAssertEqual(t["duration_ms"] as? Int, 1000)
        XCTAssertEqual(gaps(t).count, 0)
        XCTAssertEqual(lines.types.filter { $0 == "ack" }.count, 2)
    }

    func testACallThatStoresNoAudioWritesOnlyItsTimeline() throws {
        let (lines, source, root, clock) = (Lines(), FakeSource(), try container(), TestClock())
        let e = engine(lines, source, root, clock)
        _ = e.handle(startLine(id: 1, store: false))
        source.push(ms: 500)
        _ = e.handle(#"{"id":2,"cmd":{"type":"stop","call_id":"call_1"}}"#)
        let stopped = try XCTUnwrap(lines.waitFor("session_stopped"))
        XCTAssertTrue(stopped["mic_path"] is NSNull)
        XCTAssertTrue(stopped["sys_path"] is NSNull)
        let files = try FileManager.default.contentsOfDirectory(atPath: root.appendingPathComponent("audio/call_1").path)
        XCTAssertEqual(files, ["timeline.json"])
    }

    func testPauseStopsBothStreamsAndTheTimelineKeepsTheGap() throws {
        let (lines, source, root, clock) = (Lines(), FakeSource(), try container(), TestClock())
        let e = engine(lines, source, root, clock)
        _ = e.handle(startLine(id: 1))
        source.push(ms: 2000)
        clock.advance(2000)
        _ = e.handle(#"{"id":2,"cmd":{"type":"pause","call_id":"call_1"}}"#)
        XCTAssertEqual(source.stops, 1)
        source.push(ms: 1000)  // nothing is kept while paused
        clock.advance(5000)
        _ = e.handle(#"{"id":3,"cmd":{"type":"resume","call_id":"call_1"}}"#)
        XCTAssertEqual(source.starts, 2)
        source.push(ms: 1000)
        _ = e.handle(#"{"id":4,"cmd":{"type":"stop","call_id":"call_1"}}"#)
        _ = try XCTUnwrap(lines.waitFor("session_stopped"))
        let t = try timeline(root)
        XCTAssertEqual(t["duration_ms"] as? Int, 8000)
        XCTAssertEqual(gaps(t).first?["reason"] as? String, "paused")
        XCTAssertEqual(gaps(t).first?["t0_ms"] as? Int, 2000)
        XCTAssertEqual(gaps(t).first?["t1_ms"] as? Int, 7000)
        try assertAudio(root.appendingPathComponent("audio/call_1/mic.m4a"), 3.0)
    }

    func testAfterACrashTheNextEngineResumesFromTheRingInCallTime() throws {
        let (root, clock) = (try container(), TestClock())
        // The first engine captures 3 s, then dies without `stop`.
        do {
            let (lines, source) = (Lines(), FakeSource())
            let e = engine(lines, source, root, clock)
            _ = e.handle(startLine(id: 1))
            clock.advance(3000)
            source.push(ms: 3000)
        }
        clock.advance(1500)
        let (lines, source) = (Lines(), FakeSource())
        let e = engine(lines, source, root, clock)
        _ = e.handle(startLine(id: 1, resumeFrom: 3000))
        _ = try XCTUnwrap(lines.waitFor("session_started"))
        source.push(ms: 1000)
        _ = e.handle(#"{"id":2,"cmd":{"type":"stop","call_id":"call_1"}}"#)
        _ = try XCTUnwrap(lines.waitFor("session_stopped"))
        let t = try timeline(root)
        XCTAssertEqual(gaps(t).first?["reason"] as? String, "engine_restart")
        XCTAssertEqual(gaps(t).first?["t0_ms"] as? Int, 3000)
        XCTAssertEqual(gaps(t).first?["t1_ms"] as? Int, 4500)
        XCTAssertEqual(t["duration_ms"] as? Int, 5500)
        // Both engines' audio is in the call's files, the crashed run's included.
        try assertAudio(root.appendingPathComponent("audio/call_1/mic.m4a"), 4.0, parts: 2)
    }

    func testTheRingIsAMappedFileInTheContainerThatSurvivesTheEngine() throws {
        let root = try container()
        let url = root.appendingPathComponent(CaptureRing.fileName)
        do {
            let ring = try CaptureRing(url: url, callId: "call_1")
            ring.write(.mic, Array(repeating: 0.5, count: 16_000))
            ring.write(.sys, Array(repeating: 0.25, count: 8_000))
            ring.mark(callMs: 1000, epochMs: 42)
        }
        let again = try CaptureRing(url: url, callId: "call_1")
        XCTAssertEqual(again.written(.mic), 16_000)
        XCTAssertEqual(again.written(.sys), 8_000)
        XCTAssertEqual(again.last?.callMs, 1000)
        XCTAssertEqual(again.last?.epochMs, 42)
        XCTAssertEqual(again.read(.sys, last: 2), [0.25, 0.25])
        let other = try CaptureRing(url: url, callId: "call_2")
        XCTAssertEqual(other.written(.mic), 0, "another call starts an empty ring")
        XCTAssertNil(other.last)
    }

    func testTheIOThreadHandsChunksOnAndNeverWaitsForThem() {
        let (queue, release, got) = (DispatchQueue(label: "test.capture"), DispatchSemaphore(value: 0), Lines())
        let deliver = LiveAudioSource.handOff(on: queue) { chunk in
            release.wait()
            got.write(Data("{\"n\":\(chunk.samples.count)}\n".utf8))
        }
        deliver(AudioChunk(channel: .mic, samples: [0]))
        deliver(AudioChunk(channel: .sys, samples: [0, 0]))
        XCTAssertTrue(got.objects.isEmpty, "the IO proc returned while the consumer still works")
        release.signal()
        release.signal()
        queue.sync {}
        XCTAssertEqual(got.objects.map { $0["n"] as? Int }, [1, 2], "every chunk, in order")
    }

    func testDeviceSizedChunksKeepCallTimeExact() throws {
        // A live device delivers 512 frames at 48 kHz: 170.67 samples at 16 kHz per chunk, which
        // must not round up chunk by chunk (that runs call time ~7 s fast per hour).
        let (lines, source, root, clock) = (Lines(), FakeSource(), try container(), TestClock())
        let e = engine(lines, source, root, clock)
        _ = e.handle(startLine(id: 1, store: false))
        _ = try XCTUnwrap(lines.waitFor("session_started"))
        source.pushDevice(chunks: 1875)  // 20 s at 48 kHz
        let ring = try CaptureRing(url: root.appendingPathComponent(CaptureRing.fileName), callId: "call_1")
        XCTAssertEqual(ring.written(.mic), 320_000)
        XCTAssertEqual(ring.written(.sys), 320_000)
        XCTAssertEqual(ring.last?.callMs, 20_000)
    }

    func testAFullDiskStopsTheAudioFilesOnceAndCaptureGoesOn() throws {
        let (lines, source, root, clock) = (Lines(), FakeSource(), try container(), TestClock())
        let e = engine(lines, source, root, clock, encoder: { _ in FullDisk() })
        _ = e.handle(startLine(id: 1))
        source.push(ms: 1000)
        let errors = lines.events.filter { $0["type"] as? String == "error" }
        XCTAssertEqual(errors.count, 1)
        XCTAssertEqual(errors.first?["code"] as? String, "disk_full")
        XCTAssertTrue(errors.first?["cmd_id"] is NSNull)
        XCTAssertEqual(lines.events.filter { $0["type"] as? String == "levels" }.count, 10)
    }

    func testSessionCommandsNeedTheirSession() throws {
        let (lines, source, root, clock) = (Lines(), FakeSource(), try container(), TestClock())
        let e = engine(lines, source, root, clock)
        _ = e.handle(#"{"id":1,"cmd":{"type":"pause","call_id":"call_1"}}"#)
        _ = e.handle(startLine(id: 2))
        _ = e.handle(startLine(id: 3))
        _ = e.handle(#"{"id":4,"cmd":{"type":"stop","call_id":"call_9"}}"#)
        let errors = lines.events.filter { $0["type"] as? String == "error" }
        XCTAssertEqual(errors.map { $0["code"] as? String }, ["no_session", "bad_command", "no_session"])
        XCTAssertEqual(errors.map { $0["cmd_id"] as? Int }, [1, 3, 4])
    }

    func testATapThatCannotOpenAnswersDeviceUnavailableAndStartsNoSession() throws {
        let (lines, source, root, clock) = (Lines(), FakeSource(), try container(), TestClock())
        source.failStart = true
        let e = engine(lines, source, root, clock)
        _ = e.handle(startLine(id: 1))
        let error = try XCTUnwrap(lines.waitFor("error"))
        XCTAssertEqual(error["code"] as? String, "device_unavailable")
        XCTAssertEqual(error["cmd_id"] as? Int, 1)
        XCTAssertNil(lines.events.first { $0["type"] as? String == "session_started" })
        _ = e.handle(#"{"id":2,"cmd":{"type":"stop","call_id":"call_1"}}"#)
        XCTAssertEqual(lines.events.last?["code"] as? String, "no_session")
    }

    func testGlossaryLanguagesAndExclusionsAreAcknowledged() throws {
        let (lines, source, root, clock) = (Lines(), FakeSource(), try container(), TestClock())
        let e = engine(lines, source, root, clock)
        _ = e.handle(startLine(id: 1))
        _ = e.handle(#"{"id":2,"cmd":{"type":"set_languages","languages":["en","de"]}}"#)
        _ = e.handle(#"{"id":3,"cmd":{"type":"set_glossary","entries":[]}}"#)
        _ = e.handle(#"{"id":4,"cmd":{"type":"exclude_process","call_id":"call_1","bundle_id":"com.spotify.client"}}"#)
        XCTAssertEqual(
            lines.events.filter { $0["type"] as? String == "ack" }.compactMap { $0["cmd_id"] as? Int }, [1, 2, 3, 4])
    }
}
