// Speaker clustering of the archive pass (`inst-decode-cluster`, D-32 option 2), as pyannote
// community-1 runs it: its segmentation finds the speakers of each 10 s window of the system
// channel, WeSpeaker embeds each of them over the whole window with the frames they speak alone
// weighted 1, and VBx (an agglomerative start at 0.6, PLDA features, Fa 0.07, Fb 0.8; Landini et
// al. 2022) learns the voices from the speakers with 2 s of such speech. Every speaker then joins
// its likeliest voice that no cannot-link forbids (two speakers of one window are two people too);
// must-links and shared names join voices afterwards in `Archive.voices`, as they join live labels.
// shortcut: windows do not overlap (pyannote steps 1 s and averages); the upgrade if the golden
// set (TL-17) shows errors at window edges.

import Foundation

/// pyannote segmentation: one window of 16 kHz audio (at most `Diarization.window` samples) to
/// the window's local speakers talking in each frame; the frames span the whole window.
public protocol SegmentationModel: AnyObject, Sendable {
    func speakers(_ window: [Float]) throws -> [Set<Int>]
}

/// The clustering's own models; WeSpeaker is the offline work's speaker model.
public struct Clustering: Sendable {
    let segmentation: SegmentationModel
    let plda: PLDA

    public init(segmentation: SegmentationModel, plda: PLDA) {
        self.segmentation = segmentation
        self.plda = plda
    }
}

/// VBx's PLDA (BUT Speech@FIT's, as community-1 ships it): the x-vector transform (`mean1`,
/// `lda`, `mean2`), then the PLDA (`mu`, `tr`, `psi`) with its directions by weight.
public struct PLDA: Sendable, Equatable {
    var mean1: [Double]
    var lda: [[Double]]
    var mean2: [Double]
    var mu: [Double]
    var tr: [[Double]]
    var psi: [Double]

    init(mean1: [Double], lda: [[Double]], mean2: [Double], mu: [Double], tr: [[Double]], psi: [Double]) {
        // pyannote solves eigh(B, W) for W = (trᵀtr)⁻¹, B = (trᵀ diag(1/psi) tr)⁻¹: the
        // eigenvalues are psi and the eigenvectors tr's rows, so it only orders them, heaviest first.
        let order = psi.indices.sorted { psi[$0] > psi[$1] }
        (self.mean1, self.lda, self.mean2, self.mu) = (mean1, lda, mean2, mu)
        (self.tr, self.psi) = (order.map { tr[$0] }, order.map { psi[$0] })
    }

    /// A WeSpeaker vector as VBx sees it (pyannote's `xvec_tf` then `plda_tf`).
    func features(_ x: [Double]) -> [Double] {
        let y = Diarization.scaled(zip(x, mean1).map(-), to: Double(mean1.count).squareRoot())
        let z = mean2.indices.map { j in zip(y, lda).reduce(0) { $0 + $1.0 * $1.1[j] } }
        let w = zip(Diarization.scaled(zip(z, mean2).map(-), to: Double(mean2.count).squareRoot()), mu).map(-)
        return tr.map { Diarization.dot($0, w) }
    }

    /// `xvector-transform.json` and `plda-parameters.json` in `folder`; files that are not those
    /// tensors in matching shapes are `model_load_failed`.
    static func read(folder: URL) throws -> PLDA {
        func tensors(_ name: String) throws -> [String: TensorFile.Tensor] {
            try JSONDecoder().decode(TensorFile.self, from: Data(contentsOf: folder.appendingPathComponent(name))).tensors
        }
        let (x, p) = (try tensors("xvector-transform.json"), try tensors("plda-parameters.json"))
        guard let mean1 = x["mean1"]?.vector, let lda = x["lda"]?.matrix, let mean2 = x["mean2"]?.vector,
            let mu = p["mu"]?.vector, let tr = p["tr"]?.matrix, let psi = p["psi"]?.vector,
            lda.count == mean1.count, let d = lda.first?.count, d > 0,
            [mean2.count, mu.count, tr.count, psi.count].allSatisfy({ $0 == d }), tr.allSatisfy({ $0.count == d }),
            psi.allSatisfy({ $0 > 0 })
        else { throw OfflineFailure(code: .modelLoadFailed) }
        return PLDA(mean1: mean1, lda: lda, mean2: mean2, mu: mu, tr: tr, psi: psi)
    }
}

/// Fluid Inference's tensor files: each tensor's shape and its float32 little-endian values.
private struct TensorFile: Decodable {
    struct Tensor: Decodable {
        let shape: [Int]
        let dataBase64: String

