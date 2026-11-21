import Foundation

enum ProbeError: Error { case invalid(String) }

enum Framing {
    static let maximumPayload = 65_536

    static func encode(_ payload: Data) throws -> Data {
        guard !payload.isEmpty, payload.count <= maximumPayload else { throw ProbeError.invalid("payload length") }
        var length = UInt32(payload.count).bigEndian
        return withUnsafeBytes(of: &length) { Data($0) } + payload
    }

    static func payloadLength(_ header: Data) throws -> Int {
        guard header.count == 4 else { throw ProbeError.invalid("header length") }
        let length = header.reduce(0) { ($0 << 8) | Int($1) }
        guard length > 0, length <= maximumPayload else { throw ProbeError.invalid("declared length") }
        return length
    }

    static func exact(_ count: Int, from handle: FileHandle) throws -> Data {
        var result = Data()
        while result.count < count {
            guard let part = try handle.read(upToCount: count - result.count), !part.isEmpty else {
                throw ProbeError.invalid("truncated frame")
            }
            result.append(part)
        }
        return result
    }
}

struct Bootstrap: Codable {
    enum Mode: String, Codable { case none, implicit, stripped, corrupt }
    let version: Int
    let nonce: String
    var mode: Mode
    let workspace: String
    let fixtureSHA256: String
    let port: UInt16
    var bookmark: String?

    var sibling: String {
        URL(fileURLWithPath: workspace).deletingLastPathComponent().appendingPathComponent("denied/sentinel.bin").path
    }

    func validate() throws {
        func hex(_ text: String, count: Int) -> Bool {
            text.utf8.count == count && text.utf8.allSatisfy { (48...57).contains($0) || (97...102).contains($0) }
        }
        guard version == 1, hex(nonce, count: 32), hex(fixtureSHA256, count: 64), port > 0 else {
            throw ProbeError.invalid("version, nonce, hash or port")
        }
        let url = URL(fileURLWithPath: workspace)
        guard workspace.hasPrefix("/"), workspace.utf8.count < 4096,
            !workspace.contains("\0"), !workspace.contains("\n"), !workspace.contains("//"),
            !workspace.split(separator: "/").contains(where: { $0 == "." || $0 == ".." }),
            url.lastPathComponent == "workspace", url.standardizedFileURL.path == workspace else {
            throw ProbeError.invalid("workspace path")
        }
        if mode == .none {
            guard bookmark == nil else { throw ProbeError.invalid("unexpected bookmark") }
        } else {
            guard let bookmark, let data = Data(base64Encoded: bookmark), !data.isEmpty,
                data.count <= 32_768 else { throw ProbeError.invalid("bookmark encoding or size") }
        }
    }

    func frame() throws -> Data {
        try validate()
        return try Framing.encode(JSONEncoder().encode(self))
    }

    static func decodeFrame(_ frame: Data) throws -> Bootstrap {
        let count = try Framing.payloadLength(Data(frame.prefix(4)))
        guard frame.count == count + 4 else { throw ProbeError.invalid("frame length") }
        let value = try JSONDecoder().decode(Self.self, from: frame.dropFirst(4))
        try value.validate()
        return value
    }

    static func read(from handle: FileHandle) throws -> Bootstrap {
        let header = try Framing.exact(4, from: handle)
        let count = try Framing.payloadLength(header)
        let payload = try Framing.exact(count, from: handle)
        guard try handle.read(upToCount: 1)?.isEmpty != false else { throw ProbeError.invalid("trailing input") }
        return try decodeFrame(header + payload)
    }
}

func emitJSON(_ value: [String: Any]) throws {
    let data = try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
    guard data.count <= 65_536 else { throw ProbeError.invalid("report too large") }
    try FileHandle.standardOutput.write(contentsOf: data + Data([10]))
}
