// The offline models on disk, all pinned by `scripts/models/manifest.json` and loaded without the
// network: Large v3 through the same WhisperKit path as the live model (`models/whisper-large-v3`),
// WeSpeaker, the segmentation and VBx's PLDA as pyannote community-1's CoreML conversions and
// tensors (`models/wespeaker`)
// and bge-m3 as a CoreML conversion with its tokenizer (`models/bge-m3`).
// shortcut: not exercised by the CI tests (no models on the runner); the owner's golden-set run
// on the Mac drives them (TL-17).

import CoreML
import Foundation
import WhisperKit

extension LocalOfflineWork {
    /// The offline work on the models the core has installed in `models` (a folder still
    /// downloading is `<name>.partial`, so it is not one of them).
    public static func installed(models: URL) -> LocalOfflineWork {
        func folder(_ name: String) -> URL? {
            let url = models.appendingPathComponent(name)
            return FileManager.default.fileExists(atPath: url.path) ? url : nil
        }
        // A wespeaker folder installed before the segmentation was pinned has none: no clustering.
        let clustering = folder("wespeaker").flatMap { f in
            FileManager.default.fileExists(atPath: f.appendingPathComponent("Segmentation.mlmodelc").path) ? f : nil
        }
        return LocalOfflineWork(
            decoder: folder("whisper-large-v3").map { f in { try WhisperArchiveDecoder(folder: f) } },
            speaker: folder("wespeaker").map { f in { try CoreMLSpeakerModel(folder: f) } },
            text: folder("bge-m3").map { f in { try CoreMLTextModel(folder: f) } },
            clustering: clustering.map { f in
                { Clustering(segmentation: try CoreMLSegmentationModel(folder: f), plda: try PLDA.read(folder: f)) }
            })
    }
}

/// pyannote community-1 segmentation: a 10 s window to 589 frames of its seven powerset classes
/// (log probabilities); the likeliest class names who talks.
final class CoreMLSegmentationModel: SegmentationModel, @unchecked Sendable {
    /// The classes as pyannote orders them: nobody, each of three speakers, each pair.
    private static let classes: [Set<Int>] = [[], [0], [1], [2], [0, 1], [0, 2], [1, 2]]
    private let model: MLModel

    init(folder: URL) throws {
        model = try MLModel(contentsOf: folder.appendingPathComponent("Segmentation.mlmodelc"))
    }

    func speakers(_ window: [Float]) throws -> [Set<Int>] {
        let audio = try array([1, 1, Diarization.window], window[...])
        let p = try floats(model.prediction(from: MLDictionaryFeatureProvider(dictionary: ["audio": audio])), "log_probs")
        let n = Self.classes.count
        guard !p.isEmpty, p.count % n == 0 else { throw OfflineFailure(code: .internal) }
        return stride(from: 0, to: p.count, by: n).map { f in Self.classes[(f..<f + n).max { p[$0] < p[$1] }! - f] }
    }
}

/// Large v3 on WhisperKit, word timings on.
final class WhisperArchiveDecoder: ArchiveDecoder, @unchecked Sendable {
    private let whisper: WhisperKit

    init(folder: URL) throws {
        let config = WhisperKitConfig(
            modelFolder: folder.path, tokenizerFolder: folder, verbose: false, logLevel: .none, prewarm: true, load: true,
            download: false)
        whisper = try WhisperTranscriber.blocking { try await WhisperKit(config) }
    }

    func languages(_ samples: [Float]) throws -> [String: Float] {
        // WhisperKit answers log probabilities.
        try WhisperTranscriber.blocking { [whisper] in
            try await whisper.detectLangauge(audioArray: samples).langProbs.mapValues { exp($0) }
        }
    }

    func decode(_ samples: [Float], language: String) throws -> Transcript {
        try WhisperTranscriber.blocking { [whisper] in
            // shortcut: WhisperKit has no beam search; a failed greedy decode falls back through
            // temperatures 0.2...1.0 sampling the top 5 tokens. Beam 5 when WhisperKit offers it.
            let options = DecodingOptions(
                language: language, temperature: 0, temperatureIncrementOnFallback: 0.2, temperatureFallbackCount: 5, topK: 5,
                usePrefillPrompt: true, detectLanguage: false, skipSpecialTokens: true, wordTimestamps: true,
                suppressBlank: true)
            let segments = try await whisper.transcribe(audioArray: samples, decodeOptions: options).flatMap(\.segments)
            let timings: [WordTiming] = segments.flatMap { $0.words ?? [] }
            let words = timings.map { (w: WordTiming) -> Word in
                let text = w.word.trimmingCharacters(in: .whitespaces)
                return Word(t0Ms: Int(w.start * 1000), t1Ms: Int(w.end * 1000), text: text, p: w.probability)
            }
            let scores: [Float] = segments.map(\.avgLogprob)
            let avgLogprob: Float = scores.isEmpty ? -10 : scores.reduce(0, +) / Float(scores.count)
            let noSpeechP: Float = segments.map(\.noSpeechProb).max() ?? 1
            return Transcript(
                text: segments.map(\.text).joined(separator: " "), words: words, avgLogprob: avgLogprob, noSpeechP: noSpeechP)
        }
    }
}

/// Reads a CoreML output as floats.
private func floats(_ output: MLFeatureProvider, _ name: String) throws -> [Float] {
    guard let array = output.featureValue(for: name)?.multiArrayValue else { throw OfflineFailure(code: .internal) }
    return (0..<array.count).map { array[$0].floatValue }
}

