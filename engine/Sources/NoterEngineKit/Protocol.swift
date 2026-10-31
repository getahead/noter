// The core ↔ engine protocol, as the engine speaks it (`cpt-noter-interface-engine-stdio`).
//
// The source of truth is `crates/noter-protocol/src/engine.rs` and its export
// `contracts/engine.schema.json`. These are the messages the engine answers (M0, capture
// sessions, the offline pass and embeddings); a command of a later protocol decodes as `.other`
// and is refused with `bad_command`. The types are hand-written (D13, TL-9); RoundTripTests decodes and re-encodes
// every line of `contracts/fixtures/engine-lines.json` with them, so a drift from the Rust types
// fails there. Nested values the engine does not read yet (glossary, languages, speaker priors)
// stay `JSONValue`, kept exactly as sent.

import Foundation

/// Must match `ENGINE_PROTOCOL_VERSION` in noter-protocol; the core refuses another major.
public let engineProtocolVersion = "2.0"

public enum Channel: String, Codable, Sendable {
    case mic, sys
}

public enum EngineErrorCode: String, Codable, Sendable {
    case permissionMissing = "permission_missing"
    case zeroBuffers = "zero_buffers"
    case deviceUnavailable = "device_unavailable"
    case modelMissing = "model_missing"
    case modelLoadFailed = "model_load_failed"
    case diskFull = "disk_full"
    case badCommand = "bad_command"
    case noSession = "no_session"
    case `internal` = "internal"
}

/// Any JSON value, for nested fields the engine passes on or does not read yet.
public enum JSONValue: Codable, Equatable, Sendable {
    case null, bool(Bool), number(Double), string(String), array([JSONValue]), object([String: JSONValue])

    public init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let v = try? c.decode(Bool.self) { self = .bool(v) }
        else if let v = try? c.decode(Double.self) { self = .number(v) }
        else if let v = try? c.decode(String.self) { self = .string(v) }
        else if let v = try? c.decode([JSONValue].self) { self = .array(v) }
        else { self = .object(try c.decode([String: JSONValue].self)) }
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .null: try c.encodeNil()
        case let .bool(v): try c.encode(v)
        case let .number(v): try c.encode(v)
        case let .string(v): try c.encode(v)
        case let .array(v): try c.encode(v)
        case let .object(v): try c.encode(v)
        }
    }
}

/// `start_session`: everything the engine needs to capture one call.
public struct StartSession: Equatable, Sendable {
    public var callId: String
    /// `audio/<call_id>/`, relative to the App Group container.
    public var sessionDir: String
    public var storeAudio: Bool
    public var micDeviceUid: String?
    public var excludeBundleIds: [String]
    public var languages: JSONValue
    public var backend: String
    public var glossary: JSONValue
    public var speakerPriors: JSONValue
    public var enrolledEmbeddingsPath: String?
    /// Set after an engine restart in the same call: resume from the capture ring.
    public var resumeFromMs: UInt32?
}

/// A live transcript segment (`EngineSegment`): hypotheses, then one confirmed with the same id.
public struct Segment: Codable, Equatable, Sendable {
    public struct Correction: Codable, Equatable, Sendable {
        public var from: String
        public var to: String
    }

    public var id: String
    public var callId: String
    public var channel: Channel
    public var t0Ms: Int
    public var t1Ms: Int
    public var state: String
    public var lang: String
    public var langP: Float
    public var speakerLabel: String
    public var text: String
    public var wordsPath: String?
    public var avgLogprob: Float
    public var noSpeechP: Float
    public var corrections: [Correction]
    public var crosstalkLabels: [String]

    enum CodingKeys: String, CodingKey {
        case id, channel, state, lang, text, corrections
        case callId = "call_id", t0Ms = "t0_ms", t1Ms = "t1_ms", langP = "lang_p", speakerLabel = "speaker_label"
        case wordsPath = "words_path", avgLogprob = "avg_logprob", noSpeechP = "no_speech_p", crosstalkLabels = "crosstalk_labels"
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(callId, forKey: .callId)
        try c.encode(channel, forKey: .channel)
        try c.encode(t0Ms, forKey: .t0Ms)
        try c.encode(t1Ms, forKey: .t1Ms)
        try c.encode(state, forKey: .state)
        try c.encode(lang, forKey: .lang)
        try c.encode(langP, forKey: .langP)
        try c.encode(speakerLabel, forKey: .speakerLabel)
        try c.encode(text, forKey: .text)
        try c.encode(wordsPath, forKey: .wordsPath)  // null, as serde writes it
        try c.encode(avgLogprob, forKey: .avgLogprob)
        try c.encode(noSpeechP, forKey: .noSpeechP)
        try c.encode(corrections, forKey: .corrections)
        try c.encode(crosstalkLabels, forKey: .crosstalkLabels)
    }
}

