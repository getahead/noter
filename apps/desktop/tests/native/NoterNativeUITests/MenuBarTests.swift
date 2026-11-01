// M1 menu bar extra (docs/features/ui/menu-bar.md): the menu per state and the controls on it.
import XCTest

// @cpt-dod:cpt-noter-dod-ui-menu-bar-native-tests:p2
final class MenuBarTests: NoterTestCase {
    func test_cpt_noter_seq_menu_bar_control_recording__mark_pause_resume_stop_continue() {
        launch("idle")
        startRecording()
        let menu = openMenu()
        assertItems(["Mark Moment", "Pause", "Stop Recording"], in: menu)
        item("Pause", in: menu).click()
        let paused = openMenu()
        assertItems(["Resume"], in: paused)
        item("Resume", in: paused).click()
        item("Stop Recording", in: openMenu()).click()
        assertItems(["Continue Recording"], in: openMenu())
    }

    func test_cpt_noter_seq_menu_bar_control_recording__paused_for_5_min() {
        launch("idle")
        startRecording()
        item("Pause", in: openMenu()).click()
        XCTAssertTrue(infoLine("Paused for 5 min", in: openMenu()).waitForExistence(timeout: 330))
    }

    func test_cpt_noter_seq_menu_bar_control_recording__quit_while_recording_alert() {
        launch("idle")
        startRecording()
        item("Quit Noter", in: openMenu()).click()
        XCTAssertTrue(alert.staticTexts["Quitting stops the recording. The transcript so far is kept."].waitForExistence(timeout: 5))
        XCTAssertTrue(alert.buttons["Cancel"].exists && alert.buttons["Stop and Quit"].exists)
    }

    func test_cpt_noter_seq_menu_bar_check_state__recording_lines_and_hotkeys() {
        launch("idle")
        startRecording()
        let menu = openMenu()
        assertItems(["Open Call Screen", "Hide for Presenting"], in: menu)
        XCTAssertEqual(keyOf("Open Call Screen"), "N", "Open Call Screen shows its hotkey ⌃⌥⌘N")
    }

    func test_cpt_noter_seq_menu_bar_check_state__not_recording_start_and_next_event() {
        launch("idle")
        let menu = openMenu()
        XCTAssertTrue(infoLine("Noter — Not recording", in: menu).exists, "the first line reads Noter — Not recording")
        assertItems(["Start Recording"], in: menu)
        XCTAssertEqual(keyOf("Start Recording"), "R", "Start Recording shows its hotkey ⌃⌥⌘R")
    }

    func test_cpt_noter_seq_menu_bar_check_state__switched_to_local() {
        launch("switched-to-local")
        XCTAssertTrue(infoLine("Switched to local", in: openMenu()).exists)
    }

    func test_cpt_noter_seq_menu_bar_check_state__setup_incomplete() {
        launch(fixture: "none")
        // A fresh data folder: setup has not run.
        let menu = openMenu()
        XCTAssertTrue(infoLine("Setup incomplete · call detection off", in: menu).exists)
        XCTAssertTrue(item("Finish Setup…", in: menu).exists)
        XCTAssertTrue(item("Start Recording", in: menu).isEnabled, "Start Recording works in every setup state")
    }

    func test_cpt_noter_seq_menu_bar_check_state__new_meeting_while_hidden() {
        launch("new-meeting")
        item("Hide for Presenting", in: openMenu()).click()
        XCTAssertTrue(infoLine("A new meeting may have started", in: openMenu()).waitForExistence(timeout: 10))
    }

    func test_cpt_noter_seq_menu_bar_check_state__glyph_per_state_and_hidden_badge() {
        launch()
        // The eye-slash badge is drawn in the image, which XCUITest cannot read reliably (two shots of the
        // same glyph differ by a few pixels); the VoiceOver label carries the hidden state.
        item("Hide for Presenting", in: openMenu()).click()
        XCTAssertTrue(item("Show Noter", in: openMenu()).exists)
        XCTAssertTrue(statusItem.label.contains("hidden for presenting"), "the VoiceOver label adds “hidden for presenting”")
    }

    func test_cpt_noter_seq_menu_bar_check_state__no_hotkey_shows_no_key() {
        // Not recording: the fixture's call screen takes a whole display (its layout for a chosen second display),
        // which on a one-display Mac covers Settings.
        launch("idle")
        XCTAssertTrue(openMenu().exists)
        XCTAssertEqual(keyOf("Open Call Screen"), "N", "before: Open Call Screen shows ⌃⌥⌘N")
        closeMenu()
        // Settings › Hotkeys: clear Open call screen.
        app.typeKey(",", modifierFlags: .command)
        let pane = app.staticTexts["Hotkeys"].firstMatch
        XCTAssertTrue(pane.waitForExistence(timeout: 5), "Settings did not open")
        pane.click()
        let field = app.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH 'Open call screen: ⌃⌥⌘N'")).firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        let clear = app.buttons.matching(NSPredicate(format: "label == 'Clear shortcut'")).allElementsBoundByIndex
            .min { abs($0.frame.midY - field.frame.midY) < abs($1.frame.midY - field.frame.midY) }
        XCTAssertNotNil(clear, "the row has no Clear shortcut button")
        clear?.click()
        XCTAssertTrue(app.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH 'Open call screen: None'")).firstMatch.waitForExistence(timeout: 5))
        XCTAssertTrue(openMenu().exists)
        XCTAssertNil(keyOf("Open Call Screen"), "an item whose hotkey is cleared shows no key")
    }

    func test_cpt_noter_flow_ui_menu_bar_start__start_recording_dimmed_below_500_mb() {
        launch("low-disk")
        let start = item("Start Recording", in: openMenu())
        XCTAssertTrue(start.exists)
        XCTAssertFalse(start.isEnabled, "Start Recording is dimmed while less than 500 MB are free")
    }

    func test_cpt_noter_flow_ui_menu_bar_start__open_items_open_only_their_windows() {
        launch("idle")
        startRecording()
        item("Open Call Screen", in: openMenu()).click()
        XCTAssertTrue(callWindow.waitForExistence(timeout: 5))
        item("Open Noter", in: openMenu()).click()
        XCTAssertTrue(window("Noter").waitForExistence(timeout: 5))
    }

    func test_cpt_noter_seq_record_prompt_record_after_missed_prompt__call_detected_start_recording() {
        launch("detected")
        let menu = openMenu()
        XCTAssertTrue(item("Call Detected · Start Recording", in: menu).exists)
        item("Call Detected · Start Recording", in: menu).click()
        XCTAssertTrue(recordingLine(in: openMenu()).waitForExistence(timeout: 5))
    }

    func test_cpt_noter_seq_call_screen_hide_for_presenting__hide_and_show_noter_items() {
        launch()
        item("Hide for Presenting", in: openMenu()).click()
        let hidden = openMenu()
        assertItems(["Show Noter"], in: hidden)
        item("Show Noter", in: hidden).click()
        assertItems(["Hide for Presenting"], in: openMenu())
    }
}
