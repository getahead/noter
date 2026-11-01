// The offline pass and the embeddings as the engine answers them (core-engine-offline.md): every
// path is checked against the App Group container and every request before a file opens; an
// invalid one gets the correlated `error`, a valid one its `ack`, then the work runs below capture
// priority and its progress, result or failure is reported with the call or request id. The work
// itself (Large v3 decode, bge-m3 and WeSpeaker) is `OfflineWork`; without its model the engine
// refuses with `model_missing`.

import Foundation

/// `offline_pass`: the archive pass of a stopped call.
public struct OfflinePass: Equatable, Sendable {
    public var callId: String
    public var sessionDir: String
    public var resultPath: String
    public var constraintsPath: String?
    public var backend: String
}

/// A span of call time, in milliseconds.
public struct Span: Codable, Equatable, Sendable {
    public var t0Ms: Int
    public var t1Ms: Int

    enum CodingKeys: String, CodingKey {
        case t0Ms = "t0_ms", t1Ms = "t1_ms"
    }
}

/// `speaker_embedding`: one speaker's spans on one channel of a call.
public struct SpeakerEmbedding: Equatable, Sendable {
    public var requestId: String
    public var callId: String
    public var channel: Channel
    public var spans: [Span]
    public var outPath: String
}

/// Offline work failed with this protocol code (any other error is `internal`).
public struct OfflineFailure: Error, Equatable {
    public let code: EngineErrorCode

    public init(code: EngineErrorCode) { self.code = code }
}

/// The models an offline command needs.
public enum OfflineModel: Sendable {
    case archive, speaker, text
}

/// The models behind the offline commands. Each call finishes its files before it returns.
public protocol OfflineWork: Sendable {
    /// The models installed: a command whose model is missing is refused.
    var available: Set<OfflineModel> { get }
    /// Decodes the call into `result` and the word timings it references, reporting progress 0...1.
    func archive(
        _ pass: OfflinePass, session: URL, result: URL, constraints: OfflineConstraints, progress: (Float) -> Void
    ) throws
    /// Writes the speaker's 256 float32 values to `out`.
    func speaker(_ request: SpeakerEmbedding, session: URL, out: URL) throws
    /// One 1024-value row per text, in order: written to `out` as float32 rows (nil returned), or
    /// returned inline for one text without `out`.
    func texts(_ texts: [String], out: URL?) throws -> [Float]?
}

extension OfflineWork {
    public var available: Set<OfflineModel> { [.archive, .speaker, .text] }
}

/// Paths the core sends are relative to the App Group container and must stay inside it.
public enum ContainerPath {
    /// The file `relative` names in `container`, or nil for an absolute path, an empty, `.` or
    /// `..` segment, a NUL, or a symlink leading out of the container.
    public static func resolve(_ relative: String, in container: URL) -> URL? {
        let segments = relative.split(separator: "/", omittingEmptySubsequences: false)
        guard !relative.contains("\u{0}"), segments.allSatisfy({ !$0.isEmpty && $0 != "." && $0 != ".." }) else {
            return nil
        }
        let url = container.appendingPathComponent(relative)
        guard real(url).hasPrefix(real(container) + "/") else { return nil }
        return url
    }

    /// The path with every symlink resolved. Foundation resolves only paths that exist, so this
    /// resolves the deepest existing ancestor (a link counts, even a dangling one) and appends the rest.
    private static func real(_ url: URL) -> String {
        var existing = url
        var rest: [String] = []
        while (try? FileManager.default.attributesOfItem(atPath: existing.path)) == nil, existing.pathComponents.count > 1 {
            rest.insert(existing.lastPathComponent, at: 0)
            existing.deleteLastPathComponent()
        }
        return rest.reduce(existing.resolvingSymlinksInPath()) { $0.appendingPathComponent($1) }.path
    }
}

extension EngineLoop {
    private func refuse(_ id: UInt64, _ why: String, _ code: EngineErrorCode = .badCommand) {
        writer.emit(.error(cmdId: id, code: code, message: why))
    }

    private static func isDirectory(_ url: URL) -> Bool {
        var dir: ObjCBool = false
        return FileManager.default.fileExists(atPath: url.path, isDirectory: &dir) && dir.boolValue
    }

    private static func code(_ error: Error) -> EngineErrorCode {
        (error as? OfflineFailure)?.code ?? .internal
    }

