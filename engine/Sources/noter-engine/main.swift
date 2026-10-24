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

/// Answers commands from stdin until `shutdown`; end of input also ends live mode, while a
/// file replay runs to its end.
func serve(_ engine: EngineLoop, exitAtEndOfInput: Bool) {
    while let line = readLine() {
        if !engine.handle(line) { exit(0) }
    }
    if exitAtEndOfInput { exit(0) }
}

switch Arguments.parse(Array(CommandLine.arguments.dropFirst())) {
case let .invalid(why):
    FileHandle.standardError.write(Data("noter-engine: \(why)\n".utf8))
    exit(2)
case let .file(mic, sys, realtime):
    let engine = EngineLoop(
        writer: writer, engineVersion: version, models: models, sandboxed: sandboxed, container: container
    ) {
        guard let m = try? WAV.read(mic), let s = try? WAV.read(sys) else { return nil }
        return FileAudioSource(mic: m, sys: s, realtime: realtime)
    }
    let replay = FileMode(mic: mic, sys: sys, realtime: realtime)
    exit(
        replay.run(writer: writer, engineVersion: version, sandboxed: sandboxed, models: models) {
            Thread.detachNewThread { serve(engine, exitAtEndOfInput: false) }
        })
case .live:
    let engine = EngineLoop(
        writer: writer, engineVersion: version, models: models, sandboxed: sandboxed, container: container
    ) {
        LiveAudioSource()
    }
    engine.start()
    serve(engine, exitAtEndOfInput: true)
}
