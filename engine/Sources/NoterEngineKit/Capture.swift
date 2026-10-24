// Capturing a call (`cpt-noter-flow-core-engine-capture-session`): both channels at 16 kHz into
// the capture ring, a memory-mapped file in the App Group container that outlives a crashed
// engine; into crash-safe AAC-LC parts when the call stores audio, remuxed to `mic.m4a` and
// `sys.m4a` on stop; and `timeline.json`, which keeps the call's gaps in call time.

import AVFoundation
import Foundation

/// Both channels' last samples in a memory-mapped file, so the engine that replaces a crashed
/// one knows where the call was (`resume_from_ms`) and what it heard last.
public final class CaptureRing: @unchecked Sendable {
    public static let fileName = "capture.ring"
    static let rate = 16_000
    static let capacity = rate * 120
    private static let magic: UInt32 = 0x4E52_4731  // "NRG1"
    private static let headerSize = 128
    // Header: magic @0, call id (64 bytes) @8, samples written mic @72 and sys @80,
    // last call ms @88 (-1: none), its wall-clock epoch ms @96.

    private let lock = NSLock()
    private let fd: Int32
    private let size: Int
    private let base: UnsafeMutableRawPointer

    public init(url: URL, callId: String) throws {
        size = Self.headerSize + 2 * Self.capacity * MemoryLayout<Float>.size
        fd = open(url.path, O_RDWR | O_CREAT, 0o600)
        guard fd >= 0 else { throw CocoaError(.fileWriteUnknown, userInfo: [NSFilePathErrorKey: url.path]) }
        guard ftruncate(fd, off_t(size)) == 0,
            let map = mmap(nil, size, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0), map != MAP_FAILED
        else {
            close(fd)
            throw CocoaError(.fileWriteOutOfSpace, userInfo: [NSFilePathErrorKey: url.path])
        }
        base = map
        let id = Array(callId.utf8.prefix(63)) + [0]
        let sameCall =
            base.load(as: UInt32.self) == Self.magic
            && (0..<id.count).allSatisfy { base.load(fromByteOffset: 8 + $0, as: UInt8.self) == id[$0] }
        if !sameCall {
            memset(base, 0, Self.headerSize)
            base.storeBytes(of: Self.magic, as: UInt32.self)
            for (i, byte) in id.enumerated() { base.storeBytes(of: byte, toByteOffset: 8 + i, as: UInt8.self) }
            base.storeBytes(of: Int64(-1), toByteOffset: 88, as: Int64.self)
        }
    }

    deinit {
        munmap(base, size)
        close(fd)
    }

    private func counter(_ channel: Channel) -> Int { channel == .mic ? 72 : 80 }
    private func data(_ channel: Channel) -> Int {
        Self.headerSize + (channel == .mic ? 0 : Self.capacity * MemoryLayout<Float>.size)
    }

    /// Appends 16 kHz samples of one channel, overwriting the oldest.
    public func write(_ channel: Channel, _ samples: [Float]) {
        lock.withLock {
            var written = Int(base.load(fromByteOffset: counter(channel), as: UInt64.self))
            let floats = (base + data(channel)).assumingMemoryBound(to: Float.self)
            written += max(0, samples.count - Self.capacity)
            for s in samples.suffix(Self.capacity) {
                floats[written % Self.capacity] = s
                written += 1
            }
            base.storeBytes(of: UInt64(written), toByteOffset: counter(channel), as: UInt64.self)
        }
    }

    public func written(_ channel: Channel) -> UInt64 {
        lock.withLock { base.load(fromByteOffset: counter(channel), as: UInt64.self) }
    }

    /// The last `count` samples of a channel, oldest first.
    public func read(_ channel: Channel, last count: Int) -> [Float] {
        lock.withLock {
            let written = Int(base.load(fromByteOffset: counter(channel), as: UInt64.self))
            let floats = (base + data(channel)).assumingMemoryBound(to: Float.self)
            let n = min(count, written, Self.capacity)
            return (written - n..<written).map { floats[$0 % Self.capacity] }
        }
    }

