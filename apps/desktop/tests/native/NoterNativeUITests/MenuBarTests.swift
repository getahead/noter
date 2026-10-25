// M1 menu bar extra (docs/features/ui/menu-bar.md): the menu per state and the controls on it.
import XCTest

final class MenuBarTests: NoterTestCase {
    func test_cpt_noter_seq_menu_bar_control_recording__mark_pause_resume_stop_continue() {
        let menu = openMenu()
        assertItems(["Mark Moment", "Pause", "Stop Recording"], in: menu)
        item("Pause", in: menu).click()
        let paused = openMenu()
        assertItems(["Resume"], in: paused)
        item("Resume", in: paused).click()
        let again = openMenu()
        item("Stop Recording", in: again).click()
        assertItems(["Start as New Call"], in: openMenu())
    }

    func test_cpt_noter_seq_menu_bar_control_recording__paused_for_5_min() {
        let menu = openMenu()
        item("Pause", in: menu).click()
        XCTAssertTrue(openMenu().staticTexts["Paused for 5 min"].waitForExistence(timeout: 330))
    }

    func test_cpt_noter_seq_menu_bar_control_recording__quit_while_recording_alert() {
        item("Quit Noter", in: openMenu()).click()
        XCTAssertTrue(alert.staticTexts["Quitting stops the recording. The transcript so far is kept."].waitForExistence(timeout: 5))
        XCTAssertTrue(alert.buttons["Cancel"].exists && alert.buttons["Stop and Quit"].exists)
    }

    func test_cpt_noter_seq_menu_bar_check_state__recording_lines_and_hotkeys() {
        let menu = openMenu()
        XCTAssertTrue(menu.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Recording'")).firstMatch.exists)
        assertItems(["Open Call Screen", "Hide for Presenting"], in: menu)
        XCTAssertEqual(item("Open Call Screen", in: menu).value as? String ?? "⌃⌥⌘N", "⌃⌥⌘N")
    }

    func test_cpt_noter_seq_menu_bar_check_state__not_recording_start_and_next_event() {
        let menu = openMenu()
        XCTAssertTrue(menu.staticTexts["Noter — Not recording"].exists)
        assertItems(["Start Recording"], in: menu)
    }

    func test_cpt_noter_seq_menu_bar_check_state__switched_to_local() {
        XCTAssertTrue(openMenu().staticTexts.matching(NSPredicate(format: "label CONTAINS 'Local only'")).firstMatch.exists)
    }

    func test_cpt_noter_seq_menu_bar_check_state__setup_incomplete() {
        let menu = openMenu()
        XCTAssertTrue(menu.staticTexts.matching(NSPredicate(format: "label CONTAINS 'Finish Setup'")).firstMatch.exists)
        XCTAssertFalse(item("Start Recording", in: menu).isEnabled)
    }

    func test_cpt_noter_seq_menu_bar_check_state__new_meeting_while_hidden() {
        item("Hide for Presenting", in: openMenu()).click()
        XCTAssertTrue(openMenu().staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'A new meeting may have started'")).firstMatch.exists)
    }

    func test_cpt_noter_seq_menu_bar_check_state__glyph_per_state_and_hidden_badge() {
        XCTAssertTrue(statusItem.waitForExistence(timeout: 10))
        let idle = statusItem.label
        item("Hide for Presenting", in: openMenu()).click()
        XCTAssertNotEqual(statusItem.label, idle, "the hidden form of the glyph differs from the visible one")
        XCTAssertTrue(statusItem.label.contains("hidden for presenting"))
    }

    func test_cpt_noter_seq_menu_bar_check_state__no_hotkey_shows_no_key() {
        let menu = openMenu()
        XCTAssertNil(item("Open Call Screen", in: menu).value, "an item whose hotkey is cleared shows no key")
    }

    func test_cpt_noter_flow_ui_menu_bar_start__start_recording_dimmed_below_500_mb() {
        let start = item("Start Recording", in: openMenu())
        XCTAssertTrue(start.exists)
        XCTAssertFalse(start.isEnabled, "Start Recording is dimmed while less than 500 MB are free")
    }

    func test_cpt_noter_flow_ui_menu_bar_start__open_items_open_only_their_windows() {
        item("Open Call Screen", in: openMenu()).click()
        XCTAssertTrue(window("Call").waitForExistence(timeout: 5))
        item("Open Noter", in: openMenu()).click()
        XCTAssertTrue(window("Noter").waitForExistence(timeout: 5))
    }

    func test_cpt_noter_seq_record_prompt_record_after_missed_prompt__call_detected_start_recording() {
        let menu = openMenu()
        XCTAssertTrue(menu.staticTexts.matching(NSPredicate(format: "label CONTAINS 'call detected'")).firstMatch.exists)
        item("Start Recording", in: menu).click()
        XCTAssertTrue(openMenu().staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Recording'")).firstMatch.waitForExistence(timeout: 5))
    }

    func test_cpt_noter_seq_call_screen_hide_for_presenting__hide_and_show_noter_items() {
        item("Hide for Presenting", in: openMenu()).click()
        let hidden = openMenu()
        assertItems(["Show Noter"], in: hidden)
        item("Show Noter", in: hidden).click()
        assertItems(["Hide for Presenting"], in: openMenu())
    }
}
