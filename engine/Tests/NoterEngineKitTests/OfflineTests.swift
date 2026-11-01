import Foundation
import XCTest

@testable import NoterEngineKit

/// What the engine answers to `offline_pass`, `speaker_embedding` and `embed_texts` before the
/// models exist (core-engine-offline, slice 1): container-relative paths and requests are checked
/// before any file opens, an invalid one gets the correlated `error`, a valid one is acknowledged
/// and its work's progress, result or failure is reported with the request's id.

/// Offline work that writes what a real decoder or embedder would, or fails as told.
private final class FakeWork: OfflineWork, @unchecked Sendable {
    var fail: EngineErrorCode?
    var leavesPartialFile = false

    func archive(
        _ pass: OfflinePass, session: URL, result: URL, constraints: OfflineConstraints, progress: (Float) -> Void
    ) throws {
        progress(0.25)
        progress(1.5)  // clamped
        if let fail {
            if leavesPartialFile { try Data("{\"call_id\":".utf8).write(to: result) }
            throw OfflineFailure(code: fail)
        }
        try Data(#"{"call_id":"call_1","backend":"whisper_large_v3","segments":[]}"#.utf8).write(to: result)
    }

    func speaker(_ request: SpeakerEmbedding, session: URL, out: URL) throws {
        if let fail {
            try Data([0, 0]).write(to: out)
            throw OfflineFailure(code: fail)
        }
        try Data(count: 256 * 4).write(to: out)
    }

    func texts(_ texts: [String], out: URL?) throws -> [Float]? {
        if let fail { throw OfflineFailure(code: fail) }
        if let out {
            try Data(count: texts.count * 1024 * 4).write(to: out)
            return nil
        }
        return [Float](repeating: 0.5, count: 1024)
    }
}

// @cpt-dod:cpt-noter-dod-core-engine-offline-tests:p1
final class OfflineTests: XCTestCase {
    private var container: URL!

    override func setUpWithError() throws {
        container = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        for dir in ["audio/call_1", "engine-io"] {
            try FileManager.default.createDirectory(
                at: container.appendingPathComponent(dir), withIntermediateDirectories: true)
        }
        try storeCall(in: container.appendingPathComponent("audio/call_1"), seconds: 1, mic: [], sys: [])
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: container)
    }

    private func engine(_ lines: Lines, work: OfflineWork?) -> EngineLoop {
        EngineLoop(
            writer: writer(lines), engineVersion: "test", models: [], sandboxed: false, container: container,
            offline: work
        ) { _ in nil }
    }

    private func offlinePass(
        _ id: Int, result: String = "audio/call_1/offline.json", session: String = "audio/call_1",
        constraints: String = "null"
    ) -> String {
        #"{"id":\#(id),"cmd":{"type":"offline_pass","call_id":"call_1","session_dir":"\#(session)","result_path":"\#(result)","constraints_path":\#(constraints),"backend":"whisper_large_v3"}}"#
    }

    private func speaker(
        _ id: Int, call: String = "call_1", spans: String = #"[{"t0_ms":1000,"t1_ms":2500}]"#,
        out: String = "engine-io/s.f32"
    ) -> String {
        #"{"id":\#(id),"cmd":{"type":"speaker_embedding","request_id":"req_\#(id)","call_id":"\#(call)","channel":"sys","spans":\#(spans),"out_path":"\#(out)"}}"#
    }

    private func texts(_ id: Int, _ texts: [String], out: String?) -> String {
        let list = texts.map { "\"\($0)\"" }.joined(separator: ",")
        let path = out.map { "\"\($0)\"" } ?? "null"
        return #"{"id":\#(id),"cmd":{"type":"embed_texts","request_id":"req_\#(id)","texts":[\#(list)],"out_path":\#(path)}}"#
    }

    /// The `error` code answering command `id`, if it was refused.
    private func refusal(_ lines: Lines, _ id: Int) -> String? {
        lines.events.first { $0["type"] as? String == "error" && $0["cmd_id"] as? Int == id }?["code"] as? String
    }

    private func acked(_ lines: Lines, _ id: Int) -> Bool {
        lines.events.contains { $0["type"] as? String == "ack" && $0["cmd_id"] as? Int == id }
    }

    private func exists(_ path: String) -> Bool {
        FileManager.default.fileExists(atPath: container.appendingPathComponent(path).path)
    }

    // MARK: paths

