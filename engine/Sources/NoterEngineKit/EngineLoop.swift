// The engine's command loop: one command line in, `ack`/`error`/`pong` and events out.

import Foundation

public final class EngineLoop: @unchecked Sendable {
    private let writer: EventWriter
    private let engineVersion: String
    private let models: [String]
    private let sandboxed: Bool
    private let source: () -> AudioSource?
    private let selfTests = DispatchQueue(label: "ai.noter.engine.self-test")
    private let decoder = JSONDecoder()

    /// `models` are the installed model folders; `source` opens the audio for a self-test
    /// (the live taps, or WAV files in file mode and tests).
    public init(
        writer: EventWriter, engineVersion: String, models: [String], sandboxed: Bool,
        source: @escaping () -> AudioSource?
    ) {
        self.writer = writer
        self.engineVersion = engineVersion
        self.models = models
        self.sandboxed = sandboxed
        self.source = source
    }

    /// Announces the engine; the core checks the protocol major.
    public func start() {
        writer.emit(
            .ready(
                protocolVersion: engineProtocolVersion, engineVersion: engineVersion, models: models,
                sandboxed: sandboxed))
    }

    /// Handles one stdin line. Returns false after `shutdown`.
    public func handle(_ line: String) -> Bool {
        guard let command = try? decoder.decode(EngineCommandLine.self, from: Data(line.utf8)) else {
            writer.emit(.error(cmdId: nil, code: .badCommand, message: "a command line did not parse"))
            return true
        }
        switch command.cmd {
        case .ping:
            writer.emit(.pong)
        case .shutdown:
            writer.emit(.ack(cmdId: command.id))
            return false
        case .setDetection:
            // shortcut: acknowledged only; the call-detection listeners arrive with capture (M1).
            writer.emit(.ack(cmdId: command.id))
        case let .selfTest(_, timeoutMs):
            writer.emit(.ack(cmdId: command.id))
            selfTests.async { self.selfTest(timeout: TimeInterval(timeoutMs) / 1000) }
        case let .other(type):
            writer.emit(.error(cmdId: command.id, code: .badCommand, message: "\(type) is not supported by this engine yet"))
        }
        return true
    }

    // @cpt-flow:cpt-noter-flow-core-engine-foundation-self-test:p1
    private func selfTest(timeout: TimeInterval) {
        let state = SelfTestState()
        let done = DispatchSemaphore(value: 0)
        let writer = self.writer
        // @cpt-begin:cpt-noter-flow-core-engine-foundation-self-test:p1:inst-open-taps
        let audio = source()
        do {
            try audio?.start { chunk in
                guard let events = state.feed(chunk) else { return }
                events.forEach(writer.emit)
                if let levels = state.levelsDue() { writer.emit(levels) }
                if state.bothArrived { done.signal() }
            }
        } catch {
            FileHandle.standardError.write(Data("noter-engine: self-test audio: \(error)\n".utf8))
        }
        // @cpt-end:cpt-noter-flow-core-engine-foundation-self-test:p1:inst-open-taps
        _ = done.wait(timeout: .now() + timeout)
        audio?.stop()
        // @cpt-begin:cpt-noter-flow-core-engine-foundation-self-test:p1:inst-return-self-test
        writer.emit(state.finish(modelsPresent: !models.isEmpty))
        // @cpt-end:cpt-noter-flow-core-engine-foundation-self-test:p1:inst-return-self-test
    }
}

/// The self-test's state, shared with the audio callbacks.
private final class SelfTestState: @unchecked Sendable {
    private let lock = NSLock()
    private var monitor = SelfTestMonitor()
    private var finished = false
    private var mic: Float = -160
    private var sys: Float = -160
    private var lastLevels: Date?

    /// The events a chunk causes, or nil once the result is out.
    func feed(_ chunk: AudioChunk) -> [EngineEvent]? {
        lock.lock()
        defer { lock.unlock() }
        guard !finished else { return nil }
        if chunk.channel == .mic { mic = Levels.db(chunk.samples) } else { sys = Levels.db(chunk.samples) }
        return monitor.feed(chunk)
    }

    // @cpt-begin:cpt-noter-flow-core-engine-foundation-self-test:p1:inst-levels-lines
    /// Levels at most every 100 ms.
    func levelsDue() -> EngineEvent? {
        lock.lock()
        defer { lock.unlock() }
        guard !finished, lastLevels.map({ Date().timeIntervalSince($0) >= 0.1 }) ?? true else { return nil }
        lastLevels = Date()
        return .levels(callId: nil, micDb: mic, sysDb: sys)
    }
    // @cpt-end:cpt-noter-flow-core-engine-foundation-self-test:p1:inst-levels-lines

    var bothArrived: Bool {
        lock.lock()
        defer { lock.unlock() }
        return monitor.bothArrived
    }

    func finish(modelsPresent: Bool) -> EngineEvent {
        lock.lock()
        defer { lock.unlock() }
        finished = true
        return monitor.result(modelsPresent: modelsPresent)
    }
}
