// Replay (`cpt-noter-flow-core-engine-capture-replay`): a span of the stored call audio played
// natively on the current output. The engine plays it itself, and the capture tap leaves out
// the engine's own process, so a replay during a call never enters the recording.

import AVFoundation

/// Plays stored audio; the seam the tests replace.
public protocol Player: AnyObject, Sendable {
    /// Plays `files` together from `fromMs` to `toMs` (or their end). `position` gets the play
    /// head about every 250 ms while playing, and once with `playing: false` at the end or on `stop`.
    func play(_ files: [URL], fromMs: Int, toMs: Int?, position: @escaping @Sendable (Int, Bool) -> Void) throws
    func stop()
}

/// shortcut: device playback is exercised by the Mac runbook; control-path tests use fake audio and timers.
// @cpt-begin:cpt-noter-flow-core-engine-capture-replay:p1:inst-position
public final class FilePlayer: Player, @unchecked Sendable {
    struct Audio {
        let endMs: Int
        let head: () -> Int
        let stop: () -> Void
    }

    private let prepare: ([URL], Int, Int?) throws -> Audio?
    private let schedule: (@escaping @Sendable () -> Void) -> () -> Void
    // Progress and completion are serialized with replacement; a callback may itself stop playback.
    private let lock = NSRecursiveLock()
    private var audio: Audio?
    private var cancel: (() -> Void)?
    private var finish: (() -> Void)?
    private var generation: UUID?

    public convenience init() { self.init(prepare: Self.prepareAudio, schedule: Self.scheduleTimer) }

    init(
        prepare: @escaping ([URL], Int, Int?) throws -> Audio?,
        schedule: @escaping (@escaping @Sendable () -> Void) -> () -> Void
    ) {
        self.prepare = prepare
        self.schedule = schedule
    }

    public func play(_ files: [URL], fromMs: Int, toMs: Int?, position: @escaping @Sendable (Int, Bool) -> Void) throws {
        try lock.withLock {
            stop()
            guard let audio = try prepare(files, fromMs, toMs) else { position(fromMs, false); return }
            let generation = UUID()
            self.generation = generation
            self.audio = audio
            finish = { position(audio.head(), false) }
            let cancel = schedule { [weak self] in
                let at = audio.head()
                self?.tick(generation, at: at, endMs: audio.endMs, position: position)
            }
            if self.generation == generation { self.cancel = cancel } else { cancel() }
        }
    }

    private func tick(_ generation: UUID, at: Int, endMs: Int, position: (Int, Bool) -> Void) {
        lock.withLock {
            guard self.generation == generation else { return }
            if at >= endMs { stop() } else { position(at, true) }
        }
    }

    public func stop() {
        let audio = lock.withLock {
            let (audio, cancel, finish) = (self.audio, self.cancel, self.finish)
            (self.audio, self.cancel, self.finish, generation) = (nil, nil, nil, nil)
            cancel?()
            finish?()
            return audio
        }
        audio?.stop()
    }

    private static func scheduleTimer(_ tick: @escaping @Sendable () -> Void) -> () -> Void {
        let timer = DispatchSource.makeTimerSource(queue: DispatchQueue(label: "ai.noter.engine.replay"))
        timer.schedule(deadline: .now() + 0.25, repeating: 0.25)
        timer.setEventHandler(handler: tick)
        timer.resume()
        return { timer.cancel() }
    }

    private static func prepareAudio(_ files: [URL], _ fromMs: Int, _ toMs: Int?) throws -> Audio? {
        let engine = AVAudioEngine()
        var nodes: [AVAudioPlayerNode] = []
        var endMs = fromMs
        for url in files {
            let file = try AVAudioFile(forReading: url)
            let rate = file.processingFormat.sampleRate
            let first = AVAudioFramePosition(Double(fromMs) * rate / 1000)
            let last = min(file.length, toMs.map { AVAudioFramePosition(Double($0) * rate / 1000) } ?? file.length)
            guard last > first else { continue }
            let node = AVAudioPlayerNode()
            engine.attach(node)
            engine.connect(node, to: engine.mainMixerNode, format: file.processingFormat)
            node.scheduleSegment(file, startingFrame: first, frameCount: AVAudioFrameCount(last - first), at: nil)
            nodes.append(node)
            endMs = max(endMs, Int(Double(last) * 1000 / rate))
        }
        guard let lead = nodes.first else {
            return nil
        }
        try engine.start()
        nodes.forEach { $0.play() }
        func head() -> Int {
            guard let now = lead.lastRenderTime, let t = lead.playerTime(forNodeTime: now) else { return fromMs }
            return min(endMs, fromMs + Int(Double(t.sampleTime) * 1000 / t.sampleRate))
        }
        return Audio(endMs: endMs, head: head, stop: { engine.stop() })
    }
}
// @cpt-end:cpt-noter-flow-core-engine-capture-replay:p1:inst-position
