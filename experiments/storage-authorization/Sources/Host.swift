import AppKit
import Foundation
import CryptoKit
import Darwin

@main
struct Host {
    @MainActor
    static func main() {
        do {
            signal(SIGPIPE, SIG_IGN)
            let arguments = Array(CommandLine.arguments.dropFirst())
            guard arguments.count == 6, arguments[0] == "--disposable-session",
                let mode = Bootstrap.Mode(rawValue: arguments[1]),
                let port = UInt16(arguments[3]), let launches = Int(arguments[4]), (1...2).contains(launches),
                ["run", "cancel"].contains(arguments[5]) else {
                throw ProbeError.invalid("use spike.py run with disposable-session attestation")
            }
            let root = URL(fileURLWithPath: arguments[2], isDirectory: true).standardizedFileURL
            let marker = root.appendingPathComponent(".storage-auth-spike.json")
            let markerData = try Data(contentsOf: marker)
            guard markerData.count < 4096,
                let metadata = try JSONSerialization.jsonObject(with: markerData) as? [String: Any],
                metadata["kind"] as? String == "storage-auth-spike-v1",
                metadata["disposable_home"] as? String == FileManager.default.homeDirectoryForCurrentUser.path,
                root.path.hasPrefix(FileManager.default.homeDirectoryForCurrentUser.path + "/Library/Application Support/StorageAuthSpike/") else {
                throw ProbeError.invalid("missing disposable fixture marker")
            }
            let workspace = root.appendingPathComponent("workspace", isDirectory: true)
            let expectedBytes = try Data(contentsOf: workspace.appendingPathComponent("models/probe.bin"))
            guard expectedBytes.count == 4096 else { throw ProbeError.invalid("fixture size") }
            let digest = SHA256.hash(data: expectedBytes).map { String(format: "%02x", $0) }.joined()
            let expectedCancellation = arguments[5] == "cancel"
            var selectedURL: URL?
            defer { selectedURL?.stopAccessingSecurityScopedResource() }
            if mode == .implicit || mode == .stripped {
                let app = NSApplication.shared
                app.setActivationPolicy(.regular)
                app.activate()
                let panel = NSOpenPanel()
                panel.title = "Storage authorization spike — disposable data only"
                panel.message = "Select only the pre-created workspace shown below. Cancel for the cancellation case."
                panel.prompt = "Authorize test workspace"
                panel.canChooseDirectories = true
                panel.canChooseFiles = false
                panel.allowsMultipleSelection = false
                panel.canCreateDirectories = false
                panel.directoryURL = root
                guard panel.runModal() == .OK, let selection = panel.url else {
                    try emitJSON(["status": "cancelled", "child_spawned": false])
                    return
                }
                guard !expectedCancellation, selection.resolvingSymlinksInPath().path == workspace.path else {
                    throw ProbeError.invalid("unexpected selection; child not spawned")
                }
                selectedURL = selection
            }
            let child = Bundle.main.bundleURL.appendingPathComponent("Contents/Helpers/StorageAuthChild.app/Contents/MacOS/StorageAuthChild")
            for _ in 0..<launches {
                let nonce = UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased()
                var bookmark: Data?
                if mode == .implicit { bookmark = try (selectedURL ?? workspace).bookmarkData(options: [], includingResourceValuesForKeys: nil, relativeTo: nil) }
                if mode == .stripped { bookmark = try (selectedURL ?? workspace).bookmarkData(options: [.withoutImplicitSecurityScope], includingResourceValuesForKeys: nil, relativeTo: nil) }
                if mode == .corrupt { bookmark = Data([0xff, 0, 0xff]) }
                let request = Bootstrap(version: 1, nonce: nonce, mode: mode, workspace: workspace.path,
                    fixtureSHA256: digest, port: port, bookmark: bookmark?.base64EncodedString())
                let bootstrap = try request.frame()
                let process = Process()
                process.executableURL = child
                process.arguments = ["--disposable-spike-child"]
                process.environment = ["PATH": "/usr/bin:/bin", "LANG": "C"]
                let input = Pipe()
                let output = Pipe()
                let errors = Pipe()
                process.standardInput = input
                process.standardOutput = output
                process.standardError = errors
                try process.run()
                let deadline = DispatchSource.makeTimerSource(queue: .global())
                deadline.schedule(deadline: .now() + 15)
                deadline.setEventHandler { if process.isRunning { process.terminate() } }
                deadline.resume()
                defer {
                    deadline.cancel()
                    try? input.fileHandleForWriting.close()
                    if process.isRunning { process.terminate() }
                    process.waitUntilExit()
                }
                try input.fileHandleForWriting.write(contentsOf: bootstrap)
                try input.fileHandleForWriting.close()
                process.waitUntilExit()
                deadline.cancel()
                let data = try output.fileHandleForReading.read(upToCount: 65_537) ?? Data()
                let diagnostic = try errors.fileHandleForReading.read(upToCount: 4097) ?? Data()
                guard data.count <= 65_536, diagnostic.count <= 4096,
                    let result = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                    throw ProbeError.invalid("invalid or oversized child output")
                }
                try emitJSON(["status": "observed", "child_exit": process.terminationStatus,
                    "nonce": nonce, "child": result, "stderr_bytes": diagnostic.count,
                    "host_fixture_sha256": digest, "host_fixture_bytes": expectedBytes.count])
            }
        } catch {
            try? emitJSON(["status": "error", "error": String(describing: error)])
            exit(2)
        }
    }
}
