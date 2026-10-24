// The live ASR loop (`cpt-noter-algo-core-engine-capture-live-asr`): per channel, an energy VAD
// cuts the 16 kHz capture into utterances; while one is spoken a hypothesis is decoded about
// once a second, and when it ends (a pause, or 20 s) it is decoded again, filtered, corrected
// with the glossary and confirmed with a live speaker label. Alongside: `no_segments` when speech
// flows but nothing comes out for 10 s, and `silence` when neither channel speaks for 10 s.

import Foundation

/// What a decoder made of one utterance.
public struct Decoded: Equatable, Sendable {
    public let text: String
    public let lang: String
    public let langP: Float
    public let avgLogprob: Float
    public let noSpeechP: Float

    public init(text: String, lang: String, langP: Float, avgLogprob: Float, noSpeechP: Float) {
        self.text = text
        self.lang = lang
        self.langP = langP
        self.avgLogprob = avgLogprob
        self.noSpeechP = noSpeechP
    }
}

/// One speech model instance, shared by both channels; calls come one at a time.
public protocol Transcriber: AnyObject, Sendable {
    /// Decodes 16 kHz mono speech; language ID picks among `languages` (none: any).
    func decode(_ samples: [Float], languages: [String]) throws -> Decoded
}

// @cpt-algo:cpt-noter-algo-core-engine-capture-live-asr:p1
final class LiveASR: @unchecked Sendable {
    static let rate = 16_000
    /// shortcut: an energy VAD (speech above -50 dBFS per 100 ms); a model VAD comes with live
    /// diarization (FluidAudio) if noisy rooms cut utterances wrong.
    static let speechDb: Float = -50
    static let pauseMs = 700
    static let maxUtteranceMs = 20_000
    static let hypothesisEveryMs = 1_000
    static let stallMs = 10_000
    static let silenceMs = 10_000

    private struct Utterance {
        let id: String
        let startMs: Int
        var audio: [Float] = []
        /// Call ms where speech last ended, and the samples up to it.
        var speechEndMs: Int
        var speechSamples = 0
        var lastHypothesisMs: Int
    }

    private enum Job {
        case hypothesis(Channel, Utterance, generation: Int)
        case confirm(Channel, Utterance)
    }

    private let callId: String
    private let writer: EventWriter
    /// nil: jobs run inline (tests); a serial queue live, so decoding never holds up capture.
    private let queue: DispatchQueue?
    private let run = String(UInt32.random(in: 0...0xFFFF), radix: 16)
    private let lock = NSLock()
    private var languages: [String]
    private var glossary: Glossary
    private var transcriber: Transcriber?
    private var open: [Channel: Utterance] = [:]
    private var generation: [Channel: Int] = [:]
    /// The language the first hypothesis of an utterance found, for its next hypotheses.
    private var utteranceLang: [String: String] = [:]
    private var next = 0
    private var lastSpeechEndMs = 0
    private var silenceReported = false
    private var stallSince: Int?
    private var stallReported = false

    init(callId: String, languages: JSONValue, glossary: JSONValue, writer: EventWriter, queue: DispatchQueue? = nil) {
        self.callId = callId
        self.languages = Self.codes(languages)
        self.glossary = Glossary(glossary)
        self.writer = writer
        self.queue = queue
    }

    /// The session languages as codes: `"en"` or `{ "code": "fr" }`.
    static func codes(_ languages: JSONValue) -> [String] {
        guard case let .array(items) = languages else { return [] }
        return items.compactMap {
            switch $0 {
            case let .string(code): code
            case let .object(o): if case let .string(code)? = o["code"] { code } else { nil }
            default: nil
            }
        }
    }

    func setLanguages(_ languages: JSONValue) { lock.withLock { self.languages = Self.codes(languages) } }
    func setGlossary(_ entries: JSONValue) { lock.withLock { glossary = Glossary(entries) } }

    /// The model to decode with, after the jobs already queued (the taps run before it loads).
    func use(_ transcriber: Transcriber) { perform { self.lock.withLock { self.transcriber = transcriber } } }

    /// Loads the model on the decode queue; a failure is `model_load_failed` and capture goes on.
    func load(_ make: @escaping () throws -> Transcriber) {
        perform {
            do {
                let t = try make()
                self.lock.withLock { self.transcriber = t }
            } catch {
                self.writer.emit(.error(cmdId: nil, code: .modelLoadFailed, message: "\(error)"))
            }
        }
    }

