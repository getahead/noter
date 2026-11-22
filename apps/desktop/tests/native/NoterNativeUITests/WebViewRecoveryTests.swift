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

    /// A panel's web process can hang before its first page commits (#1160, #1123): WebKit then has no page to reload,
    /// and a reload after the restart left the panel blank in a fresh process. The debug hook stops the panel's web
    /// process the moment it exists and writes "stalled" (or "committed" when the page got there first). The watch
    /// restarts it after 10 s and must load the page again.
    private func stallFirstLoad(of window: String) -> URL {
        let file = FileManager.default.temporaryDirectory.appendingPathComponent("noter-first-load-\(UUID().uuidString)")
        app.launchEnvironment["NOTER_TEST_STALL_FIRST_LOAD_FILE"] = file.path
        app.launchEnvironment["NOTER_TEST_STALL_FIRST_LOAD_WINDOW"] = window
        addTeardownBlock { try? FileManager.default.removeItem(at: file) }
        return file
    }

    private func expectStalled(_ file: URL, file source: StaticString = #filePath, line: UInt = #line) {
        XCTAssertTrue(waitUntil(10) { (try? String(contentsOf: file, encoding: .utf8)) != nil }, "the hook did not stall the first load", file: source, line: line)
        XCTAssertEqual(try? String(contentsOf: file, encoding: .utf8), "stalled", "the page committed before its process stopped", file: source, line: line)
    }

    func test_cpt_noter_seq_floating_panel_hide_and_reopen__a_first_load_stalled_before_commit_recovers() {
        let stalled = stallFirstLoad(of: "call-screen")
        launch()
        press("n")
        expectStalled(stalled)
        // The watch restarts the page 10 s after the window was made, then the page loads in a few seconds.
        XCTAssertTrue(callWindow.buttons["Hide"].waitForExistence(timeout: 30), "the call page did not load in its new web process")
    }

    func test_cpt_noter_seq_record_prompt_start_recording__a_first_load_stalled_before_commit_recovers() {
        let stalled = stallFirstLoad(of: "record-prompt")
        launch("detected")
        expectStalled(stalled)
        XCTAssertTrue(recordPrompt.waitForExistence(timeout: 30), "the record prompt did not load in its new web process")
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
