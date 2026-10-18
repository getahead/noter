// The engine half of the first-run self-test (`cpt-noter-flow-core-engine-foundation-self-test`):
// it proves both channels deliver non-zero buffers. The core decides `permission_missing`
// before it sends `self_test` (decision E2), so the engine only reports what it heard.

/// Watches the self-test's audio and decides its result.
public struct SelfTestMonitor: Sendable {
    private var arrived: Set<Channel> = []
    private var heard: Set<Channel> = []

    public init() {}

    public var bothArrived: Bool { arrived.count == 2 }

    // @cpt-begin:cpt-noter-flow-core-engine-foundation-self-test:p1:inst-stream-arrived
    /// `self_test_stream` for a channel's first non-zero buffer.
    public mutating func feed(_ chunk: AudioChunk) -> [EngineEvent] {
        heard.insert(chunk.channel)
        guard !arrived.contains(chunk.channel), chunk.samples.contains(where: { $0 != 0 }) else { return [] }
        arrived.insert(chunk.channel)
        return [.selfTestStream(channel: chunk.channel)]
    }
    // @cpt-end:cpt-noter-flow-core-engine-foundation-self-test:p1:inst-stream-arrived

    // @cpt-begin:cpt-noter-flow-core-engine-foundation-self-test:p1:inst-result
    /// Passed only with non-zero buffers on both channels and the live model installed. A channel
    /// that delivered only exact digital zeros is `zero_buffers` (for system audio: the System
    /// Audio Recording permission is off, inferred); one that delivered nothing is
    /// `device_unavailable`.
    public func result(modelsPresent: Bool) -> EngineEvent {
        let failure: EngineErrorCode?
        if !modelsPresent {
            failure = .modelMissing
        } else if let missing = [Channel.mic, .sys].first(where: { !arrived.contains($0) }) {
            failure = heard.contains(missing) ? .zeroBuffers : .deviceUnavailable
        } else {
            failure = nil
        }
        return .selfTestResult(passed: failure == nil, failure: failure, ownSoundsLeak: false)
    }
    // @cpt-end:cpt-noter-flow-core-engine-foundation-self-test:p1:inst-result
}
