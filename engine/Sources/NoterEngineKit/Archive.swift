// The archive pass (`cpt-noter-algo-core-engine-offline-decode`): each stored channel is read
// against `timeline.json`, cut into utterances by the live transcript's energy VAD (at pauses, the
// call's gaps and 30 s), language-identified among the call's languages, decoded by Large v3 and
// filtered as the live transcript is; an utterance of an unsure language is decoded again in the
// alternative. The system channel's live label is split and joined by the user's corrections,
// speech on both channels at once carries both labels, and the result and every word-timings
// file are complete before the pass returns.
// shortcut: clustering waits on the owner's backend choice (TL-16, D-32): until then a system
// voice is the live per-side label as the constraints split and join it.

import AVFoundation
import Foundation

/// The constraints file `offline_pass` names (noter-protocol `OfflineConstraints`).
public struct OfflineConstraints: Decodable, Equatable, Sendable {
    public struct Link: Decodable, Equatable, Sendable {
        public var a: Span
        public var b: Span
    }

    public struct Prior: Decodable, Equatable, Sendable {
        public var label: String
        public var en: Float
        public var ru: Float
        public var de: Float
    }

    public var languages: JSONValue
    public var glossary: JSONValue
    public var speakerPriors: [Prior]
    public var mustLink: [Link]
    public var cannotLink: [Link]
    public var speakerNames: [String: String]

    enum CodingKeys: String, CodingKey {
        case languages, glossary
        case speakerPriors = "speaker_priors", mustLink = "must_link", cannotLink = "cannot_link"
        case speakerNames = "speaker_names"
    }

    /// No file: any language, no glossary, nothing corrected.
    public static let none = OfflineConstraints(
        languages: .array([]), glossary: .array([]), speakerPriors: [], mustLink: [], cannotLink: [], speakerNames: [:])

    /// The file at `url`, or nil when it is not the schema, a language is neither a code nor
    /// `{ "code" }`, a glossary entry has no term, or a span is negative or empty.
    public static func read(_ url: URL) -> OfflineConstraints? {
        guard let data = try? Data(contentsOf: url), let c = try? JSONDecoder().decode(Self.self, from: data),
            case let .array(languages) = c.languages, LiveASR.codes(c.languages).count == languages.count,
            case let .array(terms) = c.glossary,
            terms.allSatisfy({ if case let .object(o) = $0, case .string? = o["term"] { true } else { false } }),
            (c.mustLink + c.cannotLink).allSatisfy({ [$0.a, $0.b].allSatisfy { $0.t0Ms >= 0 && $0.t0Ms < $0.t1Ms } })
        else { return nil }
        return c
    }
}

/// The archive result file (noter-protocol `ArchiveResult`).
public struct ArchiveResult: Codable, Equatable, Sendable {
    public var callId: String
    public var backend: String
    public var segments: [Segment]

    enum CodingKeys: String, CodingKey {
        case backend, segments
        case callId = "call_id"
    }
}

/// One word of a word-timings file (noter-protocol `EngineWord`).
public struct Word: Codable, Equatable, Sendable {
    public var t0Ms: Int
    public var t1Ms: Int
    public var text: String
    public var p: Float

    public init(t0Ms: Int, t1Ms: Int, text: String, p: Float) {
        self.t0Ms = t0Ms
        self.t1Ms = t1Ms
        self.text = text
        self.p = p
    }

    enum CodingKeys: String, CodingKey {
        case text, p
        case t0Ms = "t0_ms", t1Ms = "t1_ms"
    }
}

/// What Large v3 made of one utterance; word times are ms from its start.
public struct Transcript: Equatable, Sendable {
    public let text: String
    public let words: [Word]
    public let avgLogprob: Float
    public let noSpeechP: Float

    public init(text: String, words: [Word], avgLogprob: Float, noSpeechP: Float) {
        self.text = text
        self.words = words
        self.avgLogprob = avgLogprob
        self.noSpeechP = noSpeechP
    }
}

/// Large v3 for the archive pass; calls come one at a time.
public protocol ArchiveDecoder: AnyObject, Sendable {
    /// Language ID on 16 kHz speech: the probability of each language it names.
    func languages(_ samples: [Float]) throws -> [String: Float]
    /// Decodes 16 kHz speech in `language`.
    func decode(_ samples: [Float], language: String) throws -> Transcript
}

/// Stored audio holds captured audio only: `timeline.json`'s gaps put it back into call time.
struct CallTime {
    private let gaps: [(t0: Int, t1: Int)]

    init(session: URL) {
        let timeline = try? JSONDecoder().decode(
            Timeline.self, from: Data(contentsOf: session.appendingPathComponent("timeline.json")))
        gaps = (timeline?.gaps ?? []).filter { $0.t1Ms > $0.t0Ms }.map { ($0.t0Ms, $0.t1Ms) }.sorted { $0.t0 < $1.t0 }
    }