    // @cpt-flow:cpt-noter-flow-core-engine-offline-archive:p1
    func offlinePass(_ id: UInt64, _ pass: OfflinePass) {
        // @cpt-begin:cpt-noter-flow-core-engine-offline-archive:p1:inst-archive-paths
        guard let container,
            let session = ContainerPath.resolve(pass.sessionDir, in: container), Self.isDirectory(session),
            SessionAudio.stored(in: session), let result = ContainerPath.resolve(pass.resultPath, in: container)
        else {
            return refuse(id, "offline_pass: an unsafe path or no stored audio")
        }
        var constraints = OfflineConstraints.none
        if let path = pass.constraintsPath {
            guard let url = ContainerPath.resolve(path, in: container), let read = OfflineConstraints.read(url) else {
                return refuse(id, "offline_pass: unsafe, missing or malformed constraints")
            }
            constraints = read
        }
        // @cpt-end:cpt-noter-flow-core-engine-offline-archive:p1:inst-archive-paths
        guard let work = offline, work.available.contains(.archive) else {
            return refuse(id, "offline_pass: no archive model", .modelMissing)
        }
        // @cpt-begin:cpt-noter-flow-core-engine-offline-archive:p1:inst-archive-start
        writer.emit(.ack(cmdId: id))
        let writer = self.writer
        // On the `.utility` queue: below capture and the live transcript.
        offlineQueue.async {
            // @cpt-end:cpt-noter-flow-core-engine-offline-archive:p1:inst-archive-start
            do {
                var reported: Float = -1
                // @cpt-begin:cpt-noter-flow-core-engine-offline-archive:p1:inst-archive-progress
                try work.archive(pass, session: session, result: result, constraints: constraints) { progress in
                    // Capture goes first: the pass waits at its next step while a call is captured.
                    while self.isCapturing { Thread.sleep(forTimeInterval: 0.2) }
                    let p = min(max(progress, 0), 1)
                    if p >= reported + 0.01 || (p == 1 && reported < 1) {
                        reported = p
                        writer.emit(.offlineProgress(callId: pass.callId, progress: p))
                    }
                }
                // @cpt-end:cpt-noter-flow-core-engine-offline-archive:p1:inst-archive-progress
                // @cpt-begin:cpt-noter-flow-core-engine-offline-archive:p1:inst-archive-complete
                // The pass wrote the words, then the result, each to a temporary name renamed in place.
                guard FileManager.default.fileExists(atPath: result.path) else { throw OfflineFailure(code: .internal) }
                writer.emit(.offlineDone(callId: pass.callId, resultPath: pass.resultPath))
                // @cpt-end:cpt-noter-flow-core-engine-offline-archive:p1:inst-archive-complete
            } catch {
                // @cpt-begin:cpt-noter-flow-core-engine-offline-archive:p1:inst-archive-fail
                // Never a partial file where the core could take it for a result.
                try? FileManager.default.removeItem(at: result)
                writer.emit(.offlineFailed(callId: pass.callId, code: Self.code(error)))
                // @cpt-end:cpt-noter-flow-core-engine-offline-archive:p1:inst-archive-fail
            }
        }
    }

    // @cpt-flow:cpt-noter-flow-core-engine-offline-embeddings:p1
    func speakerEmbedding(_ id: UInt64, _ request: SpeakerEmbedding) {
        // @cpt-begin:cpt-noter-flow-core-engine-offline-embeddings:p1:inst-embed-validate
        guard let container, !request.spans.isEmpty,
            request.spans.allSatisfy({ $0.t0Ms >= 0 && $0.t0Ms < $0.t1Ms }),
            let session = ContainerPath.resolve("audio/\(request.callId)", in: container), Self.isDirectory(session),
            let out = ContainerPath.resolve(request.outPath, in: container)
        else {
            return refuse(id, "speaker_embedding: invalid spans, an unknown call or an unsafe path")
        }
        // @cpt-end:cpt-noter-flow-core-engine-offline-embeddings:p1:inst-embed-validate
        guard let work = offline, work.available.contains(.speaker) else {
            return refuse(id, "speaker_embedding: no speaker model", .modelMissing)
        }
        writer.emit(.ack(cmdId: id))
        let writer = self.writer
        offlineQueue.async {
            do {
                // @cpt-begin:cpt-noter-flow-core-engine-offline-embeddings:p1:inst-embed-run
                try work.speaker(request, session: session, out: out)
                // @cpt-end:cpt-noter-flow-core-engine-offline-embeddings:p1:inst-embed-run
                // @cpt-begin:cpt-noter-flow-core-engine-offline-embeddings:p1:inst-embed-event
                writer.emit(.speakerEmbeddingDone(requestId: request.requestId, outPath: request.outPath))
                // @cpt-end:cpt-noter-flow-core-engine-offline-embeddings:p1:inst-embed-event
            } catch {
                try? FileManager.default.removeItem(at: out)
                writer.emit(.error(cmdId: id, code: Self.code(error), message: "speaker_embedding: \(error)"))
            }
        }
    }

    func embedTexts(_ id: UInt64, _ requestId: String, _ texts: [String], _ outPath: String?) {
        // @cpt-begin:cpt-noter-flow-core-engine-offline-embeddings:p1:inst-embed-validate
        var out: URL?
        if let outPath {
            guard let container, let url = ContainerPath.resolve(outPath, in: container) else {
                return refuse(id, "embed_texts: an unsafe path")
            }
            out = url
        } else if texts.count != 1 {
            return refuse(id, "embed_texts: a batch needs out_path")
        }
        // @cpt-end:cpt-noter-flow-core-engine-offline-embeddings:p1:inst-embed-validate
        guard let work = offline, work.available.contains(.text) else {
            return refuse(id, "embed_texts: no text model", .modelMissing)
        }
        writer.emit(.ack(cmdId: id))
        let writer = self.writer
        offlineQueue.async {
            do {
                // @cpt-begin:cpt-noter-flow-core-engine-offline-embeddings:p1:inst-embed-run
                let inline = try work.texts(texts, out: out)
                // @cpt-end:cpt-noter-flow-core-engine-offline-embeddings:p1:inst-embed-run
                // @cpt-begin:cpt-noter-flow-core-engine-offline-embeddings:p1:inst-embed-event
                if let outPath {
                    writer.emit(.embeddings(requestId: requestId, inline: nil, outPath: outPath, count: UInt32(texts.count)))
                } else if let inline {
                    writer.emit(.embeddings(requestId: requestId, inline: inline, outPath: nil, count: 1))
                } else {
                    throw OfflineFailure(code: .internal)
                }
                // @cpt-end:cpt-noter-flow-core-engine-offline-embeddings:p1:inst-embed-event
            } catch {
                if let out { try? FileManager.default.removeItem(at: out) }
                writer.emit(.error(cmdId: id, code: Self.code(error), message: "embed_texts: \(error)"))
            }
        }
    }
}
