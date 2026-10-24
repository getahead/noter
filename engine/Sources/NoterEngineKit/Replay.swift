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

/// shortcut: not exercised by the CI tests (no output device there); the M1 week-one runbook
/// plays a span on the Mac.
public final class FilePlayer: Player, @unchecked Sendable {
    private let lock = NSLock()
    private var engine: AVAudioEngine?
    private var timer: DispatchSourceTimer?
    private var finish: (() -> Void)?

    public init() {}

    public func play(_ files: [URL], fromMs: Int, toMs: Int?, position: @escaping @Sendable (Int, Bool) -> Void) throws {
        stop()
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
            position(fromMs, false)
            return
        }
        try engine.start()
        nodes.forEach { $0.play() }
        // @cpt-begin:cpt-noter-flow-core-engine-capture-replay:p1:inst-position
        func head() -> Int {
            guard let now = lead.lastRenderTime, let t = lead.playerTime(forNodeTime: now) else { return fromMs }
            return min(endMs, fromMs + Int(Double(t.sampleTime) * 1000 / t.sampleRate))
        }
        let timer = DispatchSource.makeTimerSource(queue: DispatchQueue(label: "ai.noter.engine.replay"))
        lock.withLock {
            (self.engine, self.timer) = (engine, timer)
            finish = { position(head(), false) }
        }
        timer.schedule(deadline: .now() + 0.25, repeating: 0.25)
        timer.setEventHandler { [weak self] in
            let at = head()
            if at >= endMs { self?.stop() } else { position(at, true) }
        }
        timer.resume()
        // @cpt-end:cpt-noter-flow-core-engine-capture-replay:p1:inst-position
    }

    public func stop() {
        let (engine, timer, finish) = lock.withLock {
            defer { (self.engine, self.timer, self.finish) = (nil, nil, nil) }
            return (self.engine, self.timer, self.finish)
        }
        timer?.cancel()
        finish?()
        engine?.stop()
    }
}
