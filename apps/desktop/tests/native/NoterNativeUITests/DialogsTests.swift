// M1 dialogs (docs/features/ui/dialogs-host.md): the native alerts have Cancel as the default button.
import XCTest

final class DialogsTests: NoterTestCase {
    func test_cpt_noter_seq_dialogs_delete_call__error_return_pressed_by_habit() {
        openCall("Backend sync")
        app.typeKey(.delete, modifierFlags: .command)
        XCTAssertTrue(alert.buttons["Cancel"].waitForExistence(timeout: 5), "Delete Call… shows no alert")
        app.typeKey(.return, modifierFlags: [])
        XCTAssertFalse(alert.exists, "Return closes the alert")
        XCTAssertTrue(app.staticTexts["Backend sync"].firstMatch.exists, "Return chose Cancel: the call is kept")
    }

    func test_cpt_noter_seq_dialogs_delete_call__other_several_calls_selected() {
        openCall("Backend sync")
        app.typeKey("a", modifierFlags: .command)
        app.typeKey(.delete, modifierFlags: .command)
        XCTAssertTrue(alert.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Delete' AND label ENDSWITH 'calls?'")).firstMatch.waitForExistence(timeout: 5))
        XCTAssertTrue(alert.buttons["Cancel"].isEnabled)
        app.typeKey(.return, modifierFlags: [])
        XCTAssertFalse(alert.exists)
    }

    func test_cpt_noter_seq_dialogs_delete_call__alert_has_cancel_as_default() {
        openCall("Backend sync")
        app.typeKey(.delete, modifierFlags: .command)
        let cancel = alert.buttons["Cancel"]
        XCTAssertTrue(cancel.waitForExistence(timeout: 5))
        app.typeKey(.return, modifierFlags: [])
        XCTAssertTrue(cancel.waitForNonExistence(timeout: 5), "Return presses the default button, which is Cancel")
        XCTAssertTrue(app.staticTexts["Backend sync"].firstMatch.exists)
    }

    func test_cpt_noter_seq_menu_bar_control_recording__quit_while_recording() {
        startRecording()
        app.typeKey("q", modifierFlags: .command)
        XCTAssertTrue(alert.buttons["Stop and Quit"].waitForExistence(timeout: 5))
        app.typeKey(.return, modifierFlags: [])
        XCTAssertTrue(alert.waitForNonExistence(timeout: 5), "Return closes the alert")
        XCTAssertTrue(recordingLine(in: openMenu()).exists, "Return chose Cancel: the recording goes on")
    }
}