// @cpt-dod:cpt-noter-dod-core-engine-foundation-package:p1
public enum EngineCommand: Equatable, Sendable {
    case ping
    case shutdown
    case setDetection(enabled: Bool, knownBundleIds: [String])
    case selfTest(playClip: Bool, timeoutMs: UInt32)
    case startSession(StartSession)
    case pause(callId: String)
    case resume(callId: String)
    case stop(callId: String)
    case excludeProcess(callId: String, bundleId: String)
    case setGlossary(entries: JSONValue)
    case setLanguages(languages: JSONValue)
    /// Replay a span of the stored audio; no `channel` plays both.
    case play(callId: String, fromMs: Int, toMs: Int?, channel: Channel?)
    case stopPlayback
    /// Archive pass of a stopped call into `result_path` (Large v3, clustering, constraints).
    case offlinePass(OfflinePass)
    /// The 256-value speaker embedding of spans, written to `out_path`.
    case speakerEmbedding(SpeakerEmbedding)
    /// 1024-value text embeddings: one text inline, a batch into `out_path`.
    case embedTexts(requestId: String, texts: [String], outPath: String?)
    /// A command of the protocol this engine does not answer yet.
    case other(type: String)
}

public struct EngineCommandLine: Decodable, Equatable, Sendable {
    public let id: UInt64
    public let cmd: EngineCommand

    public init(id: UInt64, cmd: EngineCommand) {
        self.id = id
        self.cmd = cmd
    }
}

private struct AnyKey: CodingKey {
    var stringValue: String
    var intValue: Int? { nil }
    init(_ s: String) { stringValue = s }
    init?(stringValue: String) { self.stringValue = stringValue }
    init?(intValue: Int) { nil }
}

extension EngineCommand: Decodable {
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: AnyKey.self)
        let type = try c.decode(String.self, forKey: AnyKey("type"))
        switch type {
        case "ping": self = .ping
        case "shutdown": self = .shutdown
        case "set_detection":
            self = .setDetection(
                enabled: try c.decode(Bool.self, forKey: AnyKey("enabled")),
                knownBundleIds: try c.decode([String].self, forKey: AnyKey("known_bundle_ids")))
        case "self_test":
            self = .selfTest(
                playClip: try c.decode(Bool.self, forKey: AnyKey("play_clip")),
                timeoutMs: try c.decode(UInt32.self, forKey: AnyKey("timeout_ms")))
        case "start_session":
            func key(_ k: String) -> AnyKey { AnyKey(k) }
            self = .startSession(
                StartSession(
                    callId: try c.decode(String.self, forKey: key("call_id")),
                    sessionDir: try c.decode(String.self, forKey: key("session_dir")),
                    storeAudio: try c.decode(Bool.self, forKey: key("store_audio")),
                    micDeviceUid: try c.decode(String?.self, forKey: key("mic_device_uid")),
                    excludeBundleIds: try c.decode([String].self, forKey: key("exclude_bundle_ids")),
                    languages: try c.decode(JSONValue.self, forKey: key("languages")),
                    backend: try c.decode(String.self, forKey: key("backend")),
                    glossary: try c.decode(JSONValue.self, forKey: key("glossary")),
                    speakerPriors: try c.decode(JSONValue.self, forKey: key("speaker_priors")),
                    enrolledEmbeddingsPath: try c.decode(String?.self, forKey: key("enrolled_embeddings_path")),
                    resumeFromMs: try c.decode(UInt32?.self, forKey: key("resume_from_ms"))))
        case "pause": self = .pause(callId: try c.decode(String.self, forKey: AnyKey("call_id")))
        case "resume": self = .resume(callId: try c.decode(String.self, forKey: AnyKey("call_id")))
        case "stop": self = .stop(callId: try c.decode(String.self, forKey: AnyKey("call_id")))
        case "exclude_process":
            self = .excludeProcess(
                callId: try c.decode(String.self, forKey: AnyKey("call_id")),
                bundleId: try c.decode(String.self, forKey: AnyKey("bundle_id")))
        case "set_glossary": self = .setGlossary(entries: try c.decode(JSONValue.self, forKey: AnyKey("entries")))
        case "set_languages": self = .setLanguages(languages: try c.decode(JSONValue.self, forKey: AnyKey("languages")))
        case "play":
            self = .play(
                callId: try c.decode(String.self, forKey: AnyKey("call_id")),
                fromMs: try c.decode(Int.self, forKey: AnyKey("from_ms")),
                toMs: try c.decode(Int?.self, forKey: AnyKey("to_ms")),
                channel: try c.decode(Channel?.self, forKey: AnyKey("channel")))
        case "stop_playback": self = .stopPlayback
        case "offline_pass":
            self = .offlinePass(
                OfflinePass(
                    callId: try c.decode(String.self, forKey: AnyKey("call_id")),
                    sessionDir: try c.decode(String.self, forKey: AnyKey("session_dir")),
                    resultPath: try c.decode(String.self, forKey: AnyKey("result_path")),
                    constraintsPath: try c.decode(String?.self, forKey: AnyKey("constraints_path")),
                    backend: try c.decode(String.self, forKey: AnyKey("backend"))))
        case "speaker_embedding":
            self = .speakerEmbedding(
                SpeakerEmbedding(
                    requestId: try c.decode(String.self, forKey: AnyKey("request_id")),
                    callId: try c.decode(String.self, forKey: AnyKey("call_id")),
                    channel: try c.decode(Channel.self, forKey: AnyKey("channel")),
                    spans: try c.decode([Span].self, forKey: AnyKey("spans")),
                    outPath: try c.decode(String.self, forKey: AnyKey("out_path"))))
        case "embed_texts":
            self = .embedTexts(
                requestId: try c.decode(String.self, forKey: AnyKey("request_id")),
                texts: try c.decode([String].self, forKey: AnyKey("texts")),
                outPath: try c.decode(String?.self, forKey: AnyKey("out_path")))
        default: self = .other(type: type)
        }
    }
}

