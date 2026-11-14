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

    public init() {}

    /// Replays the pair through the same engine session used by live capture.
    public func run(
        writer: EventWriter, engine: EngineLoop, audio: FileAudioSource,
        afterReady: () -> Void = {}
    ) -> Int32 {
        let sessionDir = "engine-io/file-mode-\(UUID().uuidString)"
        do {
            try audio.validate()
        } catch {
            writer.emit(.error(cmdId: nil, code: .deviceUnavailable, message: "\(error)"))
            return 1
        }
        engine.start()
        afterReady()
        do {
            // @cpt-begin:cpt-noter-flow-core-engine-foundation-file-mode:p1:inst-file-events
            let command = #"{"id":1,"cmd":{"type":"start_session","call_id":"call_file","session_dir":"\#(sessionDir)","store_audio":false,"mic_device_uid":null,"exclude_bundle_ids":[],"languages":{"array":[]},"backend":"whisper_turbo","glossary":{"array":[]},"speaker_priors":{"object":{}},"enrolled_embeddings_path":null,"resume_from_ms":null}}"#
            guard engine.handle(command), engine.isCapturing else {
                return 1
            }
            try audio.waitUntilFinished()
            // @cpt-end:cpt-noter-flow-core-engine-foundation-file-mode:p1:inst-file-events
        } catch {
            _ = engine.handle(#"{"id":2,"cmd":{"type":"stop","call_id":"call_file"}}"#)
            engine.flushStops()
            writer.emit(.error(cmdId: nil, code: .deviceUnavailable, message: "\(error)"))
            return 1
        }
        // @cpt-begin:cpt-noter-flow-core-engine-foundation-file-mode:p1:inst-file-return
        _ = engine.handle(#"{"id":2,"cmd":{"type":"stop","call_id":"call_file"}}"#)
        engine.flushStops()
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
