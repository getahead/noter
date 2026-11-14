// The shared speech-window and pause rule used by live ASR and archive decoding.

// @cpt-algo:cpt-noter-algo-core-engine-capture-live-asr:p1
enum SpeechSegments {
    static let windowMs = 100
    static let speechDb: Float = -50
    static let pauseMs = 700

    static func isSpeech(_ samples: [Float]) -> Bool { Levels.db(samples) > speechDb }

    static func utterances(_ samples: [Float], rate: Int, cuts: [Int], maxUtteranceMs: Int) -> [Range<Int>] {
        let window = max(1, rate * windowMs / 1000)
        let pause = rate * pauseMs / 1000
        let longest = rate * maxUtteranceMs / 1000
        let bounds = [0] + cuts.filter { $0 > 0 && $0 < samples.count }.sorted() + [samples.count]
        var result: [Range<Int>] = []
        for (from, to) in zip(bounds, bounds.dropFirst()) where to > from {
            var (start, end): (Int?, Int) = (nil, from)
            for at in stride(from: from, to: to, by: window) {
                let next = min(at + window, to)
                if isSpeech(Array(samples[at..<next])) {
                    let first = start ?? at
                    (start, end) = (first, next)
                    if end - first >= longest {
                        result.append(first..<end)
                        start = nil
                    }
                } else if let first = start, next - end >= pause {
                    result.append(first..<end)
                    start = nil
                }
            }
            if let start { result.append(start..<end) }
        }
        return result
    }
}
