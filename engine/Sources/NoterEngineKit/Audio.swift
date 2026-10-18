// Audio as the engine sees it: chunks of float samples per channel, from the live taps or
// from WAV files (file mode, tests and the golden set).

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
    /// Interleaved frames of `channels` channels averaged to mono.
    public static func mono(_ interleaved: [Float], channels: Int) -> [Float] {
        guard channels > 1 else { return interleaved }
        return stride(from: 0, to: interleaved.count - channels + 1, by: channels).map { i in
            interleaved[i..<i + channels].reduce(0, +) / Float(channels)
        }
    }

    /// Linear-interpolation resampling (speech models want 16 kHz).
    public static func resample(_ samples: [Float], from: Double, to: Double) -> [Float] {
        guard from != to, !samples.isEmpty else { return samples }
        let count = Int((Double(samples.count) * to / from).rounded())
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

/// A source of audio chunks on both channels; `start` delivers chunks on any thread.
public protocol AudioSource: AnyObject, Sendable {
    func start(_ onChunk: @escaping @Sendable (AudioChunk) -> Void) throws
    func stop()
}

public enum Levels {
    /// RMS level in dBFS, -160 for silence.
    public static func db(_ samples: [Float]) -> Float {
        guard !samples.isEmpty else { return -160 }
        let meanSquare = samples.reduce(Float(0)) { $0 + $1 * $1 } / Float(samples.count)
        return meanSquare > 0 ? max(-160, 10 * log10(meanSquare)) : -160
    }
}

/// Mono audio read from a WAV file (the first channel of a multichannel file).
public struct WAVAudio: Sendable {
    public let sampleRate: Int
    public let samples: [Float]
}

public enum WAV {
    public struct Unreadable: Error, CustomStringConvertible {
        public let description: String
    }

    /// Reads PCM 16-bit or float 32-bit RIFF/WAVE.
    public static func read(_ url: URL) throws -> WAVAudio {
        let data = try Data(contentsOf: url)
        func u32(_ at: Int) -> UInt32 { data[at..<at + 4].withUnsafeBytes { $0.loadUnaligned(as: UInt32.self) } }
        func u16(_ at: Int) -> UInt16 { data[at..<at + 2].withUnsafeBytes { $0.loadUnaligned(as: UInt16.self) } }
        guard data.count >= 12, data.prefix(4) == Data("RIFF".utf8), data[8..<12] == Data("WAVE".utf8) else {
            throw Unreadable(description: "\(url.lastPathComponent) is not a WAV file")
        }
        var format: (tag: UInt16, channels: Int, rate: Int, bits: UInt16)?
        var offset = 12
        while offset + 8 <= data.count {
            let id = String(decoding: data[offset..<offset + 4], as: UTF8.self)
            let size = Int(u32(offset + 4))
            let body = offset + 8
            guard body + size <= data.count else { break }
            if id == "fmt " {
                format = (u16(body), Int(u16(body + 2)), Int(u32(body + 4)), u16(body + 14))
            } else if id == "data", let f = format {
                let step = Int(f.bits / 8) * f.channels
                guard step > 0 else { break }
                let frames = size / step
                let samples: [Float] = (0..<frames).map { i in
                    let at = body + i * step
                    switch (f.tag, f.bits) {
                    case (1, 16): return Float(Int16(bitPattern: u16(at))) / 32_768
                    case (3, 32): return Float(bitPattern: u32(at))
                    default: return .nan
                    }
                }
                guard !samples.contains(where: \.isNaN) else {
                    throw Unreadable(description: "\(url.lastPathComponent): only PCM 16-bit and float 32-bit")
                }
                return WAVAudio(sampleRate: f.rate, samples: samples)
            }
            offset = body + size + (size & 1)
        }
        throw Unreadable(description: "\(url.lastPathComponent) has no audio data")
    }

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

/// Plays two WAV recordings as the two channels, in 100 ms chunks, in file time or as fast
/// as possible.
public final class FileAudioSource: AudioSource, @unchecked Sendable {
    private let mic: WAVAudio
    private let sys: WAVAudio
    private let realtime: Bool
    private let lock = NSLock()
    private var stopped = false

    public init(mic: WAVAudio, sys: WAVAudio, realtime: Bool) {
        self.mic = mic
        self.sys = sys
        self.realtime = realtime
    }

    public func start(_ onChunk: @escaping @Sendable (AudioChunk) -> Void) throws {
        lock.lock()
        stopped = false
        lock.unlock()
        Thread.detachNewThread { [self] in
            self.play(onChunk)
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
    func play(_ onChunk: (AudioChunk) -> Void) -> Int {
        let windows = FileAudioSource.windows(mic: mic, sys: sys)
        for (i, (m, s)) in windows.enumerated() {
            if isStopped { return i }
            onChunk(AudioChunk(channel: .mic, samples: m, sampleRate: Double(mic.sampleRate)))
            onChunk(AudioChunk(channel: .sys, samples: s, sampleRate: Double(sys.sampleRate)))
            if realtime { Thread.sleep(forTimeInterval: 0.1) }
        }
        return windows.count
    }

    /// Both files cut into aligned 100 ms windows, as long as the longer file.
    static func windows(mic: WAVAudio, sys: WAVAudio) -> [([Float], [Float])] {
        func cut(_ a: WAVAudio, _ n: Int) -> [[Float]] {
            let size = max(1, a.sampleRate / 10)
            return (0..<n).map { i in
                let from = min(i * size, a.samples.count)
                return Array(a.samples[from..<min(from + size, a.samples.count)])
            }
        }
        let count = { (a: WAVAudio) in (a.samples.count + max(1, a.sampleRate / 10) - 1) / max(1, a.sampleRate / 10) }
        let n = max(count(mic), count(sys))
        return Array(zip(cut(mic, n), cut(sys, n)))
    }
}
