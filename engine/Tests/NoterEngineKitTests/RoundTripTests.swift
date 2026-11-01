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
    private enum Keys: String, CodingKey {
        case type, enabled, known_bundle_ids, play_clip, timeout_ms, call_id, bundle_id, entries, languages
        case session_dir, store_audio, mic_device_uid, exclude_bundle_ids, backend, glossary, speaker_priors
        case enrolled_embeddings_path, resume_from_ms, from_ms, to_ms, channel
        case result_path, constraints_path, request_id, spans, out_path, texts
    }
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
        case let .startSession(s):
            try c.encode("start_session", forKey: .type)
            try c.encode(s.callId, forKey: .call_id)
            try c.encode(s.sessionDir, forKey: .session_dir)
            try c.encode(s.storeAudio, forKey: .store_audio)
            try c.encode(s.micDeviceUid, forKey: .mic_device_uid)
            try c.encode(s.excludeBundleIds, forKey: .exclude_bundle_ids)
            try c.encode(s.languages, forKey: .languages)
            try c.encode(s.backend, forKey: .backend)
            try c.encode(s.glossary, forKey: .glossary)
            try c.encode(s.speakerPriors, forKey: .speaker_priors)
            try c.encode(s.enrolledEmbeddingsPath, forKey: .enrolled_embeddings_path)
            try c.encode(s.resumeFromMs, forKey: .resume_from_ms)
        case let .pause(callId), let .resume(callId), let .stop(callId):
            let type = switch self { case .pause: "pause"; case .resume: "resume"; default: "stop" }
            try c.encode(type, forKey: .type)
            try c.encode(callId, forKey: .call_id)
        case let .excludeProcess(callId, bundleId):
            try c.encode("exclude_process", forKey: .type)
            try c.encode(callId, forKey: .call_id)
            try c.encode(bundleId, forKey: .bundle_id)
        case let .setGlossary(entries):
            try c.encode("set_glossary", forKey: .type)
            try c.encode(entries, forKey: .entries)
        case let .setLanguages(languages):
            try c.encode("set_languages", forKey: .type)
            try c.encode(languages, forKey: .languages)
        case let .play(callId, fromMs, toMs, channel):
            try c.encode("play", forKey: .type)
            try c.encode(callId, forKey: .call_id)
            try c.encode(fromMs, forKey: .from_ms)
            try c.encode(toMs, forKey: .to_ms)
            try c.encode(channel, forKey: .channel)
        case .stopPlayback: try c.encode("stop_playback", forKey: .type)
        case let .offlinePass(p):
            try c.encode("offline_pass", forKey: .type)
            try c.encode(p.callId, forKey: .call_id)
            try c.encode(p.sessionDir, forKey: .session_dir)
            try c.encode(p.resultPath, forKey: .result_path)
            try c.encode(p.constraintsPath, forKey: .constraints_path)
            try c.encode(p.backend, forKey: .backend)
        case let .speakerEmbedding(r):
            try c.encode("speaker_embedding", forKey: .type)
            try c.encode(r.requestId, forKey: .request_id)
            try c.encode(r.callId, forKey: .call_id)
            try c.encode(r.channel, forKey: .channel)
            try c.encode(r.spans, forKey: .spans)
            try c.encode(r.outPath, forKey: .out_path)
        case let .embedTexts(requestId, texts, outPath):
            try c.encode("embed_texts", forKey: .type)
            try c.encode(requestId, forKey: .request_id)
            try c.encode(texts, forKey: .texts)
            try c.encode(outPath, forKey: .out_path)
        case let .other(type):
            throw EncodingError.invalidValue(type, .init(codingPath: [], debugDescription: "a command the engine does not answer"))
        }
    }
}

/// An event type the engine does not write (speaker turns: live diarization, later).
private struct NotWritten: Error {}

