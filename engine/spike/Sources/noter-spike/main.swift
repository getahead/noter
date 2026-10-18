// noter-spike: the week-one spike CLI (throwaway).
//
//   noter-spike capture [--seconds 20]
//       Runs the engine's live source (system audio tap + microphone) and prints, per channel,
//       when the first buffer and the first non-zero buffer arrived, the sample rate and the
//       level each second. Run it as the sandboxed child of SpikeHost.app to see whose name
//       the System Audio Recording prompt carries (Q4).
//   noter-spike latency [--seconds 300] [--model openai_whisper-large-v3-v20240930_turbo] [--model-folder DIR]
//       Streams both channels through one WhisperKit Turbo instance with per-pass language
//       detection and prints every hypothesis and confirmed segment with its lag, then p50/p95.
//
// Output lines start with a tag (CAPTURE, LEVEL, HYP, CONF, SUMMARY) so they can be pasted
// into the spike report as they are.

import Foundation
import NoterEngineKit
import WhisperKit

typealias Chunk = NoterEngineKit.AudioChunk
typealias Ch = NoterEngineKit.Channel

func arg(_ name: String, _ fallback: String) -> String {
    let a = CommandLine.arguments
    guard let i = a.firstIndex(of: name), i + 1 < a.count else { return fallback }
    return a[i + 1]
}

func say(_ line: String) {
    print(line)
    fflush(stdout)
}

let started = Date()
func elapsed() -> String { String(format: "%7.3f", Date().timeIntervalSince(started)) }

/// Per-channel facts the capture run reports.
final class Capture: @unchecked Sendable {
    let lock = NSLock()
    var firstBuffer: [Ch: TimeInterval] = [:]
    var firstSound: [Ch: TimeInterval] = [:]
    var rate: [Ch: Double] = [:]
    var level: [Ch: Float] = [:]
    var audio: [Ch: [Float]] = [.mic: [], .sys: []]
    let keepAudio: Bool

    init(keepAudio: Bool) { self.keepAudio = keepAudio }

    func feed(_ c: Chunk) {
        lock.lock()
        defer { lock.unlock() }
        let t = Date().timeIntervalSince(started)
        if firstBuffer[c.channel] == nil {
            firstBuffer[c.channel] = t
            say("CAPTURE \(elapsed()) \(c.channel) first buffer, \(Int(c.sampleRate)) Hz")
        }
        if firstSound[c.channel] == nil, c.samples.contains(where: { $0 != 0 }) {
            firstSound[c.channel] = t
            say("CAPTURE \(elapsed()) \(c.channel) first non-zero buffer")
        }
        rate[c.channel] = c.sampleRate
        level[c.channel] = Levels.db(c.samples)
        if keepAudio { audio[c.channel, default: []] += Mix.resample(c.samples, from: c.sampleRate, to: 16_000) }
    }

    /// The 16 kHz audio of a channel received since `from` (a sample index).
    func audio16k(_ ch: Ch, from: Int) -> [Float] {
        lock.lock()
        defer { lock.unlock() }
        let a = audio[ch, default: []]
        return from < a.count ? Array(a[from...]) : []
    }

    func count16k(_ ch: Ch) -> Int {
        lock.lock()
        defer { lock.unlock() }
        return audio[ch, default: []].count
    }
}

func capture(seconds: Double) {
    let state = Capture(keepAudio: false)
    let source = LiveAudioSource()
    do {
        try source.start { state.feed($0) }
    } catch {
        say("CAPTURE \(elapsed()) FAILED to start: \(error)")
        exit(1)
    }
    let end = Date().addingTimeInterval(seconds)
    while Date() < end {
        Thread.sleep(forTimeInterval: 1)
        state.lock.lock()
        let m = state.level[.mic].map { String(format: "%6.1f", $0) } ?? "  none"
        let s = state.level[.sys].map { String(format: "%6.1f", $0) } ?? "  none"
        state.lock.unlock()
        say("LEVEL \(elapsed()) mic \(m) dB  sys \(s) dB")
    }
    source.stop()
    state.lock.lock()
    for ch in [Ch.mic, .sys] {
        let buf = state.firstBuffer[ch].map { String(format: "%.3f s", $0) } ?? "never"
        let snd = state.firstSound[ch].map { String(format: "%.3f s", $0) } ?? "never"
        say("SUMMARY \(ch): first buffer \(buf), first non-zero \(snd), \(Int(state.rate[ch] ?? 0)) Hz")
    }
    say("SUMMARY sandboxed: \(ProcessInfo.processInfo.environment["APP_SANDBOX_CONTAINER_ID"] != nil)")
    state.lock.unlock()
}

