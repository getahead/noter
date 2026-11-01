import Foundation
import XCTest

@testable import NoterEngineKit

/// The archive's speaker clustering (`inst-decode-cluster`, D-32 option 2) on synthetic calls:
/// each voice is a tone of its own pitch, the segmentation and WeSpeaker models are scripted from
/// that pitch, and VBx runs on a PLDA that keeps the vectors as they are. The pinned CoreML models
/// and the golden-set quality run are the owner's (TL-17).

/// Zero crossings per second of `samples`: twice a tone's pitch.
private func crossings(_ samples: ArraySlice<Float>) -> Double {
    guard samples.count > 1 else { return 0 }
    let n = zip(samples, samples.dropFirst()).filter { ($0 < 0) != ($1 < 0) }.count
    return Double(n) * 16_000 / Double(samples.count)
}

/// Which voice a pitch is: 220 Hz is 0, 440 Hz is 1, 660 Hz is 2.
private func voice(_ samples: ArraySlice<Float>) -> Int { max(0, Int((crossings(samples) / 440).rounded()) - 1) }

/// pyannote segmentation as a test scripts it: 100 frames of 100 ms per 10 s window, each frame
/// with sound has the voice its pitch names as the window's local speaker.
final class PitchSegmentation: SegmentationModel, @unchecked Sendable {
    var fails = false
    var silent = false
    private(set) var windows = 0

    func speakers(_ window: [Float]) throws -> [Set<Int>] {
        if fails { throw OfflineFailure(code: .internal) }
        windows += 1
        return (0..<100).map { f in
            let frame = window[min(window.count, f * 1_600)..<min(window.count, (f + 1) * 1_600)]
            guard !silent, Levels.db(Array(frame)) > LiveASR.speechDb else { return [] }
            return [voice(frame)]
        }
    }
}

/// WeSpeaker as a test scripts it: a voice's vector points along its own axis, nudged by the
/// turn's length so no two are equal.
final class PitchSpeaker: SpeakerModel, @unchecked Sendable {
    private(set) var turns = 0

    func embed(_ samples: [Float]) throws -> [Float] {
        turns += 1
        var v = [Float](repeating: 0, count: Vectors.speakerDims)
        v[voice(samples[...])] = 1
        v[200] = Float(samples.count % 97) / 1_000
        return v
    }
}

/// A PLDA that changes nothing: the first 128 values pass through, every direction weighs one.
func identityPLDA() -> PLDA {
    let (big, small) = (Vectors.speakerDims, 128)
    let eye = { (rows: Int, cols: Int) in (0..<rows).map { i in (0..<cols).map { j in i == j ? 1.0 : 0 } } }
    return PLDA(
        mean1: Array(repeating: 0, count: big), lda: eye(big, small), mean2: Array(repeating: 0, count: small),
        mu: Array(repeating: 0, count: small), tr: eye(small, small), psi: Array(repeating: 1, count: small))
}

final class DiarizationTests: XCTestCase {
    private var container: URL!
    private var session: URL { container.appendingPathComponent("audio/call_1") }
    private let pass = OfflinePass(
        callId: "call_1", sessionDir: "audio/call_1", resultPath: "audio/call_1/offline-1.json", constraintsPath: nil,
        backend: "whisper_large_v3")
    private let segmentation = PitchSegmentation()
    private let speaker = PitchSpeaker()