        enum CodingKeys: String, CodingKey {
            case shape
            case dataBase64 = "data_base64"
        }

        /// The values, nil when they do not fill the shape.
        var values: [Double]? {
            guard let data = Data(base64Encoded: dataBase64), shape.allSatisfy({ $0 > 0 }),
                data.count == shape.reduce(4, *)
            else { return nil }
            return data.withUnsafeBytes { raw in
                (0..<data.count / 4).map {
                    Double(Float(bitPattern: UInt32(littleEndian: raw.loadUnaligned(fromByteOffset: $0 * 4, as: UInt32.self))))
                }
            }
        }

        var vector: [Double]? { shape.count == 1 ? values : nil }

        var matrix: [[Double]]? {
            guard shape.count == 2, let v = values else { return nil }
            return stride(from: 0, to: v.count, by: shape[1]).map { Array(v[$0..<$0 + shape[1]]) }
        }
    }

    let tensors: [String: Tensor]
}

enum Diarization {
    /// pyannote's window: 10 s at 16 kHz.
    static let window = 160_000
    /// A speaker with less speech alone in a window has no vector; their words take the voice
    /// nearest them.
    static let shortestSpeechMs = 500
    /// VBx learns the voices from speakers with this much speech alone in a window (pyannote's 20 %).
    static let trainingSpeechMs = 2_000
    static let threshold = 0.6
    static let fa = 0.07
    static let fb = 0.8

    /// One local speaker of one window: the frames they talk in alone (their vector's), how
    /// much that is, and where they talk at all, in samples of the channel.
    struct Turn: Equatable {
        let window: Int
        let local: Int
        let alone: [Bool]
        let speech: Int
        let runs: [Range<Int>]
    }

    // @cpt-begin:cpt-noter-algo-core-engine-offline-decode:p1:inst-decode-cluster
    /// The system channel's segments labelled by voice, `spk_1`, `spk_2`… in order of first words;
    /// with no speech turn they keep the live label.
    static func label(
        _ segments: inout [Segment], samples: [Float], time: CallTime, constraints c: OfflineConstraints,
        _ models: (clustering: Clustering, speaker: SpeakerModel)
    ) throws {
        let turns = try turns(samples, models.clustering.segmentation)
        guard !turns.isEmpty else { return }
        let rate = Archive.rate
        let runs = turns.map {
            $0.runs.map { (t0: time.call($0.lowerBound * 1000 / rate), t1: time.call($0.upperBound * 1000 / rate, end: true)) }
        }
        let vectors = try turns.map { t in
            let from = t.window * window
            let heard = try models.speaker.embed(window: Array(samples[from..<min(from + window, samples.count)]), speaking: t.alone)
            return try Vectors.checked(heard, Vectors.speakerDims).map(Double.init)
        }
        func overlap(_ k: Int, _ t0: Int, _ t1: Int) -> Int { runs[k].reduce(0) { $0 + max(0, min(t1, $1.t1) - max(t0, $1.t0)) } }
        func inside(_ s: Span) -> [Int] { turns.indices.filter { overlap($0, s.t0Ms, s.t1Ms) > 0 } }
        let cannot =
            c.cannotLink.flatMap { l in inside(l.a).flatMap { a in inside(l.b).map { (a, $0) } } }
            + turns.indices.flatMap { i in
                turns.indices.filter { turns[$0].window == turns[i].window && turns[$0].local > turns[i].local }.map { (i, $0) }
            }
        let voices = cluster(
            vectors, training: turns.map { $0.speech * 1000 >= trainingSpeechMs * rate }, plda: models.clustering.plda,
            cannot: cannot)
        var names: [Int: String] = [:]
        for i in segments.indices where segments[i].channel == .sys {
            let s = segments[i]
            var heard: [Int: Int] = [:]
            for k in turns.indices { heard[voices[k], default: 0] += overlap(k, s.t0Ms, s.t1Ms) }
            let gap = { (k: Int) in runs[k].map { max($0.t0 - s.t1Ms, s.t0Ms - $0.t1) }.min() ?? .max }
            let nearest = turns.indices.min { gap($0) < gap($1) }!
            let voice = heard.filter { $0.value > 0 }.max { ($0.value, -$0.key) < ($1.value, -$1.key) }?.key ?? voices[nearest]
            let name = names[voice] ?? "spk_\(names.count + 1)"
            names[voice] = name
            segments[i].speakerLabel = name
        }
    }

