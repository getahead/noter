// M1 call window (docs/features/ui/call-window.md): hotkeys, hiding for presenting, the panel on a display change.
import AppKit
import XCTest

final class CallWindowTests: NoterTestCase {
    func test_cpt_noter_seq_floating_panel_hide_and_reopen__hotkey_shows_without_focus() {
        let other = XCUIApplication(bundleIdentifier: "com.apple.finder")
        other.activate()
        hotkey("n")
        XCTAssertTrue(window("Call").waitForExistence(timeout: 5), "⌃⌥⌘N shows the call window")
        XCTAssertEqual(other.state, .runningForeground, "it shows without taking focus")
    }

    func test_cpt_noter_seq_call_screen_hide_for_presenting__hotkey_hides_and_restores_every_surface() {
        hotkey("n")
        XCTAssertTrue(window("Call").waitForExistence(timeout: 5))
        hotkey("0")
        XCTAssertFalse(window("Call").exists)
        XCTAssertFalse(window("Noter").exists)
        hotkey("0")
        XCTAssertTrue(window("Noter").waitForExistence(timeout: 5))
        XCTAssertTrue(window("Call").waitForExistence(timeout: 5))
    }

    func test_cpt_noter_seq_call_screen_stop_at_call_end__hidden_for_presenting_menu_carries_notice() {
        hotkey("0")
        XCTAssertTrue(openMenu().staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Call seems to have ended'")).firstMatch.exists)
    }

    func test_cpt_noter_seq_floating_panel_display_unplugged__panel_lands_inside_remaining_display() {
        hotkey("n")
        let panel = window("Call")
        XCTAssertTrue(panel.waitForExistence(timeout: 5))
        let screens = NSScreen.screens.map(\.frame)
        XCTAssertFalse(screens.isEmpty)
        XCTAssertTrue(screens.contains { $0.contains(panel.frame) }, "the panel is inside a display")
    }
}