    override func setUpWithError() throws {
        container = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(
            at: container.appendingPathComponent("engine-io"), withIntermediateDirectories: true)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: container)
    }

    /// A call with the user on the microphone at `mic` and the voices of `sys` (from, to, pitch).
    private func store(seconds: Double, mic: [(Double, Double)] = [], sys: [(Double, Double, Float)]) throws {
        try storeCall(in: session, seconds: seconds, mic: mic, sys: [])
        var samples = [Float](repeating: 0, count: Int(seconds * 16_000))
        for (from, to, hz) in sys {
            for i in Int(from * 16_000)..<Int(to * 16_000) { samples[i] = 0.3 * sin(Float(i) * 2 * .pi * hz / 16_000) }
        }
        try WAV.encode(samples: samples, sampleRate: 16_000, float: false).write(to: session.appendingPathComponent("sys.wav"))
    }

    private func constraints(must: [(Int, Int, Int, Int)] = [], cannot: [(Int, Int, Int, Int)] = [], names: String = "{}")
        throws -> OfflineConstraints
    {
        let links = { (l: [(Int, Int, Int, Int)]) in
            l.map { #"{"a":{"t0_ms":\#($0.0),"t1_ms":\#($0.1)},"b":{"t0_ms":\#($0.2),"t1_ms":\#($0.3)}}"# }.joined(separator: ",")
        }
        let json = #"{"languages":[],"glossary":[],"speaker_priors":[],"must_link":[\#(links(must))],"cannot_link":[\#(links(cannot))],"speaker_names":\#(names)}"#
        let url = container.appendingPathComponent("engine-io/c.json")
        try Data(json.utf8).write(to: url)
        return try XCTUnwrap(OfflineConstraints.read(url))
    }

    /// The pass with the scripted models: each segment's channel and label, in call order.
    private func labels(_ c: OfflineConstraints = .none) throws -> [String] {
        let work = LocalOfflineWork(
            decoder: { FakeDecoder() }, speaker: { self.speaker },
            clustering: { Clustering(segmentation: self.segmentation, plda: identityPLDA()) })
        let out = container.appendingPathComponent(pass.resultPath)
        try work.archive(pass, session: session, result: out, constraints: c) { _ in }
        return try JSONDecoder().decode(ArchiveResult.self, from: Data(contentsOf: out)).segments
            .map { "\($0.channel.rawValue):\($0.speakerLabel)" }
    }

    // MARK: the pass

    func testTwoVoicesOnTheSystemChannelAreTwoSpeakersInOrderOfFirstWords() throws {
        // A and B take turns in the first window and again in the second one.
        try store(
            seconds: 17, mic: [(6, 8)], sys: [(0.5, 2.5, 220), (3.5, 5.5, 440), (11, 13, 220), (14, 16, 440)])
        XCTAssertEqual(
            try labels(), ["sys:spk_1", "sys:spk_2", "mic:you", "sys:spk_1", "sys:spk_2"],
            "one label per voice; the microphone stays the user")
        XCTAssertEqual(segmentation.windows, 2, "the system channel in 10 s windows")
        XCTAssertEqual(speaker.turns, 4, "one vector per speaker of a window")
    }

    func testACannotLinkKeepsTwoTurnsOfOneVoiceApart() throws {
        try store(seconds: 16, sys: [(0.5, 4, 220), (11, 14.5, 220)])
        XCTAssertEqual(try labels(), ["sys:spk_1", "sys:spk_1"], "one voice")
        XCTAssertEqual(
            try labels(constraints(cannot: [(500, 4_000, 11_000, 14_500)])), ["sys:spk_1", "sys:spk_2"],
            "the user said these are two people")
        // Within one window the segmentation hears one speaker: the user's split still holds.
        try store(seconds: 10, sys: [(0.5, 4, 220), (5, 8.5, 220)])
        XCTAssertEqual(try labels(constraints(cannot: [(500, 4_000, 5_000, 8_500)])), ["sys:spk_1", "sys:spk_2"])
    }

    func testAMustLinkJoinsTwoVoicesTheUserSaidAreOne() throws {
        try store(seconds: 17, sys: [(0.5, 2.5, 220), (3.5, 5.5, 440), (11, 13, 220), (14, 16, 440)])
        XCTAssertEqual(
            try labels(constraints(must: [(500, 2_500, 3_500, 5_500)])), Array(repeating: "sys:spk_1", count: 4),
            "the link joins the turns it names and so their voices")
    }

    func testSpeakersSharingAUserGivenNameAreOneVoice() throws {
        try store(seconds: 17, sys: [(0.5, 2.5, 220), (3.5, 5.5, 440), (11, 13, 220), (14, 16, 440)])
        XCTAssertEqual(
            try labels(constraints(names: #"{"spk_1":"Anna","spk_2":"Anna"}"#)), Array(repeating: "sys:spk_1", count: 4))
    }

    func testAVoiceWithUnderThreeSecondsOfSpeechStaysUnnamed() throws {
        try store(seconds: 10, sys: [(0.5, 4.5, 220), (6, 7, 660)])
        XCTAssertEqual(try labels(), ["sys:spk_1", "sys:"])
    }

    func testWithoutSpeechTurnsTheSystemChannelKeepsItsLiveLabel() throws {
        segmentation.silent = true
        try store(seconds: 6, sys: [(0.5, 4.5, 220)])
        XCTAssertEqual(try labels(), ["sys:spk_1"])
        XCTAssertEqual(speaker.turns, 0)
    }

    func testAFailedSegmentationFailsThePassAndLeavesNoResult() throws {
        segmentation.fails = true
        try store(seconds: 6, sys: [(0.5, 4.5, 220)])
        XCTAssertThrowsError(try labels())
        XCTAssertFalse(FileManager.default.fileExists(atPath: container.appendingPathComponent(pass.resultPath).path))
    }

    // MARK: the parts

    func testVBxSeparatesTwoVoicesOfPLDASize() {
        // Two voices along two of 128 directions, at the length the x-vector transform gives.
        let x = (0..<6).map { i in (0..<128).map { j in j == i / 3 ? 11.3 : 0 } }
        let (gamma, pi) = Diarization.vbx(x, phi: Array(repeating: 4, count: 128), start: [0, 0, 0, 1, 1, 1])
        XCTAssertEqual(gamma.map { $0[0] > 0.5 ? 0 : 1 }, [0, 0, 0, 1, 1, 1])
        XCTAssertEqual(pi[0], 0.5, accuracy: 1e-9)
        for row in gamma { XCTAssertEqual(row.reduce(0, +), 1, accuracy: 1e-9) }
    }

    func testVBxGivesWhatPyannotesVBxGives() {
        // Expected values: pyannote's `VBx` (numpy) on the same input, Fa 0.07, Fb 0.8, 20 iterations.
        let x: [[Double]] = [
            [2, 0.5, -1, 0.3], [1.8, 0.7, -0.8, 0.1], [2.2, 0.4, -1.1, 0.5], [-1, 1.5, 0.9, -0.4], [-0.8, 1.7, 1.1, -0.2],
            [-1.2, 1.4, 0.8, -0.6],
        ]
        let (gamma, pi) = Diarization.vbx(x, phi: [6, 3, 2, 1], start: [0, 0, 0, 1, 1, 1])
        let expected = [0.514384349006, 0.514408719833, 0.514382503431, 0.514278948874, 0.514344679707, 0.514235743246]
        for (row, e) in zip(gamma, expected) { XCTAssertEqual(row[0], e, accuracy: 1e-9) }
        XCTAssertEqual(pi[0], 0.51433915735, accuracy: 1e-9)
    }

    func testAgglomerativeStartJoinsCloseVectorsOnly() {
        let x: [[Double]] = [[1, 0], [0.99, 0.14], [0, 1], [0.1, 0.99]]
        XCTAssertEqual(Diarization.ahc(x, threshold: 0.6), [0, 0, 1, 1])
        XCTAssertEqual(Diarization.ahc(x, threshold: 2), [0, 0, 0, 0])
    }

    func testAssignmentKeepsCannotLinks() {
        let x: [[Double]] = [[1, 0], [1, 0.1], [0, 1]]
        let centroids: [[Double]] = [[1, 0], [0, 1]]
        XCTAssertEqual(Diarization.assign(x, centroids: centroids, cannot: []), [0, 0, 1])
        XCTAssertEqual(Diarization.assign(x, centroids: centroids, cannot: [(0, 1)]), [0, 1, 1], "the less sure one moves")
        // Three turns, each said apart from the others: a third cluster opens.
        XCTAssertEqual(Set(Diarization.assign(x, centroids: centroids, cannot: [(0, 1), (0, 2), (1, 2)])).count, 3)
    }

    func testThePinnedPLDAFilesAreReadWithTheirDirectionsByWeight() throws {
        let folder = container.appendingPathComponent("wespeaker")
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        func tensor(_ shape: [Int], _ values: [Float]) -> [String: Any] {
            var data = Data()
            for v in values { withUnsafeBytes(of: v.bitPattern.littleEndian) { data.append(contentsOf: $0) } }
            return ["shape": shape, "dtype": "float32", "layout": "row-major", "data_base64": data.base64EncodedString()]
        }
        let transform: [String: Any] = [
            "tensors": ["mean1": tensor([2], [1, 0]), "mean2": tensor([2], [0, 0]), "lda": tensor([2, 2], [1, 0, 0, 1])]
        ]
        // The second direction weighs more, so it comes first.
        let plda: [String: Any] = [
            "tensors": ["mu": tensor([2], [0, 0]), "tr": tensor([2, 2], [1, 0, 0, 2]), "psi": tensor([2], [0.5, 3])]
        ]
        try JSONSerialization.data(withJSONObject: transform).write(to: folder.appendingPathComponent("xvector-transform.json"))
        try JSONSerialization.data(withJSONObject: plda).write(to: folder.appendingPathComponent("plda-parameters.json"))
        let p = try PLDA.read(folder: folder)
        XCTAssertEqual(p.psi, [3, 0.5])
        XCTAssertEqual(p.tr, [[0, 2], [1, 0]])
        XCTAssertEqual(p.mean1, [1, 0])
        // x - mean1 = (0, 1), scaled to length √2, through the LDA, to length √2 again, then tr.
        let f = p.features([1, 1])
        XCTAssertEqual(f[0], 2 * 2.0.squareRoot(), accuracy: 1e-6)
        XCTAssertEqual(f[1], 0, accuracy: 1e-6)
        try Data("{}".utf8).write(to: folder.appendingPathComponent("plda-parameters.json"))
        XCTAssertThrowsError(try PLDA.read(folder: folder))
    }
}
