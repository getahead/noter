import Foundation
import XCTest

@testable import NoterEngineKit

/// A transcriber the test scripts: `text` for every decode, and what it was asked.
final class FakeTranscriber: Transcriber, @unchecked Sendable {
    private let lock = NSLock()
    var text: String
    var lang = "en"
    var noSpeechP: Float = 0.1
    var avgLogprob: Float = -0.3
    private(set) var asked: [(samples: Int, languages: [String])] = []

    init(_ text: String) { self.text = text }

    func decode(_ samples: [Float], languages: [String]) throws -> Decoded {
        lock.withLock {
            asked.append((samples.count, languages))
            return Decoded(text: text, lang: lang, langP: 0.9, avgLogprob: avgLogprob, noSpeechP: noSpeechP)
        }
    }
}

private func speech(_ ms: Int = 100) -> [Float] { (0..<16 * ms).map { 0.3 * sin(Float($0) * 2 * .pi * 300 / 16_000) } }
private func quiet(_ ms: Int = 100) -> [Float] { [Float](repeating: 0, count: 16 * ms) }

final class LiveASRTests: XCTestCase {
    private var lines = Lines()

    private func asr(
        _ transcriber: Transcriber?, languages: JSONValue = .array([.string("en"), .string("de")]),
        glossary: JSONValue = .array([])
    ) -> LiveASR {
        lines = Lines()
        let asr = LiveASR(callId: "call_1", languages: languages, glossary: glossary, writer: writer(lines))
        if let transcriber { asr.use(transcriber) }
        return asr
    }

    /// `ms` of audio on `channel` from `atMs`, in 100 ms chunks; the other channel is quiet.
    private func play(_ asr: LiveASR, _ channel: Channel, from atMs: Int, _ ms: Int, speaking: Bool) {
        for t in stride(from: atMs, to: atMs + ms, by: 100) {
            asr.feed(channel, speaking ? speech() : quiet(), atMs: t)
            asr.feed(channel == .mic ? .sys : .mic, quiet(), atMs: t)
        }
        asr.wait()
    }

    private var segments: [[String: Any]] { lines.events.compactMap { $0["segment"] as? [String: Any] } }
    private var confirmed: [[String: Any]] { segments.filter { $0["state"] as? String == "confirmed" } }

    func testSpeechGetsAHypothesisAboutEverySecondThenOneConfirmedSegment() throws {
        let a = asr(FakeTranscriber("hello there"))
        play(a, .mic, from: 0, 2500, speaking: true)
        play(a, .mic, from: 2500, 1000, speaking: false)
        let hypotheses = segments.filter { $0["state"] as? String == "hypothesis" }
        XCTAssertEqual(hypotheses.count, 2)
        let segment = try XCTUnwrap(confirmed.first)
        XCTAssertEqual(confirmed.count, 1)
        XCTAssertEqual(segment["id"] as? String, hypotheses.first?["id"] as? String, "the confirmed segment replaces its hypotheses")
        XCTAssertEqual(segment["call_id"] as? String, "call_1")
        XCTAssertEqual(segment["channel"] as? String, "mic")
        XCTAssertEqual(segment["speaker_label"] as? String, "you")
        XCTAssertEqual(segment["text"] as? String, "hello there")
        XCTAssertEqual(segment["lang"] as? String, "en")
        XCTAssertEqual(segment["t0_ms"] as? Int, 0)
        XCTAssertEqual(segment["t1_ms"] as? Int, 2500)
        XCTAssertTrue(segment["words_path"] is NSNull)
    }

    func testTheOtherSideIsALiveSpeakerAndTheSessionLanguagesBoundLanguageID() throws {
        let t = FakeTranscriber("guten Tag")
        t.lang = "de"
        let a = asr(t, languages: .array([.string("en"), .object(["code": .string("de")])]))
        play(a, .sys, from: 0, 1500, speaking: true)
        play(a, .sys, from: 1500, 1000, speaking: false)
        let segment = try XCTUnwrap(confirmed.first)
        XCTAssertEqual(segment["channel"] as? String, "sys")
        XCTAssertEqual(segment["speaker_label"] as? String, "spk_1")
        XCTAssertEqual(segment["lang"] as? String, "de")
        XCTAssertEqual(t.asked.last?.languages, ["en", "de"])
    }

    func testLanguageIDRunsOncePerHypothesisRunAndAgainOnTheWholeUtterance() throws {
        let t = FakeTranscriber("hallo zusammen")
        t.lang = "de"
        let a = asr(t)
        play(a, .mic, from: 0, 3500, speaking: true)
        play(a, .mic, from: 3500, 1000, speaking: false)
        XCTAssertEqual(
            t.asked.map(\.languages), [["en", "de"], ["de"], ["de"], ["en", "de"]],
            "hypotheses reuse the first one's language; the confirmation decides on the whole utterance")
    }

