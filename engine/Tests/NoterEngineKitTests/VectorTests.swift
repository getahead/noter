import Foundation
import XCTest

@testable import NoterEngineKit

/// Local vectors (`cpt-noter-algo-core-engine-offline-vectors`): WeSpeaker reads only the
/// requested channel and spans, bge-m3 keeps input order and count (an empty batch is zero rows),
/// every vector is checked before it is written or returned. The models are scripted here.

/// A speaker model that answers `vector` and records the audio it was given.
final class FakeSpeaker: SpeakerModel, @unchecked Sendable {
    var vector = [Float](repeating: 0.25, count: 256)
    private(set) var heard: [Float] = []

    func embed(_ samples: [Float]) throws -> [Float] {
        heard = samples
        return vector
    }
}

/// A text model whose row for a text is its length, repeated; `broken` texts get a NaN.
final class FakeText: TextModel, @unchecked Sendable {
    var dims = 1024
    var broken: Set<String> = []

    func embed(_ text: String) throws -> [Float] {
        [Float](repeating: broken.contains(text) ? .nan : Float(text.count), count: dims)
    }
}

final class VectorTests: XCTestCase {
    private var container: URL!
    private var session: URL { container.appendingPathComponent("audio/call_1") }

    override func setUpWithError() throws {
        container = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: container.appendingPathComponent("engine-io"), withIntermediateDirectories: true)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: container)
    }

    private func floats(_ url: URL) throws -> [Float] {
        let data = try Data(contentsOf: url)
        return stride(from: 0, to: data.count, by: 4).map { i in
            Float(bitPattern: UInt32(littleEndian: data[i..<i + 4].withUnsafeBytes { $0.loadUnaligned(as: UInt32.self) }))
        }
    }

    private func request(_ spans: [Span], channel: Channel = .sys) -> SpeakerEmbedding {
        SpeakerEmbedding(requestId: "r1", callId: "call_1", channel: channel, spans: spans, outPath: "engine-io/s.f32")
    }

    // MARK: speaker

    func testASpeakerVectorHearsOnlyItsChannelAndSpansInCallTime() throws {
        // The mic is quiet, the system channel loud; the call paused 2.5-12.5 s.
        try storeCall(
            in: session, seconds: 6, mic: [(0, 6)], sys: [(0, 6)], gaps: [(2_500, 12_500)], micAmplitude: 0.01,
            sysAmplitude: 0.5)
        let model = FakeSpeaker()
        let out = container.appendingPathComponent("engine-io/s.f32")
        try LocalOfflineWork(speaker: { model }).speaker(
            request([Span(t0Ms: 1_000, t1Ms: 2_000), Span(t0Ms: 13_000, t1Ms: 13_500)]), session: session, out: out)
        XCTAssertEqual(model.heard.count, 16_000 + 8_000, "1 s, then 0.5 s after the gap")
        XCTAssertGreaterThan(Levels.db(model.heard), -10, "the system channel")
        XCTAssertEqual(try floats(out), model.vector)
    }

    func testASpeakerVectorThatIsNotTwoHundredFiftySixFiniteValuesIsNeverWritten() throws {
        try storeCall(in: session, seconds: 3, mic: [], sys: [(0, 3)])
        let out = container.appendingPathComponent("engine-io/s.f32")
        for bad in [[Float](repeating: 1, count: 255), [Float](repeating: .infinity, count: 256)] {
            let model = FakeSpeaker()
            model.vector = bad
            XCTAssertThrowsError(
                try LocalOfflineWork(speaker: { model }).speaker(request([Span(t0Ms: 0, t1Ms: 1_000)]), session: session, out: out))
            XCTAssertFalse(FileManager.default.fileExists(atPath: out.path))
        }
    }

    func testSpansWithNoStoredAudioFailAsABadCommand() throws {
        try storeCall(in: session, seconds: 3, mic: [], sys: [(0, 3)])
        try FileManager.default.removeItem(at: session.appendingPathComponent("mic.wav"))
        let work = LocalOfflineWork(speaker: { FakeSpeaker() })
        let out = container.appendingPathComponent("engine-io/s.f32")
        for r in [request([Span(t0Ms: 60_000, t1Ms: 61_000)]), request([Span(t0Ms: 0, t1Ms: 1_000)], channel: .mic)] {
            XCTAssertThrowsError(try work.speaker(r, session: session, out: out)) {
                XCTAssertEqual(($0 as? OfflineFailure)?.code, .badCommand)
            }
        }
    }

    // MARK: text

    func testTextRowsKeepInputOrderAndCountInTheirFile() throws {
        let out = container.appendingPathComponent("engine-io/b.f32")
        XCTAssertNil(try LocalOfflineWork(text: { FakeText() }).texts(["a", "bbb", "cc"], out: out))
        let rows = try floats(out)
        XCTAssertEqual(rows.count, 3 * 1024)
        XCTAssertEqual([rows[0], rows[1024], rows[2048]], [1, 3, 2])
    }

    func testOneTextIsInlineAndAnEmptyBatchIsZeroRowsWithoutTheModel() throws {
        XCTAssertEqual(try LocalOfflineWork(text: { FakeText() }).texts(["hello"], out: nil), [Float](repeating: 5, count: 1024))
        let out = container.appendingPathComponent("engine-io/e.f32")
        let unused = LocalOfflineWork(text: { throw OfflineFailure(code: .modelLoadFailed) })
        XCTAssertNil(try unused.texts([], out: out))
        XCTAssertEqual(try Data(contentsOf: out).count, 0)
    }

    func testATextRowThatIsNotFiniteOrTheWrongSizeFailsTheWholeBatch() throws {
        let out = container.appendingPathComponent("engine-io/b.f32")
        let nan = FakeText()
        nan.broken = ["b"]
        XCTAssertThrowsError(try LocalOfflineWork(text: { nan }).texts(["a", "b"], out: out))
        let short = FakeText()
        short.dims = 768
        XCTAssertThrowsError(try LocalOfflineWork(text: { short }).texts(["a"], out: nil))
        XCTAssertFalse(FileManager.default.fileExists(atPath: out.path))
    }

    func testAModelThatFailsToLoadIsModelLoadFailed() throws {
        let work = LocalOfflineWork(text: { throw CocoaError(.fileReadCorruptFile) })
        XCTAssertThrowsError(try work.texts(["a"], out: nil)) {
            XCTAssertEqual(($0 as? OfflineFailure)?.code, .modelLoadFailed)
        }
    }

    func testTheInstalledModelFoldersSayWhatTheEngineCanDo() throws {
        let models = container.appendingPathComponent("models")
        XCTAssertEqual(LocalOfflineWork.installed(models: models).available, [])
        for folder in ["whisper-large-v3", "bge-m3", "wespeaker.partial"] {
            try FileManager.default.createDirectory(at: models.appendingPathComponent(folder), withIntermediateDirectories: true)
        }
        XCTAssertEqual(LocalOfflineWork.installed(models: models).available, [.archive, .text])
    }
}