extension EngineEvent: Decodable {
    private enum Keys: String, CodingKey {
        case type, protocol_version, engine_version, models, sandboxed, cmd_id, code, message, call_id, mic_db, sys_db
        case channel, passed, failure, own_sounds_leak, timeline_path, mic_path, sys_path, mic_device, output_device
        case device_name, gap_from_ms, gap_to_ms, bundle_id, app_name, pid, since_ms, confidence, at_ms, playing, segment, text
        case progress, result_path, request_id, out_path, inline, count
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
        case "session_started":
            self = .sessionStarted(
                callId: try c.decode(String.self, forKey: .call_id), micDevice: try c.decode(String.self, forKey: .mic_device),
                outputDevice: try c.decode(String.self, forKey: .output_device))
        case "session_stopped":
            self = .sessionStopped(
                callId: try c.decode(String.self, forKey: .call_id), timelinePath: try c.decode(String.self, forKey: .timeline_path),
                micPath: try c.decode(String?.self, forKey: .mic_path), sysPath: try c.decode(String?.self, forKey: .sys_path))
        case "device_changed":
            self = .deviceChanged(
                callId: try c.decode(String.self, forKey: .call_id), deviceName: try c.decode(String.self, forKey: .device_name),
                gapFromMs: try c.decode(Int.self, forKey: .gap_from_ms), gapToMs: try c.decode(Int.self, forKey: .gap_to_ms))
        case "call_detected":
            self = .callDetected(
                bundleId: try c.decode(String.self, forKey: .bundle_id), appName: try c.decode(String.self, forKey: .app_name),
                pid: try c.decode(Int32.self, forKey: .pid))
        case "call_audio_released": self = .callAudioReleased(bundleId: try c.decode(String.self, forKey: .bundle_id))
        case "audio_source_added":
            self = .audioSourceAdded(
                callId: try c.decode(String.self, forKey: .call_id), bundleId: try c.decode(String.self, forKey: .bundle_id),
                appName: try c.decode(String.self, forKey: .app_name))
        case "system_audio_silent":
            self = .systemAudioSilent(
                callId: try c.decode(String.self, forKey: .call_id), sinceMs: try c.decode(Int.self, forKey: .since_ms),
                confidence: try c.decode(Float.self, forKey: .confidence))
        case "playback_position":
            self = .playbackPosition(
                callId: try c.decode(String.self, forKey: .call_id), atMs: try c.decode(Int.self, forKey: .at_ms),
                playing: try c.decode(Bool.self, forKey: .playing))
        case "segment": self = .segment(try c.decode(Segment.self, forKey: .segment))
        case "no_segments":
            self = .noSegments(callId: try c.decode(String.self, forKey: .call_id), sinceMs: try c.decode(Int.self, forKey: .since_ms))
        case "silence":
            self = .silence(callId: try c.decode(String.self, forKey: .call_id), sinceMs: try c.decode(Int.self, forKey: .since_ms))
        case "self_test_line":
            self = .selfTestLine(channel: try c.decode(Channel.self, forKey: .channel), text: try c.decode(String.self, forKey: .text))
        case "offline_progress":
            self = .offlineProgress(callId: try c.decode(String.self, forKey: .call_id), progress: try c.decode(Float.self, forKey: .progress))
        case "offline_done":
            self = .offlineDone(callId: try c.decode(String.self, forKey: .call_id), resultPath: try c.decode(String.self, forKey: .result_path))
        case "offline_failed":
            self = .offlineFailed(callId: try c.decode(String.self, forKey: .call_id), code: try c.decode(EngineErrorCode.self, forKey: .code))
        case "speaker_embedding_done":
            self = .speakerEmbeddingDone(
                requestId: try c.decode(String.self, forKey: .request_id), outPath: try c.decode(String.self, forKey: .out_path))
        case "embeddings":
            self = .embeddings(
                requestId: try c.decode(String.self, forKey: .request_id), inline: try c.decode([Float]?.self, forKey: .inline),
                outPath: try c.decode(String?.self, forKey: .out_path), count: try c.decode(UInt32.self, forKey: .count))
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
        XCTAssertEqual(
            answered.sorted(),
            [
                "embed_texts", "exclude_process", "offline_pass", "pause", "ping", "play", "resume", "self_test",
                "set_detection", "set_glossary", "set_languages", "shutdown", "speaker_embedding", "start_session", "stop",
                "stop_playback",
            ])
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
            [
                "ack", "audio_source_added", "call_audio_released", "call_detected", "device_changed", "embeddings", "error",
                "levels", "no_segments", "offline_done", "offline_failed", "offline_progress", "playback_position", "pong",
                "ready", "segment", "self_test_line", "self_test_result", "self_test_stream", "session_started",
                "session_stopped", "silence", "speaker_embedding_done", "system_audio_silent",
            ])
    }

    /// The offline pass's files: the archive result and word timings it writes, the constraints it reads.
    func testTheOfflineFilesOfTheFixtureDecodeAndReencodeEqual() throws {
        for result in try XCTUnwrap(fixture["archive_results"]) {
            let data = try JSONSerialization.data(withJSONObject: result)
            XCTAssertEqual(try object(JSONEncoder().encode(JSONDecoder().decode(ArchiveResult.self, from: data))), try object(data))
        }
        let words = try JSONSerialization.data(withJSONObject: try XCTUnwrap(fixture["words"]))
        XCTAssertEqual(
            try JSONSerialization.jsonObject(with: JSONEncoder().encode(JSONDecoder().decode([Word].self, from: words))) as? NSArray,
            try JSONSerialization.jsonObject(with: words) as? NSArray)
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("\(UUID().uuidString).json")
        defer { try? FileManager.default.removeItem(at: url) }
        for example in try XCTUnwrap(fixture["constraints"]) {
            try JSONSerialization.data(withJSONObject: example).write(to: url)
            let constraints = try XCTUnwrap(OfflineConstraints.read(url))
            XCTAssertEqual(constraints.mustLink.first?.b, Span(t0Ms: 5_000, t1Ms: 6_500))
            XCTAssertEqual(constraints.speakerNames["spk_1"], "Anna K.")
            XCTAssertEqual(LiveASR.codes(constraints.languages), ["en", "fr"])
        }
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