    /// Where the call was in call time, and when on the wall clock.
    public func mark(callMs: Int, epochMs: Int64) {
        lock.withLock {
            base.storeBytes(of: Int64(callMs), toByteOffset: 88, as: Int64.self)
            base.storeBytes(of: epochMs, toByteOffset: 96, as: Int64.self)
        }
    }

    public var last: (callMs: Int, epochMs: Int64)? {
        lock.withLock {
            let callMs = base.load(fromByteOffset: 88, as: Int64.self)
            return callMs < 0 ? nil : (Int(callMs), base.load(fromByteOffset: 96, as: Int64.self))
        }
    }
}

/// Writes one channel's 16 kHz samples to a file.
public protocol AudioEncoder {
    func append(_ samples: [Float]) throws
    func finish()
}

/// AAC-LC in an ADTS stream, one frame per packet written straight to the file: every frame
/// stands alone and is on disk once written, so a part survives a crashed engine.
/// shortcut: ADTS cannot carry the encoder delay, so each part starts with ~130 ms of priming
/// silence and the files run that much behind call time per engine run; record the delay per
/// part in `timeline.json` when the offline pass needs tighter alignment.
public final class ADTSEncoder: AudioEncoder {
    private let file: FileHandle
    private let pcm: AVAudioFormat
    private let converter: AVAudioConverter
    private var pending: [Float] = []

    public init(url: URL) throws {
        guard FileManager.default.createFile(atPath: url.path, contents: nil),
            let pcm = AVAudioFormat(
                commonFormat: .pcmFormatFloat32, sampleRate: Double(CaptureRing.rate), channels: 1, interleaved: false),
            let aac = AVAudioFormat(settings: [
                AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: CaptureRing.rate, AVNumberOfChannelsKey: 1,
            ]),
            let converter = AVAudioConverter(from: pcm, to: aac)
        else { throw CocoaError(.fileWriteUnknown, userInfo: [NSFilePathErrorKey: url.path]) }
        file = try FileHandle(forWritingTo: url)
        (self.pcm, self.converter) = (pcm, converter)
    }

    public func append(_ samples: [Float]) throws {
        pending += samples
        while pending.count >= 1024 {
            try encode(Array(pending.prefix(1024)), end: false)
            pending.removeFirst(1024)
        }
    }

    public func finish() {
        try? encode(pending, end: true)
        pending = []
        try? file.close()
    }

    private func encode(_ frames: [Float], end: Bool) throws {
        var input: AVAudioPCMBuffer?
        if !frames.isEmpty, let buffer = AVAudioPCMBuffer(pcmFormat: pcm, frameCapacity: AVAudioFrameCount(frames.count)) {
            buffer.frameLength = AVAudioFrameCount(frames.count)
            frames.withUnsafeBufferPointer { buffer.floatChannelData![0].update(from: $0.baseAddress!, count: frames.count) }
            input = buffer
        }
        let out = AVAudioCompressedBuffer(
            format: converter.outputFormat, packetCapacity: 8, maximumPacketSize: converter.maximumOutputPacketSize)
        var error: NSError?
        let status = converter.convert(to: out, error: &error) { _, state in
            guard let buffer = input else {
                state.pointee = end ? .endOfStream : .noDataNow
                return nil
            }
            input = nil
            state.pointee = .haveData
            return buffer
        }
        if status == .error { throw error ?? CocoaError(.fileWriteUnknown) }
        guard let descriptions = out.packetDescriptions else { return }
        var data = Data()
        for i in 0..<Int(out.packetCount) {
            let d = descriptions[i]
            let packet = Data(bytes: out.data + Int(d.mStartOffset), count: Int(d.mDataByteSize))
            data.append(contentsOf: Self.header(packet.count))
            data.append(packet)
        }
        try file.write(contentsOf: data)
    }

    /// The 7-byte ADTS header of an AAC-LC packet, 16 kHz, mono.
    static func header(_ packetBytes: Int) -> [UInt8] {
        let n = packetBytes + 7
        let (profile, rate, channels) = (1, 8, 1)  // AAC LC - 1, 16 kHz index, mono
        return [
            0xFF, 0xF1, UInt8(profile << 6 | rate << 2 | channels >> 2), UInt8((channels & 3) << 6 | n >> 11),
            UInt8((n >> 3) & 0xFF), UInt8((n & 7) << 5 | 0x1F), 0xFC,
        ]
    }
}