    func testTheGlossaryCorrectsTermsAndSaysSo() throws {
        let glossary: JSONValue = .array([
            .object([
                "term": .string("Noter"), "variants_latin": .array([.string("Notter")]),
                "variants_cyrillic": .array([.string("Ноутер")]), "spoken_forms": .array([.string("no-ter")]),
            ])
        ])
        let a = asr(FakeTranscriber("we use notter and Ноутер daily"), glossary: glossary)
        play(a, .mic, from: 0, 1500, speaking: true)
        play(a, .mic, from: 1500, 1000, speaking: false)
        let segment = try XCTUnwrap(confirmed.first)
        XCTAssertEqual(segment["text"] as? String, "we use Noter and Noter daily")
        let corrections = try XCTUnwrap(segment["corrections"] as? [[String: Any]])
        XCTAssertEqual(corrections.map { $0["from"] as? String }, ["notter", "Ноутер"])
        XCTAssertEqual(corrections.map { $0["to"] as? String }, ["Noter", "Noter"])
    }

    func testHallucinationsAndUnsureDecodesAreNotConfirmed() throws {
        for (text, noSpeech, logprob) in [("Продолжение следует...", Float(0.1), Float(-0.3)), ("hmm", 0.9, -1.5), ("  ", 0.1, -0.3)] {
            let t = FakeTranscriber(text)
            (t.noSpeechP, t.avgLogprob) = (noSpeech, logprob)
            let a = asr(t)
            play(a, .mic, from: 0, 1500, speaking: true)
            play(a, .mic, from: 1500, 1000, speaking: false)
            XCTAssertEqual(segments.count, 0, text)
        }
    }

    func testALongUtteranceIsConfirmedWithoutWaitingForAPause() throws {
        let a = asr(FakeTranscriber("a long monologue"))
        play(a, .mic, from: 0, 21_000, speaking: true)
        XCTAssertEqual(confirmed.first?["t1_ms"] as? Int, 20_000)
    }

    func testAudioBeforeTheModelLoadsIsDecodedOnceItHas() throws {
        let a = asr(nil)
        play(a, .mic, from: 0, 2000, speaking: true)
        XCTAssertEqual(segments.count, 0)
        let t = FakeTranscriber("said before the model loaded")
        a.use(t)
        play(a, .mic, from: 2000, 1000, speaking: false)
        XCTAssertEqual(confirmed.first?["t0_ms"] as? Int, 0)
        XCTAssertEqual(t.asked.last?.samples, 16 * 2000, "up to the last speech, without the pause")
    }

    func testSpeechWithoutSegmentsFor10SecondsIsNoSegmentsOnce() throws {
        let a = asr(FakeTranscriber(""))
        play(a, .mic, from: 0, 12_000, speaking: true)
        let facts = lines.events.filter { $0["type"] as? String == "no_segments" }
        XCTAssertEqual(facts.count, 1)
        XCTAssertEqual(facts.first?["since_ms"] as? Int, 0)
        XCTAssertEqual(facts.first?["call_id"] as? String, "call_1")
    }

    func testNoSpeechOnEitherChannelIsSilenceOnceUntilSpeechComesBack() throws {
        let a = asr(FakeTranscriber("hi"))
        play(a, .mic, from: 0, 1000, speaking: true)
        play(a, .mic, from: 1000, 12_000, speaking: false)
        var facts = lines.events.filter { $0["type"] as? String == "silence" }
        XCTAssertEqual(facts.map { $0["since_ms"] as? Int }, [1000])
        play(a, .sys, from: 13_000, 1000, speaking: true)
        play(a, .sys, from: 14_000, 11_000, speaking: false)
        facts = lines.events.filter { $0["type"] as? String == "silence" }
        XCTAssertEqual(facts.map { $0["since_ms"] as? Int }, [1000, 14_000])
    }

    func testTheOpenTailIsWhatTheCrashedEngineHadNotClosed() {
        func audio(_ parts: [(Bool, Int)]) -> [Float] { parts.flatMap { $0.0 ? speech($0.1) : quiet($0.1) } }
        func seconds(_ tail: [Float]) -> Double { Double(tail.count) / 16_000 }
        XCTAssertEqual(seconds(LiveASR.openTail(audio([(false, 1000), (true, 2000)]), fromCallStart: false)), 2)
        XCTAssertEqual(LiveASR.openTail(audio([(true, 2000), (false, 800)]), fromCallStart: false), [], "ends in a pause")
        XCTAssertEqual(
            seconds(LiveASR.openTail(audio([(false, 1000), (true, 25_000)]), fromCallStart: false)), 5,
            "the crashed engine closed the first 20 s itself")
        XCTAssertEqual(LiveASR.openTail(audio([(false, 1000), (true, 40_000)]), fromCallStart: false), [])
        XCTAssertEqual(
            LiveASR.openTail(audio([(true, 30_000)]), fromCallStart: false), [],
            "speech fills the ring: where it was cut is unknown")
        XCTAssertEqual(seconds(LiveASR.openTail(audio([(true, 25_000)]), fromCallStart: true)), 5)
    }

