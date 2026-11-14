// M1 notifications (docs/features/ui/notifications.md) and the call page that loads after a stop.
import XCTest

final class NotificationsTests: NoterTestCase {
    // @cpt-dod:cpt-noter-dod-ui-notifications-permission:p2
    func test_notifications_banner_dismisses_after_harness_permission_answer() {
        // The banner follows the first recorded call: the library holds only “Backend sync”.
        launch("first-call")
        openCall("Backend sync")
        app.typeKey(.return, modifierFlags: [])
        let allow = app.buttons["Notify Me When Summaries Are Ready"]
        XCTAssertTrue(allow.waitForExistence(timeout: 10), "the call page offers notifications after the first call")
        allow.click()
        XCTAssertTrue(allow.waitForNonExistence(timeout: 30), "the banner goes once macOS has answered")
    }

    func test_stop_recording_from_menu_keeps_focus() {
        launch("idle")
        startRecording()
        let main = window("Noter")
        XCTAssertTrue(main.waitForExistence(timeout: 5))
        other.activate()
        clickKeepingFocus(statusItem)
        let stop = item("Stop Recording", in: statusItem.menus.firstMatch)
        XCTAssertTrue(stop.waitForExistence(timeout: 5), "the menu did not open")
        XCTAssertTrue(waitUntil(3) { self.other.state == .runningForeground }, "opening the menu bar extra keeps the call app in front")
        clickKeepingFocus(stop)
        var start = item("Start Recording", in: openMenu())
        for _ in 0..<5 where !start.waitForExistence(timeout: 1) {
            closeMenu()
            start = item("Start Recording", in: openMenu())
        }
        XCTAssertTrue(start.waitForExistence(timeout: 2), "stopping returns the menu to its not-recording state")
        XCTAssertTrue(waitUntil(3) { self.other.state == .runningForeground }, "stopping from the menu keeps focus on the other app")
    }
}