/// `timeline.json`: the call's length and its gaps in call time (what the offline pass and the
/// gaps table read); `parts` counts the engine runs that wrote audio parts.
struct Timeline: Codable {
    struct Gap: Codable {
        var t0Ms: Int
        var t1Ms: Int
        var reason: String
        enum CodingKeys: String, CodingKey { case t0Ms = "t0_ms", t1Ms = "t1_ms", reason }
    }
    var callId: String
    var durationMs = 0
    var gaps: [Gap] = []
    var parts = 0
    enum CodingKeys: String, CodingKey { case callId = "call_id", durationMs = "duration_ms", gaps, parts }
}

// @cpt-dod:cpt-noter-dod-core-engine-capture-pipeline:p1
/// One call being captured. Chunks arrive on the audio threads; commands on the engine's.
final class CaptureSession: @unchecked Sendable {
    let callId: String
    private let dir: URL
    private let relative: String
    private let writer: EventWriter
    private let now: () -> Int64
    private let ring: CaptureRing
    private let lock = NSLock()
    private var timeline: Timeline
    private var encoders: [Channel: AudioEncoder] = [:]
    private var live = false
    /// Call ms where the current span of audio began, and samples captured since, per channel.
    private var spanStart: Int
    private var spanSamples: [Channel: Int] = [.mic: 0, .sys: 0]
    private var pausedAt: (callMs: Int, epochMs: Int64)?
    private var nextLevels: Int
    private var db: [Channel: Float] = [.mic: -160, .sys: -160]
    private var resampled: [Channel: Resampled] = [:]
    private var zeros = ZeroRun()
    private var meetingAppPlaying = false
    /// The live transcript of this call, fed the 16 kHz audio in call time.
    let asr: LiveASR
    /// After a restart: the call ms where the crashed engine's audio ends in the ring.
    private var ringEnd: Int?

    init(
        start: StartSession, container: URL, writer: EventWriter, now: @escaping () -> Int64,
        encoder: (URL) throws -> AudioEncoder, asrQueue: DispatchQueue? = nil
    ) throws {
        callId = start.callId
        asr = LiveASR(callId: start.callId, languages: start.languages, glossary: start.glossary, writer: writer, queue: asrQueue)
        relative = start.sessionDir
        dir = container.appendingPathComponent(start.sessionDir, isDirectory: true)
        self.writer = writer
        self.now = now
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        ring = try CaptureRing(url: container.appendingPathComponent(CaptureRing.fileName), callId: callId)
        let saved = try? JSONDecoder().decode(
            Timeline.self, from: Data(contentsOf: dir.appendingPathComponent("timeline.json")))
        timeline = start.resumeFromMs == nil ? Timeline(callId: callId) : saved ?? Timeline(callId: callId)
        // After a crash the call went on while no engine ran: resume in call time, with the gap.
        if start.resumeFromMs != nil, let last = ring.last {
            spanStart = last.callMs + max(0, Int(now() - last.epochMs))
            ringEnd = last.callMs
            if spanStart > last.callMs {
                timeline.gaps.append(.init(t0Ms: last.callMs, t1Ms: spanStart, reason: "engine_restart"))
            }
        } else {
            spanStart = Int(start.resumeFromMs ?? 0)
        }
        nextLevels = spanStart + 100
        if start.storeAudio {
            for channel in [Channel.mic, .sys] {
                encoders[channel] = try encoder(dir.appendingPathComponent("\(channel.rawValue).\(timeline.parts).aac"))
            }
            timeline.parts += 1
        }
        try save()
    }

    private var callMs: Int { spanStart + (spanSamples.values.max() ?? 0) * 1000 / CaptureRing.rate }

    private func save() throws {
        timeline.durationMs = pausedAt?.callMs ?? callMs
        try JSONEncoder().encode(timeline).write(to: dir.appendingPathComponent("timeline.json"), options: .atomic)
    }