    func testFinishConfirmsWhatIsStillBeingSaid() throws {
        let a = asr(FakeTranscriber("cut off by stop"))
        play(a, .mic, from: 0, 1500, speaking: true)
        a.finish()
        XCTAssertEqual(confirmed.first?["text"] as? String, "cut off by stop")
    }
}

final class EngineASRTests: XCTestCase {
    private let startLine =
        #"{"id":1,"cmd":{"type":"start_session","call_id":"call_1","session_dir":"audio/call_1","store_audio":false,"mic_device_uid":null,"exclude_bundle_ids":[],"languages":["en"],"backend":"whisper_turbo","glossary":[],"speaker_priors":[],"enrolled_embeddings_path":null,"resume_from_ms":null}}"#

    private func root() throws -> URL {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("noter-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }

    func testTheSessionCapturesFirstThenLoadsTheModelAndTranscribes() throws {
        let (lines, source, loads) = (Lines(), DeviceSource(), Box<[String]>([]))
        let e = EngineLoop(
            writer: writer(lines), engineVersion: "test", models: ["whisper-turbo"], sandboxed: false, container: try root(),
            transcriber: {
                loads.value.append(lines.types.contains("session_started") ? "after" : "before")
                return FakeTranscriber("live words")
            }, source: { _ in source })
        _ = e.handle(startLine)
        _ = try XCTUnwrap(lines.waitFor("session_started"))
        for _ in 0..<15 { source.push(mic: speech(), sys: quiet()) }
        for _ in 0..<10 { source.push(mic: quiet(), sys: quiet()) }
        _ = e.handle(#"{"id":2,"cmd":{"type":"stop","call_id":"call_1"}}"#)
        _ = try XCTUnwrap(lines.waitFor("session_stopped"))
        XCTAssertEqual(loads.value, ["after"], "taps first, then the model")
        let segment = try XCTUnwrap(lines.events.compactMap { $0["segment"] as? [String: Any] }.last)
        XCTAssertEqual(segment["text"] as? String, "live words")
        XCTAssertEqual(segment["state"] as? String, "confirmed")
    }

    func testStopAnswersPingWhileTheModelIsStillLoading() throws {
        let (lines, source, loading) = (Lines(), DeviceSource(), DispatchSemaphore(value: 0))
        let e = EngineLoop(
            writer: writer(lines), engineVersion: "test", models: ["whisper-turbo"], sandboxed: false, container: try root(),
            transcriber: {
                loading.wait()  // a slow model load
                return FakeTranscriber("late words")
            }, source: { _ in source })
        _ = e.handle(startLine)
        for _ in 0..<15 { source.push(mic: speech(), sys: quiet()) }
        _ = e.handle(#"{"id":2,"cmd":{"type":"stop","call_id":"call_1"}}"#)
        _ = e.handle(#"{"id":3,"cmd":{"type":"ping"}}"#)
        XCTAssertEqual(lines.types.suffix(2), ["ack", "pong"], "the command thread is free while the call finishes")
        XCTAssertFalse(lines.types.contains("session_stopped"))
        loading.signal()
        _ = try XCTUnwrap(lines.waitFor("session_stopped"))
        let segment = try XCTUnwrap(lines.events.compactMap { $0["segment"] as? [String: Any] }.last)
        XCTAssertEqual(segment["text"] as? String, "late words", "what was said before the model loaded is still confirmed")
        XCTAssertLessThan(
            try XCTUnwrap(lines.types.lastIndex(of: "segment")), try XCTUnwrap(lines.types.firstIndex(of: "session_stopped")))
    }

    /// The first engine hears `before` (quiet then speech) and dies without `stop`; the successor
    /// restarts the call 1.5 s later and must transcribe what the first one never confirmed.
    private func restart(before: [(speaking: Bool, ms: Int)]) throws -> (lines: Lines, asked: FakeTranscriber) {
        let (root, clock) = (try root(), TestClock())
        do {
            let (lines, source) = (Lines(), DeviceSource())
            let e = EngineLoop(
                writer: writer(lines), engineVersion: "test", models: [], sandboxed: false, container: root, now: clock.now,
                source: { _ in source })
            _ = e.handle(startLine)
            for (speaking, ms) in before {
                for _ in 0..<(ms / 100) { source.push(mic: speaking ? speech() : quiet(), sys: quiet()) }
                clock.advance(Int64(ms))
            }
        }
        clock.advance(1500)
        let (lines, source, t) = (Lines(), DeviceSource(), FakeTranscriber("said as the engine died"))
        let e = EngineLoop(
            writer: writer(lines), engineVersion: "test", models: ["whisper-turbo"], sandboxed: false, container: root,
            now: clock.now, transcriber: { t }, source: { _ in source })
        _ = e.handle(startLine.replacingOccurrences(of: #""resume_from_ms":null"#, with: #""resume_from_ms":3000"#))
        _ = try XCTUnwrap(lines.waitFor("session_started"))
        _ = e.handle(#"{"id":2,"cmd":{"type":"stop","call_id":"call_1"}}"#)
        _ = try XCTUnwrap(lines.waitFor("session_stopped"))
        return (lines, t)
    }

    func testAfterARestartTheSuccessorDecodesWhatTheCrashedEngineHadNotConfirmed() throws {
        let (lines, t) = try restart(before: [(false, 1000), (true, 2000)])
        let segment = try XCTUnwrap(lines.events.compactMap { $0["segment"] as? [String: Any] }.first)
        XCTAssertEqual(segment["state"] as? String, "confirmed")
        XCTAssertEqual(segment["text"] as? String, "said as the engine died")
        XCTAssertEqual(segment["t0_ms"] as? Int, 1000, "from the last pause before the crash")
        XCTAssertEqual(segment["t1_ms"] as? Int, 3000, "to where the crashed engine stopped")
        XCTAssertEqual(t.asked.first?.samples, 16 * 2000)
        XCTAssertLessThan(
            try XCTUnwrap(lines.types.firstIndex(of: "session_started")), try XCTUnwrap(lines.types.firstIndex(of: "segment")),
            "taps first, then the model, then the ring")
    }

    func testAfterARestartAtAPauseThereIsNothingToDecodeAgain() throws {
        let (lines, t) = try restart(before: [(true, 1000), (false, 2000)])
        XCTAssertTrue(t.asked.isEmpty, "the crashed engine closed and confirmed that utterance itself")
        XCTAssertNil(lines.events.first { $0["type"] as? String == "segment" })
    }

    func testAModelThatFailsToLoadIsReportedAndCaptureGoesOn() throws {
        let (lines, source) = (Lines(), DeviceSource())
        let e = EngineLoop(
            writer: writer(lines), engineVersion: "test", models: ["whisper-turbo"], sandboxed: false, container: try root(),
            transcriber: { throw LiveAudioSource.Failure(description: "bad model") }, source: { _ in source })
        _ = e.handle(startLine)
        let error = try XCTUnwrap(lines.waitFor("error"))
        XCTAssertEqual(error["code"] as? String, "model_load_failed")
        XCTAssertTrue(error["cmd_id"] is NSNull)
        source.push(ms: 300)
        XCTAssertTrue(lines.types.contains("levels"))
    }

    func testTheSelfTestSaysWhatEachChannelHeardOnceTheModelIsLoaded() throws {
        let (source, loaded) = (DeviceSource(), DispatchSemaphore(value: 0))
        var lines = Lines()
        let e = EngineLoop(
            writer: EventWriter(clock: { 1_000 }, out: { lines.write($0) }), engineVersion: "test", models: ["whisper-turbo"],
            sandboxed: false, play: { _ in },
            transcriber: {
                defer { loaded.signal() }
                return FakeTranscriber("one two three")
            }, source: { _ in source })
        func selfTest() throws -> [[String: Any]] {
            lines = Lines()
            _ = e.handle(#"{"id":1,"cmd":{"type":"self_test","play_clip":false,"timeout_ms":3000}}"#)
            Thread.sleep(forTimeInterval: 0.2)
            for _ in 0..<20 { source.push(mic: speech(), sys: speech()) }
            _ = try XCTUnwrap(lines.waitFor("self_test_result"))
            return lines.events.filter { $0["type"] as? String == "self_test_line" }
        }
        // A cold model can take longer to load than the core waits for the result: the first test
        // only starts loading it.
        XCTAssertEqual(try selfTest().count, 0)
        XCTAssertEqual(loaded.wait(timeout: .now() + 5), .success)
        let heard = try selfTest()
        XCTAssertEqual(Set(heard.compactMap { $0["channel"] as? String }), ["mic", "sys"])
        XCTAssertEqual(heard.first?["text"] as? String, "one two three")
        XCTAssertLessThan(
            try XCTUnwrap(lines.types.firstIndex(of: "self_test_line")), try XCTUnwrap(lines.types.firstIndex(of: "self_test_result")))
    }
}
