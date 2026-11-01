// M1 call window (docs/features/ui/call-window.md): hotkeys, hiding for presenting, the panel on a display change.
import AppKit
import XCTest

final class CallWindowTests: NoterTestCase {
    func test_cpt_noter_seq_floating_panel_hide_and_reopen__hotkey_shows_without_focus() {
        launch()
        other.activate()
        hotkey("n")
        XCTAssertTrue(callWindow.waitForExistence(timeout: 5), "⌃⌥⌘N shows the call window")
        XCTAssertEqual(other.state, .runningForeground, "it shows without taking focus")
    }

    func test_cpt_noter_seq_floating_panel_hide_and_reopen__click_keeps_focus() {
        launch()
        other.activate()
        hotkey("n")
        XCTAssertTrue(callWindow.waitForExistence(timeout: 5), "⌃⌥⌘N shows the call window")
        clickKeepingFocus(callWindow)
        XCTAssertEqual(other.state, .runningForeground, "no click on the call window moves focus from the call app")
    }

    func test_cpt_noter_seq_call_screen_hide_for_presenting__hotkey_hides_and_restores_every_surface() {
        launch()
        hotkey("n")
        XCTAssertTrue(callWindow.waitForExistence(timeout: 5))
        XCTAssertTrue(window("Noter").exists)
        hotkey("0")
        XCTAssertTrue(callWindow.waitForNonExistence(timeout: 5))
        XCTAssertTrue(window("Noter").waitForNonExistence(timeout: 5))
        hotkey("0")
        XCTAssertTrue(window("Noter").waitForExistence(timeout: 5))
        XCTAssertTrue(callWindow.waitForExistence(timeout: 5))
    }

    func test_cpt_noter_seq_call_screen_stop_at_call_end__hidden_for_presenting_menu_carries_notice() {
        launch("call-seems-ended")
        XCTAssertTrue(infoLine("Call seems to have ended", in: openMenu()).waitForExistence(timeout: 10))
    }

    func test_cpt_noter_seq_floating_panel_display_unplugged__panel_lands_inside_remaining_display() {
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
}