    /// Whether a meeting app plays now: exact zeros on the system channel then mean no permission.
    func meetingApp(_ playing: Bool) { lock.withLock { meetingAppPlaying = playing } }

    /// After a restart, decodes again what the crashed engine heard but never confirmed: the
    /// ring's tail after its last pause, in call time, then confirmed (no hypotheses).
    func decodeRingTail() {
        guard let end = ringEnd else { return }
        let window = LiveASR.rate / 10
        let tails = lock.withLock {
            [Channel.mic, .sys].map { ($0, LiveASR.openTail(ring.read($0, last: LiveASR.rate * LiveASR.maxUtteranceMs / 1000))) }
        }
        for (channel, tail) in tails where !tail.isEmpty {
            let from = end - tail.count * 1000 / LiveASR.rate
            for at in stride(from: 0, to: tail.count, by: window) {
                asr.feed(channel, Array(tail[at..<min(at + window, tail.count)]), atMs: from + at * 1000 / LiveASR.rate, hypotheses: false)
            }
        }
        asr.cut()
    }

    /// Audio flows to the ring and files from now on (after `session_started`).
    func go() { lock.withLock { live = true } }

    // @cpt-begin:cpt-noter-flow-core-engine-capture-session:p1:inst-write-ring
    func feed(_ chunk: AudioChunk) {
        var events: [EngineEvent] = []
        var heard: (samples: [Float], atMs: Int)?
        lock.withLock {
            guard live, pausedAt == nil else { return }
            let to = Double(CaptureRing.rate)
            let count = resampled[chunk.channel, default: Resampled()].count(chunk.samples.count, from: chunk.sampleRate, to: to)
            let samples = Mix.resample(chunk.samples, from: chunk.sampleRate, to: to, count: count)
            // @cpt-begin:cpt-noter-algo-core-engine-capture-zero-detect:p1:inst-return-zero
            if chunk.channel == .sys,
                let fact = zeros.feed(
                    zeros: !chunk.samples.isEmpty && chunk.samples.allSatisfy { $0 == 0 },
                    atMs: spanStart + (spanSamples[.sys] ?? 0) * 1000 / CaptureRing.rate, meetingApp: meetingAppPlaying)
            {
                events.append(.systemAudioSilent(callId: callId, sinceMs: fact.sinceMs, confidence: fact.confidence))
            }
            // @cpt-end:cpt-noter-algo-core-engine-capture-zero-detect:p1:inst-return-zero
            ring.write(chunk.channel, samples)
            heard = (samples, spanStart + (spanSamples[chunk.channel] ?? 0) * 1000 / CaptureRing.rate)
            spanSamples[chunk.channel, default: 0] += samples.count
            db[chunk.channel] = Levels.db(chunk.samples)
            if let encoder = encoders[chunk.channel] {
                do {
                    try encoder.append(samples)
                } catch {
                    // The disk is full: no more audio files, transcription goes on.
                    encoders.values.forEach { $0.finish() }
                    encoders = [:]
                    events.append(.error(cmdId: nil, code: .diskFull, message: "audio files stopped: \(error)"))
                }
            }
            ring.mark(callMs: callMs, epochMs: now())
            if callMs >= nextLevels {
                nextLevels = callMs - callMs % 100 + 100
                events.append(.levels(callId: callId, micDb: db[.mic] ?? -160, sysDb: db[.sys] ?? -160))
            }
        }
        events.forEach(writer.emit)
        // @cpt-begin:cpt-noter-flow-core-engine-capture-session:p1:inst-run-asr
        if let heard { asr.feed(chunk.channel, heard.samples, atMs: heard.atMs) }
        // @cpt-end:cpt-noter-flow-core-engine-capture-session:p1:inst-run-asr
    }
    // @cpt-end:cpt-noter-flow-core-engine-capture-session:p1:inst-write-ring

