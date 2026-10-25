// M1 record prompt (docs/features/ui/record-prompt.md): a non-activating panel that takes the hotkey, not the focus.
import XCTest

final class RecordPromptTests: NoterTestCase {
    func test_cpt_noter_seq_record_prompt_start_recording__hotkey_keeps_focus() {
        let other = XCUIApplication(bundleIdentifier: "com.apple.finder")
        other.activate()
        XCTAssertTrue(app.dialogs.matching(NSPredicate(format: "label == 'Record this call?'")).firstMatch.waitForExistence(timeout: 10), "no record prompt")
        hotkey("r")
        XCTAssertEqual(other.state, .runningForeground, "the prompt never takes focus from the call app")
        XCTAssertTrue(openMenu().staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Recording'")).firstMatch.exists)
    }

    func test_cpt_noter_seq_record_prompt_record_after_missed_prompt__hotkey_records() {
        XCTAssertTrue(openMenu().staticTexts.matching(NSPredicate(format: "label CONTAINS 'call detected'")).firstMatch.exists)
        app.typeKey(.escape, modifierFlags: [])
        hotkey("r")
        XCTAssertTrue(openMenu().staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Recording'")).firstMatch.waitForExistence(timeout: 5))
    }
}
