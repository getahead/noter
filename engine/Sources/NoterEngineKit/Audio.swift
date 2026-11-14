// Audio as the engine sees it: chunks of float samples per channel, from the live taps or
// from WAV files (file mode, tests and the golden set).

import AVFoundation
import Foundation

/// Mono samples of one channel at `sampleRate`.
public struct AudioChunk: Sendable {
    public let channel: Channel
    public let samples: [Float]
    public let sampleRate: Double

    public init(channel: Channel, samples: [Float], sampleRate: Double = 16_000) {
        self.channel = channel
        self.samples = samples
        self.sampleRate = sampleRate
    }
}

public enum Mix {
    /// Downmixes planar channel buffers to mono, trimming to the shortest channel.
    public static func mono(_ channels: [[Float]]) -> [Float] {
        guard let first = channels.first, !first.isEmpty else { return [] }
        guard channels.count > 1 else { return first }
        let frames = channels.map(\.count).min() ?? 0
        return (0..<frames).map { frame in
            channels.reduce(Float(0)) { $0 + $1[frame] } / Float(channels.count)
        }
    }

    /// Interleaved frames of `channels` channels averaged to mono.
    public static func mono(_ interleaved: [Float], channels: Int) -> [Float] {
        guard channels > 1 else { return interleaved }
        return stride(from: 0, to: interleaved.count - channels + 1, by: channels).map { i in
            interleaved[i..<i + channels].reduce(0, +) / Float(channels)
        }
    }

    /// Linear-interpolation resampling (speech models want 16 kHz). A stream cut into chunks
    /// passes each chunk's `count` (see `Resampled`), so rounding never adds up.
    public static func resample(_ samples: [Float], from: Double, to: Double, count: Int? = nil) -> [Float] {
        guard from != to, !samples.isEmpty else { return samples }
        let count = count ?? Int((Double(samples.count) * to / from).rounded())
        let step = from / to
        return (0..<count).map { i in
            let x = Double(i) * step
            let j = min(Int(x), samples.count - 1)
            let k = min(j + 1, samples.count - 1)
            let t = Float(x - Double(j))
            return samples[j] * (1 - t) + samples[k] * t
        }
    }
}

/// One channel's filtered samples at a new rate. Its low-pass history and output phase survive
/// chunk boundaries, while cumulative rounding keeps the stream's duration exact.
// @cpt-algo:cpt-noter-algo-core-engine-capture-live-asr:p1
struct Resampled {
    private static let taps = 127
    private var rate = 0.0
    private var input = 0
    private var output = 0
    private var history: [Float] = []

    mutating func process(_ samples: [Float], from: Double, to: Double) -> [Float] {
        if from != rate { (rate, input, output, history) = (from, 0, 0, []) }
        guard from > to, !samples.isEmpty else {
            return from == to ? samples : Mix.resample(samples, from: from, to: to)
        }
        let base = input - history.count
        history += samples
        input += samples.count
        let end = Int(Double(input) * to / from)
        let cutoff = min(1, to / from) / 2
        let coefficients = (0..<Self.taps).map { tap -> Double in
            let x = Double(tap - Self.taps / 2)
            let window = 0.5 + 0.5 * cos(.pi * x / Double(Self.taps / 2))
            let angle = 2 * .pi * cutoff * x
            return (tap == Self.taps / 2 ? 2 * cutoff : sin(angle) / (.pi * x)) * window
        }
        let norm = coefficients.reduce(0, +)
        let result = (output..<end).map { out -> Float in
            let at = Double(out) * from / to
            let center = Int(at)
            var value = 0.0
            for (tap, coefficient) in coefficients.enumerated() {
                let index = center - tap
                let sample: Float
                if index < 0 || index < base {
                    sample = 0
                } else {
                    sample = history[index - base]
                }
                value += Double(sample) * coefficient
            }
            return Float(value / norm)
        }
        output = end
        history = Array(history.suffix(Self.taps))
        return result
    }
}

/// The source swapped the microphone by itself (unplugged, a new default input): audio stopped
/// at `lostAtMs` and flows again from `backAtMs` (epoch milliseconds) on `name`.
public struct DeviceChange: Sendable, Equatable {
    public let name: String
    public let lostAtMs: Int64
    public let backAtMs: Int64

    public init(name: String, lostAtMs: Int64, backAtMs: Int64) {
        self.name = name
        self.lostAtMs = lostAtMs
        self.backAtMs = backAtMs
    }
}

/// A source of audio chunks on both channels; `start` delivers chunks on any thread.
public protocol AudioSource: AnyObject, Sendable {
    func start(_ onChunk: @escaping @Sendable (AudioChunk) -> Void) throws
    func stop()
    /// The microphone and the output device by name, for `session_started`.
    var devices: (mic: String, output: String) { get }
    var microphoneAvailable: Bool { get }
    /// Leaves a running app out of the system channel from now on (`exclude_process`).
    func exclude(bundleId: String) throws
    /// `handler` hears of every microphone swap, before audio from the new device arrives.
    func observeDevices(_ handler: @escaping @Sendable (DeviceChange) -> Void)
}

extension AudioSource {
    public var devices: (mic: String, output: String) { ("", "") }
    public var microphoneAvailable: Bool { true }
    public func exclude(bundleId: String) throws {}
    public func observeDevices(_ handler: @escaping @Sendable (DeviceChange) -> Void) {}
}

