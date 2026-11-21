import Foundation

@main
struct ProtocolTests {
    static func main() throws {
        var checks = 0
        func expect(_ value: Bool, _ label: String) {
            checks += 1
            if !value { fatalError("FAIL: \(label)") }
        }
        func rejects(_ data: Data, _ label: String) {
            do { _ = try Bootstrap.decodeFrame(data); fatalError("accepted \(label)") }
            catch { checks += 1 }
        }
        let value = Bootstrap(version: 1, nonce: String(repeating: "a", count: 32),
            mode: .none, workspace: "/test/run/workspace", fixtureSHA256: String(repeating: "b", count: 64),
            port: 12345, bookmark: nil)
        let frame = try value.frame()
        let decoded = try Bootstrap.decodeFrame(frame)
        expect(decoded.nonce == value.nonce, "round trip")
        expect(decoded.sibling == "/test/run/denied/sentinel.bin", "sibling outside grant")
        rejects(Data(), "empty header")
        rejects(Data([0, 0, 0]), "short header")
        rejects(Data([0, 0, 0, 0]), "empty payload")
        rejects(Data([0xff, 0xff, 0xff, 0xff]), "oversized declared length")
        rejects(frame.dropLast(), "truncated payload")
        rejects(frame + Data([0]), "trailing bytes")
        func altered(_ key: String, _ replacement: Any, _ label: String) throws {
            var object = try JSONSerialization.jsonObject(with: JSONEncoder().encode(value)) as! [String: Any]
            object[key] = replacement
            rejects(try Framing.encode(JSONSerialization.data(withJSONObject: object)), label)
        }
        try altered("version", 2, "unsupported version")
        try altered("nonce", "../unsafe", "invalid nonce")
        try altered("workspace", "/test/../run/workspace", "traversal")
        try altered("workspace", "/test/run/other", "wrong leaf")
        try altered("workspace", "relative/workspace", "relative path")
        try altered("fixtureSHA256", "invalid", "invalid hash")
        try altered("port", 0, "zero port")
        try altered("mode", "unrecognized", "unknown mode")
        try altered("bookmark", Data([1]).base64EncodedString(), "unexpected grant in none case")
        try altered("mode", "implicit", "missing implicit bookmark")
        var positive = value
        positive.mode = .implicit
        positive.bookmark = Data([1, 2, 3]).base64EncodedString()
        expect(try Bootstrap.decodeFrame(positive.frame()).bookmark == positive.bookmark, "opaque bookmark transport")
        positive.bookmark = "!not-base64!"
        do { _ = try positive.frame(); fatalError("accepted invalid base64") } catch { checks += 1 }
        do { _ = try Framing.encode(Data(repeating: 0, count: Framing.maximumPayload + 1)); fatalError("oversized") }
        catch { checks += 1 }
        let temporary = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: temporary) }
        try frame.write(to: temporary)
        let handle = try FileHandle(forReadingFrom: temporary)
        defer { try? handle.close() }
        expect(try Bootstrap.read(from: handle).nonce == value.nonce, "bounded handle reader")
        print("PASS: \(checks) protocol assertions; no sandbox/GUI/security-scope APIs executed")
    }
}
