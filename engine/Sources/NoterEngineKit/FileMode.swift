// File mode (`cpt-noter-flow-core-engine-foundation-file-mode`): `noter-engine --mic mic.wav
// --sys sys.wav` replays a recording through the same protocol, so the core and the golden
// set are tested without a live call.

import Foundation

public enum Arguments: Equatable {
    case live
    case file(mic: URL, sys: URL, realtime: Bool)
    case invalid(String)

    // @cpt-begin:cpt-noter-flow-core-engine-foundation-file-mode:p1:inst-file-args
    public static func parse(_ args: [String]) -> Arguments {
        var mic: URL?
        var sys: URL?
        var realtime = true
        var rest = args[...]
        while let arg = rest.popFirst() {
            switch arg {
            case "--mic": mic = rest.popFirst().map { URL(fileURLWithPath: $0) }
            case "--sys": sys = rest.popFirst().map { URL(fileURLWithPath: $0) }
            case "--fast": realtime = false
            default: return .invalid("unknown argument \(arg)")
            }
        }
        switch (mic, sys) {
        case (nil, nil): return .live
        case let (mic?, sys?): return .file(mic: mic, sys: sys, realtime: realtime)
        default: return .invalid("file mode needs both --mic and --sys")
        }
    }
    // @cpt-end:cpt-noter-flow-core-engine-foundation-file-mode:p1:inst-file-args
}

// @cpt-flow:cpt-noter-flow-core-engine-foundation-file-mode:p2
public struct FileMode {
    public static let callId = "call_file"
    let mic: URL
    let sys: URL
    let realtime: Bool

    public init(mic: URL, sys: URL, realtime: Bool) {
        self.mic = mic
        self.sys = sys
        self.realtime = realtime
    }

    /// Replays the pair and returns the exit code: `ready`, levels in file time (or as fast as
    /// possible), then `session_stopped`; a file that cannot be read is `device_unavailable`.
    /// `afterReady` runs once `ready` is out (the caller starts answering commands then).
    /// `models` are the installed model folders, as in live mode, so a self-test over the
    /// replayed files is judged the same way.
    public func run(
        writer: EventWriter, engineVersion: String, sandboxed: Bool = false, models: [String] = [],
        afterReady: () -> Void = {}
    ) -> Int32 {
        let audio: (mic: WAVAudio, sys: WAVAudio)
        do {
            audio = (try WAV.read(mic), try WAV.read(sys))
        } catch {
            writer.emit(.error(cmdId: nil, code: .deviceUnavailable, message: "\(error)"))
            return 1
        }
        // @cpt-begin:cpt-noter-flow-core-engine-foundation-file-mode:p1:inst-file-events
        writer.emit(
            .ready(protocolVersion: engineProtocolVersion, engineVersion: engineVersion, models: models, sandboxed: sandboxed))
        afterReady()
        for (m, s) in FileAudioSource.windows(mic: audio.mic, sys: audio.sys) {
            writer.emit(.levels(callId: FileMode.callId, micDb: Levels.db(m), sysDb: Levels.db(s)))
            if realtime { Thread.sleep(forTimeInterval: 0.1) }
        }
        // @cpt-end:cpt-noter-flow-core-engine-foundation-file-mode:p1:inst-file-events
        // @cpt-begin:cpt-noter-flow-core-engine-foundation-file-mode:p1:inst-file-return
        writer.emit(.sessionStopped(callId: FileMode.callId, timelinePath: "", micPath: mic.path, sysPath: sys.path))
        return 0
        // @cpt-end:cpt-noter-flow-core-engine-foundation-file-mode:p1:inst-file-return
    }
}

/// Installed model folders: `models/` in the App Group container the supervisor passes as
/// `NOTER_APP_GROUP_DIR`.
public enum Models {
    public static func installed(container: URL?) -> [String] {
        guard let container,
            let names = try? FileManager.default.contentsOfDirectory(atPath: container.appendingPathComponent("models").path)
        else { return [] }
        // Hidden files and downloads still in progress (`<name>.partial`) are not installed.
        return names.filter { !$0.hasPrefix(".") && !$0.hasSuffix(".partial") }.sorted()
    }

    // @cpt-dod:cpt-noter-dod-core-engine-foundation-offline:p1
    public static func container(environment: [String: String]) -> URL? {
        environment["NOTER_APP_GROUP_DIR"].map { URL(fileURLWithPath: $0, isDirectory: true) }
    }
}
