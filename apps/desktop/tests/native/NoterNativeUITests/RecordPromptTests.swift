// M1 record prompt (docs/features/ui/record-prompt.md): a non-activating panel that takes the hotkey, not the focus.
import XCTest

final class RecordPromptTests: NoterTestCase {
    // @cpt-dod:cpt-noter-dod-ui-record-prompt-panel:p2
    func test_cpt_noter_seq_record_prompt_start_recording__hotkey_keeps_focus() {
        launch("detected")
        other.activate()
        XCTAssertTrue(recordPrompt.waitForExistence(timeout: 10), "no record prompt")
        hotkey("r")
        XCTAssertEqual(other.state, .runningForeground, "the prompt never takes focus from the call app")
        XCTAssertTrue(recordingLine(in: openMenu()).waitForExistence(timeout: 5))
    }

    func test_cpt_noter_seq_record_prompt_record_after_missed_prompt__hotkey_records() {
        launch("detected")
        XCTAssertTrue(item("Call Detected · Start Recording", in: openMenu()).exists)
        closeMenu()
        hotkey("r")
        XCTAssertTrue(recordingLine(in: openMenu()).waitForExistence(timeout: 5))
    }
}
