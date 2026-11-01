import Foundation
import XCTest

@testable import NoterEngineKit

/// The archive pass on synthetic calls (core-engine-offline, slice 2): stored channels against
/// `timeline.json`, VAD and language ID, the decode with its filters and the alternative language,
/// overlap marks and the user's constraints, and the result and word files the core installs.
/// Large v3 is scripted here; the golden-set quality run is the owner's (TL-17).

/// Large v3 as a test scripts it: language ID answers `probabilities`, each language decodes to
/// its text and score, and every decode is recorded.
final class FakeDecoder: ArchiveDecoder, @unchecked Sendable {
    var probabilities: [String: Float] = ["en": 0.95]
    var texts: [String: (text: String, avgLogprob: Float)] = ["en": ("hello there", -0.3)]
    var fails = false
    private let lock = NSLock()
    private var calls: [(samples: Int, language: String)] = []

    var decoded: [(samples: Int, language: String)] { lock.withLock { calls } }

    func languages(_ samples: [Float]) throws -> [String: Float] { probabilities }

    func decode(_ samples: [Float], language: String) throws -> Transcript {
        if fails { throw OfflineFailure(code: .internal) }
        lock.withLock { calls.append((samples.count, language)) }
        let (text, score) = texts[language] ?? ("", -5)
        let words = text.split(separator: " ").map(String.init)
        let ms = samples.count * 1000 / 16_000
        let step = words.isEmpty ? 0 : ms / words.count
        return Transcript(
            text: text,
            words: words.enumerated().map { i, w in Word(t0Ms: i * step, t1Ms: (i + 1) * step, text: w, p: 0.9) },
            avgLogprob: score, noSpeechP: 0.05)
    }
}

/// A stored call: tone where someone speaks, silence elsewhere, as `<channel>.wav` (file mode)
/// in `dir`, and `timeline.json` with the call's gaps.
func storeCall(
    in dir: URL, seconds: Double, mic: [(Double, Double)], sys: [(Double, Double)],
    gaps: [(Int, Int)] = [], micAmplitude: Float = 0.3, sysAmplitude: Float = 0.3
) throws {
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    let rate = 16_000
    for (channel, spans, amplitude) in [("mic", mic, micAmplitude), ("sys", sys, sysAmplitude)] {
        var samples = [Float](repeating: 0, count: Int(seconds * Double(rate)))
        for (from, to) in spans {
            for i in Int(from * Double(rate))..<min(samples.count, Int(to * Double(rate))) {
                samples[i] = amplitude * sin(Float(i) * 2 * .pi * 220 / Float(rate))
            }
        }
        try WAV.encode(samples: samples, sampleRate: rate, float: false).write(to: dir.appendingPathComponent("\(channel).wav"))
    }
    let timeline: [String: Any] = [
        "call_id": "call_1", "duration_ms": Int(seconds * 1000) + gaps.reduce(0) { $0 + $1.1 - $1.0 }, "parts": 1,
        "gaps": gaps.map { ["t0_ms": $0.0, "t1_ms": $0.1, "reason": "paused"] },
    ]
    try JSONSerialization.data(withJSONObject: timeline).write(to: dir.appendingPathComponent("timeline.json"))
}

final class ArchiveTests: XCTestCase {
    private var container: URL!
    private var session: URL { container.appendingPathComponent("audio/call_1") }
    private let pass = OfflinePass(
        callId: "call_1", sessionDir: "audio/call_1", resultPath: "audio/call_1/offline-1.json", constraintsPath: nil,
        backend: "whisper_large_v3")

