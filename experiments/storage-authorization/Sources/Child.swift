import Foundation
import CryptoKit
import Security
import Darwin

func readObservation(_ path: String) -> (observation: [String: Any], bytes: Data?) {
    let descriptor = open(path, O_RDONLY | O_CLOEXEC)
    guard descriptor >= 0 else { return (["ok": false, "errno": errno], nil) }
    defer { close(descriptor) }
    var bytes = [UInt8](repeating: 0, count: 4097)
    let count = read(descriptor, &bytes, bytes.count)
    guard count >= 0 else { return (["ok": false, "errno": errno], nil) }
    return (["ok": true, "errno": 0, "bytes": count], Data(bytes.prefix(count)))
}

func writeObservation(_ path: String, nonce: String) -> [String: Any] {
    let descriptor = open(path, O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC, 0o600)
    guard descriptor >= 0 else { return ["ok": false, "errno": errno] }
    defer { close(descriptor) }
    let bytes = Array(nonce.utf8)
    let written = bytes.withUnsafeBytes { write(descriptor, $0.baseAddress, $0.count) }
    guard written == bytes.count else { return ["ok": false, "errno": errno, "bytes": written] }
    return ["ok": true, "errno": 0, "bytes": written]
}

func siblingWriteObservation(_ path: String) -> [String: Any] {
    let descriptor = open(path, O_WRONLY | O_NOFOLLOW | O_CLOEXEC)
    guard descriptor >= 0 else { return ["ok": false, "errno": errno] }
    close(descriptor)
    return ["ok": true, "errno": 0]
}

func loopbackObservation(port: UInt16) -> [String: Any] {
    let descriptor = socket(AF_INET, SOCK_STREAM, 0)
    guard descriptor >= 0 else { return ["ok": false, "errno": errno] }
    defer { close(descriptor) }
    guard fcntl(descriptor, F_SETFL, O_NONBLOCK) == 0 else { return ["ok": false, "errno": errno] }
    var address = sockaddr_in()
    address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
    address.sin_family = sa_family_t(AF_INET)
    address.sin_port = port.bigEndian
    address.sin_addr.s_addr = inet_addr("127.0.0.1")
    let addressLength = socklen_t(address.sin_len)
    let result = withUnsafePointer(to: &address) {
        $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { connect(descriptor, $0, addressLength) }
    }
    if result == 0 { return ["ok": true, "errno": 0] }
    let failure = errno
    guard failure == EINPROGRESS else { return ["ok": false, "errno": failure] }
    var event = pollfd(fd: descriptor, events: Int16(POLLOUT), revents: 0)
    guard poll(&event, 1, 1000) > 0 else { return ["ok": false, "errno": ETIMEDOUT] }
    var socketError: Int32 = 0
    var length = socklen_t(MemoryLayout<Int32>.size)
    guard getsockopt(descriptor, SOL_SOCKET, SO_ERROR, &socketError, &length) == 0 else {
        return ["ok": false, "errno": errno]
    }
    return ["ok": socketError == 0, "errno": socketError]
}

func signingEntitlements() throws -> [String: Any] {
    var code: SecCode?
    guard SecCodeCopySelf([], &code) == errSecSuccess, let code else { throw ProbeError.invalid("SecCodeCopySelf") }
    var staticCode: SecStaticCode?
    guard SecCodeCopyStaticCode(code, [], &staticCode) == errSecSuccess, let staticCode else {
        throw ProbeError.invalid("SecCodeCopyStaticCode")
    }
    var information: CFDictionary?
    guard SecCodeCopySigningInformation(staticCode, SecCSFlags(rawValue: kSecCSSigningInformation), &information) == errSecSuccess,
        let information = information as? [String: Any],
        let entitlements = information[kSecCodeInfoEntitlementsDict as String] as? [String: Any] else {
        throw ProbeError.invalid("signing entitlements")
    }
    return entitlements
}

@main
struct Child {
    static func main() {
        do {
            guard CommandLine.arguments.dropFirst() == ["--disposable-spike-child"] else {
                throw ProbeError.invalid("run only via the disposable-session driver")
            }
            let request = try Bootstrap.read(from: .standardInput)
            let entitlements = try signingEntitlements()
            var report: [String: Any] = [
                "nonce": request.nonce, "mode": request.mode.rawValue,
                "bundle_id": Bundle.main.bundleIdentifier ?? "unknown",
                "sandbox_entitlement": entitlements["com.apple.security.app-sandbox"] as? Bool ?? false,
                "network_entitlement": (entitlements["com.apple.security.network.client"] as? Bool ?? false)
                    || (entitlements["com.apple.security.network.server"] as? Bool ?? false),
                "inherit_entitlement": entitlements["com.apple.security.inherit"] as? Bool ?? false,
                "scope_started": false,
            ]
            var activeURL: URL?
            defer { activeURL?.stopAccessingSecurityScopedResource() }
            if let encoded = request.bookmark, let bookmark = Data(base64Encoded: encoded) {
                do {
                    var stale = false
                    let url = try URL(resolvingBookmarkData: bookmark,
                        options: [.withoutUI, .withoutMounting, .withoutImplicitStartAccessing],
                        relativeTo: nil, bookmarkDataIsStale: &stale)
                    guard !stale, url.standardizedFileURL.path == request.workspace else {
                        throw ProbeError.invalid("stale or mismatched bookmark")
                    }
                    let started = url.startAccessingSecurityScopedResource()
                    report["scope_started"] = started
                    if started { activeURL = url }
                } catch {
                    report["resolution_error_domain"] = (error as NSError).domain
                    report["resolution_error_code"] = (error as NSError).code
                }
            }
            let fixture = readObservation(request.workspace + "/models/probe.bin")
            report["fixture_read"] = fixture.observation
            if let bytes = fixture.bytes {
                report["fixture_sha256"] = SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined()
            }
            report["workspace_write"] = writeObservation(request.workspace + "/audio/" + request.nonce + ".bin", nonce: request.nonce)
            report["sibling_read"] = readObservation(request.sibling).observation
            report["sibling_write"] = siblingWriteObservation(request.sibling)
            report["symlink_read"] = readObservation(request.workspace + "/escape.bin").observation
            report["loopback_connect"] = loopbackObservation(port: request.port)
            try emitJSON(report)
        } catch {
            try? emitJSON(["fatal": String(describing: error)])
            exit(2)
        }
    }
}
