// A window whose page stops loading recovers (#521): the host gives the page a new web process. On the macOS 15
// runner a web process could hang in its first frame, leaving its window blank and every query that reached it waiting.
import XCTest

final class WebViewRecoveryTests: NoterTestCase {
    /// The debug hook stops the main window's web process a few seconds after its page loaded and reloads the page,
    /// then writes the file: from then on every query that reaches the page waits on the stopped process, until the
    /// host's watch (10 s) restarts it. The window then answers again: Calls opens and lists the library.
    func test_a_stalled_page_reloads_in_a_new_web_process() {
        let stalled = FileManager.default.temporaryDirectory.appendingPathComponent("noter-stalled-\(UUID().uuidString)")
        app.launchEnvironment["NOTER_TEST_STALL_FILE"] = stalled.path
        defer { try? FileManager.default.removeItem(at: stalled) }
        launch("idle")
        XCTAssertTrue(app.groups["Sidebar"].waitForExistence(timeout: 10), "the main window did not load")
        XCTAssertTrue(waitUntil(10) { FileManager.default.fileExists(atPath: stalled.path) }, "the hook did not stall the page")
        openCall("Backend sync")
    }
}
