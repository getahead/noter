// The standard windows open at DESIGN's sizes (cpt-noter-topology-ui-windows): without one, AppKit's default of
// 800×600 pixels is 400×300 pt on a Retina display, where Settings stacks its pane list over the pane.
import XCTest

final class WindowSizeTests: NoterTestCase {
    /// The window around the region with this VoiceOver label.
    func window(around label: String) -> XCUIElement {
        app.windows.containing(NSPredicate(format: "label == %@", label)).firstMatch
    }

    func test_cpt_noter_seq_settings_set_hotkeys__window_shows_pane_list_beside_pane() {
        launch("idle")
        XCTAssertTrue(app.groups["Sidebar"].waitForExistence(timeout: 10), "the main window did not load")
        app.typeKey(",", modifierFlags: .command)
        let settings = window(around: "Settings panes")
        XCTAssertTrue(settings.waitForExistence(timeout: 5), "Settings did not open")
        let size = settings.frame.size
        XCTAssertGreaterThanOrEqual(size.width, 700, "Settings is at least 700 pt wide")
        XCTAssertGreaterThanOrEqual(size.height, 480, "Settings is at least 480 pt high")
        let list = settings.descendants(matching: .any).matching(NSPredicate(format: "label == 'Settings panes'")).firstMatch
        let pane = settings.descendants(matching: .any).matching(NSPredicate(format: "label == 'General'"))
            .matching(NSPredicate(format: "elementType != %d", XCUIElement.ElementType.link.rawValue)).firstMatch
        XCTAssertTrue(pane.waitForExistence(timeout: 5), "no General pane")
        XCTAssertLessThanOrEqual(list.frame.maxX, pane.frame.minX, "the pane list sits beside the pane, not over it")
    }

    func test_cpt_noter_seq_first_run_complete_setup__window_opens_at_760_by_560() {
        launch(fixture: "none")
        let menu = openMenu()
        let finish = item("Finish Setup…", in: menu)
        if finish.exists { finish.click() } else { closeMenu() }
        let wizard = window(around: "Setup steps")
        XCTAssertTrue(wizard.waitForExistence(timeout: 10), "the first-run window did not open")
        XCTAssertEqual(wizard.frame.width, 760, accuracy: 1, "the first-run window is 760 pt wide")
        XCTAssertGreaterThanOrEqual(wizard.frame.height, 560, "the first-run window is at least 560 pt high")
    }
}
