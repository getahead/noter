import Foundation
import XCTest

@testable import NoterEngineKit

private func app(_ bundleId: String, pid: Int32 = 100, output: Bool = false, input: Bool = false) -> ProcessAudio {
    ProcessAudio(pid: pid, bundleId: bundleId, name: bundleId.components(separatedBy: ".").last ?? "", output: output, input: input)
}

private let zoom = "us.zoom.xos"
private let chrome = "com.google.Chrome"

private let startLine =
    #"{"id":2,"cmd":{"type":"start_session","call_id":"call_1","session_dir":"audio/call_1","store_audio":false,"mic_device_uid":null,"exclude_bundle_ids":[],"languages":["en"],"backend":"whisper_turbo","glossary":[],"speaker_priors":[],"enrolled_embeddings_path":null,"resume_from_ms":null}}"#

final class DetectorTests: XCTestCase {
    func testAKnownAppPlayingWhileHoldingTheMicIsACallUntilItLetsGoOfBoth() {
        var d = Detector()
        d.rule(enabled: true, known: [zoom, chrome])
        XCTAssertEqual(d.update([app(zoom, output: true)]), [], "audio alone is not a call")
        XCTAssertEqual(d.update([app(zoom, pid: 7, output: true, input: true)]), [.callDetected(bundleId: zoom, appName: "xos", pid: 7)])
        XCTAssertEqual(d.update([app(zoom, pid: 7, output: true, input: true)]), [], "reported once")
        XCTAssertEqual(d.update([app(zoom, pid: 7, input: true)]), [], "still holds the mic")
        XCTAssertEqual(d.update([]), [.callAudioReleased(bundleId: zoom)])
    }

    func testABrowserCallPlaysAndRecordsInItsHelpersAndIsReportedAsTheBrowser() {
        var d = Detector()
        d.rule(enabled: true, known: [chrome])
        let events = d.update([
            app(chrome, pid: 10), app("\(chrome).helper", pid: 11, output: true), app("\(chrome).helper", pid: 12, input: true),
        ])
        XCTAssertEqual(events, [.callDetected(bundleId: chrome, appName: "Chrome", pid: 10)])
    }

    func testNothingIsReportedWhileDetectionIsOffAndTurningItOffForgetsCalls() {
        var d = Detector()
        d.rule(enabled: false, known: [zoom])
        XCTAssertEqual(d.update([app(zoom, output: true, input: true)]), [])
        d.rule(enabled: true, known: [zoom])
        XCTAssertEqual(d.update([app(zoom, output: true, input: true)]).count, 1)
        d.rule(enabled: false, known: [zoom])
        XCTAssertEqual(d.update([]), [], "no release while off")
        XCTAssertTrue(d.update([app("com.apple.Music", output: true)]).isEmpty)
    }

    func testDuringASessionANewSoundSourceIsReportedOnceButNotTheCallOrExcludedApps() {
        var d = Detector()
        d.rule(enabled: false, known: [zoom])
        d.startSession(callId: "call_1", current: [app(zoom, output: true, input: true)], excluded: ["com.spotify.client"])
        let events = d.update([
            app(zoom, output: true, input: true), app("com.spotify.client.helper", output: true),
            app("com.apple.Music", pid: 9, output: true),
        ])
        XCTAssertEqual(events, [.audioSourceAdded(callId: "call_1", bundleId: "com.apple.Music", appName: "Music")])
        XCTAssertEqual(d.update([app("com.apple.Music", pid: 9, output: true)]), [])
        d.exclude("tv.twitch")
        XCTAssertEqual(d.update([app("tv.twitch", output: true)]), [])
        d.stopSession()
        XCTAssertEqual(d.update([app("com.apple.Safari", output: true)]), [])
    }

    func testAKnownAppPlayingCountsAsAMeetingAppForSilenceDetection() {
        var d = Detector()
        d.rule(enabled: false, known: [zoom])
        _ = d.update([app(zoom, input: true)])
        XCTAssertFalse(d.meetingAppPlaying)
        _ = d.update([app("\(zoom).helper", output: true)])
        XCTAssertTrue(d.meetingAppPlaying)
    }
}

final class ZeroRunTests: XCTestCase {
    func testExactZerosWhileTheMeetingAppPlaysRaiseAGrowingConfidence() {
        var z = ZeroRun()
        XCTAssertNil(z.feed(zeros: true, atMs: 1_000, meetingApp: true))
        XCTAssertNil(z.feed(zeros: true, atMs: 5_900, meetingApp: true))
        XCTAssertEqual(z.feed(zeros: true, atMs: 6_000, meetingApp: true)?.sinceMs, 1_000)
        XCTAssertNil(z.feed(zeros: true, atMs: 6_100, meetingApp: true), "once per step")
        XCTAssertEqual(z.feed(zeros: true, atMs: 16_000, meetingApp: true)?.confidence, 0.8)
        XCTAssertEqual(z.feed(zeros: true, atMs: 31_000, meetingApp: true)?.confidence, 0.95)
        XCTAssertNil(z.feed(zeros: true, atMs: 90_000, meetingApp: true))
    }

    func testSoundOrNoMeetingAppEndsOrHoldsTheRun() {
        var z = ZeroRun()
        _ = z.feed(zeros: true, atMs: 0, meetingApp: false)
        XCTAssertNil(z.feed(zeros: true, atMs: 10_000, meetingApp: false), "a silent room without a call app is not a permission problem")
        XCTAssertEqual(z.feed(zeros: true, atMs: 10_100, meetingApp: true)?.sinceMs, 0)
        XCTAssertNil(z.feed(zeros: false, atMs: 10_200, meetingApp: true))
        XCTAssertNil(z.feed(zeros: true, atMs: 10_300, meetingApp: true))
        XCTAssertEqual(z.feed(zeros: true, atMs: 15_300, meetingApp: true)?.confidence, 0.6, "a new run starts over")
    }
}

