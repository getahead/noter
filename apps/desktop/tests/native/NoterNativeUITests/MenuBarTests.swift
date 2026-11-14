// M1 menu bar extra (docs/features/ui/menu-bar.md): the menu per state and the controls on it.
import XCTest

// @cpt-dod:cpt-noter-dod-ui-menu-bar-native-tests:p2
final class MenuBarTests: NoterTestCase {
    func test_cpt_noter_seq_menu_bar_control_recording__main_window_close_reopen_keeps_running_and_size() {
        launch("idle")
        let main = window("Noter")
        XCTAssertTrue(app.groups["Sidebar"].waitForExistence(timeout: 10), "the main window did not load")
        let originalFrame = main.frame
        app.typeKey("w", modifierFlags: .command)
        XCTAssertTrue(statusItem.waitForExistence(timeout: 5), "closing the main window leaves the menu bar extra available")
        XCTAssertTrue(waitUntil(5) { !main.isHittable }, "closing the main window should hide it")
        let menu = openMenu()
        item("Open Noter", in: menu).click()
        XCTAssertTrue(app.groups["Sidebar"].waitForExistence(timeout: 10), "Open Noter did not restore the main window")
        XCTAssertTrue(waitUntil(5) { main.isHittable }, "Open Noter should make the main window visible again")
        XCTAssertEqual(main.frame, originalFrame, "reopening should preserve the window frame")
    }

    func test_cpt_noter_seq_menu_bar_control_recording__mark_pause_resume_stop_continue() {
        launch("idle")
        startRecording()
        let main = window("Noter")
        XCTAssertTrue(main.waitForExistence(timeout: 5))
        app.typeKey("w", modifierFlags: .command)
        XCTAssertTrue(waitUntil(5) { !main.isHittable }, "the main window is hidden before opening the call panel")
        press("n")
        XCTAssertTrue(callWindow.waitForExistence(timeout: 5), "the call panel opens for Mark Moment feedback")
        XCTAssertTrue(callWindow.buttons["Hide"].waitForExistence(timeout: 5), "the call panel has loaded its page")
        let menu = openMenu()
        assertItems(["Mark Moment", "Pause", "Stop Recording"], in: menu)
        XCTAssertFalse(accessibilityTreeContains("Marked ", in: callWindow), "there is no mark feedback before Mark Moment is clicked")
        item("Mark Moment", in: menu).click()
        let markedButton = callWindow.buttons.matching(NSPredicate(format: "label CONTAINS 'Marked '")).firstMatch
        XCTAssertTrue(markedButton.waitForExistence(timeout: 5), "Mark Moment shows its timestamp on the call window")
        let reopened = openMenu()
        item("Pause", in: reopened).click()
        let paused = openMenu()
        assertItems(["Resume"], in: paused)
        item("Resume", in: paused).click()
        XCTAssertTrue(recordingLine(in: openMenu()).waitForExistence(timeout: 5), "Resume returns the menu to Recording")
        item("Stop Recording", in: openMenu()).click()
        assertItems(["Continue Recording"], in: openMenu())
    }