public enum EngineEvent: Equatable, Sendable {
    case ready(protocolVersion: String, engineVersion: String, models: [String], sandboxed: Bool)
    case ack(cmdId: UInt64)
    case error(cmdId: UInt64?, code: EngineErrorCode, message: String)
    case pong
    case levels(callId: String?, micDb: Float, sysDb: Float)
    case selfTestStream(channel: Channel)
    case selfTestResult(passed: Bool, failure: EngineErrorCode?, ownSoundsLeak: Bool)
    case sessionStarted(callId: String, micDevice: String, outputDevice: String)
    case sessionStopped(callId: String, timelinePath: String, micPath: String?, sysPath: String?)
    case deviceChanged(callId: String, deviceName: String, gapFromMs: Int, gapToMs: Int)
    case callDetected(bundleId: String, appName: String, pid: Int32)
    case callAudioReleased(bundleId: String)
    case audioSourceAdded(callId: String, bundleId: String, appName: String)
    case systemAudioSilent(callId: String, sinceMs: Int, confidence: Float)
    case playbackPosition(callId: String, atMs: Int, playing: Bool)
    case segment(Segment)
    case noSegments(callId: String, sinceMs: Int)
    case silence(callId: String, sinceMs: Int)
    case selfTestLine(channel: Channel, text: String)
    case offlineProgress(callId: String, progress: Float)
    case offlineDone(callId: String, resultPath: String)
    case offlineFailed(callId: String, code: EngineErrorCode)
    case speakerEmbeddingDone(requestId: String, outPath: String)
    case embeddings(requestId: String, inline: [Float]?, outPath: String?, count: UInt32)
}

