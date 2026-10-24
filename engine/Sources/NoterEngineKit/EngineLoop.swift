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
    private let player: Player
    /// The speech model, loaded on first use; nil without one installed.
    private let model: ModelCache?
    private let asrQueue = DispatchQueue(label: "ai.noter.engine.asr")
    private let stops = DispatchQueue(label: "ai.noter.engine.stop")
    private let processes: @Sendable () -> [ProcessAudio]
    /// The call being captured and its audio; commands arrive on one thread.
    private var session: (capture: CaptureSession, audio: AudioSource)?
    private var replaying = false
    /// Detection and the running capture, shared with `poll`, which runs on its own timer.
    private let facts = NSLock()
    private var detector = Detector()
    private var capturing: CaptureSession?
    private var watcher: DispatchSourceTimer?

    /// `models` are the installed model folders; `source` opens the audio for a session or, given
    /// nil, a self-test (the live taps, or WAV files in file mode and tests); `container` is the
    /// App Group container sessions write into; `now` gives epoch milliseconds; `play` plays the
    /// self-test's clip; `player` replays stored audio; `processes` lists the processes playing or
    /// recording now (`ProcessWatcher.snapshot` live); `transcriber` loads the live speech model.
    public init(
        writer: EventWriter, engineVersion: String, models: [String], sandboxed: Bool,
        container: URL? = nil, now: @escaping () -> Int64 = { Int64(Date().timeIntervalSince1970 * 1000) },
        encoder: @escaping (URL) throws -> AudioEncoder = { try ADTSEncoder(url: $0) },
        play: @escaping @Sendable ([Float]) -> Void = { Clip.play($0) },
        player: Player = FilePlayer(),
        processes: @escaping @Sendable () -> [ProcessAudio] = { [] },
        transcriber: (() throws -> Transcriber)? = nil,
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
        self.player = player
        self.processes = processes
        model = transcriber.map(ModelCache.init)
    }

    /// Checks the processes every `interval` for detection facts, new sound sources and whether
    /// a meeting app plays (live mode).
    /// shortcut: polls once a second instead of a listener per process; listen to
    /// `kAudioProcessPropertyIsRunning*` if a second is too slow for the detection notice.
    public func watchProcesses(every interval: TimeInterval = 1) {
        let timer = DispatchSource.makeTimerSource(queue: DispatchQueue(label: "ai.noter.engine.processes"))
        timer.schedule(deadline: .now() + interval, repeating: interval)
        timer.setEventHandler { [weak self] in self?.poll() }
        timer.resume()
        watcher = timer
    }

    // @cpt-begin:cpt-noter-flow-core-engine-capture-detect:p1:inst-listen
    /// One look at the processes: the facts it brings out, and the meeting app for the zero check.
    func poll() {
        let snapshot = processes()
        let (events, capture, meetingApp) = facts.withLock { (detector.update(snapshot), capturing, detector.meetingAppPlaying) }
        capture?.meetingApp(meetingApp)
        events.forEach(writer.emit)
    }
    // @cpt-end:cpt-noter-flow-core-engine-capture-detect:p1:inst-listen

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
        case let .setDetection(enabled, known):
            facts.withLock { detector.rule(enabled: enabled, known: known) }
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
        case let .play(callId, fromMs, toMs, channel):
            replay(command.id, callId, fromMs, toMs, channel)
        case .stopPlayback:
            player.stop()
            replaying = false
            writer.emit(.ack(cmdId: command.id))
        case let .setGlossary(entries):
            session?.capture.asr.setGlossary(entries)
            writer.emit(.ack(cmdId: command.id))
        case let .setLanguages(languages):
            session?.capture.asr.setLanguages(languages)
            writer.emit(.ack(cmdId: command.id))
        case let .other(type):
            writer.emit(.error(cmdId: command.id, code: .badCommand, message: "\(type) is not supported by this engine yet"))
        }
        return true
    }

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
                start: start, container: container, writer: writer, now: now, encoder: encoder, asrQueue: asrQueue)
            audio.observeDevices { capture.deviceChanged($0) }
            try audio.start { capture.feed($0) }
            // @cpt-end:cpt-noter-flow-core-engine-capture-session:p1:inst-open-streams
            session = (capture, audio)
            let current = processes()
            facts.withLock {
                detector.startSession(callId: start.callId, current: current, excluded: start.excludeBundleIds)
                capturing = capture
            }
            writer.emit(.ack(cmdId: id))
            // @cpt-begin:cpt-noter-flow-core-engine-capture-session:p1:inst-session-started
            writer.emit(.sessionStarted(callId: start.callId, micDevice: audio.devices.mic, outputDevice: audio.devices.output))
            // @cpt-end:cpt-noter-flow-core-engine-capture-session:p1:inst-session-started
            // @cpt-begin:cpt-noter-flow-core-engine-capture-recover:p1:inst-capture-first
            // The taps run already; the model loads behind them (what was said meanwhile is decoded
            // then), and after a restart the ring's unconfirmed tail is decoded behind the load.
            if let model {
                capture.asr.load(model.get)
                capture.decodeRingTail()
            }
            // @cpt-end:cpt-noter-flow-core-engine-capture-recover:p1:inst-capture-first
            // Only now does audio reach the ring and the transcript, so neither the ring's tail
            // nor the utterance it opens can mix with the successor's first chunks.
            capture.go()
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
            facts.withLock {
                detector.stopSession()
                capturing = nil
            }
            self.session = nil
            // The last words (after a model still loading) and the files can take seconds to
            // finish: off the command thread, so `ping` is still answered meanwhile.
            let (capture, writer) = (session.capture, self.writer)
            stops.async {
                capture.asr.finish()
                // @cpt-begin:cpt-noter-flow-core-engine-capture-session:p1:inst-return-session
                writer.emit(capture.stop())
                // @cpt-end:cpt-noter-flow-core-engine-capture-session:p1:inst-return-session
            }
        // @cpt-end:cpt-noter-flow-core-engine-capture-session:p1:inst-if-stop
        case let .excludeProcess(_, bundleId):
            do {
                try session.audio.exclude(bundleId: bundleId)
                facts.withLock { detector.exclude(bundleId) }
                writer.emit(.ack(cmdId: command.id))
            } catch {
                writer.emit(.error(cmdId: command.id, code: .internal, message: "\(error)"))
            }
        default:
            break
        }
    }

    // @cpt-flow:cpt-noter-flow-core-engine-capture-replay:p2
    // @cpt-begin:cpt-noter-flow-core-engine-capture-replay:p1:inst-play
    /// Plays the call's stored files (`audio/<call_id>/`); a new `play` replaces the one before.
    private func replay(_ id: UInt64, _ callId: String, _ fromMs: Int, _ toMs: Int?, _ channel: Channel?) {
        let dir = container?.appendingPathComponent("audio/\(callId)", isDirectory: true)
        let files = (channel.map { [$0] } ?? [.mic, .sys]).compactMap { dir?.appendingPathComponent("\($0.rawValue).m4a") }
            .filter { FileManager.default.fileExists(atPath: $0.path) }
        guard !files.isEmpty else {
            // The core reads an error for `play` as `audio_deleted`.
            writer.emit(.error(cmdId: id, code: .badCommand, message: "no stored audio for \(callId)"))
            return
        }
        if replaying { player.stop() }
        let writer = self.writer
        do {
            try player.play(files, fromMs: fromMs, toMs: toMs) { at, playing in
                writer.emit(.playbackPosition(callId: callId, atMs: at, playing: playing))
            }
            replaying = true
            // @cpt-begin:cpt-noter-flow-core-engine-capture-replay:p1:inst-return-replay
            writer.emit(.ack(cmdId: id))
            // @cpt-end:cpt-noter-flow-core-engine-capture-replay:p1:inst-return-replay
        } catch {
            writer.emit(.error(cmdId: id, code: .internal, message: "\(error)"))
        }
    }
    // @cpt-end:cpt-noter-flow-core-engine-capture-replay:p1:inst-play

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
        // @cpt-begin:cpt-noter-flow-core-engine-capture-self-test:p1:inst-self-test-lines
        // The core waits for the result only a little past the window, and a cold model can take
        // longer to load: lines come from a model already loaded; otherwise it starts loading now.
        if let model, !models.isEmpty {
            if let transcriber = model.ready {
                for channel in [Channel.mic, .sys] where Date() < deadline {
                    let heard = state.heard(channel)
                    guard !heard.isEmpty, let d = try? transcriber.decode(heard, languages: []), LiveASR.keep(d) else { continue }
                    writer.emit(.selfTestLine(channel: channel, text: d.text.trimmingCharacters(in: .whitespacesAndNewlines)))
                }
            } else {
                asrQueue.async { _ = try? model.get() }
            }
        }
        // @cpt-end:cpt-noter-flow-core-engine-capture-self-test:p1:inst-self-test-lines
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
    /// Up to 10 s per channel at 16 kHz, for the self-test lines.
    private var audio: [Channel: [Float]] = [:]

    /// The events a chunk causes, or nil once the result is out.
    func feed(_ chunk: AudioChunk) -> [EngineEvent]? {
        lock.lock()
        defer { lock.unlock() }
        guard !finished else { return nil }
        if chunk.channel == .mic { mic = Levels.db(chunk.samples) } else { sys = Levels.db(chunk.samples) }
        if audio[chunk.channel, default: []].count < 160_000 {
            audio[chunk.channel, default: []] += Mix.resample(chunk.samples, from: chunk.sampleRate, to: 16_000)
        }
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

    func heard(_ channel: Channel) -> [Float] { lock.withLock { audio[channel] ?? [] } }

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

/// The speech model, loaded once per engine on first use; sessions and self-tests share it.
final class ModelCache: @unchecked Sendable {
    private let lock = NSLock()
    private let make: () throws -> Transcriber
    private var loaded: Transcriber?

    init(_ make: @escaping () throws -> Transcriber) { self.make = make }

    /// The model if it is loaded already; never waits for a load.
    var ready: Transcriber? {
        guard lock.try() else { return nil }  // a load holds the lock: not ready
        defer { lock.unlock() }
        return loaded
    }

    func get() throws -> Transcriber {
        try lock.withLock {
            if let loaded { return loaded }
            let t = try make()
            loaded = t
            return t
        }
    }
}