    func testContainerPathsStayInsideTheContainer() throws {
        let ok = try XCTUnwrap(ContainerPath.resolve("audio/call_1/offline.json", in: container))
        XCTAssertEqual(ok.lastPathComponent, "offline.json")
        for bad in ["", "/etc/passwd", "../x", "audio/../../x", "audio/./x", "audio//x", "a\u{0}b", "audio/call_1/"] {
            XCTAssertNil(ContainerPath.resolve(bad, in: container), bad)
        }
    }

    func testASymlinkOutOfTheContainerIsRefused() throws {
        let outside = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: outside, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: outside) }
        try FileManager.default.createSymbolicLink(
            at: container.appendingPathComponent("audio/link"), withDestinationURL: outside)
        XCTAssertNil(ContainerPath.resolve("audio/link/offline.json", in: container))
    }

    // MARK: offline_pass

    func testAnArchivePassWithUnsafeOrMissingInputIsRefusedWithItsId() throws {
        let lines = Lines()
        let e = engine(lines, work: FakeWork())
        _ = e.handle(offlinePass(1, result: "../offline.json"))
        _ = e.handle(offlinePass(2, session: "/audio/call_1"))
        _ = e.handle(offlinePass(3, constraints: #""audio/call_1/../../c.json""#))
        _ = e.handle(offlinePass(4, session: "audio/call_2"))  // no stored audio
        _ = e.handle(offlinePass(5, constraints: #""audio/call_1/constraints.json""#))  // not written
        for id in 1...5 {
            XCTAssertEqual(refusal(lines, id), "bad_command", "\(id)")
            XCTAssertFalse(acked(lines, id))
        }
        XCTAssertFalse(lines.types.contains("offline_done"))
    }

    func testWithoutTheModelsTheRequestIsRefusedAsModelMissing() throws {
        let lines = Lines()
        let e = engine(lines, work: nil)
        _ = e.handle(offlinePass(1))
        _ = e.handle(speaker(2))
        _ = e.handle(texts(3, ["hello"], out: nil))
        XCTAssertEqual([1, 2, 3].map { refusal(lines, $0) }, ["model_missing", "model_missing", "model_missing"])
    }

    func testAnArchivePassIsAcknowledgedThenReportsProgressAndItsCompleteFile() throws {
        let lines = Lines()
        try Data(ArchiveTests.languages(["en"]).utf8).write(to: container.appendingPathComponent("audio/call_1/constraints.json"))
        _ = engine(lines, work: FakeWork()).handle(offlinePass(7, constraints: #""audio/call_1/constraints.json""#))
        let done = try XCTUnwrap(lines.waitFor("offline_done"))
        XCTAssertEqual(done["call_id"] as? String, "call_1")
        XCTAssertEqual(done["result_path"] as? String, "audio/call_1/offline.json")
        XCTAssertTrue(exists("audio/call_1/offline.json"))
        let types = lines.types
        XCTAssertEqual(types.first, "ack")
        XCTAssertEqual(lines.events.first?["cmd_id"] as? Int, 7)
        XCTAssertEqual(
            lines.events.filter { $0["type"] as? String == "offline_progress" }.compactMap { $0["progress"] as? Double },
            [0.25, 1.0])
        XCTAssertLessThan(
            try XCTUnwrap(types.firstIndex(of: "offline_progress")), try XCTUnwrap(types.firstIndex(of: "offline_done")))
    }

    func testAFailedArchivePassReportsOfflineFailedAndLeavesNoPartialFile() throws {
        let lines = Lines()
        let work = FakeWork()
        work.fail = .diskFull
        work.leavesPartialFile = true
        _ = engine(lines, work: work).handle(offlinePass(1))
        let failed = try XCTUnwrap(lines.waitFor("offline_failed"))
        XCTAssertEqual(failed["code"] as? String, "disk_full")
        XCTAssertFalse(lines.types.contains("offline_done"))
        XCTAssertFalse(exists("audio/call_1/offline.json"))
    }

    // MARK: embeddings

    func testSpeakerSpansAndCallsAreCheckedBeforeAnyFileOpens() throws {
        let lines = Lines()
        let e = engine(lines, work: FakeWork())
        _ = e.handle(speaker(1, spans: "[]"))
        _ = e.handle(speaker(2, spans: #"[{"t0_ms":2000,"t1_ms":2000}]"#))
        _ = e.handle(speaker(3, spans: #"[{"t0_ms":-5,"t1_ms":2000}]"#))
        _ = e.handle(speaker(4, call: "call_9"))
        _ = e.handle(speaker(5, out: "../s.f32"))
        for id in 1...5 { XCTAssertEqual(refusal(lines, id), "bad_command", "\(id)") }
    }

    func testASpeakerEmbeddingAnswersWithItsRequestIdAndFile() throws {
        let lines = Lines()
        _ = engine(lines, work: FakeWork()).handle(speaker(4))
        let done = try XCTUnwrap(lines.waitFor("speaker_embedding_done"))
        XCTAssertTrue(acked(lines, 4))
        XCTAssertEqual(done["request_id"] as? String, "req_4")
        XCTAssertEqual(done["out_path"] as? String, "engine-io/s.f32")
    }

    func testAFailedSpeakerEmbeddingIsTheCorrelatedErrorAndRemovesItsFile() throws {
        let lines = Lines()
        let work = FakeWork()
        work.fail = .modelLoadFailed
        _ = engine(lines, work: work).handle(speaker(4))
        XCTAssertNotNil(lines.waitFor("error"))
        XCTAssertTrue(acked(lines, 4))
        XCTAssertEqual(refusal(lines, 4), "model_load_failed")
        XCTAssertFalse(exists("engine-io/s.f32"))
    }

    func testOneTextIsInlineAndABatchGoesToItsFileWithItsCount() throws {
        let lines = Lines()
        let e = engine(lines, work: FakeWork())
        _ = e.handle(texts(1, ["hello"], out: nil))
        _ = e.handle(texts(2, ["a", "b", "c"], out: "engine-io/b.f32"))
        _ = e.handle(texts(3, [], out: "engine-io/e.f32"))
        _ = e.handle(texts(4, ["a", "b"], out: nil))  // a batch needs a file
        _ = e.handle(texts(5, ["a"], out: "/tmp/x.f32"))
        let deadline = Date().addingTimeInterval(5)
        while lines.types.filter({ $0 == "embeddings" }).count < 3, Date() < deadline {
            Thread.sleep(forTimeInterval: 0.01)
        }
        let answers = Dictionary(
            uniqueKeysWithValues: lines.events.filter { $0["type"] as? String == "embeddings" }
                .map { ($0["request_id"] as? String ?? "", $0) })
        XCTAssertEqual((answers["req_1"]?["inline"] as? [Double])?.count, 1024)
        XCTAssertEqual(answers["req_1"]?["count"] as? Int, 1)
        XCTAssertTrue(answers["req_1"]?["out_path"] is NSNull)
        XCTAssertEqual(answers["req_2"]?["out_path"] as? String, "engine-io/b.f32")
        XCTAssertEqual(answers["req_2"]?["count"] as? Int, 3)
        XCTAssertTrue(answers["req_2"]?["inline"] is NSNull)
        XCTAssertEqual(answers["req_3"]?["count"] as? Int, 0)
        XCTAssertEqual(refusal(lines, 4), "bad_command")
        XCTAssertEqual(refusal(lines, 5), "bad_command")
    }

    func testAFailedTextEmbeddingIsTheCorrelatedError() throws {
        let lines = Lines()
        let work = FakeWork()
        work.fail = .modelMissing
        _ = engine(lines, work: work).handle(texts(9, ["a"], out: nil))
        XCTAssertNotNil(lines.waitFor("error"))
        XCTAssertTrue(acked(lines, 9))
        XCTAssertEqual(refusal(lines, 9), "model_missing")
    }

    func testTheCommandsDecodeAsTheCoreWritesThem() throws {
        let decode = { (s: String) in try JSONDecoder().decode(EngineCommandLine.self, from: Data(s.utf8)).cmd }
        XCTAssertEqual(
            try decode(offlinePass(1, constraints: #""audio/call_1/c.json""#)),
            .offlinePass(
                OfflinePass(
                    callId: "call_1", sessionDir: "audio/call_1", resultPath: "audio/call_1/offline.json",
                    constraintsPath: "audio/call_1/c.json", backend: "whisper_large_v3")))
        XCTAssertEqual(
            try decode(speaker(2)),
            .speakerEmbedding(
                SpeakerEmbedding(
                    requestId: "req_2", callId: "call_1", channel: .sys, spans: [Span(t0Ms: 1000, t1Ms: 2500)],
                    outPath: "engine-io/s.f32")))
        XCTAssertEqual(try decode(texts(3, ["a"], out: nil)), .embedTexts(requestId: "req_3", texts: ["a"], outPath: nil))
    }
}