    /// The call ms of a file ms: audio at a gap resumes after it, while an `end` there is before it.
    func call(_ fileMs: Int, end: Bool = false) -> Int {
        gaps.reduce(fileMs) { t, g in (end ? g.t0 < t : g.t0 <= t) ? t + g.t1 - g.t0 : t }
    }

    /// The file ms of a call ms (one inside a gap: where the audio resumes).
    func file(_ callMs: Int) -> Int {
        var shift = 0
        for g in gaps {
            if callMs >= g.t1 {
                shift += g.t1 - g.t0
            } else {
                return min(callMs, g.t0) - shift
            }
        }
        return callMs - shift
    }

    /// Where the gaps cut the stored audio, in file ms.
    var cuts: [Int] { gaps.map { file($0.t0) } }
}

/// The stored channels of a call: `<channel>.m4a` after capture, `<channel>.wav` in file mode.
enum SessionAudio {
    static func url(_ channel: Channel, in session: URL) -> URL? {
        ["m4a", "wav"].map { session.appendingPathComponent("\(channel.rawValue).\($0)") }
            .first { FileManager.default.fileExists(atPath: $0.path) }
    }

    static func stored(in session: URL) -> Bool { [Channel.mic, .sys].contains { url($0, in: session) != nil } }

    /// 16 kHz mono samples of a file, from `fromMs` to `toMs` (its end when nil).
    static func read(_ url: URL, fromMs: Int = 0, toMs: Int? = nil) throws -> [Float] {
        let file = try AVAudioFile(forReading: url)
        let rate = file.processingFormat.sampleRate
        let first = min(file.length, AVAudioFramePosition(Double(fromMs) * rate / 1000))
        let last = min(file.length, toMs.map { AVAudioFramePosition(Double($0) * rate / 1000) } ?? file.length)
        guard last > first,
            let buffer = AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: AVAudioFrameCount(last - first))
        else { return [] }
        file.framePosition = first
        try file.read(into: buffer, frameCount: AVAudioFrameCount(last - first))
        guard let data = buffer.floatChannelData else { return [] }
        let (n, channels) = (Int(buffer.frameLength), Int(buffer.format.channelCount))
        let mono =
            channels == 1
            ? Array(UnsafeBufferPointer(start: data[0], count: n))
            : (0..<n).map { i in (0..<channels).reduce(Float(0)) { $0 + data[$1][i] } / Float(channels) }
        return Mix.resample(mono, from: rate, to: Double(Archive.rate))
    }
}

enum Archive {
    static let rate = 16_000
    /// Whisper's window: a longer utterance is cut.
    static let maxUtteranceMs = 30_000
    /// Below this language probability the alternative language is decoded too.
    static let alternativeBelow: Float = 0.7
    /// A system voice with less speech in the whole call stays unlabelled (PRD › Diarization).
    static let labelledSpeechMs = 3_000

    /// Speech cut into utterances: 100 ms windows above the live VAD's level, ended by a pause,
    /// a gap in the call (`cuts`, sample indexes) or 30 s.
    static func utterances(_ samples: [Float], cuts: [Int]) -> [Range<Int>] {
        let (window, pause, longest) = (rate / 10, LiveASR.pauseMs * rate / 1000, maxUtteranceMs * rate / 1000)
        let bounds = [0] + cuts.filter { $0 > 0 && $0 < samples.count }.sorted() + [samples.count]
        var out: [Range<Int>] = []
        for (from, to) in zip(bounds, bounds.dropFirst()) where to > from {
            var (start, end): (Int?, Int) = (nil, from)
            for at in stride(from: from, to: to, by: window) {
                let next = min(at + window, to)
                if Levels.db(Array(samples[at..<next])) > LiveASR.speechDb {
                    let s = start ?? at
                    (start, end) = (s, next)
                    if end - s >= longest {
                        out.append(s..<end)
                        start = nil
                    }
                } else if let s = start, next - end >= pause {
                    out.append(s..<end)
                    start = nil
                }
            }
            if let s = start { out.append(s..<end) }
        }
        return out
    }

    /// The languages an utterance may be in, the likeliest first: the channel's last one, then the
    /// speaker's prior shares, then the call's order. Empty with no call languages: any.
    static func languages(_ c: OfflineConstraints, label: String, last: String?) -> (allowed: [String], order: [String]) {
        let call = LiveASR.codes(c.languages)
        let prior = c.speakerPriors.first { $0.label == label }.map { p in
            [("en", p.en), ("ru", p.ru), ("de", p.de)].filter { $0.1 > 0 }.sorted { $0.1 > $1.1 }.map { $0.0 }
        } ?? []
        var order: [String] = []
        for l in [last].compactMap({ $0 }) + prior + call where (call.isEmpty || call.contains(l)) && !order.contains(l) {
            order.append(l)
        }
        return (call.isEmpty ? [] : order, order)
    }