func percentile(_ xs: [Double], _ p: Double) -> String {
    guard !xs.isEmpty else { return "n/a" }
    let s = xs.sorted()
    return String(format: "%.2f s", s[min(s.count - 1, Int(Double(s.count - 1) * p))])
}

/// One channel's streaming state: audio before `committed` is confirmed and never re-decoded.
struct Stream {
    var committed = 0
    var previous: [String: Float] = [:]
}

func latency(seconds: Double, model: String, modelFolder: String?) async {
    say("SUMMARY loading \(model)…")
    let whisper: WhisperKit
    do {
        whisper = try await WhisperKit(WhisperKitConfig(model: model, modelFolder: modelFolder))
    } catch {
        say("SUMMARY FAILED to load the model: \(error)")
        exit(1)
    }
    let state = Capture(keepAudio: true)
    let source = LiveAudioSource()
    do {
        try source.start { state.feed($0) }
    } catch {
        say("SUMMARY FAILED to start capture: \(error)")
        exit(1)
    }
    let options = DecodingOptions(language: nil, usePrefillPrompt: false, detectLanguage: true)
    var streams: [Ch: Stream] = [.mic: Stream(), .sys: Stream()]
    var hypothesisLag: [Ch: [Double]] = [.mic: [], .sys: []]
    var confirmedLag: [Ch: [Double]] = [.mic: [], .sys: []]
    var languages: [String: Int] = [:]
    let end = Date().addingTimeInterval(seconds)
    while Date() < end {
        try? await Task.sleep(nanoseconds: 500_000_000)
        for ch in [Ch.mic, .sys] {
            var st = streams[ch]!
            let total = state.count16k(ch)
            // Up to 30 s after the confirmed point; Whisper's window.
            st.committed = max(st.committed, total - 30 * 16_000)
            let window = state.audio16k(ch, from: st.committed)
            guard window.count >= 16_000 else { continue }
            let windowEnd = Date()
            let t0 = Date()
            guard let result = try? await whisper.transcribe(audioArray: window, decodeOptions: options).first else { continue }
            let pass = Date().timeIntervalSince(t0)
            let windowSeconds = Float(window.count) / 16_000
            languages[result.language, default: 0] += 1
            var current: [String: Float] = [:]
            for seg in result.segments {
                let text = seg.text.trimmingCharacters(in: .whitespaces)
                guard !text.isEmpty, !text.hasPrefix("<|") else { continue }
                current[text] = seg.end
                // Audio of this segment ended (windowSeconds - seg.end) before the window was cut.
                let lag = Date().timeIntervalSince(windowEnd) + Double(windowSeconds - seg.end)
                if seg.end < windowSeconds - 2, st.previous[text] != nil {
                    confirmedLag[ch]!.append(lag)
                    say("CONF \(elapsed()) \(ch) [\(result.language)] lag \(String(format: "%.2f", lag)) s: \(text)")
                    st.committed += Int(seg.end * 16_000)
                    current = [:]
                    break
                } else if seg == result.segments.last {
                    hypothesisLag[ch]!.append(pass)
                    say("HYP  \(elapsed()) \(ch) [\(result.language)] pass \(String(format: "%.2f", pass)) s: \(text)")
                }
            }
            st.previous = current
            streams[ch] = st
        }
    }
    source.stop()
    for ch in [Ch.mic, .sys] {
        say("SUMMARY \(ch): hypothesis p50 \(percentile(hypothesisLag[ch]!, 0.5)) p95 \(percentile(hypothesisLag[ch]!, 0.95)); confirmed p50 \(percentile(confirmedLag[ch]!, 0.5)) p95 \(percentile(confirmedLag[ch]!, 0.95))")
    }
    say("SUMMARY languages per pass: \(languages.sorted { $0.key < $1.key }.map { "\($0.key)=\($0.value)" }.joined(separator: " "))")
    say("SUMMARY budget: hypothesis <= 2 s, confirmed <= 4 s (provisional, PRD Roadmap)")
}

switch CommandLine.arguments.dropFirst().first {
case "capture":
    capture(seconds: Double(arg("--seconds", "20")) ?? 20)
case "latency":
    let folder = arg("--model-folder", "")
    await latency(
        seconds: Double(arg("--seconds", "300")) ?? 300,
        model: arg("--model", "openai_whisper-large-v3-v20240930_turbo"),
        modelFolder: folder.isEmpty ? nil : folder)
default:
    FileHandle.standardError.write(Data("usage: noter-spike capture [--seconds N] | latency [--seconds N] [--model NAME] [--model-folder DIR]\n".utf8))
    exit(2)
}
