// M1 dialogs (docs/features/ui/dialogs-host.md): the native alerts have Cancel as the default button.
import XCTest

final class DialogsTests: NoterTestCase {
    func test_cpt_noter_seq_dialogs_delete_call__error_return_pressed_by_habit() {
        // Nothing recording: the live call's window would cover the library (its fixture display is not this Mac's).
        launch("idle")
        openCall("Backend sync")
        app.typeKey(.delete, modifierFlags: .command)
        let cancel = alert.buttons["Cancel"]
        XCTAssertTrue(cancel.waitForExistence(timeout: 5), "Delete Call… shows no alert")
        app.typeKey(.return, modifierFlags: [])
        XCTAssertTrue(alert.waitForNonExistence(timeout: 5), "Return closes the alert")
        XCTAssertTrue(cancel.waitForNonExistence(timeout: 5), "Return presses the default button, which is Cancel")
        XCTAssertTrue(app.staticTexts["Backend sync"].firstMatch.exists, "Return chose Cancel: the call is kept")
    }

    func test_cpt_noter_seq_dialogs_delete_call__other_several_calls_selected() {
        // Nothing recording: the live call's window would cover the library (its fixture display is not this Mac's).
        launch("idle")
        openCall("Backend sync")
        app.typeKey("a", modifierFlags: .command)
        app.typeKey(.delete, modifierFlags: .command)
        XCTAssertTrue(alert.staticTexts.matching(NSPredicate(format: "value BEGINSWITH 'Delete' AND value ENDSWITH 'calls?'")).firstMatch.waitForExistence(timeout: 5))
        XCTAssertTrue(alert.buttons["Cancel"].isEnabled)
        app.typeKey(.return, modifierFlags: [])
        XCTAssertTrue(alert.waitForNonExistence(timeout: 5))
    }

    func test_cpt_noter_seq_menu_bar_control_recording__repeated_quit_keeps_one_alert() {
        launch("idle")
        startRecording()
        closeMenu()
        app.typeKey("q", modifierFlags: .command)
        XCTAssertTrue(alert.buttons["Cancel"].waitForExistence(timeout: 5))
        let cancelButtons = app.buttons.matching(identifier: "Cancel")
        app.typeKey("q", modifierFlags: .command)
        XCTAssertEqual(cancelButtons.count, 1, "a repeated quit request must not queue another alert")
        alert.buttons["Cancel"].click()
        XCTAssertTrue(waitUntil(5) { cancelButtons.count == 0 }, "Cancel should close the only quit alert")
        XCTAssertTrue(recordingLine(in: openMenu()).exists, "Cancel keeps the recording active")
    }

    func test_cpt_noter_seq_menu_bar_control_recording__macos_terminate_uses_quit_alert() {
        let terminate = FileManager.default.temporaryDirectory.appendingPathComponent("noter-terminate-\(UUID().uuidString)")
        app.launchEnvironment["NOTER_TEST_TERMINATE_APP_FILE"] = terminate.path
        defer { try? FileManager.default.removeItem(at: terminate) }
        launch("idle")
        startRecording()
        closeMenu()
        XCTAssertTrue(FileManager.default.createFile(atPath: terminate.path, contents: nil), "could not request AppKit termination")
        XCTAssertTrue(alert.buttons["Stop and Quit"].waitForExistence(timeout: 10), "the system quit path must ask before stopping a recording")
        alert.buttons["Cancel"].click()
        XCTAssertTrue(waitUntil(5) { app.state == .runningForeground }, "Cancel should leave Noter running")
    }

    func test_cpt_noter_seq_menu_bar_control_recording__quit_while_recording() {
        launch("idle")
        startRecording()
        // ⌘Q while no menu is open: an open status menu takes the keys.
        closeMenu()
        app.typeKey("q", modifierFlags: .command)
        XCTAssertTrue(alert.buttons["Stop and Quit"].waitForExistence(timeout: 5))
        app.typeKey(.return, modifierFlags: [])
        XCTAssertTrue(alert.waitForNonExistence(timeout: 5), "Return closes the alert")
        XCTAssertTrue(recordingLine(in: openMenu()).exists, "Return chose Cancel: the recording goes on")
    }
}
