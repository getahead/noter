// Local vectors (`cpt-noter-algo-core-engine-offline-vectors`) and the offline work on the
// installed models: WeSpeaker hears only the requested channel and spans, bge-m3 embeds each text
// in order, and every vector is checked for its size and finite values before it is written or
// returned. Nothing here touches the network or the database.

import Foundation

/// WeSpeaker: one voice's 16 kHz speech to its 256 values.
public protocol SpeakerModel: AnyObject, Sendable {
    func embed(_ samples: [Float]) throws -> [Float]
    /// One speaker of a 10 s window (`Diarization.window`): the frames of `speaking` they talk in.
    func embed(window: [Float], speaking: [Bool]) throws -> [Float]
}

extension SpeakerModel {
    /// A model without frame weights hears the speaker's frames only.
    public func embed(window: [Float], speaking: [Bool]) throws -> [Float] {
        let (n, size) = (max(speaking.count, 1), Diarization.window)
        return try embed(
            speaking.indices.filter { speaking[$0] }.flatMap { f in
                window[min(window.count, f * size / n)..<min(window.count, (f + 1) * size / n)]
            })
    }
}

/// bge-m3: one text to its 1024 values.
public protocol TextModel: AnyObject, Sendable {
    func embed(_ text: String) throws -> [Float]
}

enum Vectors {
    static let speakerDims = 256
    static let textDims = 1024

    /// `v` when it has `dims` finite values; a model that answers anything else failed.
    static func checked(_ v: [Float], _ dims: Int) throws -> [Float] {
        // @cpt-begin:cpt-noter-algo-core-engine-offline-vectors:p1:inst-vector-check
        guard v.count == dims, v.allSatisfy(\.isFinite) else { throw OfflineFailure(code: .internal) }
        return v
        // @cpt-end:cpt-noter-algo-core-engine-offline-vectors:p1:inst-vector-check
    }

    /// The rows as float32 little-endian, one after the other; the file appears whole or not at all.
    static func write(_ rows: [[Float]], to url: URL) throws {
        // @cpt-begin:cpt-noter-algo-core-engine-offline-vectors:p1:inst-vector-file
        var data = Data(capacity: rows.reduce(0) { $0 + $1.count } * 4)
        for v in rows.joined() { withUnsafeBytes(of: v.bitPattern.littleEndian) { data.append(contentsOf: $0) } }
        try data.write(to: url, options: .atomic)
        // @cpt-end:cpt-noter-algo-core-engine-offline-vectors:p1:inst-vector-file
    }
}

/// A model loaded on first use and kept; one that fails to load is `model_load_failed`.
private final class Loaded<T>: @unchecked Sendable {
    private let make: () throws -> T
    private let lock = NSLock()
    private var model: T?

    init(_ make: @escaping () throws -> T) { self.make = make }

    func get() throws -> T {
        try lock.withLock {
            if let model { return model }
            let m = try Self.load(make)
            model = m
            return m
        }
    }

    static func load(_ make: () throws -> T) throws -> T {
        do {
            return try make()
        } catch let failure as OfflineFailure {
            throw failure
        } catch {
            throw OfflineFailure(code: .modelLoadFailed)
        }
    }
}

// @cpt-dod:cpt-noter-dod-core-engine-offline-embeddings:p1
/// The offline commands on the installed models. Large v3 loads for each pass, so it never stays
/// beside the live model through a call; the embedding models stay once loaded.
public final class LocalOfflineWork: OfflineWork, @unchecked Sendable {
    private let decoder: (() throws -> ArchiveDecoder)?
    private let speakerModel: Loaded<SpeakerModel>?
    private let textModel: Loaded<TextModel>?
    private let clustering: (() throws -> Clustering)?

    public init(
        decoder: (() throws -> ArchiveDecoder)? = nil, speaker: (() throws -> SpeakerModel)? = nil,
        text: (() throws -> TextModel)? = nil, clustering: (() throws -> Clustering)? = nil
    ) {
        self.decoder = decoder
        speakerModel = speaker.map(Loaded.init)
        textModel = text.map(Loaded.init)
        self.clustering = clustering
    }

    public var available: Set<OfflineModel> {
        Set([decoder.map { _ in .archive }, speakerModel.map { _ in .speaker }, textModel.map { _ in .text }].compactMap { $0 })
    }

    // @cpt-dod:cpt-noter-dod-core-engine-offline-archive:p1
    public func archive(
        _ pass: OfflinePass, session: URL, result: URL, constraints: OfflineConstraints, progress: (Float) -> Void
    ) throws {
        guard let decoder else { throw OfflineFailure(code: .modelMissing) }
        // Clustering loads for each pass like Large v3; it needs WeSpeaker beside its own models.
        let diarizer = try clustering.flatMap { make in try speakerModel.map { (try Loaded.load(make), try $0.get()) } }
        try Archive.run(
            pass, session: session, result: result, constraints: constraints, decoder: Loaded.load(decoder),
            diarizer: diarizer, progress: progress)
    }

    // @cpt-algo:cpt-noter-algo-core-engine-offline-vectors:p1
    public func speaker(_ request: SpeakerEmbedding, session: URL, out: URL) throws {
        guard let speakerModel else { throw OfflineFailure(code: .modelMissing) }
        // @cpt-begin:cpt-noter-algo-core-engine-offline-vectors:p1:inst-vector-speaker
        guard let audio = SessionAudio.url(request.channel, in: session) else { throw OfflineFailure(code: .badCommand) }
        let time = CallTime(session: session)
        let samples = try request.spans.flatMap { try SessionAudio.read(audio, fromMs: time.file($0.t0Ms), toMs: time.file($0.t1Ms)) }
        guard !samples.isEmpty else { throw OfflineFailure(code: .badCommand) }
        let vector = try Vectors.checked(speakerModel.get().embed(samples), Vectors.speakerDims)
        // @cpt-end:cpt-noter-algo-core-engine-offline-vectors:p1:inst-vector-speaker
        // @cpt-begin:cpt-noter-algo-core-engine-offline-vectors:p1:inst-vector-return
        try Vectors.write([vector], to: out)
        // @cpt-end:cpt-noter-algo-core-engine-offline-vectors:p1:inst-vector-return
    }

    public func texts(_ texts: [String], out: URL?) throws -> [Float]? {
        // @cpt-begin:cpt-noter-algo-core-engine-offline-vectors:p1:inst-vector-text
        // An empty batch is zero rows, with or without the model.
        var rows: [[Float]] = []
        if !texts.isEmpty {
            guard let textModel else { throw OfflineFailure(code: .modelMissing) }
            let model = try textModel.get()
            rows = try texts.map { try Vectors.checked(model.embed($0), Vectors.textDims) }
        }
        // @cpt-end:cpt-noter-algo-core-engine-offline-vectors:p1:inst-vector-text
        // @cpt-begin:cpt-noter-algo-core-engine-offline-vectors:p1:inst-vector-return
        guard let out else { return rows.first }
        try Vectors.write(rows, to: out)
        return nil
        // @cpt-end:cpt-noter-algo-core-engine-offline-vectors:p1:inst-vector-return
    }
}
