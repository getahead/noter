// SpikeHost: a stand-in for Noter.app (throwaway). Launched with `open`, it spawns the spike CLI
// from its own bundle as a child process, exactly as the app will spawn noter-engine, and
// writes the child's output to spike.log in its sandbox container (and to its own stdout).
//
//   open SpikeHost.app --args capture --seconds 20

import Foundation

let helper = Bundle.main.bundleURL.appendingPathComponent("Contents/MacOS/noter-spike")
let log = FileManager.default.temporaryDirectory.appendingPathComponent("spike.log")
FileManager.default.createFile(atPath: log.path, contents: nil)
let out = try FileHandle(forWritingTo: log)

let child = Process()
child.executableURL = helper
child.arguments = Array(CommandLine.arguments.dropFirst())
let pipe = Pipe()
child.standardOutput = pipe
child.standardError = pipe
pipe.fileHandleForReading.readabilityHandler = { h in
    let data = h.availableData
    out.write(data)
    FileHandle.standardOutput.write(data)
}
print("SpikeHost: log at \(log.path)")
do {
    try child.run()
} catch {
    out.write(Data("SpikeHost: could not start \(helper.path): \(error)\n".utf8))
    exit(1)
}
child.waitUntilExit()
Thread.sleep(forTimeInterval: 0.2)
out.write(Data("SpikeHost: child exited with \(child.terminationStatus)\n".utf8))
exit(child.terminationStatus)