    /// The speakers of each window with enough speech alone, as the segmentation hears them.
    static func turns(_ samples: [Float], _ model: SegmentationModel) throws -> [Turn] {
        var out: [Turn] = []
        for (w, start) in stride(from: 0, to: samples.count, by: window).enumerated() {
            let end = min(start + window, samples.count)
            let frames = try model.speakers(Array(samples[start..<end]))
            let at = { (f: Int) in min(end, start + f * window / max(frames.count, 1)) }
            for local in Set(frames.joined()).sorted() {
                let alone = frames.map { $0 == [local] }
                let speech = alone.indices.reduce(0) { $0 + (alone[$1] ? at($1 + 1) - at($1) : 0) }
                guard speech * 1000 >= shortestSpeechMs * Archive.rate else { continue }
                var runs: [Range<Int>] = []
                for f in frames.indices where frames[f].contains(local) && at(f) < at(f + 1) {
                    if let last = runs.last, last.upperBound == at(f) {
                        runs[runs.count - 1] = last.lowerBound..<at(f + 1)
                    } else {
                        runs.append(at(f)..<at(f + 1))
                    }
                }
                out.append(Turn(window: w, local: local, alone: alone, speech: speech, runs: runs))
            }
        }
        return out
    }

    /// VBx learns the voices from the `training` vectors (all of them when none is) from the
    /// agglomerative start; each vector then joins the voice whose centroid is closest that no
    /// cannot-link forbids.
    static func cluster(_ vectors: [[Double]], training: [Bool], plda: PLDA, cannot: [(Int, Int)]) -> [Int] {
        let trained = vectors.indices.filter { training[$0] }
        let x = (trained.isEmpty ? Array(vectors.indices) : trained).map { vectors[$0] }
        let (gamma, pi) = vbx(x.map(plda.features), phi: plda.psi, start: ahc(x, threshold: threshold))
        // The voices VBx kept, at their members' mean weighted by responsibility.
        let centroids = pi.indices.filter { pi[$0] > 1e-7 }.map { k in
            let total = gamma.reduce(0) { $0 + $1[k] }
            return x[0].indices.map { j in zip(gamma, x).reduce(0) { $0 + $1.0[k] * $1.1[j] } / total }
        }
        return assign(vectors, centroids: centroids, cannot: cannot)
    }
    // @cpt-end:cpt-noter-algo-core-engine-offline-decode:p1:inst-decode-cluster

    /// Centroid-linkage clustering of the normalised vectors (Lance-Williams on squared
    /// distances), joining while the closest two are within `threshold`: the clusters in order of
    /// first member.
    /// shortcut: O(n³) in turns, under a second for the ~1,000 turns of an hour; a nearest-
    /// neighbour cache when calls get much longer.
    static func ahc(_ x: [[Double]], threshold: Double) -> [Int] {
        let x = x.map { scaled($0, to: 1) }
        let n = x.count
        var d: [[Double]] = x.map { a in
            x.map { b in zip(a, b).reduce(0.0) { (sum: Double, p: (Double, Double)) -> Double in sum + (p.0 - p.1) * (p.0 - p.1) } }
        }
        var (size, parent, alive) = (Array(repeating: 1.0, count: n), Array(0..<n), Array(repeating: true, count: n))
        while true {
            var (bi, bj, best) = (0, 0, Double.infinity)
            for i in 0..<n where alive[i] {
                for j in (i + 1)..<n where alive[j] && d[i][j] < best { (bi, bj, best) = (i, j, d[i][j]) }
            }
            guard best.squareRoot() <= threshold else { break }
            let (ni, nj): (Double, Double) = (size[bi], size[bj])
            let m: Double = ni + nj
            let pull: Double = ni * nj * best / (m * m)
            for k in 0..<n where alive[k] && k != bi && k != bj {
                let mean: Double = (ni * d[bi][k] + nj * d[bj][k]) / m
                d[bi][k] = mean - pull
                d[k][bi] = d[bi][k]
            }
            (size[bi], alive[bj], parent[bj]) = (ni + nj, false, bi)
        }
        func root(_ i: Int) -> Int { parent[i] == i ? i : root(parent[i]) }
        var ids: [Int: Int] = [:]
        return (0..<n).map { i in
            let r = root(i)
            if ids[r] == nil { ids[r] = ids.count }
            return ids[r]!
        }
    }

