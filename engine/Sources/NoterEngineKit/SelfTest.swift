// The engine half of the first-run self-test (`cpt-noter-flow-core-engine-foundation-self-test`):
// it proves both channels deliver non-zero buffers. The core decides `permission_missing`
// before it sends `self_test` (decision E2), so the engine only reports what it heard. In M1
// it runs on the capture pipeline (`cpt-noter-flow-core-engine-capture-self-test`): the same
// one-clock source as a session, and with `play_clip` the engine's own clip, which the tap must
// not hear.

import AVFoundation
import os

/// Watches the self-test's audio and decides its result.
public struct SelfTestMonitor: Sendable {
    private var arrived: Set<Channel> = []
    private var heard: Set<Channel> = []
    private var listening = false
    private var leaked = false

    public init() {}

    public var bothArrived: Bool { arrived.count == 2 }

    // @cpt-begin:cpt-noter-flow-core-engine-foundation-self-test:p1:inst-stream-arrived
    /// `self_test_stream` for a channel's first non-zero buffer.
    public mutating func feed(_ chunk: AudioChunk) -> [EngineEvent] {
        heard.insert(chunk.channel)
        // @cpt-begin:cpt-noter-flow-core-engine-capture-self-test:p1:inst-play-clip
        if listening, chunk.channel == .sys, Clip.heard(in: chunk) { leaked = true }
        // @cpt-end:cpt-noter-flow-core-engine-capture-self-test:p1:inst-play-clip
        guard !arrived.contains(chunk.channel), chunk.samples.contains(where: { $0 != 0 }) else { return [] }
        arrived.insert(chunk.channel)
        return [.selfTestStream(channel: chunk.channel)]
    }
    // @cpt-end:cpt-noter-flow-core-engine-foundation-self-test:p1:inst-stream-arrived

    /// From now on the engine plays its clip; the system channel must not carry it.
    public mutating func clipStarted() { listening = true }

    // @cpt-begin:cpt-noter-flow-core-engine-foundation-self-test:p1:inst-result
    /// Passed only with non-zero buffers on both channels and the live model installed. A channel
    /// that delivered only exact digital zeros is `zero_buffers` (for system audio: the System
    /// Audio Recording permission is off, inferred); one that delivered nothing is
    /// `device_unavailable`. The tap hearing the engine's own clip fails it as `OwnSoundsLeak`.
    public func result(modelsPresent: Bool) -> EngineEvent {
        let failure: EngineErrorCode?
        if !modelsPresent {
            failure = .modelMissing
        } else if let missing = [Channel.mic, .sys].first(where: { !arrived.contains($0) }) {
            failure = heard.contains(missing) ? .zeroBuffers : .deviceUnavailable
        } else {
            failure = nil
        }
        return .selfTestResult(passed: failure == nil && !leaked, failure: failure, ownSoundsLeak: leaked)
    }
    // @cpt-end:cpt-noter-flow-core-engine-foundation-self-test:p1:inst-result
}

/// The self-test's clip: one second of a tone no call carries for long on its own.
public enum Clip {
    public static let hz: Float = 1_500
    public static let seconds = 1.0

    /// 16 kHz samples at -12 dBFS, faded in and out over 20 ms.
    public static func samples() -> [Float] {
        let n = Int(16_000 * seconds)
        return (0..<n).map { i in
            let fade = Float(min(i, n - 1 - i, 320)) / 320
            return 0.25 * fade * sin(Float(i) * 2 * .pi * hz / 16_000)
        }
    }

    /// The share of a chunk's energy at the clip's pitch, 0...1 (the Goertzel power at `hz`
    /// against the whole chunk's).
    public static func share(_ samples: [Float], rate: Double) -> Float {
        let energy = samples.reduce(Float(0)) { $0 + $1 * $1 }
        guard energy > 0 else { return 0 }
        let coefficient = 2 * cos(2 * .pi * hz / Float(rate))
        var (s1, s2) = (Float(0), Float(0))
        for x in samples { (s1, s2) = (x + coefficient * s1 - s2, s1) }
        let power = s1 * s1 + s2 * s2 - coefficient * s1 * s2
        return min(1, 2 * power / (Float(samples.count) * energy))
    }

    /// shortcut: a pitch test, not a correlation with the clip; a call that holds 1.5 kHz above
    /// -60 dBFS for a whole chunk would read as a leak. Correlate with the clip if that shows up.
    static func heard(in chunk: AudioChunk) -> Bool {
        Levels.db(chunk.samples) > -60 && share(chunk.samples, rate: chunk.sampleRate) > 0.5
    }

    // @cpt-begin:cpt-noter-flow-core-engine-capture-self-test:p1:inst-play-clip
    /// Plays the clip on the default output; the player lives until the next clip.
    public static func play(_ samples: [Float]) {
        let data = WAV.encode(samples: samples, sampleRate: 16_000, float: false)
        guard let player = try? AVAudioPlayer(data: data) else { return }
        playing.withLock { $0 = player }
        player.play()
    }
    // @cpt-end:cpt-noter-flow-core-engine-capture-self-test:p1:inst-play-clip

    private static let playing = OSAllocatedUnfairLock<AVAudioPlayer?>(uncheckedState: nil)
}
