// M1 notifications (docs/features/ui/notifications.md) and the call page that loads after a stop.
import XCTest

final class NotificationsTests: NoterTestCase {
    func test_cpt_noter_seq_notifications_allow_notifications__happy_path() {
        app.typeKey("3", modifierFlags: .command)
        app.staticTexts["Backend sync"].firstMatch.click()
        let allow = app.buttons["Notify Me When Summaries Are Ready"]
        XCTAssertTrue(allow.waitForExistence(timeout: 5))
        allow.click()
        XCTAssertTrue(allow.waitForNonExistence(timeout: 30), "the banner goes once macOS has answered")
    }

    func test_cpt_noter_seq_call_screen_stop_at_call_end__call_page_loads_without_taking_focus() {
        let other = XCUIApplication(bundleIdentifier: "com.apple.finder")
        other.activate()
        item("Stop Recording", in: openMenu()).click()
        XCTAssertEqual(other.state, .runningForeground, "the call page loads without activating Noter")
    }
}