    /// Decodes the call's stored channels into `result`, every segment's words beside it in
    /// `<result>.words/`; on failure neither is left. `progress` hears 0...1 between utterances.
    static func run(
        _ pass: OfflinePass, session: URL, result: URL, constraints c: OfflineConstraints, decoder: ArchiveDecoder,
        progress: (Float) -> Void
    ) throws {
        let wordsDir = result.deletingPathExtension().appendingPathExtension("words")
        let wordsPath = (pass.resultPath as NSString).deletingPathExtension + ".words"
        do {
            progress(0)
            try? FileManager.default.removeItem(at: wordsDir)
            try FileManager.default.createDirectory(at: wordsDir, withIntermediateDirectories: true)
            // @cpt-begin:cpt-noter-algo-core-engine-offline-decode:p1:inst-decode-timeline
            let time = CallTime(session: session)
            let channels = [Channel.mic, .sys].compactMap { ch in SessionAudio.url(ch, in: session).map { (ch, $0) } }
            guard !channels.isEmpty else { throw OfflineFailure(code: .badCommand) }
            // @cpt-end:cpt-noter-algo-core-engine-offline-decode:p1:inst-decode-timeline
            let glossary = Glossary(c.glossary)
            var segments: [Segment] = []
            for (i, (channel, url)) in channels.enumerated() {
                // @cpt-begin:cpt-noter-algo-core-engine-offline-decode:p1:inst-decode-timeline
                let samples = try SessionAudio.read(url)
                let utterances = utterances(samples, cuts: time.cuts.map { $0 * rate / 1000 })
                // @cpt-end:cpt-noter-algo-core-engine-offline-decode:p1:inst-decode-timeline
                // @cpt-begin:cpt-noter-algo-core-engine-offline-decode:p1:inst-decode-channel
                // The two channels stay apart: the microphone is the user, the system channel starts as
                // its live label. Who else spoke into the user's microphone is the core's (M3).
                let label = channel == .mic ? "you" : "spk_1"
                // @cpt-end:cpt-noter-algo-core-engine-offline-decode:p1:inst-decode-channel
                var last: String?
                for (k, range) in utterances.enumerated() {
                    defer { progress((Float(i) + Float(k + 1) / Float(utterances.count)) / Float(channels.count)) }
                    let audio = Array(samples[range])
                    // @cpt-begin:cpt-noter-algo-core-engine-offline-decode:p1:inst-decode-language
                    let (allowed, order) = languages(c, label: label, last: last)
                    let probabilities = try decoder.languages(audio)
                    let (lang, langP) = LiveASR.language(probabilities, among: allowed)
                    // @cpt-end:cpt-noter-algo-core-engine-offline-decode:p1:inst-decode-language
                    // @cpt-begin:cpt-noter-algo-core-engine-offline-decode:p1:inst-decode-asr
                    var (best, bestLang, bestP) = (try decoder.decode(audio, language: lang), lang, langP)
                    // @cpt-end:cpt-noter-algo-core-engine-offline-decode:p1:inst-decode-asr
                    // @cpt-begin:cpt-noter-algo-core-engine-offline-decode:p1:inst-decode-alternative
                    if langP < alternativeBelow, let other = order.first(where: { $0 != lang }) {
                        let again = try decoder.decode(audio, language: other)
                        if again.avgLogprob > best.avgLogprob { (best, bestLang, bestP) = (again, other, probabilities[other] ?? 0) }
                    }
                    // @cpt-end:cpt-noter-algo-core-engine-offline-decode:p1:inst-decode-alternative
                    // @cpt-begin:cpt-noter-algo-core-engine-offline-decode:p1:inst-decode-asr
                    let decoded = Decoded(
                        text: best.text, lang: bestLang, langP: bestP, avgLogprob: best.avgLogprob, noSpeechP: best.noSpeechP)
                    guard LiveASR.keep(decoded) else { continue }
                    last = bestLang
                    let (text, corrections) = glossary.apply(best.text)
                    let (fromMs, toMs) = (range.lowerBound * 1000 / rate, range.upperBound * 1000 / rate)
                    let words = best.words.map { w in
                        Word(
                            t0Ms: time.call(min(fromMs + w.t0Ms, toMs)), t1Ms: time.call(min(fromMs + w.t1Ms, toMs), end: true),
                            text: w.text, p: w.p)
                    }
                    let id = "aseg_\(segments.count + 1)"
                    try JSONEncoder().encode(words).write(to: wordsDir.appendingPathComponent("\(id).json"), options: .atomic)
                    segments.append(
                        Segment(
                            id: id, callId: pass.callId, channel: channel, t0Ms: time.call(fromMs), t1Ms: time.call(toMs, end: true),
                            state: "confirmed", lang: bestLang, langP: bestP, speakerLabel: label,
                            text: text.trimmingCharacters(in: .whitespacesAndNewlines), wordsPath: "\(wordsPath)/\(id).json",
                            avgLogprob: best.avgLogprob, noSpeechP: best.noSpeechP, corrections: corrections, crosstalkLabels: []))
                    // @cpt-end:cpt-noter-algo-core-engine-offline-decode:p1:inst-decode-asr
                }
            }
            segments.sort { ($0.t0Ms, $0.channel == .mic ? 0 : 1) < ($1.t0Ms, $1.channel == .mic ? 0 : 1) }
            voices(&segments, c)
            overlap(&segments)
            // @cpt-begin:cpt-noter-algo-core-engine-offline-decode:p1:inst-decode-return
            try JSONEncoder().encode(ArchiveResult(callId: pass.callId, backend: pass.backend, segments: segments))
                .write(to: result, options: .atomic)
            // @cpt-end:cpt-noter-algo-core-engine-offline-decode:p1:inst-decode-return
        } catch {
            try? FileManager.default.removeItem(at: wordsDir)
            throw error
        }
    }

