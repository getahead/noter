// noter-engine: the sandboxed audio and speech sidecar. Live mode answers the core on stdin
// and stdout; file mode (`--mic mic.wav --sys sys.wav [--fast]`) replays a recording through
// the same protocol. stdout carries protocol lines only; diagnostics go to stderr.

import Foundation
import NoterEngineKit

let version = "0.1.0"
let environment = ProcessInfo.processInfo.environment
let sandboxed = environment["APP_SANDBOX_CONTAINER_ID"] != nil
let writer = EventWriter.stdout()
let container = Models.container(environment: environment)
let models = Models.installed(container: container)
/// The live speech model, when the core has installed it.
let speechModel: (() throws -> Transcriber)? = container.map { $0.appendingPathComponent("models/whisper-turbo") }
    .flatMap { folder in FileManager.default.fileExists(atPath: folder.path) ? { try WhisperTranscriber(folder: folder) } : nil }

/// The offline models (archive decode, embeddings) the core has installed.
let offline = container.map { LocalOfflineWork.installed(models: $0.appendingPathComponent("models")) }

/// Answers commands from stdin until `shutdown`; end of input also ends live mode, while a
/// file replay runs to its end.
func serve(_ engine: EngineLoop, exitAtEndOfInput: Bool) {
    while let line = readLine() {
        if !engine.handle(line) { engine.flushStops(); exit(0) }
    }
    if exitAtEndOfInput { engine.flushStops(); exit(0) }
}

switch Arguments.parse(Array(CommandLine.arguments.dropFirst())) {
case let .invalid(why):
    FileHandle.standardError.write(Data("noter-engine: \(why)\n".utf8))
    exit(2)
case let .file(mic, sys, realtime):
    // The speech model too: a replayed call is transcribed as a live one (golden set, Q4 replay).
    let fileContainer = container ?? FileManager.default.temporaryDirectory.appendingPathComponent("noter-file-mode", isDirectory: true)
    let audio = FileAudioSource(mic: mic, sys: sys, realtime: realtime)
    let engine = EngineLoop(
        writer: writer, engineVersion: version, models: models, sandboxed: sandboxed, container: fileContainer,
        transcriber: speechModel, offline: offline
    ) { start in
        start == nil ? FileAudioSource(mic: mic, sys: sys, realtime: realtime) : audio
    }
    let replay = FileMode()
    exit(
        replay.run(writer: writer, engine: engine, audio: audio) {
            Thread.detachNewThread { serve(engine, exitAtEndOfInput: false) }
        })
case .live:
    let engine = EngineLoop(
        writer: writer, engineVersion: version, models: models, sandboxed: sandboxed, container: container,
        processes: { ProcessWatcher.snapshot() },
        transcriber: speechModel, offline: offline
    ) { start in
        LiveAudioSource(micUid: start?.micDeviceUid, excluding: start?.excludeBundleIds ?? [])
    }
    engine.start()
    engine.watchProcesses()
    serve(engine, exitAtEndOfInput: true)
}