    override func setUpWithError() throws {
        container = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(
            at: container.appendingPathComponent("engine-io"), withIntermediateDirectories: true)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: container)
    }

    private func constraints(_ json: String) throws -> OfflineConstraints {
        let url = container.appendingPathComponent("engine-io/c.json")
        try Data(json.utf8).write(to: url)
        return try XCTUnwrap(OfflineConstraints.read(url))
    }

    /// Runs the pass with `decoder`; the result file as written, and the progress reported.
    @discardableResult
    private func archive(
        _ decoder: FakeDecoder = FakeDecoder(), constraints: OfflineConstraints = .none
    ) throws -> (result: ArchiveResult, progress: [Float]) {
        var progress: [Float] = []
        let work = LocalOfflineWork(decoder: { decoder })
        let out = container.appendingPathComponent(pass.resultPath)
        try work.archive(pass, session: session, result: out, constraints: constraints) { progress.append($0) }
        return (try JSONDecoder().decode(ArchiveResult.self, from: Data(contentsOf: out)), progress)
    }

    private func near(_ a: Int, _ b: Int, _ what: String, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertLessThanOrEqual(abs(a - b), 100, "\(what): \(a) vs \(b)", file: file, line: line)
    }

    // MARK: timeline and channels

    func testSegmentsKeepCallTimeAcrossGapsOnBothChannels() throws {
        // Paused at 2.5 s of the call for 10 s: the files hold captured audio only.
        try storeCall(in: session, seconds: 7, mic: [(0.5, 1.2), (2.2, 3)], sys: [(3, 6)], gaps: [(2_500, 12_500)])
        let (result, progress) = try archive()
        XCTAssertEqual(result.callId, "call_1")
        XCTAssertEqual(result.backend, "whisper_large_v3")
        let segments = result.segments
        XCTAssertEqual(segments.map(\.channel), [.mic, .mic, .mic, .sys])
        XCTAssertEqual(segments.map(\.t0Ms), segments.map(\.t0Ms).sorted(), "in call order")
        // The second utterance is cut where the call paused, and goes on after the gap.
        let expected = [(500, 1_200), (2_200, 2_500), (12_500, 13_000), (13_000, 16_000)]
        for (s, (t0, t1)) in zip(segments, expected) {
            near(s.t0Ms, t0, "t0 of \(s.id)")
            near(s.t1Ms, t1, "t1 of \(s.id)")
        }
        XCTAssertEqual(segments.map(\.speakerLabel), ["you", "you", "you", "spk_1"], "the two-channel split")
        XCTAssertTrue(segments.allSatisfy { $0.state == "confirmed" && $0.callId == "call_1" && $0.lang == "en" })
        XCTAssertEqual(Set(segments.map(\.id)).count, segments.count)
        XCTAssertEqual(progress.last, 1)
        XCTAssertEqual(progress, progress.sorted(), "progress only advances")
    }

    func testEverySegmentNamesItsCompleteWordTimingsInCallTime() throws {
        try storeCall(in: session, seconds: 6, mic: [], sys: [(3.5, 5)], gaps: [(2_500, 12_500)])
        let segment = try XCTUnwrap(try archive().result.segments.first)
        let path = try XCTUnwrap(segment.wordsPath)
        XCTAssertTrue(path.hasPrefix("audio/call_1/offline-1.words/"), path)
        let words = try JSONDecoder().decode([Word].self, from: Data(contentsOf: container.appendingPathComponent(path)))
        XCTAssertEqual(words.map(\.text), ["hello", "there"])
        XCTAssertTrue(words.allSatisfy { $0.t0Ms >= segment.t0Ms && $0.t1Ms <= segment.t1Ms + 1 && $0.t0Ms < $0.t1Ms })
        near(words[0].t0Ms, 13_500, "first word")
    }

    func testUtterancesEndAtAPauseAndAtThirtySeconds() {
        let rate = 16_000
        var samples = [Float](repeating: 0, count: 45 * rate)
        for i in 0..<(rate * 2) { samples[i] = 0.3 }  // 0-2 s
        for i in (rate * 5)..<(rate * 42) { samples[i] = 0.3 }  // 5-42 s: one long run
        let ranges = Archive.utterances(samples, cuts: [])
        XCTAssertEqual(ranges.map { $0.lowerBound / 1_600 }, [0, 50, 350])
        XCTAssertEqual(ranges.map { $0.upperBound / 1_600 }, [20, 350, 420])
        // A cut ends the utterance it falls in.
        XCTAssertEqual(Archive.utterances(Array(samples.prefix(2 * rate)), cuts: [rate]).count, 2)
    }

    func testOnlyAMissingSessionHasNoAudio() throws {
        XCTAssertFalse(SessionAudio.stored(in: session))
        try storeCall(in: session, seconds: 1, mic: [], sys: [])
        XCTAssertTrue(SessionAudio.stored(in: session))
        try FileManager.default.removeItem(at: session.appendingPathComponent("mic.wav"))
        XCTAssertTrue(SessionAudio.stored(in: session), "one channel is enough")
    }

    // MARK: language, filters

    func testALowProbabilityLanguageIsDecodedAgainInTheAlternativeAndTheBetterScoreKept() throws {
        try storeCall(in: session, seconds: 3, mic: [(1, 2)], sys: [])
        let decoder = FakeDecoder()
        decoder.probabilities = ["en": 0.55]
        decoder.texts = ["en": ("hollow vee gates", -1.4), "de": ("hallo wie geht's", -0.2)]
        let segment = try XCTUnwrap(try archive(decoder, constraints: constraints(Self.languages(["en", "de"]))).result.segments.first)
        XCTAssertEqual(decoder.decoded.map(\.language), ["en", "de"])
        XCTAssertEqual(segment.lang, "de")
        XCTAssertEqual(segment.text, "hallo wie geht's")
        XCTAssertEqual(segment.avgLogprob, -0.2)
    }

    func testASureLanguageIsDecodedOnceAndALanguageOutsideTheCallIsNotTaken() throws {
        try storeCall(in: session, seconds: 3, mic: [(1, 2)], sys: [])
        let decoder = FakeDecoder()
        decoder.probabilities = ["fr": 0.99]
        decoder.texts = ["ru": ("привет", -0.3), "fr": ("bonjour", -0.1)]
        let segment = try XCTUnwrap(try archive(decoder, constraints: constraints(Self.languages(["ru"]))).result.segments.first)
        XCTAssertEqual(decoder.decoded.map(\.language), ["ru"])
        XCTAssertEqual(segment.text, "привет")
    }

    func testHallucinationsAreDroppedAndTheGlossaryCorrectsTerms() throws {
        try storeCall(in: session, seconds: 6, mic: [(1, 2)], sys: [(3, 4)])
        let decoder = FakeDecoder()
        decoder.texts = ["en": ("notter is ready", -0.3)]
        let glossary = #"{"languages":[],"glossary":[{"term":"Noter","variants_latin":["notter"],"variants_cyrillic":[],"spoken_forms":[]}],"speaker_priors":[],"must_link":[],"cannot_link":[],"speaker_names":{}}"#
        let segments = try archive(decoder, constraints: constraints(glossary)).result.segments
        XCTAssertEqual(segments.map(\.text), ["Noter is ready", "Noter is ready"])
        XCTAssertEqual(segments[0].corrections, [Segment.Correction(from: "notter", to: "Noter")])

        decoder.texts = ["en": ("Thank you for watching!", -0.3)]
        XCTAssertEqual(try archive(decoder).result.segments, [], "Whisper's credits on silence are not speech")
    }

    // MARK: overlap and speakers

    func testOverlappingSpeechCarriesBothCandidateLabels() throws {
        try storeCall(in: session, seconds: 8, mic: [(1, 3)], sys: [(2, 4), (6, 7)])
        let segments = try archive().result.segments
        XCTAssertEqual(segments.map(\.crosstalkLabels), [["you", "spk_1"], ["spk_1", "you"], []])
    }

    func testCannotLinkSplitsVoicesMustLinkJoinsThemAndAShortVoiceStaysUnlabelled() throws {
        // A 1-4 s (3 s), B 6-7 s (1 s), C 9-13 s (4 s): all "spk_1" live.
        try storeCall(in: session, seconds: 14, mic: [], sys: [(1, 4), (6, 7), (9, 13)])
        let split = #"""
            {"languages":[],"glossary":[],"speaker_priors":[],"must_link":[],"speaker_names":{},
             "cannot_link":[{"a":{"t0_ms":1000,"t1_ms":4000},"b":{"t0_ms":9000,"t1_ms":13000}},
                            {"a":{"t0_ms":1000,"t1_ms":4000},"b":{"t0_ms":6000,"t1_ms":7000}}]}
            """#
        XCTAssertEqual(try archive(constraints: constraints(split)).result.segments.map(\.speakerLabel), ["spk_1", "", "spk_2"])

        // B and C are one voice; A and C stay apart, whatever a must-link says.
        let joined = split.replacingOccurrences(
            of: #""must_link":[]"#,
            with: #""must_link":[{"a":{"t0_ms":6000,"t1_ms":7000},"b":{"t0_ms":9000,"t1_ms":13000}},{"a":{"t0_ms":1000,"t1_ms":4000},"b":{"t0_ms":9000,"t1_ms":13000}}]"#)
        XCTAssertEqual(
            try archive(constraints: constraints(joined)).result.segments.map(\.speakerLabel), ["spk_1", "spk_2", "spk_2"])

        // The same name on two voices joins them too.
        let named = split.replacingOccurrences(of: #""speaker_names":{}"#, with: #""speaker_names":{"spk_2":"Anna","spk_3":"Anna"}"#)
        XCTAssertEqual(
            try archive(constraints: constraints(named)).result.segments.map(\.speakerLabel), ["spk_1", "spk_2", "spk_2"])
    }

    // MARK: constraints file

    func testTheConstraintsFileIsCheckedBeforeUse() throws {
        let valid = Self.languages(["en", #"{"code":"fr"}"#])
        XCTAssertEqual(LiveASR.codes(try constraints(valid).languages), ["en", "fr"])
        let url = container.appendingPathComponent("engine-io/bad.json")
        for bad in [
            "[]", "{", #"{"languages":[]}"#,
            valid.replacingOccurrences(of: #""must_link":[]"#, with: #""must_link":[{"a":{"t0_ms":-1,"t1_ms":5},"b":{"t0_ms":1,"t1_ms":2}}]"#),
            valid.replacingOccurrences(of: #""cannot_link":[]"#, with: #""cannot_link":[{"a":{"t0_ms":5,"t1_ms":5},"b":{"t0_ms":1,"t1_ms":2}}]"#),
            valid.replacingOccurrences(of: #""glossary":[]"#, with: #""glossary":[{"variants_latin":[]}]"#),
            valid.replacingOccurrences(of: #""languages":["en""#, with: #""languages":[7"#),
        ] {
            try Data(bad.utf8).write(to: url)
            XCTAssertNil(OfflineConstraints.read(url), bad)
        }
    }

    // MARK: through the engine

    private func engine(_ lines: Lines, _ work: OfflineWork) -> EngineLoop {
        EngineLoop(
            writer: writer(lines), engineVersion: "test", models: [], sandboxed: false, container: container,
            offline: work
        ) { _ in nil }
    }

    private func command(_ id: Int, constraints: String = "null") -> String {
        #"{"id":\#(id),"cmd":{"type":"offline_pass","call_id":"call_1","session_dir":"audio/call_1","result_path":"audio/call_1/offline-1.json","constraints_path":\#(constraints),"backend":"whisper_large_v3"}}"#
    }

    func testOfflineDoneComesOnlyWhenTheResultAndEveryWordsFileAreComplete() throws {
        try storeCall(in: session, seconds: 6, mic: [(1, 2)], sys: [(3, 5)])
        let lines = Lines()
        _ = engine(lines, LocalOfflineWork(decoder: { FakeDecoder() })).handle(command(3))
        let done = try XCTUnwrap(lines.waitFor("offline_done"))
        XCTAssertEqual(done["result_path"] as? String, "audio/call_1/offline-1.json")
        let result = try JSONDecoder().decode(
            ArchiveResult.self, from: Data(contentsOf: container.appendingPathComponent("audio/call_1/offline-1.json")))
        XCTAssertEqual(result.segments.count, 2)
        for s in result.segments {
            XCTAssertTrue(FileManager.default.fileExists(atPath: container.appendingPathComponent(s.wordsPath ?? "-").path))
        }
        let names = try FileManager.default.contentsOfDirectory(atPath: session.path)
        XCTAssertEqual(Set(names), ["mic.wav", "sys.wav", "timeline.json", "offline-1.json", "offline-1.words"], "no temporary files")
    }

    func testAFailedDecodeLeavesNeitherResultNorWords() throws {
        try storeCall(in: session, seconds: 3, mic: [(1, 2)], sys: [])
        let decoder = FakeDecoder()
        decoder.fails = true
        let lines = Lines()
        _ = engine(lines, LocalOfflineWork(decoder: { decoder })).handle(command(4))
        XCTAssertEqual(try XCTUnwrap(lines.waitFor("offline_failed"))["code"] as? String, "internal")
        let names = try FileManager.default.contentsOfDirectory(atPath: session.path)
        XCTAssertEqual(Set(names), ["mic.wav", "sys.wav", "timeline.json"])
    }

    func testMalformedConstraintsOrNoStoredAudioAreRefusedWithTheCommandId() throws {
        try storeCall(in: session, seconds: 3, mic: [(1, 2)], sys: [])
        try Data("[]".utf8).write(to: session.appendingPathComponent("c.json"))
        let lines = Lines()
        let e = engine(lines, LocalOfflineWork(decoder: { FakeDecoder() }))
        _ = e.handle(command(5, constraints: #""audio/call_1/c.json""#))
        try FileManager.default.createDirectory(at: container.appendingPathComponent("audio/call_2"), withIntermediateDirectories: true)
        _ = e.handle(command(6).replacingOccurrences(of: #""session_dir":"audio/call_1""#, with: #""session_dir":"audio/call_2""#))
        for id in [5, 6] {
            let error = lines.events.first { $0["type"] as? String == "error" && $0["cmd_id"] as? Int == id }
            XCTAssertEqual(error?["code"] as? String, "bad_command", "\(id)")
            XCTAssertFalse(lines.events.contains { $0["type"] as? String == "ack" && $0["cmd_id"] as? Int == id })
        }
    }

    func testWithoutModelsEveryOfflineCommandIsRefusedAsModelMissing() throws {
        try storeCall(in: session, seconds: 3, mic: [(1, 2)], sys: [])
        let lines = Lines()
        let e = engine(lines, LocalOfflineWork())
        _ = e.handle(command(1))
        _ = e.handle(#"{"id":2,"cmd":{"type":"speaker_embedding","request_id":"r2","call_id":"call_1","channel":"sys","spans":[{"t0_ms":0,"t1_ms":500}],"out_path":"engine-io/s.f32"}}"#)
        _ = e.handle(#"{"id":3,"cmd":{"type":"embed_texts","request_id":"r3","texts":["a"],"out_path":null}}"#)
        for id in 1...3 {
            let error = lines.events.first { $0["type"] as? String == "error" && $0["cmd_id"] as? Int == id }
            XCTAssertEqual(error?["code"] as? String, "model_missing", "\(id)")
        }
    }

    func testTheArchiveWaitsWhileACallIsCaptured() throws {
        try storeCall(in: session, seconds: 3, mic: [(1, 2)], sys: [])
        let lines = Lines()
        let decoder = FakeDecoder()
        let e = EngineLoop(
            writer: writer(lines), engineVersion: "test", models: [], sandboxed: false, container: container,
            offline: LocalOfflineWork(decoder: { decoder }, text: { FakeText() })
        ) { _ in FileAudioSource(mic: WAVAudio(sampleRate: 16_000, samples: []), sys: WAVAudio(sampleRate: 16_000, samples: []), realtime: true) }
        _ = e.handle(#"{"id":1,"cmd":{"type":"start_session","call_id":"call_2","session_dir":"audio/call_2","store_audio":false,"mic_device_uid":null,"exclude_bundle_ids":[],"languages":["en"],"backend":"whisper_turbo","glossary":[],"speaker_priors":[],"enrolled_embeddings_path":null,"resume_from_ms":null}}"#)
        XCTAssertNotNil(lines.waitFor("session_started"))
        _ = e.handle(command(2))
        Thread.sleep(forTimeInterval: 0.5)
        XCTAssertFalse(lines.types.contains("offline_done"), "capture goes first")
        // A query's embedding is not held behind the waiting pass.
        _ = e.handle(#"{"id":4,"cmd":{"type":"embed_texts","request_id":"r4","texts":["a"],"out_path":null}}"#)
        XCTAssertNotNil(lines.waitFor("embeddings"))
        XCTAssertFalse(lines.types.contains("offline_done"))
        _ = e.handle(#"{"id":3,"cmd":{"type":"stop","call_id":"call_2"}}"#)
        XCTAssertNotNil(lines.waitFor("offline_done"))
    }

    static func languages(_ codes: [String]) -> String {
        let list = codes.map { $0.hasPrefix("{") ? $0 : "\"\($0)\"" }.joined(separator: ",")
        return #"{"languages":[\#(list)],"glossary":[],"speaker_priors":[],"must_link":[],"cannot_link":[],"speaker_names":{}}"#
    }
}
