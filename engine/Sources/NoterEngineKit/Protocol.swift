// The core ↔ engine protocol, as the engine speaks it (`cpt-noter-interface-engine-stdio`).
//
// The source of truth is `crates/noter-protocol/src/engine.rs` and its export
// `contracts/engine.schema.json`. These are the M0 messages the engine answers;
// commands it does not implement yet decode as `.other` and are refused with `bad_command`.
// shortcut: hand-written for the M0 subset; generate them from contracts/engine.schema.json
// when capture (M1) needs the full set.

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

public enum EngineCommand: Equatable, Sendable {
    case ping
    case shutdown
    case setDetection(enabled: Bool, knownBundleIds: [String])
    case selfTest(playClip: Bool, timeoutMs: UInt32)
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
    case sessionStopped(callId: String, timelinePath: String, micPath: String?, sysPath: String?)
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
        case let .sessionStopped(callId, timelinePath, micPath, sysPath):
            try put("type", "session_stopped")
            try put("call_id", callId)
            try put("timeline_path", timelinePath)
            try put("mic_path", micPath)
            try put("sys_path", sysPath)
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
