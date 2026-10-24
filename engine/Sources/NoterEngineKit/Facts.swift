// Facts about other apps and the system channel, never decisions: call detection
// (`cpt-noter-flow-core-engine-capture-detect`; the core applies the rule and decides what to
// show) and exact digital zeros on the system channel (`cpt-noter-algo-core-engine-capture-zero-detect`).

import AppKit
import CoreAudio

/// A process that plays or records audio now, as Core Audio reports it.
public struct ProcessAudio: Equatable, Sendable {
    public let pid: Int32
    public let bundleId: String
    public let name: String
    public let output: Bool
    public let input: Bool

    public init(pid: Int32, bundleId: String, name: String, output: Bool, input: Bool) {
        self.pid = pid
        self.bundleId = bundleId
        self.name = name
        self.output = output
        self.input = input
    }
}

// @cpt-flow:cpt-noter-flow-core-engine-capture-detect:p1
// @cpt-dod:cpt-noter-dod-core-engine-capture-detection:p1
/// Turns process snapshots into detection facts. An app's helpers (`<bundle id>.…`, where
/// browsers and Electron apps play and record) count as the app.
public struct Detector: Sendable {
    private var enabled = false
    private var known: [String] = []
    private var detected: Set<String> = []
    private var session: (callId: String, seen: Set<String>)?
    private var excluded: Set<String> = []
    /// A known app plays audio: zeros on the system channel then likely mean no permission.
    public private(set) var meetingAppPlaying = false

    public init() {}

    // @cpt-begin:cpt-noter-flow-core-engine-capture-detect:p1:inst-listen
    /// `set_detection`; turning detection off forgets the calls seen, without facts.
    public mutating func rule(enabled: Bool, known: [String]) {
        (self.enabled, self.known) = (enabled, known)
        if !enabled { detected = [] }
    }
    // @cpt-end:cpt-noter-flow-core-engine-capture-detect:p1:inst-listen

    /// From now on a new sound source is reported; what plays already and the excluded apps are not.
    public mutating func startSession(callId: String, current: [ProcessAudio], excluded: [String]) {
        self.excluded = Set(excluded)
        session = (callId, Set(current.filter(\.output).map { owner($0.bundleId) }))
    }

    public mutating func exclude(_ bundleId: String) { excluded.insert(bundleId) }

    public mutating func stopSession() {
        session = nil
        excluded = []
    }

    /// The known app a process belongs to, or its own bundle id.
    private func owner(_ bundleId: String) -> String { known.first { Exclusion.matches(bundleId, [$0]) } ?? bundleId }

    // @cpt-begin:cpt-noter-flow-core-engine-capture-detect:p1:inst-emit-facts
    public mutating func update(_ processes: [ProcessAudio]) -> [EngineEvent] {
        var events: [EngineEvent] = []
        let byApp = Dictionary(grouping: processes) { owner($0.bundleId) }
        func main(_ id: String) -> ProcessAudio? { byApp[id].flatMap { ps in ps.first { $0.bundleId == id } ?? ps.first } }
        meetingAppPlaying = known.contains { byApp[$0]?.contains(where: \.output) == true }
        if enabled {
            for id in known {
                let ps = byApp[id] ?? []
                let (output, input) = (ps.contains(where: \.output), ps.contains(where: \.input))
                if !detected.contains(id), output, input, let app = main(id) {
                    detected.insert(id)
                    events.append(.callDetected(bundleId: id, appName: app.name, pid: app.pid))
                } else if detected.contains(id), !output, !input {
                    detected.remove(id)
                    events.append(.callAudioReleased(bundleId: id))
                }
            }
        }
        if var s = session {
            for id in byApp.keys.sorted() where !s.seen.contains(id) && !Exclusion.matches(id, excluded) {
                guard byApp[id]?.contains(where: \.output) == true, let app = main(id) else { continue }
                s.seen.insert(id)
                events.append(.audioSourceAdded(callId: s.callId, bundleId: id, appName: app.name))
            }
            session = s
        }
        return events
    }
    // @cpt-end:cpt-noter-flow-core-engine-capture-detect:p1:inst-emit-facts
}

// @cpt-algo:cpt-noter-algo-core-engine-capture-zero-detect:p1
/// A run of exact digital zeros on the system channel. A real quiet room is never exact zero;
/// zeros while a meeting app plays mean the System Audio Recording permission is likely off.
public struct ZeroRun: Sendable {
    /// How long the zeros last before each report, and how sure it is then.
    static let steps: [(ms: Int, confidence: Float)] = [(5_000, 0.6), (15_000, 0.8), (30_000, 0.95)]
    private var since: Int?
    private var reported = 0

    public init() {}

    /// One system-channel chunk at `atMs` of call time; the fact to report, if any.
    public mutating func feed(zeros: Bool, atMs: Int, meetingApp: Bool) -> (sinceMs: Int, confidence: Float)? {
        // @cpt-begin:cpt-noter-algo-core-engine-capture-zero-detect:p1:inst-count-zeros
        guard zeros else {
            (since, reported) = (nil, 0)
            return nil
        }
        let start = since ?? atMs
        since = start
        // @cpt-end:cpt-noter-algo-core-engine-capture-zero-detect:p1:inst-count-zeros
        // @cpt-begin:cpt-noter-algo-core-engine-capture-zero-detect:p1:inst-emit-silent
        guard meetingApp, reported < Self.steps.count, atMs - start >= Self.steps[reported].ms else { return nil }
        reported += 1
        return (start, Self.steps[reported - 1].confidence)
        // @cpt-end:cpt-noter-algo-core-engine-capture-zero-detect:p1:inst-emit-silent
    }
}

public enum ProcessWatcher {
    // @cpt-begin:cpt-noter-flow-core-engine-capture-detect:p1:inst-listen
    /// The processes playing or recording now, except this engine and the app that started it.
    /// shortcut: Safari plays calls from `com.apple.WebKit.*` processes, which do not carry
    /// Safari's bundle id, so a Safari call is not detected; map WebKit processes to their
    /// responsible app if the runbook shows Safari calls matter.
    public static func snapshot() -> [ProcessAudio] {
        let me = [getpid(), getppid()]
        return LiveAudioSource.processObjects().compactMap { object in
            let (output, input) = (flag(object, kAudioProcessPropertyIsRunningOutput), flag(object, kAudioProcessPropertyIsRunningInput))
            guard output || input, let bundleId = LiveAudioSource.string(object, kAudioProcessPropertyBundleID), !bundleId.isEmpty,
                let pid = pid(object), !me.contains(pid)
            else { return nil }
            let name = NSRunningApplication(processIdentifier: pid)?.localizedName ?? bundleId
            return ProcessAudio(pid: pid, bundleId: bundleId, name: name, output: output, input: input)
        }
    }
    // @cpt-end:cpt-noter-flow-core-engine-capture-detect:p1:inst-listen

    private static func flag(_ object: AudioObjectID, _ selector: AudioObjectPropertySelector) -> Bool {
        var address = AudioObjectPropertyAddress(
            mSelector: selector, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
        var value: UInt32 = 0
        var size = UInt32(MemoryLayout<UInt32>.size)
        return AudioObjectGetPropertyData(object, &address, 0, nil, &size, &value) == noErr && value != 0
    }

    private static func pid(_ object: AudioObjectID) -> Int32? {
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioProcessPropertyPID, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
        var pid: pid_t = 0
        var size = UInt32(MemoryLayout<pid_t>.size)
        return AudioObjectGetPropertyData(object, &address, 0, nil, &size, &pid) == noErr ? pid : nil
    }
}