    func test_cpt_noter_seq_menu_bar_control_recording__paused_for_5_min() {
        // Core tests prove the deadline; the native test proves the real menu at that deadline.
        launch("paused-5-min")
        XCTAssertTrue(infoLine("Paused for 5 min", in: openMenu()).waitForExistence(timeout: 5))
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

    // @cpt-flow:cpt-noter-flow-ui-today-review:p1
    func test_cpt_noter_seq_today_review_before_call__menu_next_is_disabled() {
        app.launchEnvironment["NOTER_TEST_CLOCK"] = "fixed"
        launch("idle")
        // The calendar is read a few seconds after launch; an open menu does not follow a rebuild,
        // so reopen it until the line is there.
        let deadline = Date().addingTimeInterval(30)
        var next = infoLine("Next: 1:1 with Anna K. 12:30", in: openMenu(timeout: 10))
        while true {
            let wait = deadline.timeIntervalSinceNow
            if wait <= 0 || next.waitForExistence(timeout: min(1, wait)) { break }
            closeMenu()
            let remaining = deadline.timeIntervalSinceNow
            if remaining <= 0 { break }
            next = infoLine("Next: 1:1 with Anna K. 12:30", in: openMenu(timeout: min(10, remaining)))
        }
        XCTAssertTrue(next.waitForExistence(timeout: 2))
        XCTAssertFalse(next.isEnabled, "Next is calendar information, not a recording action")
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
        let field = app.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH 'Open call screen: shortcut Control-Option-Command-N'")).firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        let clear = app.buttons.matching(NSPredicate(format: "label == 'Clear shortcut'")).allElementsBoundByIndex
            .min { abs($0.frame.midY - field.frame.midY) < abs($1.frame.midY - field.frame.midY) }
        XCTAssertNotNil(clear, "the row has no Clear shortcut button")
        clear?.click()
        XCTAssertTrue(app.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH 'Open call screen: shortcut None'")).firstMatch.waitForExistence(timeout: 5))
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
        let main = window("Noter")
        XCTAssertTrue(main.waitForExistence(timeout: 5))
        // Close the main window while it is the foreground window; the non-activating call panel
        // must not receive Command-W in its place.
        app.typeKey("w", modifierFlags: .command)
        XCTAssertTrue(waitUntil(5) { !main.isHittable }, "closing hides the main window")
        XCTAssertTrue(statusItem.waitForExistence(timeout: 5), "closing the main window leaves the menu bar extra available")
        item("Open Call Screen", in: openMenu()).click()
        XCTAssertTrue(callWindow.waitForExistence(timeout: 5))
        XCTAssertFalse(main.isHittable, "opening the call panel does not restore the main window")
        let menu = openMenu()
        XCTAssertFalse(main.isHittable, "opening the menu does not itself restore the main window")
        let openNoter = item("Open Noter", in: menu)
        XCTAssertTrue(openNoter.waitForExistence(timeout: 5), "the menu offers Open Noter after the main window closes")
        openNoter.click()
        XCTAssertTrue(waitUntil(5) { main.isHittable }, "Open Noter shows the hidden main window")
        XCTAssertTrue(callWindow.waitForExistence(timeout: 5), "Open Noter leaves the call panel open")
    }

    /// With notifications denied the menu bar still shows a ready summary: Open Last Summary names the latest call
    /// whose outputs are ready and opens its Summary in the main window.
    func test_cpt_noter_flow_ui_menu_bar_start__open_last_summary_opens_the_latest_ready_summary() {
        launch("idle")
        let main = window("Noter")
        XCTAssertTrue(main.waitForExistence(timeout: 5))
        app.typeKey("w", modifierFlags: .command)
        XCTAssertTrue(waitUntil(5) { !main.isHittable }, "the main window is hidden before Open Last Summary")
        let last = openMenu().menuItems.matching(NSPredicate(format: "title BEGINSWITH 'Open Last Summary — '")).firstMatch
        XCTAssertTrue(last.waitForExistence(timeout: 10), "the menu offers Open Last Summary for the call with ready outputs")
        last.click()
        XCTAssertTrue(main.waitForExistence(timeout: 5))
        XCTAssertTrue(waitUntil(5) { main.isHittable }, "Open Last Summary shows the hidden main window")
        XCTAssertTrue(waitUntil(5) { accessibilityTreeContains("Backend sync", in: main) }, "the selected call is the latest ready summary")
        let summaryTab = app.buttons["Summary"]
        let summaryPopup = app.descendants(matching: .any).matching(NSPredicate(format: "label == 'Call page view'")).firstMatch
        XCTAssertTrue(waitUntil(5) {
            (summaryTab.exists && summaryTab.isSelected)
                || (summaryPopup.exists && ((summaryPopup.value as? String) == "Summary" || summaryPopup.title == "Summary"))
        }, "Open Last Summary selects the Summary view")
    }

    func test_hidden_state_voiceover_label_and_hide_show_menu_items() {
        launch()
        item("Hide for Presenting", in: openMenu()).click()
        let hidden = openMenu()
        assertItems(["Show Noter"], in: hidden)
        XCTAssertTrue(statusItem.label.contains("hidden for presenting"), "the VoiceOver label adds hidden state")
        item("Show Noter", in: hidden).click()
        assertItems(["Hide for Presenting"], in: openMenu())
    }
}
