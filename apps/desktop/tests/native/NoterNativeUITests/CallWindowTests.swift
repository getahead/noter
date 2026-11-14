// M1 call window (docs/features/ui/call-window.md): hotkeys, hiding for presenting, the panel on a display change.
import AppKit
import CoreGraphics
import XCTest

final class CallWindowTests: NoterTestCase {
    func test_cpt_noter_seq_floating_panel_hide_and_reopen__hotkey_shows_without_focus() {
        launch()
        let main = window("Noter")
        XCTAssertTrue(main.waitForExistence(timeout: 5))
        main.typeKey("w", modifierFlags: .command)
        XCTAssertTrue(waitUntil(5) { !main.isHittable }, "the main window is hidden before opening the call panel")
        other.activate()
        hotkey("n")
        XCTAssertTrue(callWindow.waitForExistence(timeout: 5), "⌃⌥⌘N shows the call window")
        XCTAssertTrue(callWindow.buttons["Hide"].waitForExistence(timeout: 5), "the call window has loaded its page")
        XCTAssertFalse(main.isHittable, "the call panel opened without restoring the main window")
        XCTAssertEqual(other.state, .runningForeground, "it shows without taking focus")
    }

    func test_cpt_noter_seq_floating_panel_hide_and_reopen__click_keeps_focus() {
        launch()
        let main = window("Noter")
        XCTAssertTrue(main.waitForExistence(timeout: 5))
        main.typeKey("w", modifierFlags: .command)
        XCTAssertTrue(waitUntil(5) { !main.isHittable }, "the main window is hidden before opening the call panel")
        other.activate()
        hotkey("n")
        XCTAssertTrue(callWindow.waitForExistence(timeout: 5), "⌃⌥⌘N shows the call window")
        XCTAssertTrue(callWindow.buttons["Hide"].waitForExistence(timeout: 5), "the call window has loaded its page")
        XCTAssertFalse(main.isHittable, "the call panel opened without restoring the main window")
        clickKeepingFocus(callWindow)
        XCTAssertTrue(waitUntil(3) { self.other.state == .runningForeground }, "no click on the call window moves focus from the call app")
    }

    func test_hide_for_presenting_hides_and_restores_main_and_call_windows() {
        launch()
        step("open the call window") { press("n") }
        step("call window appears") { XCTAssertTrue(callWindow.waitForExistence(timeout: 5)) }
        step("main window exists") { XCTAssertTrue(window("Noter").waitForExistence(timeout: 5)) } // an immediate .exists can time out on a busy runner
        step("hide hotkey") { press("0") }
        step("call window gone") { XCTAssertTrue(callWindow.waitForNonExistence(timeout: 5)) }
        step("main window gone") { XCTAssertTrue(window("Noter").waitForNonExistence(timeout: 5)) }
        step("show hotkey") { press("0") }
        step("main window back") { XCTAssertTrue(window("Noter").waitForExistence(timeout: 5)) }
        step("call window back") { XCTAssertTrue(callWindow.waitForExistence(timeout: 5)) }
    }

    func test_cpt_noter_seq_call_screen_stop_at_call_end__hidden_for_presenting_menu_carries_notice() {
        launch("call-seems-ended")
        XCTAssertTrue(infoLine("Call seems to have ended", in: openMenu()).waitForExistence(timeout: 10))
    }

    func test_floating_panel_lands_inside_a_display_at_launch() {
        launch()
        hotkey("n")
        let panel = callWindow
        XCTAssertTrue(panel.waitForExistence(timeout: 5))
        // AppKit's screen frames grow up from the bottom of the primary display; XCUITest's frames grow down.
        let top = NSScreen.screens.first?.frame.maxY ?? 0
        let screens = NSScreen.screens.map { CGRect(x: $0.frame.minX, y: top - $0.frame.maxY, width: $0.frame.width, height: $0.frame.height) }
        XCTAssertFalse(screens.isEmpty)
        XCTAssertTrue(screens.contains { $0.contains(panel.frame) }, "the panel is inside a display")
    }

    func test_cpt_noter_seq_call_screen_hide_for_presenting__call_panel_is_excluded_from_window_capture() {
        launch("detected")
        app.typeKey("w", modifierFlags: .command)
        XCTAssertTrue(waitUntil(5) { !window("Noter").isHittable }, "the ordinary main window is hidden")
        XCTAssertTrue(recordPrompt.waitForExistence(timeout: 10), "the native record prompt is shown")
        assertVisibleNoterWindowsAreExcludedFromWindowCapture()

        recordPrompt.buttons["Record"].click()
        XCTAssertTrue(callWindow.waitForExistence(timeout: 10), "recording opens the native call panel")
        assertVisibleNoterWindowsAreExcludedFromWindowCapture()
    }

    private func assertVisibleNoterWindowsAreExcludedFromWindowCapture(file: StaticString = #filePath, line: UInt = #line) {
        let infos = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
        let processID = NSRunningApplication.runningApplications(withBundleIdentifier: "com.getahead.noter").first?.processIdentifier
        XCTAssertNotNil(processID, "the Noter test app is running", file: file, line: line)
        let ownWindows = infos.filter {
            ($0["kCGWindowOwnerPID"] as? Int) == Int(processID ?? -1)
        }
        let sharingStates = ownWindows.compactMap { $0["kCGWindowSharingState"] as? Int }
        XCTAssertFalse(sharingStates.isEmpty, "a visible Noter panel is in the window server list", file: file, line: line)
        XCTAssertTrue(sharingStates.allSatisfy { $0 == 0 }, "visible Noter panels are excluded from window capture", file: file, line: line)
    }
}