/// A player the test drives: it records what it was asked to play.
final class FakePlayer: Player, @unchecked Sendable {
    private(set) var played: [(files: [String], fromMs: Int, toMs: Int?)] = []
    private(set) var stops = 0
    var position: (@Sendable (Int, Bool) -> Void)?

    func play(_ files: [URL], fromMs: Int, toMs: Int?, position: @escaping @Sendable (Int, Bool) -> Void) throws {
        played.append((files.map(\.lastPathComponent), fromMs, toMs))
        self.position = position
    }

    func stop() { stops += 1 }
}

final class EngineFactsTests: XCTestCase {
    private func root() throws -> URL {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("noter-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: url.appendingPathComponent("audio/call_1"), withIntermediateDirectories: true)
        return url
    }

    private func engine(
        _ lines: Lines, root: URL, source: DeviceSource = DeviceSource(), player: Player = FakePlayer(),
        processes: Box<[ProcessAudio]>
    ) -> EngineLoop {
        let e = EngineLoop(
            writer: writer(lines), engineVersion: "test", models: [], sandboxed: false, container: root,
            player: player, processes: { processes.value }, source: { _ in source })
        e.start()
        return e
    }

    func testDetectionFactsFollowTheRuleTheCoreSends() throws {
        let (lines, processes) = (Lines(), Box<[ProcessAudio]>([]))
        let e = engine(lines, root: try root(), processes: processes)
        _ = e.handle(#"{"id":1,"cmd":{"type":"set_detection","enabled":true,"known_bundle_ids":["us.zoom.xos"]}}"#)
        processes.value = [app(zoom, pid: 42, output: true, input: true)]
        e.poll()
        let detected = try XCTUnwrap(lines.waitFor("call_detected"))
        XCTAssertEqual(detected["bundle_id"] as? String, zoom)
        XCTAssertEqual(detected["pid"] as? Int, 42)
        processes.value = []
        e.poll()
        XCTAssertEqual(try XCTUnwrap(lines.waitFor("call_audio_released"))["bundle_id"] as? String, zoom)
    }

    func testSilentSystemAudioDuringACallIsReportedWithItsStart() throws {
        let (lines, source, processes) = (Lines(), DeviceSource(), Box<[ProcessAudio]>([]))
        let e = engine(lines, root: try root(), source: source, processes: processes)
        _ = e.handle(#"{"id":1,"cmd":{"type":"set_detection","enabled":false,"known_bundle_ids":["us.zoom.xos"]}}"#)
        _ = e.handle(startLine)
        processes.value = [app(zoom, output: true, input: true)]
        e.poll()
        source.push(ms: 1000)
        for _ in 0..<60 { source.push(mic: [Float](repeating: 0.1, count: 1600), sys: [Float](repeating: 0, count: 1600)) }
        let silent = try XCTUnwrap(lines.waitFor("system_audio_silent"))
        XCTAssertEqual(silent["call_id"] as? String, "call_1")
        XCTAssertEqual(silent["since_ms"] as? Int, 1000)
        XCTAssertEqual(silent["confidence"] as? Double ?? 0, 0.6, accuracy: 0.001)
    }

    func testReplayPlaysTheStoredFilesAndReportsItsPosition() throws {
        let (lines, root, player) = (Lines(), try root(), FakePlayer())
        for name in ["mic.m4a", "sys.m4a"] {
            FileManager.default.createFile(atPath: root.appendingPathComponent("audio/call_1/\(name)").path, contents: Data())
        }
        let e = engine(lines, root: root, player: player, processes: Box([]))
        _ = e.handle(#"{"id":1,"cmd":{"type":"play","call_id":"call_1","from_ms":1500,"to_ms":null,"channel":null}}"#)
        _ = e.handle(#"{"id":2,"cmd":{"type":"play","call_id":"call_1","from_ms":0,"to_ms":900,"channel":"sys"}}"#)
        XCTAssertEqual(player.played.map(\.files), [["mic.m4a", "sys.m4a"], ["sys.m4a"]])
        XCTAssertEqual(player.played.map(\.fromMs), [1500, 0])
        XCTAssertEqual(player.played.last?.toMs, 900)
        XCTAssertEqual(player.stops, 1, "a new play stops the one before")
        player.position?(400, true)
        player.position?(900, false)
        let positions = lines.events.filter { $0["type"] as? String == "playback_position" }
        XCTAssertEqual(positions.map { $0["at_ms"] as? Int }, [400, 900])
        XCTAssertEqual(positions.map { $0["playing"] as? Bool }, [true, false])
        XCTAssertEqual(positions.first?["call_id"] as? String, "call_1")
        _ = e.handle(#"{"id":3,"cmd":{"type":"stop_playback"}}"#)
        XCTAssertEqual(player.stops, 2)
        XCTAssertEqual(lines.events.filter { $0["type"] as? String == "ack" }.compactMap { $0["cmd_id"] as? Int }, [1, 2, 3])
    }

    func testReplayWithoutStoredAudioIsAnErrorForTheCommand() throws {
        let (lines, player) = (Lines(), FakePlayer())
        let e = engine(lines, root: try root(), player: player, processes: Box([]))
        _ = e.handle(#"{"id":4,"cmd":{"type":"play","call_id":"call_1","from_ms":0,"to_ms":null,"channel":"mic"}}"#)
        let error = try XCTUnwrap(lines.waitFor("error"))
        XCTAssertEqual(error["cmd_id"] as? Int, 4)
        XCTAssertTrue(player.played.isEmpty)
    }
}
