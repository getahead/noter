// M2 speakers (docs/features/ui/speakers.md): naming a speaker from the call screen, and the Edit menu's Fix Term….
import XCTest

final class SpeakersTests: NoterTestCase {
    /// Rename on the live call asks the core for the call window (`window_show_call`): it becomes the key panel while
    /// the call app keeps focus (the same request a second ⌃⌥⌘N makes), so the name field takes typing.
    func test_cpt_noter_seq_call_screen_name_speaker__call_window_becomes_key_panel_while_call_app_keeps_focus() {
        launch()
        other.activate()
        hotkey("n")
        XCTAssertTrue(callWindow.waitForExistence(timeout: 10), "⌃⌥⌘N shows the call window")
        other.activate()
        hotkey("n")
        XCTAssertTrue(waitUntil(10) { self.callWindow.value(forKey: "hasKeyboardFocus") as? Bool == true }, "the call window is the key panel")
        XCTAssertEqual(other.state, .runningForeground, "the call app keeps focus")
    }

    /// Fix Term… sits in the Edit menu and stays disabled while no confirmed words are selected.
    func test_cpt_noter_seq_call_screen_name_speaker__edit_menu_has_fix_term_disabled_without_a_selection() {
        launch()
        XCTAssertTrue(window("Noter").waitForExistence(timeout: 10))
        let fixTerm = app.menuBars.menuItems["Fix Term…"]
        XCTAssertTrue(fixTerm.exists, "the Edit menu has Fix Term…")
        XCTAssertFalse(fixTerm.isEnabled, "no selection, no Fix Term…")
    }
}