/// The capture's aggregate device runs the microphone and the system tap on one clock.
public enum OneClock {
    /// One IO cycle's input buffers, the microphone's first, then the tap's, as mono channels.
    /// Each buffer is interleaved with its own channel count; several buffers of a side are mixed.
    public static func split(_ buffers: [(channels: Int, samples: [Float])], micBuffers: Int) -> (mic: [Float], sys: [Float]) {
        func mixed(_ side: ArraySlice<(channels: Int, samples: [Float])>) -> [Float] {
            let monos = side.map { Mix.mono($0.samples, channels: max(1, $0.channels)) }
            guard let n = monos.map(\.count).min() else { return [] }
            return (0..<n).map { i in monos.reduce(0) { $0 + $1[i] } / Float(monos.count) }
        }
        let cut = min(micBuffers, buffers.count)
        return (mixed(buffers[..<cut]), mixed(buffers[cut...]))
    }
}

public enum Exclusion {
    /// An excluded app's process, or one of its helpers (`<bundle id>.…`), is left out of the tap.
    public static func matches(_ bundleId: String, _ excluded: Set<String>) -> Bool {
        !bundleId.isEmpty && excluded.contains { bundleId == $0 || bundleId.hasPrefix($0 + ".") }
    }
}

public enum Levels {
    /// RMS level in dBFS, -160 for silence.
    public static func db(_ samples: [Float]) -> Float {
        guard !samples.isEmpty else { return -160 }
        let meanSquare = samples.reduce(Float(0)) { $0 + $1 * $1 } / Float(samples.count)
        return meanSquare > 0 ? max(-160, 10 * log10(meanSquare)) : -160
    }
}

public enum WAV {
    /// A mono WAV file, PCM 16-bit or float 32-bit (tests and the spike's recordings).
    public static func encode(samples: [Float], sampleRate: Int, float: Bool) -> Data {
        var d = Data()
        func put32(_ v: UInt32) { withUnsafeBytes(of: v.littleEndian) { d.append(contentsOf: $0) } }
        func put16(_ v: UInt16) { withUnsafeBytes(of: v.littleEndian) { d.append(contentsOf: $0) } }
        let bits: UInt16 = float ? 32 : 16
        let size = UInt32(samples.count * Int(bits / 8))
        d.append(contentsOf: Array("RIFF".utf8)); put32(36 + size); d.append(contentsOf: Array("WAVE".utf8))
        d.append(contentsOf: Array("fmt ".utf8)); put32(16); put16(float ? 3 : 1); put16(1)
        put32(UInt32(sampleRate)); put32(UInt32(sampleRate) * UInt32(bits / 8)); put16(bits / 8); put16(bits)
        d.append(contentsOf: Array("data".utf8)); put32(size)
        for s in samples {
            if float { put32(s.bitPattern) } else { put16(UInt16(bitPattern: Int16(max(-1, min(1, s)) * 32_767))) }
        }
        return d
    }
}

/// Reads two WAV files in aligned 100 ms chunks, in file time or as fast as possible.
public final class FileAudioSource: AudioSource, @unchecked Sendable {
    private let mic: URL
    private let sys: URL
    private let realtime: Bool
    private let lock = NSLock()
    private var stopped = false

    public init(mic: URL, sys: URL, realtime: Bool) {
        self.mic = mic
        self.sys = sys
        self.realtime = realtime
    }

    func validate() throws {
        _ = try AVAudioFile(forReading: mic)
        _ = try AVAudioFile(forReading: sys)
    }

    public func start(_ onChunk: @escaping @Sendable (AudioChunk) -> Void) throws {
        // Open here so invalid inputs fail before the session is acknowledged, while sample
        // data itself remains bounded to a pair of windows.
        try validate()
        lock.lock()
        stopped = false
        lock.unlock()
        Thread.detachNewThread { [self] in
            do {
                try self.play(onChunk)
            } catch {
                FileHandle.standardError.write(Data("noter-engine: file audio: \(error)\n".utf8))
            }
        }
    }

    public func stop() {
        lock.lock()
        stopped = true
        lock.unlock()
    }

    private var isStopped: Bool {
        lock.lock()
        defer { lock.unlock() }
        return stopped
    }

    /// Delivers every 100 ms window of both files; returns how many windows it delivered.
    @discardableResult
    func play(_ onChunk: (AudioChunk) -> Void) throws -> Int {
        let microphone = try AVAudioFile(forReading: mic)
        let system = try AVAudioFile(forReading: sys)
        var count = 0
        while !isStopped {
            let m = try Self.readWindow(microphone)
            let s = try Self.readWindow(system)
            guard m.frames > 0 || s.frames > 0 else { break }
            onChunk(AudioChunk(channel: .mic, samples: m.samples, sampleRate: m.rate))
            onChunk(AudioChunk(channel: .sys, samples: s.samples, sampleRate: s.rate))
            count += 1
            if realtime { Thread.sleep(forTimeInterval: 0.1) }
        }
        return count
    }

    private static func readWindow(_ file: AVAudioFile) throws -> (samples: [Float], rate: Double, frames: Int) {
        let rate = file.processingFormat.sampleRate
        let remaining = file.length - file.framePosition
        guard remaining > 0 else { return ([], rate, 0) }
        let frames = AVAudioFrameCount(min(max(1, Int(rate / 10)), Int(remaining)))
        guard let buffer = AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: frames) else {
            throw CocoaError(.fileReadUnknown, userInfo: [NSFilePathErrorKey: file.url.path])
        }
        try file.read(into: buffer, frameCount: frames)
        guard let channels = buffer.floatChannelData else {
            throw CocoaError(.fileReadUnknown, userInfo: [NSFilePathErrorKey: file.url.path])
        }
        let n = Int(buffer.frameLength)
        let channelCount = Int(buffer.format.channelCount)
        let planes = (0..<channelCount).map { channel in Array(UnsafeBufferPointer(start: channels[channel], count: n)) }
        let samples = Mix.mono(planes)
        return (samples, rate, n)
    }
}