    // @cpt-begin:cpt-noter-flow-core-engine-capture-session:p1:inst-pause-streams
    /// Both streams are stopped by the caller; nothing is kept until `resume`.
    func pause() {
        lock.withLock {
            guard pausedAt == nil else { return }
            pausedAt = (callMs, now())
            try? save()
        }
        asr.cut()
    }

    func resume() {
        lock.withLock {
            guard let paused = pausedAt else { return }
            let at = paused.callMs + max(0, Int(now() - paused.epochMs))
            timeline.gaps.append(.init(t0Ms: paused.callMs, t1Ms: at, reason: "paused"))
            (spanStart, spanSamples, pausedAt) = (at, [.mic: 0, .sys: 0], nil)
            nextLevels = at + 100
            try? save()
        }
    }
    // @cpt-end:cpt-noter-flow-core-engine-capture-session:p1:inst-pause-streams

    // @cpt-begin:cpt-noter-flow-core-engine-capture-session:p1:inst-open-streams
    /// The source swapped the microphone: the call went on while no audio came, so it resumes
    /// in call time after a `device_changed` gap. Not while paused: nothing is captured then.
    func deviceChanged(_ change: DeviceChange) {
        let event: EngineEvent? = lock.withLock {
            guard live, pausedAt == nil else { return nil }
            let from = callMs
            let to = from + max(0, Int(change.backAtMs - change.lostAtMs))
            if to > from { timeline.gaps.append(.init(t0Ms: from, t1Ms: to, reason: "device_changed")) }
            (spanStart, spanSamples, nextLevels) = (to, [.mic: 0, .sys: 0], to + 100)
            try? save()
            return .deviceChanged(callId: callId, deviceName: change.name, gapFromMs: from, gapToMs: to)
        }
        event.map(writer.emit)
        if event != nil { asr.cut() }
    }
    // @cpt-end:cpt-noter-flow-core-engine-capture-session:p1:inst-open-streams

    // @cpt-begin:cpt-noter-flow-core-engine-capture-session:p1:inst-stop
    /// Flushes the files, writes `timeline.json`; the `session_stopped` to send.
    func stop() -> EngineEvent {
        lock.withLock {
            live = false
            encoders.values.forEach { $0.finish() }
            encoders = [:]
            try? save()
            let paths = [Channel.mic, .sys].map { channel -> String? in
                let parts = (0..<timeline.parts)
                    .map { dir.appendingPathComponent("\(channel.rawValue).\($0).aac") }
                    .filter { FileManager.default.fileExists(atPath: $0.path) }
                let out = dir.appendingPathComponent("\(channel.rawValue).m4a")
                guard !parts.isEmpty, Self.remux(parts, to: out) else { return nil }
                parts.forEach { try? FileManager.default.removeItem(at: $0) }
                return "\(relative)/\(channel.rawValue).m4a"
            }
            return .sessionStopped(
                callId: callId, timelinePath: "\(relative)/timeline.json", micPath: paths[0], sysPath: paths[1])
        }
    }
    // @cpt-end:cpt-noter-flow-core-engine-capture-session:p1:inst-stop

    /// The parts, one after the other, into one `.m4a` without re-encoding: ADTS frames stand
    /// alone, so the parts join byte for byte, and the joined stream is remuxed.
    static func remux(_ parts: [URL], to out: URL) -> Bool {
        let joined = out.deletingPathExtension().appendingPathExtension("aac")
        do {
            try parts.reduce(Data()) { $0 + (try Data(contentsOf: $1)) }.write(to: joined)
        } catch {
            return false
        }
        defer { try? FileManager.default.removeItem(at: joined) }
        try? FileManager.default.removeItem(at: out)
        let done = DispatchSemaphore(value: 0)
        let result = Box(false)
        Task {
            defer { done.signal() }
            let asset = AVURLAsset(url: joined)
            guard let export = AVAssetExportSession(asset: asset, presetName: AVAssetExportPresetPassthrough) else { return }
            export.outputURL = out
            export.outputFileType = .m4a
            await export.export()
            result.value = export.status == .completed
        }
        done.wait()
        return result.value
    }
}

private final class Box<T>: @unchecked Sendable {
    var value: T
    init(_ value: T) { self.value = value }
}
