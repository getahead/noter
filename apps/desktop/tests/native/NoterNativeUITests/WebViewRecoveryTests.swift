// A window whose page stops loading recovers (#521): the host gives the page a new web process. On the macOS 15
// runner a web process could hang in its first frame, leaving its window blank and every query that reached it waiting.
import XCTest

final class WebViewRecoveryTests: NoterTestCase {
    /// Once the test has seen the page it creates the file; the debug hook then stops the main window's web process
    /// and reloads the page, and writes "stalled" into the file (a timer in the hook stalled a slow runner's page
    /// before its first query was answered, #578). From then on every query that reaches the page waits on the
    /// stopped process, until the host's watch (10 s) restarts it. The window then answers again: Calls opens and
    /// lists the library.
    func test_cpt_noter_seq_floating_panel_hide_and_reopen__loaded_web_process_terminates() {
        let terminated = FileManager.default.temporaryDirectory.appendingPathComponent("noter-terminated-\(UUID().uuidString)")
        app.launchEnvironment["NOTER_TEST_TERMINATE_WEB_PROCESS_FILE"] = terminated.path
        defer { try? FileManager.default.removeItem(at: terminated) }
        launch()
        hotkey("n")
        XCTAssertTrue(callWindow.buttons["Hide"].waitForExistence(timeout: 10), "the call page did not load")
        XCTAssertTrue(FileManager.default.createFile(atPath: terminated.path, contents: nil), "could not request web process termination")
        XCTAssertTrue(waitUntil(10) { (try? String(contentsOf: terminated, encoding: .utf8)) == "terminated" }, "the test hook did not terminate the loaded page process")
        XCTAssertTrue(callWindow.buttons["Hide"].waitForExistence(timeout: 30), "the call page did not recover")
    }

    func test_cpt_noter_seq_call_screen_recover_capture__a_stalled_page_reloads_in_a_new_web_process() {
        let stalled = FileManager.default.temporaryDirectory.appendingPathComponent("noter-stalled-\(UUID().uuidString)")
        app.launchEnvironment["NOTER_TEST_STALL_FILE"] = stalled.path
        defer { try? FileManager.default.removeItem(at: stalled) }
        launch("idle")
        // A first-frame WebKit hang is restarted by the host after 10 s. Leave time for the watchdog's
        // one-second poll and the replacement process to load before treating the initial page as lost.
        XCTAssertTrue(app.groups["Sidebar"].waitForExistence(timeout: 30), "the main window did not load after WebView recovery")
        XCTAssertTrue(FileManager.default.createFile(atPath: stalled.path, contents: nil), "could not ask the hook to stall the page")
        XCTAssertTrue(waitUntil(10) { (try? String(contentsOf: stalled, encoding: .utf8)) == "stalled" }, "the hook did not stall the page")
        // The watch restarts the page 10 s after the stall (`webview_watch::BOUND`, checked once a second) and the
        // reload then takes a few seconds: more than openCall's 10 s, which is for a live page.
        XCTAssertTrue(app.groups["Sidebar"].waitForExistence(timeout: 30), "the stalled page did not recover")
        openCall("Backend sync")
    }
}
