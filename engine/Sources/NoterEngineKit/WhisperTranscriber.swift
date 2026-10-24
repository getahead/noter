// The live speech model: WhisperKit Turbo from the App Group `models/whisper-turbo` folder, which
// the core downloads (pinned by `scripts/models/manifest.json`, the tokenizer included: the
// sandboxed engine has no network, so nothing may be fetched at load).
// shortcut: not exercised by the CI tests (no model on the runner); the M1 week-one runbook's
// part C runs it on a real call.

import Foundation
import WhisperKit

public final class WhisperTranscriber: Transcriber, @unchecked Sendable {
    private let whisper: WhisperKit

    /// Loads the model from `folder` (blocks while CoreML compiles and loads it).
    public init(folder: URL) throws {
        let config = WhisperKitConfig(
            modelFolder: folder.path, tokenizerFolder: folder, verbose: false, logLevel: .none, prewarm: true, load: true,
            download: false)
        whisper = try Self.blocking { try await WhisperKit(config) }
    }

    // @cpt-begin:cpt-noter-algo-core-engine-capture-live-asr:p1:inst-lang-id
    public func decode(_ samples: [Float], languages: [String]) throws -> Decoded {
        try Self.blocking { [whisper] in
            // Language ID per utterance, among the session's languages.
            let (_, probabilities) = try await whisper.detectLangauge(audioArray: samples)
            let allowed = languages.isEmpty ? probabilities : probabilities.filter { languages.contains($0.key) }
            let (lang, langP) = (allowed.max { $0.value < $1.value } ?? probabilities.max { $0.value < $1.value })
                .map { ($0.key, $0.value) } ?? ("en", 0)
            let options = DecodingOptions(
                language: lang, temperatureFallbackCount: 2, usePrefillPrompt: true, detectLanguage: false,
                skipSpecialTokens: true, withoutTimestamps: true, suppressBlank: true)
            let segments = try await whisper.transcribe(audioArray: samples, decodeOptions: options).flatMap(\.segments)
            let text = segments.map(\.text).joined(separator: " ")
            let avgLogprob = segments.isEmpty ? -10 : segments.map(\.avgLogprob).reduce(0, +) / Float(segments.count)
            return Decoded(
                text: text, lang: lang, langP: langP, avgLogprob: avgLogprob, noSpeechP: segments.map(\.noSpeechProb).max() ?? 1)
        }
    }
    // @cpt-end:cpt-noter-algo-core-engine-capture-live-asr:p1:inst-lang-id

    /// Runs async WhisperKit work on the caller's thread (the decode queue).
    /// WhisperKit is not `Sendable`; the decode queue is its only user, one call at a time.
    private static func blocking<T>(_ work: @escaping () async throws -> T) throws -> T {
        let done = DispatchSemaphore(value: 0)
        let (job, result) = (Locked(work), Locked<Result<T, Error>?>(nil))
        Task {
            do { result.set(.success(try await job.get()())) } catch { result.set(.failure(error)) }
            done.signal()
        }
        done.wait()
        return try result.get()!.get()
    }
}

private final class Locked<T>: @unchecked Sendable {
    private let lock = NSLock()
    private var value: T
    init(_ value: T) { self.value = value }
    func set(_ new: T) { lock.withLock { value = new } }
    func get() -> T { lock.withLock { value } }
}
