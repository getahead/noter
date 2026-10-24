import Foundation
import XCTest

@testable import NoterEngineKit

private func tone(_ hz: Float, ms: Int = 100, rate: Float = 16_000, amplitude: Float = 0.3) -> [Float] {
    (0..<Int(rate) * ms / 1000).map { i in amplitude * sin(Float(i) * 2 * .pi * hz / rate) }
}

private func root() throws -> URL {
    let url = FileManager.default.temporaryDirectory.appendingPathComponent("noter-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    return url
}

private func start(id: Int, exclude: [String] = []) -> String {
    let ids = exclude.map { "\"\($0)\"" }.joined(separator: ",")
    return #"{"id":\#(id),"cmd":{"type":"start_session","call_id":"call_1","session_dir":"audio/call_1","store_audio":false,"mic_device_uid":"BuiltInMic","exclude_bundle_ids":[\#(ids)],"languages":["en"],"backend":"whisper_turbo","glossary":[],"speaker_priors":[],"enrolled_embeddings_path":null,"resume_from_ms":null}}"#
}

final class Box<T>: @unchecked Sendable {
    var value: T
    init(_ value: T) { self.value = value }
}

/// The fake source of CaptureTests, plus what the live source reports on its own.
final class DeviceSource: AudioSource, @unchecked Sendable {
    private let lock = NSLock()
    private var onChunk: (@Sendable (AudioChunk) -> Void)?
    private var onDevice: (@Sendable (DeviceChange) -> Void)?
    private(set) var excluded: [String] = []
    var failExclude = false
    /// A leaky system: the tap hears what the engine itself plays.
    var leaky = false

    func start(_ onChunk: @escaping @Sendable (AudioChunk) -> Void) throws { lock.withLock { self.onChunk = onChunk } }
    func stop() { lock.withLock { onChunk = nil } }

    func exclude(bundleId: String) throws {
        if failExclude { throw LiveAudioSource.Failure(description: "tap refused") }
        lock.withLock { excluded.append(bundleId) }
    }

    func observeDevices(_ handler: @escaping @Sendable (DeviceChange) -> Void) { lock.withLock { onDevice = handler } }

    func push(mic: [Float], sys: [Float]) {
        let deliver = lock.withLock { onChunk }
        deliver?(AudioChunk(channel: .mic, samples: mic))
        deliver?(AudioChunk(channel: .sys, samples: sys))
    }

    func push(ms: Int) {
        for _ in 0..<(ms / 100) { push(mic: tone(440), sys: tone(440)) }
    }

    func change(_ change: DeviceChange) { lock.withLock { onDevice }?(change) }

    /// The engine's clip, as a speaker plays it: the mic hears it, the tap only when it leaks.
    func play(_ clip: [Float]) {
        for at in stride(from: 0, to: clip.count, by: 1600) {
            let part = Array(clip[at..<min(at + 1600, clip.count)])
            push(mic: part, sys: leaky ? part : tone(440, ms: part.count / 16))
        }
    }
}

final class OneClockTests: XCTestCase {
    func testTheAggregateBuffersSplitIntoTheMicrophoneThenTheTap() {
        // A stereo mic as two mono buffers, then the tap's interleaved stereo buffer.
        let buffers: [(channels: Int, samples: [Float])] = [(1, [1, 1, 1]), (1, [3, 3, 3]), (2, [1, 3, 0, 0, -1, -1])]
        let (mic, sys) = OneClock.split(buffers, micBuffers: 2)
        XCTAssertEqual(mic, [2, 2, 2])
        XCTAssertEqual(sys, [2, 0, -1])
        XCTAssertEqual(OneClock.split([(1, [0.5])], micBuffers: 1).sys, [], "no tap buffer: nothing on sys")
        XCTAssertEqual(OneClock.split([], micBuffers: 1).mic, [])
    }

    func testExcludedBundlesCoverTheirHelperProcesses() {
        let excluded: Set<String> = ["com.spotify.client", "us.zoom.xos"]
        XCTAssertTrue(Exclusion.matches("com.spotify.client", excluded))
        XCTAssertTrue(Exclusion.matches("com.spotify.client.helper", excluded))
        XCTAssertFalse(Exclusion.matches("com.spotify.clientx", excluded))
        XCTAssertFalse(Exclusion.matches("com.apple.Music", excluded))
        XCTAssertFalse(Exclusion.matches("", excluded))
    }
}

final class SessionDeviceTests: XCTestCase {
    private func engine(_ lines: Lines, _ source: DeviceSource, _ root: URL, _ clock: TestClock, seen: Box<StartSession?>)
        -> EngineLoop
    {
        let e = EngineLoop(
            writer: writer(lines), engineVersion: "test", models: [], sandboxed: false, container: root, now: clock.now,
            play: source.play
        ) { start in
            seen.value = start
            return source
        }
        e.start()
        return e
    }

    func testTheSessionOpensTheSourceWithItsMicrophoneAndExclusions() throws {
        let (lines, source, seen) = (Lines(), DeviceSource(), Box<StartSession?>(nil))
        let e = engine(lines, source, try root(), TestClock(), seen: seen)
        _ = e.handle(start(id: 1, exclude: ["com.spotify.client"]))
        XCTAssertEqual(seen.value?.micDeviceUid, "BuiltInMic")
        XCTAssertEqual(seen.value?.excludeBundleIds, ["com.spotify.client"])
        _ = e.handle(#"{"id":2,"cmd":{"type":"exclude_process","call_id":"call_1","bundle_id":"com.apple.Music"}}"#)
        XCTAssertEqual(source.excluded, ["com.apple.Music"])
        XCTAssertEqual(lines.events.last?["type"] as? String, "ack")
        source.failExclude = true
        _ = e.handle(#"{"id":3,"cmd":{"type":"exclude_process","call_id":"call_1","bundle_id":"tv.twitch"}}"#)
        XCTAssertEqual(lines.events.last?["code"] as? String, "internal")
        XCTAssertEqual(lines.events.last?["cmd_id"] as? Int, 3)
    }

    func testAMicrophoneSwapIsADeviceChangeWithItsGapInCallTime() throws {
        let (lines, source, root, clock) = (Lines(), DeviceSource(), try root(), TestClock())
        let e = engine(lines, source, root, clock, seen: Box(nil))
        _ = e.handle(start(id: 1))
        source.push(ms: 2000)
        let lost = clock.now()
        clock.advance(800)
        source.change(DeviceChange(name: "AirPods", lostAtMs: lost, backAtMs: clock.now()))
        let changed = try XCTUnwrap(lines.waitFor("device_changed"))
        XCTAssertEqual(changed["call_id"] as? String, "call_1")
        XCTAssertEqual(changed["device_name"] as? String, "AirPods")
        XCTAssertEqual(changed["gap_from_ms"] as? Int, 2000)
        XCTAssertEqual(changed["gap_to_ms"] as? Int, 2800)
        source.push(ms: 1000)
        _ = e.handle(#"{"id":2,"cmd":{"type":"stop","call_id":"call_1"}}"#)
        _ = try XCTUnwrap(lines.waitFor("session_stopped"))
        let data = try Data(contentsOf: root.appendingPathComponent("audio/call_1/timeline.json"))
        let t = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertEqual(t["duration_ms"] as? Int, 3800)
        let gap = try XCTUnwrap((t["gaps"] as? [[String: Any]])?.first)
        XCTAssertEqual(gap["reason"] as? String, "device_changed")
        XCTAssertEqual(gap["t0_ms"] as? Int, 2000)
        XCTAssertEqual(gap["t1_ms"] as? Int, 2800)
    }

    func testAnInstantSwapStillReportsTheNewDeviceWithoutAGap() throws {
        let (lines, source, root, clock) = (Lines(), DeviceSource(), try root(), TestClock())
        let e = engine(lines, source, root, clock, seen: Box(nil))
        _ = e.handle(start(id: 1))
        source.push(ms: 500)
        source.change(DeviceChange(name: "Studio Display Microphone", lostAtMs: clock.now(), backAtMs: clock.now()))
        let changed = try XCTUnwrap(lines.waitFor("device_changed"))
        XCTAssertEqual(changed["gap_from_ms"] as? Int, 500)
        XCTAssertEqual(changed["gap_to_ms"] as? Int, 500)
        _ = e.handle(#"{"id":2,"cmd":{"type":"stop","call_id":"call_1"}}"#)
        _ = try XCTUnwrap(lines.waitFor("session_stopped"))
        let data = try Data(contentsOf: root.appendingPathComponent("audio/call_1/timeline.json"))
        let t = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertEqual((t["gaps"] as? [[String: Any]])?.count, 0)
    }

    func testADeviceChangeWhilePausedIsNotReported() throws {
        let (lines, source, root, clock) = (Lines(), DeviceSource(), try root(), TestClock())
        let e = engine(lines, source, root, clock, seen: Box(nil))
        _ = e.handle(start(id: 1))
        _ = e.handle(#"{"id":2,"cmd":{"type":"pause","call_id":"call_1"}}"#)
        source.change(DeviceChange(name: "AirPods", lostAtMs: clock.now(), backAtMs: clock.now() + 500))
        XCTAssertFalse(lines.types.contains("device_changed"))
    }
}

final class SelfTestClipTests: XCTestCase {
    private func run(leaky: Bool) throws -> (result: [String: Any], played: Bool) {
        let (lines, source, played) = (Lines(), DeviceSource(), Box(false))
        source.leaky = leaky
        let e = EngineLoop(
            writer: writer(lines), engineVersion: "test", models: ["whisper-turbo"], sandboxed: false,
            play: { clip in
                played.value = true
                source.play(clip)
            }
        ) { start in
            XCTAssertNil(start, "the self-test opens the source as a session does, without a call")
            return source
        }
        e.start()
        _ = e.handle(#"{"id":1,"cmd":{"type":"self_test","play_clip":true,"timeout_ms":3000}}"#)
        let result = try XCTUnwrap(lines.waitFor("self_test_result"))
        return (result, played.value)
    }

    func testTheEnginesOwnClipNeverReachesTheTap() throws {
        let (result, played) = try run(leaky: false)
        XCTAssertTrue(played)
        XCTAssertEqual(result["passed"] as? Bool, true)
        XCTAssertEqual(result["own_sounds_leak"] as? Bool, false)
    }

    func testAClipTheTapHearsIsOwnSoundsLeak() throws {
        let (result, _) = try run(leaky: true)
        XCTAssertEqual(result["passed"] as? Bool, false)
        XCTAssertEqual(result["own_sounds_leak"] as? Bool, true)
    }

    func testWithoutPlayClipNothingIsPlayed() throws {
        let (lines, source, played) = (Lines(), DeviceSource(), Box(false))
        let e = EngineLoop(
            writer: writer(lines), engineVersion: "test", models: ["whisper-turbo"], sandboxed: false,
            play: { _ in played.value = true }, source: { _ in source })
        _ = e.handle(#"{"id":1,"cmd":{"type":"self_test","play_clip":false,"timeout_ms":300}}"#)
        source.push(ms: 200)
        _ = try XCTUnwrap(lines.waitFor("self_test_result"))
        XCTAssertFalse(played.value)
    }

    func testTheClipIsATonePickedOutOfOtherSound() {
        let clip = Clip.samples()
        XCTAssertEqual(clip.count, 16_000)
        XCTAssertGreaterThan(Clip.share(Array(clip[4000..<5600]), rate: 16_000), 0.9)
        XCTAssertLessThan(Clip.share(tone(440), rate: 16_000), 0.05)
        XCTAssertLessThan(Clip.share(tone(1_400), rate: 16_000), 0.05)
        XCTAssertEqual(Clip.share([Float](repeating: 0, count: 1600), rate: 16_000), 0)
        // The tap at 48 kHz hears the clip at its own rate: still the clip.
        XCTAssertGreaterThan(Clip.share(tone(Clip.hz, ms: 10, rate: 48_000), rate: 48_000), 0.9)
    }
}