    /// Bayesian HMM clustering of x-vectors without transitions (VBx as pyannote runs it):
    /// responsibilities of each voice for each vector, and the voices' shares, from `start`
    /// smoothed as pyannote does (softmax of 7 × one-hot).
    static func vbx(
        _ x: [[Double]], phi: [Double], start: [Int], fa: Double = fa, fb: Double = fb, iterations: Int = 20
    ) -> (gamma: [[Double]], pi: [Double]) {
        let (s, d) = ((start.max() ?? -1) + 1, phi.count)
        guard !x.isEmpty, s > 0 else { return ([], []) }
        // Typed sub-expressions throughout: CI's Swift cannot type-check the chained arithmetic in time.
        let warm: Double = exp(7) + Double(s - 1)
        var gamma: [[Double]] = start.map { k in (0..<s).map { (j: Int) -> Double in exp(j == k ? 7.0 : 0.0) / warm } }
        var pi = Array(repeating: 1 / Double(s), count: s)
        let norm: Double = Double(d) * log(2 * Double.pi)
        let g: [Double] = x.map { (v: [Double]) -> Double in -0.5 * (dot(v, v) + norm) }
        let rho = x.map { zip($0, phi).map { $0 * $1.squareRoot() } }
        let ratio: Double = fa / fb
        var elbo = -Double.infinity
        for _ in 0..<iterations {
            let counts = (0..<s).map { k in gamma.reduce(0) { $0 + $1[k] } }
            let invL: [[Double]] = counts.map { (n: Double) -> [Double] in phi.map { (p: Double) -> Double in 1 / (1 + ratio * n * p) } }
            let alpha: [[Double]] = (0..<s).map { (k: Int) -> [Double] in
                (0..<d).map { (j: Int) -> Double in
                    var sum = 0.0
                    for (gi, ri) in zip(gamma, rho) { sum += gi[k] * ri[j] }
                    return ratio * invL[k][j] * sum
                }
            }
            let constant: [Double] = (0..<s).map { (k: Int) -> Double in
                var sum = 0.0
                for j in 0..<d {
                    let a: Double = alpha[k][j]
                    sum += (invL[k][j] + a * a) * phi[j]
                }
                return -0.5 * sum
            }
            let lpi = pi.map { log($0 + 1e-8) }
            var total = 0.0
            for i in x.indices {
                let lp: [Double] = (0..<s).map { (k: Int) -> Double in
                    let inner: Double = dot(rho[i], alpha[k]) + constant[k] + g[i]
                    return fa * inner + lpi[k]
                }
                let top = lp.max()!
                let lse = top + log(lp.reduce(0) { $0 + exp($1 - top) })
                gamma[i] = lp.map { exp($0 - lse) }
                total += lse
            }
            let shares = (0..<s).map { k in gamma.reduce(0) { $0 + $1[k] } }
            pi = shares.map { $0 / shares.reduce(0, +) }
            var bound = 0.0
            for k in 0..<s {
                var sum = 0.0
                for j in 0..<d {
                    let (l, a): (Double, Double) = (invL[k][j], alpha[k][j])
                    sum += log(l) - l - a * a + 1
                }
                bound += sum
            }
            let next = total + fb * 0.5 * bound
            if next - elbo < 1e-6 { break }
            elbo = next
        }
        return (gamma, pi)
    }

    /// Each vector to its closest centroid (cosine) that no cannot-linked vector already holds,
    /// the surest first; one with every centroid forbidden opens a voice of its own.
    static func assign(_ x: [[Double]], centroids: [[Double]], cannot: [(Int, Int)]) -> [Int] {
        var centroids = centroids
        var apart: [Int: [Int]] = [:]
        for (a, b) in cannot where a != b {
            apart[a, default: []].append(b)
            apart[b, default: []].append(a)
        }
        let surest = x.indices.map { i in centroids.map { cosine(x[i], $0) }.max() ?? -1 }
        var out = [Int?](repeating: nil, count: x.count)
        for i in x.indices.sorted(by: { (surest[$0], -$0) > (surest[$1], -$1) }) {
            let taken = Set((apart[i] ?? []).compactMap { out[$0] })
            let free = centroids.indices.filter { !taken.contains($0) }
            if let k = free.max(by: { (cosine(x[i], centroids[$0]), -$0) < (cosine(x[i], centroids[$1]), -$1) }) {
                out[i] = k
            } else {
                centroids.append(x[i])
                out[i] = centroids.count - 1
            }
        }
        return out.map { $0! }
    }

    static func dot(_ a: [Double], _ b: [Double]) -> Double { zip(a, b).reduce(0) { $0 + $1.0 * $1.1 } }

    /// `v` at length `length` (a zero vector stays zero).
    static func scaled(_ v: [Double], to length: Double) -> [Double] {
        let norm = dot(v, v).squareRoot()
        return norm > 0 ? v.map { $0 * length / norm } : v
    }

    static func cosine(_ a: [Double], _ b: [Double]) -> Double {
        let norms = (dot(a, a) * dot(b, b)).squareRoot()
        return norms > 0 ? dot(a, b) / norms : 0
    }
}