/// A float32 array of `shape` holding `values`, zero after them.
private func array(_ shape: [Int], _ values: ArraySlice<Float>) throws -> MLMultiArray {
    let a = try MLMultiArray(shape: shape.map(NSNumber.init), dataType: .float32)
    let p = a.dataPointer.bindMemory(to: Float.self, capacity: a.count)
    p.initialize(repeating: 0, count: a.count)
    values.withUnsafeBufferPointer { p.update(from: $0.baseAddress!, count: min($0.count, a.count)) }
    return a
}

/// WeSpeaker ResNet34 (256 values) as pyannote community-1 runs it: 10 s windows through FBank,
/// then Embedding with the frames the speech fills weighted 1; the windows' mean by length.
final class CoreMLSpeakerModel: SpeakerModel, @unchecked Sendable {
    private static let window = 160_000
    private static let frames = 589
    private let fbank: MLModel
    private let embedding: MLModel

    init(folder: URL) throws {
        fbank = try MLModel(contentsOf: folder.appendingPathComponent("FBank.mlmodelc"))
        embedding = try MLModel(contentsOf: folder.appendingPathComponent("Embedding.mlmodelc"))
    }

    func embed(_ samples: [Float]) throws -> [Float] {
        var (sum, total) = ([Float](repeating: 0, count: Vectors.speakerDims), 0)
        for start in stride(from: 0, to: samples.count, by: Self.window) {
            let chunk = samples[start..<min(start + Self.window, samples.count)]
            let used = Int((Double(chunk.count) * Double(Self.frames) / Double(Self.window)).rounded(.up))
            let v = try vector(chunk, weights: ArraySlice(repeating: 1, count: used))
            sum = zip(sum, v).map { $0 + $1 * Float(chunk.count) }
            total += chunk.count
        }
        return sum.map { $0 / Float(max(total, 1)) }
    }

    /// pyannote's way: the whole window through FBank, the speaker's frames weighted 1.
    func embed(window: [Float], speaking: [Bool]) throws -> [Float] {
        let weights = (0..<Self.frames).map { f in !speaking.isEmpty && speaking[f * speaking.count / Self.frames] ? Float(1) : 0 }
        return try vector(window[...], weights: weights[...])
    }

    private func vector(_ audio: ArraySlice<Float>, weights: ArraySlice<Float>) throws -> [Float] {
        guard let features = try fbank.prediction(
            from: MLDictionaryFeatureProvider(dictionary: ["audio": array([1, 1, Self.window], audio)])
        ).featureValue(for: "fbank_features")?.multiArrayValue
        else { throw OfflineFailure(code: .internal) }
        let v = try floats(
            embedding.prediction(
                from: MLDictionaryFeatureProvider(dictionary: ["fbank_features": features, "weights": array([1, Self.frames], weights)])),
            "embedding")
        guard v.count == Vectors.speakerDims else { throw OfflineFailure(code: .internal) }
        return v
    }
}

/// bge-m3 (1024 values) as its CoreML conversion pools it (mean of the tokens, L2-normalised),
/// on token ids from bge-m3's own tokenizer.
/// shortcut: the package is compiled at the first text of each engine run (CoreML loads only
/// compiled models); keep the compiled model in the container if that wait shows.
final class CoreMLTextModel: TextModel, @unchecked Sendable {
    private let model: MLModel
    private let tokenizer: TokenizerWrapper
    private let ids: MLMultiArrayConstraint
    private let mask: MLMultiArrayConstraint

    init(folder: URL) throws {
        model = try MLModel(contentsOf: MLModel.compileModel(at: folder.appendingPathComponent("bge-m3.mlpackage")))
        tokenizer = try WhisperTranscriber.blocking { try await AutoTokenizerWrapper.from(modelFolder: folder) }
        let inputs = model.modelDescription.inputDescriptionsByName
        guard let ids = inputs["input_ids"]?.multiArrayConstraint, let mask = inputs["attention_mask"]?.multiArrayConstraint
        else { throw OfflineFailure(code: .modelLoadFailed) }
        (self.ids, self.mask) = (ids, mask)
    }

    /// The sequence length the conversion takes for `n` tokens: its fixed size, the smallest
    /// enumerated one that fits (else the largest), or `n` within its range.
    private func length(_ n: Int) -> Int {
        let shape = ids.shapeConstraint
        switch shape.type {
        case .enumerated:
            let sizes = shape.enumeratedShapes.compactMap { $0.last?.intValue }.sorted()
            return sizes.first { $0 >= n } ?? sizes.last ?? n
        case .range:
            let range = shape.sizeRangeForDimension.last?.rangeValue ?? NSRange(location: n, length: 0)
            return min(max(n, range.location), range.location + range.length)
        default:
            return ids.shape.last?.intValue ?? n
        }
    }

    func embed(_ text: String) throws -> [Float] {
        var tokens = tokenizer.encode(text: text)
        let size = length(tokens.count)
        // A text longer than the model takes keeps its start and its closing token.
        if tokens.count > size, let end = tokens.last { tokens = Array(tokens.prefix(size - 1)) + [end] }
        let pad = tokenizer.convertTokenToId("<pad>") ?? 1
        let input = try MLMultiArray(shape: [1, NSNumber(value: size)], dataType: ids.dataType)
        let attention = try MLMultiArray(shape: [1, NSNumber(value: size)], dataType: mask.dataType)
        for i in 0..<size {
            input[i] = NSNumber(value: i < tokens.count ? tokens[i] : pad)
            attention[i] = NSNumber(value: i < tokens.count ? 1 : 0)
        }
        return try floats(
            model.prediction(from: MLDictionaryFeatureProvider(dictionary: ["input_ids": input, "attention_mask": attention])),
            "embedding")
    }
}