    /// 16 kHz samples of one channel starting at `atMs` of call time; `hypotheses: false` for
    /// audio decoded again after a restart, which only needs its confirmation.
    func feed(_ channel: Channel, _ samples: [Float], atMs: Int, hypotheses: Bool = true) {
        let endMs = atMs + samples.count * 1000 / Self.rate
        var (jobs, facts) = ([Job](), [EngineEvent]())
        lock.withLock {
            // @cpt-begin:cpt-noter-algo-core-engine-capture-live-asr:p1:inst-vad
            guard Levels.db(samples) > Self.speechDb else {
                if var u = open[channel] {
                    u.audio += samples
                    open[channel] = u
                    if endMs - u.speechEndMs >= Self.pauseMs { jobs.append(close(channel)) }
                }
                // @cpt-begin:cpt-noter-algo-core-engine-capture-live-asr:p1:inst-silence
                if !silenceReported, endMs - lastSpeechEndMs >= Self.silenceMs {
                    silenceReported = true
                    facts.append(.silence(callId: callId, sinceMs: lastSpeechEndMs))
                }
                // @cpt-end:cpt-noter-algo-core-engine-capture-live-asr:p1:inst-silence
                return
            }
            // @cpt-end:cpt-noter-algo-core-engine-capture-live-asr:p1:inst-vad
            (lastSpeechEndMs, silenceReported) = (max(lastSpeechEndMs, endMs), false)
            // @cpt-begin:cpt-noter-algo-core-engine-capture-live-asr:p1:inst-no-segments
            let since = stallSince ?? atMs
            stallSince = since
            if !stallReported, endMs - since >= Self.stallMs {
                stallReported = true
                facts.append(.noSegments(callId: callId, sinceMs: since))
            }
            // @cpt-end:cpt-noter-algo-core-engine-capture-live-asr:p1:inst-no-segments
            var u = open[channel] ?? {
                next += 1
                return Utterance(id: "eseg_\(run)_\(next)", startMs: atMs, speechEndMs: atMs, lastHypothesisMs: atMs)
            }()
            u.audio += samples
            (u.speechEndMs, u.speechSamples) = (endMs, u.audio.count)
            // @cpt-begin:cpt-noter-algo-core-engine-capture-live-asr:p1:inst-hypothesis
            let hypothesis = hypotheses && endMs - u.lastHypothesisMs >= Self.hypothesisEveryMs
            if hypothesis { u.lastHypothesisMs = endMs }
            open[channel] = u
            if endMs - u.startMs >= Self.maxUtteranceMs {
                jobs.append(close(channel))
            } else if hypothesis {
                generation[channel, default: 0] += 1
                jobs.append(.hypothesis(channel, u, generation: generation[channel] ?? 0))
            }
            // @cpt-end:cpt-noter-algo-core-engine-capture-live-asr:p1:inst-hypothesis
        }
        facts.forEach(writer.emit)
        jobs.forEach(schedule)
    }

    /// The utterance still open when capture stopped (so never confirmed), from the end of
    /// `samples` (16 kHz): it began after the last pause, at the last 20 s mark since then (a
    /// longer utterance was closed every 20 s). Empty when they end in a pause, or when speech
    /// fills them and they do not reach back to the call's start (where it was cut is unknown).
    static func openTail(_ samples: [Float], fromCallStart: Bool) -> [Float] {
        let (w, n) = (rate / 10, samples.count / (rate / 10))
        let base = samples.count - n * w
        let speech = (0..<n).map { k in Levels.db(Array(samples[base + k * w..<base + (k + 1) * w])) > speechDb }
        guard let last = speech.lastIndex(of: true), (n - 1 - last) * 100 < pauseMs else { return [] }
        var (first, quiet, paused) = (last, 0, false)
        for k in stride(from: last, through: 0, by: -1) {
            if speech[k] {
                (first, quiet) = (k, 0)
            } else {
                quiet += 1
                if quiet * 100 >= pauseMs {
                    paused = true
                    break
                }
            }
        }
        guard paused || fromCallStart else { return [] }
        let windows = maxUtteranceMs / 100
        first += (n - first) / windows * windows
        return first < n ? Array(samples[(base + first * w)...]) : []
    }

    /// Ends the utterance of `channel` (caller holds the lock).
    private func close(_ channel: Channel) -> Job {
        let u = open.removeValue(forKey: channel)!
        generation[channel, default: 0] += 1
        return .confirm(channel, u)
    }

    /// Confirms what is being said now (pause, device change); returns at once.
    func cut() {
        let jobs = lock.withLock { open.keys.sorted { $0.rawValue < $1.rawValue }.map(close) }
        jobs.forEach(schedule)
    }

    /// Confirms what is being said and waits for every decode (`stop`).
    func finish() {
        cut()
        wait()
    }

    /// Waits for the queued decodes.
    func wait() { queue?.sync {} }

    private func perform(_ work: @escaping () -> Void) {
        if let queue { queue.async(execute: work) } else { work() }
    }

    private func schedule(_ job: Job) { perform { self.decode(job) } }

