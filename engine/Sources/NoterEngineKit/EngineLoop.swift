// The engine's command loop: one command line in, `ack`/`error`/`pong` and events out.

import Foundation

public final class EngineLoop: @unchecked Sendable {
    private let writer: EventWriter
    private let engineVersion: String
    private let models: [String]
    private let sandboxed: Bool
    private let source: (StartSession?) -> AudioSource?
    private let play: @Sendable ([Float]) -> Void
    private let container: URL?
    private let now: () -> Int64
    private let encoder: (URL) throws -> AudioEncoder
    private let selfTests = DispatchQueue(label: "ai.noter.engine.self-test")
    private let decoder = JSONDecoder()
    /// The call being captured and its audio; commands arrive on one thread.
    private var session: (capture: CaptureSession, audio: AudioSource)?

    /// `models` are the installed model folders; `source` opens the audio for a session or, given
    /// nil, a self-test (the live taps, or WAV files in file mode and tests); `container` is the
    /// App Group container sessions write into; `now` gives epoch milliseconds; `play` plays the
    /// self-test's clip.
    public init(
        writer: EventWriter, engineVersion: String, models: [String], sandboxed: Bool,
        container: URL? = nil, now: @escaping () -> Int64 = { Int64(Date().timeIntervalSince1970 * 1000) },
        encoder: @escaping (URL) throws -> AudioEncoder = { try ADTSEncoder(url: $0) },
        play: @escaping @Sendable ([Float]) -> Void = { Clip.play($0) },
        source: @escaping (StartSession?) -> AudioSource?
    ) {
        self.writer = writer
        self.engineVersion = engineVersion
        self.models = models
        self.sandboxed = sandboxed
        self.container = container
        self.now = now
        self.encoder = encoder
        self.source = source
        self.play = play
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
        case let .selfTest(playClip, timeoutMs):
            writer.emit(.ack(cmdId: command.id))
            selfTests.async { self.selfTest(timeout: TimeInterval(timeoutMs) / 1000, playClip: playClip) }
        case let .startSession(start):
            startSession(command.id, start)
        case let .pause(callId), let .resume(callId), let .stop(callId), let .excludeProcess(callId, _):
            guard let session, session.capture.callId == callId else {
                writer.emit(.error(cmdId: command.id, code: .noSession, message: "no session for \(callId)"))
                break
            }
            sessionCommand(command, session)
        case .setGlossary, .setLanguages:
            // shortcut: kept for the live ASR loop, which arrives with it; acknowledged now.
            writer.emit(.ack(cmdId: command.id))
        case let .other(type):
            writer.emit(.error(cmdId: command.id, code: .badCommand, message: "\(type) is not supported by this engine yet"))
        }
        return true
    }

    // @cpt-flow:cpt-noter-flow-core-engine-capture-session:p1
    private func startSession(_ id: UInt64, _ start: StartSession) {
        guard session == nil else {
            writer.emit(.error(cmdId: id, code: .badCommand, message: "a session runs already"))
            return
        }
        do {
            guard let container else { throw LiveAudioSource.Failure(description: "no App Group container") }
            // @cpt-begin:cpt-noter-flow-core-engine-capture-session:p1:inst-open-streams
            guard let audio = source(start) else { throw LiveAudioSource.Failure(description: "no audio source") }
            let capture = try CaptureSession(
                start: start, container: container, writer: writer, now: now, encoder: encoder)
            audio.observeDevices { capture.deviceChanged($0) }
            try audio.start { capture.feed($0) }
            // @cpt-end:cpt-noter-flow-core-engine-capture-session:p1:inst-open-streams
            session = (capture, audio)
            writer.emit(.ack(cmdId: id))
            // @cpt-begin:cpt-noter-flow-core-engine-capture-session:p1:inst-session-started
            writer.emit(.sessionStarted(callId: start.callId, micDevice: audio.devices.mic, outputDevice: audio.devices.output))
            capture.go()
            // @cpt-end:cpt-noter-flow-core-engine-capture-session:p1:inst-session-started
        } catch {
            writer.emit(.error(cmdId: id, code: .deviceUnavailable, message: "\(error)"))
        }
    }

    private func sessionCommand(_ command: EngineCommandLine, _ session: (capture: CaptureSession, audio: AudioSource)) {
        switch command.cmd {
        // @cpt-begin:cpt-noter-flow-core-engine-capture-session:p1:inst-if-pause
        case .pause:
            session.audio.stop()
            session.capture.pause()
            writer.emit(.ack(cmdId: command.id))
        case .resume:
            session.capture.resume()
            do {
                try session.audio.start { session.capture.feed($0) }
                writer.emit(.ack(cmdId: command.id))
            } catch {
                writer.emit(.error(cmdId: command.id, code: .deviceUnavailable, message: "\(error)"))
            }
        // @cpt-end:cpt-noter-flow-core-engine-capture-session:p1:inst-if-pause
        // @cpt-begin:cpt-noter-flow-core-engine-capture-session:p1:inst-if-stop
        case .stop:
            session.audio.stop()
            writer.emit(.ack(cmdId: command.id))
            writer.emit(session.capture.stop())
            self.session = nil
        // @cpt-end:cpt-noter-flow-core-engine-capture-session:p1:inst-if-stop
        case let .excludeProcess(_, bundleId):
            do {
                try session.audio.exclude(bundleId: bundleId)
                writer.emit(.ack(cmdId: command.id))
            } catch {
                writer.emit(.error(cmdId: command.id, code: .internal, message: "\(error)"))
            }
        default:
            break
        }
    }

    // @cpt-flow:cpt-noter-flow-core-engine-foundation-self-test:p1
    // @cpt-flow:cpt-noter-flow-core-engine-capture-self-test:p1
    private func selfTest(timeout: TimeInterval, playClip: Bool) {
        let deadline = Date().addingTimeInterval(timeout)
        let state = SelfTestState()
        let done = DispatchSemaphore(value: 0)
        let writer = self.writer
        // @cpt-begin:cpt-noter-flow-core-engine-foundation-self-test:p1:inst-open-taps
        // @cpt-begin:cpt-noter-flow-core-engine-capture-self-test:p1:inst-self-test-one-clock
        let audio = source(nil)
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
        // @cpt-end:cpt-noter-flow-core-engine-capture-self-test:p1:inst-self-test-one-clock
        // @cpt-end:cpt-noter-flow-core-engine-foundation-self-test:p1:inst-open-taps
        // @cpt-begin:cpt-noter-flow-core-engine-capture-self-test:p1:inst-play-clip
        if playClip, audio != nil {
            state.clipStarted()
            play(Clip.samples())
            // The tap is listened to until the clip is over, however soon both channels arrive.
            Thread.sleep(until: min(deadline, Date().addingTimeInterval(Clip.seconds + 0.3)))
        }
        // @cpt-end:cpt-noter-flow-core-engine-capture-self-test:p1:inst-play-clip
        _ = done.wait(timeout: .now() + max(0, deadline.timeIntervalSinceNow))
        audio?.stop()
        // @cpt-begin:cpt-noter-flow-core-engine-foundation-self-test:p1:inst-return-self-test
        // @cpt-begin:cpt-noter-flow-core-engine-capture-self-test:p1:inst-return-self-test-capture
        writer.emit(state.finish(modelsPresent: !models.isEmpty))
        // @cpt-end:cpt-noter-flow-core-engine-capture-self-test:p1:inst-return-self-test-capture
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

    func clipStarted() { lock.withLock { monitor.clipStarted() } }

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