extension EngineEvent: Encodable {
    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: AnyKey.self)
        // Optional fields are written as `null`, as serde writes them.
        func put<T: Encodable>(_ key: String, _ value: T?) throws {
            if let value { try c.encode(value, forKey: AnyKey(key)) } else { try c.encodeNil(forKey: AnyKey(key)) }
        }
        switch self {
        case let .ready(protocolVersion, engineVersion, models, sandboxed):
            try put("type", "ready")
            try put("protocol_version", protocolVersion)
            try put("engine_version", engineVersion)
            try put("models", models)
            try put("sandboxed", sandboxed)
        case let .ack(cmdId):
            try put("type", "ack")
            try put("cmd_id", cmdId)
        case let .error(cmdId, code, message):
            try put("type", "error")
            try put("cmd_id", cmdId)
            try put("code", code)
            try put("message", message)
        case .pong:
            try put("type", "pong")
        case let .levels(callId, micDb, sysDb):
            try put("type", "levels")
            try put("call_id", callId)
            try put("mic_db", micDb)
            try put("sys_db", sysDb)
        case let .selfTestStream(channel):
            try put("type", "self_test_stream")
            try put("channel", channel)
        case let .selfTestResult(passed, failure, ownSoundsLeak):
            try put("type", "self_test_result")
            try put("passed", passed)
            try put("failure", failure)
            try put("own_sounds_leak", ownSoundsLeak)
        case let .sessionStarted(callId, micDevice, outputDevice):
            try put("type", "session_started")
            try put("call_id", callId)
            try put("mic_device", micDevice)
            try put("output_device", outputDevice)
        case let .sessionStopped(callId, timelinePath, micPath, sysPath):
            try put("type", "session_stopped")
            try put("call_id", callId)
            try put("timeline_path", timelinePath)
            try put("mic_path", micPath)
            try put("sys_path", sysPath)
        case let .deviceChanged(callId, deviceName, gapFromMs, gapToMs):
            try put("type", "device_changed")
            try put("call_id", callId)
            try put("device_name", deviceName)
            try put("gap_from_ms", gapFromMs)
            try put("gap_to_ms", gapToMs)
        case let .callDetected(bundleId, appName, pid):
            try put("type", "call_detected")
            try put("bundle_id", bundleId)
            try put("app_name", appName)
            try put("pid", pid)
        case let .callAudioReleased(bundleId):
            try put("type", "call_audio_released")
            try put("bundle_id", bundleId)
        case let .audioSourceAdded(callId, bundleId, appName):
            try put("type", "audio_source_added")
            try put("call_id", callId)
            try put("bundle_id", bundleId)
            try put("app_name", appName)
        case let .systemAudioSilent(callId, sinceMs, confidence):
            try put("type", "system_audio_silent")
            try put("call_id", callId)
            try put("since_ms", sinceMs)
            try put("confidence", confidence)
        case let .playbackPosition(callId, atMs, playing):
            try put("type", "playback_position")
            try put("call_id", callId)
            try put("at_ms", atMs)
            try put("playing", playing)
        case let .segment(segment):
            try put("type", "segment")
            try put("segment", segment)
        case let .noSegments(callId, sinceMs):
            try put("type", "no_segments")
            try put("call_id", callId)
            try put("since_ms", sinceMs)
        case let .silence(callId, sinceMs):
            try put("type", "silence")
            try put("call_id", callId)
            try put("since_ms", sinceMs)
        case let .selfTestLine(channel, text):
            try put("type", "self_test_line")
            try put("channel", channel)
            try put("text", text)
        case let .offlineProgress(callId, progress):
            try put("type", "offline_progress")
            try put("call_id", callId)
            try put("progress", progress)
        case let .offlineDone(callId, resultPath):
            try put("type", "offline_done")
            try put("call_id", callId)
            try put("result_path", resultPath)
        case let .offlineFailed(callId, code):
            try put("type", "offline_failed")
            try put("call_id", callId)
            try put("code", code)
        case let .speakerEmbeddingDone(requestId, outPath):
            try put("type", "speaker_embedding_done")
            try put("request_id", requestId)
            try put("out_path", outPath)
        case let .embeddings(requestId, inline, outPath, count):
            try put("type", "embeddings")
            try put("request_id", requestId)
            try put("inline", inline)
            try put("out_path", outPath)
            try put("count", count)
        }
    }
}

private struct EngineEventLine: Encodable {
    let seq: UInt64
    let at: Int64
    let event: EngineEvent
}

/// Writes event lines to stdout with a `seq` that increases by one per line.
public final class EventWriter: @unchecked Sendable {
    private let lock = NSLock()
    private var seq: UInt64 = 0
    private let clock: () -> Int64
    private let out: (Data) -> Void
    private let encoder = JSONEncoder()

    /// `clock` gives epoch milliseconds; `out` receives whole lines.
    public init(clock: @escaping () -> Int64, out: @escaping (Data) -> Void) {
        self.clock = clock
        self.out = out
    }

    /// stdout, with the wall clock.
    public static func stdout() -> EventWriter {
        EventWriter(clock: { Int64(Date().timeIntervalSince1970 * 1000) }) { FileHandle.standardOutput.write($0) }
    }

    public func emit(_ event: EngineEvent) {
        lock.lock()
        defer { lock.unlock() }
        seq += 1
        guard var line = try? encoder.encode(EngineEventLine(seq: seq, at: clock(), event: event)) else { return }
        line.append(0x0A)
        out(line)
    }
}