    private func decode(_ job: Job) {
        let (channel, u, confirmed): (Channel, Utterance, Bool)
        switch job {
        case let .hypothesis(c, utterance, generation):
            // A newer hypothesis or the confirmation is queued: this one is stale.
            guard lock.withLock({ self.generation[c] == generation }) else { return }
            (channel, u, confirmed) = (c, utterance, false)
        case let .confirm(c, utterance): (channel, u, confirmed) = (c, utterance, true)
        }
        // Language ID once per utterance for its hypotheses; the confirmation decides on all of it.
        let (transcriber, languages, glossary) = lock.withLock {
            (self.transcriber, confirmed ? self.languages : utteranceLang[u.id].map { [$0] } ?? self.languages, self.glossary)
        }
        let samples = confirmed ? Array(u.audio.prefix(u.speechSamples)) : u.audio
        let d = transcriber.flatMap { try? $0.decode(samples, languages: languages) }
        lock.withLock {
            if confirmed { utteranceLang[u.id] = nil } else if let d, utteranceLang[u.id] == nil { utteranceLang[u.id] = d.lang }
        }
        guard let d, Self.keep(d) else { return }
        // @cpt-begin:cpt-noter-algo-core-engine-capture-live-asr:p1:inst-confirm
        let (text, corrections) = confirmed ? glossary.apply(d.text) : (d.text, [])
        let segment = Segment(
            id: u.id, callId: callId, channel: channel, t0Ms: u.startMs, t1Ms: u.speechEndMs,
            state: confirmed ? "confirmed" : "hypothesis", lang: d.lang, langP: d.langP,
            // shortcut: one label per side until live diarization (FluidAudio) labels the speakers.
            speakerLabel: channel == .mic ? "you" : "spk_1",
            text: text.trimmingCharacters(in: .whitespacesAndNewlines), wordsPath: nil, avgLogprob: d.avgLogprob,
            noSpeechP: d.noSpeechP, corrections: corrections, crosstalkLabels: [])
        // @cpt-end:cpt-noter-algo-core-engine-capture-live-asr:p1:inst-confirm
        lock.withLock { (stallSince, stallReported) = (nil, false) }
        writer.emit(.segment(segment))
    }

    /// Whisper's known hallucinations on silence and music (subtitle credits), normalised.
    static let hallucinations: Set<String> = [
        "продолжение следует", "субтитры сделал dimatorzok", "субтитры создавал dimatorzok",
        "редактор субтитров асемкин корректор аегорова", "thanks for watching", "thank you for watching",
        "subtitles by the amaraorg community", "untertitel im auftrag des zdf für funk 2017",
        "untertitel der amaraorg community", "untertitelung des zdf 2020",
    ]

    /// The hallucination and unsure-decode filters.
    static func keep(_ d: Decoded) -> Bool {
        let key = d.text.lowercased().unicodeScalars.filter { CharacterSet.alphanumerics.contains($0) || $0 == " " }
            .map(String.init).joined().split(separator: " ").joined(separator: " ")
        guard !key.isEmpty, !hallucinations.contains(key) else { return false }
        return !(d.noSpeechP > 0.6 && d.avgLogprob < -1)
    }
}

/// The session glossary: every variant and spoken form of a term is written as the term.
struct Glossary {
    private let regex: NSRegularExpression?
    private let terms: [String: String]

    init(_ entries: JSONValue) {
        var terms: [String: String] = [:]
        if case let .array(items) = entries {
            for case let .object(o) in items {
                guard case let .string(term)? = o["term"] else { continue }
                terms[term.lowercased()] = term
                for key in ["variants_latin", "variants_cyrillic", "spoken_forms"] {
                    guard case let .array(forms)? = o[key] else { continue }
                    for case let .string(form) in forms { terms[form.lowercased()] = term }
                }
            }
        }
        self.terms = terms
        let alternatives = terms.keys.sorted { $0.count > $1.count }.map(NSRegularExpression.escapedPattern(for:))
        regex = alternatives.isEmpty
            ? nil
            : try? NSRegularExpression(
                pattern: "(?<![\\p{L}\\p{N}])(\(alternatives.joined(separator: "|")))(?![\\p{L}\\p{N}])",
                options: .caseInsensitive)
    }

    func apply(_ text: String) -> (String, [Segment.Correction]) {
        guard let regex else { return (text, []) }
        var (out, corrections) = (text, [Segment.Correction]())
        let ns = text as NSString
        for match in regex.matches(in: text, range: NSRange(location: 0, length: ns.length)).reversed() {
            let found = ns.substring(with: match.range)
            guard let term = terms[found.lowercased()], found != term else { continue }
            out = (out as NSString).replacingCharacters(in: match.range, with: term)
            corrections.insert(.init(from: found, to: term), at: 0)
        }
        return (out, corrections)
    }
}