    /// The system channel's voices: its live label, split where the user said two spans are two
    /// voices, joined where they said one (a must-link or one name on two labels) unless that
    /// would join a split; a voice with under three seconds of speech stays unlabelled ("").
    static func voices(_ segments: inout [Segment], _ c: OfflineConstraints) {
        let sys = segments.indices.filter { segments[$0].channel == .sys }
        func inside(_ span: Span) -> [Int] { sys.filter { segments[$0].t0Ms < span.t1Ms && span.t0Ms < segments[$0].t1Ms } }
        func labels(_ span: Span) -> Set<String> { Set(inside(span).map { segments[$0].speakerLabel }) }
        var apart: [(String, String)] = []
        for link in c.cannotLink {
            let a = labels(link.a)
            let b = inside(link.b)
            if b.contains(where: { a.contains(segments[$0].speakerLabel) }) {
                let used = Set(sys.map { segments[$0].speakerLabel })
                let fresh = (2...).lazy.map { "spk_\($0)" }.first { !used.contains($0) }!
                b.forEach { segments[$0].speakerLabel = fresh }
            }
            apart += a.flatMap { x in labels(link.b).map { (x, $0) } }
        }
        // The lower-numbered label names a joined voice.
        func rank(_ l: String) -> (Int, String) { (Int(l.dropFirst(4)) ?? .max, l) }
        var parent: [String: String] = [:]
        func find(_ l: String) -> String { parent[l].map { $0 == l ? l : find($0) } ?? l }
        func join(_ x: String, _ y: String) {
            let (rx, ry) = (find(x), find(y))
            guard rx != ry, !apart.contains(where: { Set([find($0.0), find($0.1)]) == Set([rx, ry]) }) else { return }
            let (keep, drop) = rank(rx) < rank(ry) ? (rx, ry) : (ry, rx)
            parent[drop] = keep
        }
        for link in c.mustLink {
            for x in labels(link.a) { for y in labels(link.b) { join(x, y) } }
        }
        for group in Dictionary(grouping: c.speakerNames.filter { !$0.value.isEmpty }, by: { $0.value }).values {
            let named = group.map { $0.key }.sorted()
            named.dropFirst().forEach { join(named[0], $0) }
        }
        sys.forEach { segments[$0].speakerLabel = find(segments[$0].speakerLabel) }
        // @cpt-begin:cpt-noter-algo-core-engine-offline-decode:p1:inst-decode-overlap
        var speech: [String: Int] = [:]
        sys.forEach { speech[segments[$0].speakerLabel, default: 0] += segments[$0].t1Ms - segments[$0].t0Ms }
        for i in sys where speech[segments[i].speakerLabel, default: 0] < labelledSpeechMs { segments[i].speakerLabel = "" }
        // @cpt-end:cpt-noter-algo-core-engine-offline-decode:p1:inst-decode-overlap
    }

    /// Speech on both channels at once: each side carries both candidate labels.
    static func overlap(_ segments: inout [Segment]) {
        // @cpt-begin:cpt-noter-algo-core-engine-offline-decode:p1:inst-decode-overlap
        let all = segments
        for (i, s) in all.enumerated() {
            let others = all.filter { $0.channel != s.channel && $0.t0Ms < s.t1Ms && s.t0Ms < $0.t1Ms }.map(\.speakerLabel)
            guard !others.isEmpty else { continue }
            segments[i].crosstalkLabels = ([s.speakerLabel] + others).reduce(into: []) { if !$0.contains($1) { $0.append($1) } }
        }
        // @cpt-end:cpt-noter-algo-core-engine-offline-decode:p1:inst-decode-overlap
    }
}
