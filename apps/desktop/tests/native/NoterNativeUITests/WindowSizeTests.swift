// The standard windows open at DESIGN's sizes (cpt-noter-topology-ui-windows): without one, AppKit's default of
// 800×600 pixels is 400×300 pt on a Retina display, where Settings stacks its pane list over the pane.
import XCTest
import CoreGraphics

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

    func test_cpt_noter_seq_settings_set_hotkeys__search_clears_native_titlebar_at_default_and_minimum_sizes() {
        launch("idle")
        XCTAssertTrue(app.groups["Sidebar"].waitForExistence(timeout: 10), "the main window did not load")
        app.typeKey(",", modifierFlags: .command)
        let settings = window(around: "Settings panes")
        XCTAssertTrue(settings.waitForExistence(timeout: 5), "Settings did not open")
        XCTAssertEqual(settings.frame.width, 820, accuracy: 8, "Settings opens at its 820 pt default width")
        XCTAssertEqual(settings.frame.height, 620, accuracy: 8, "Settings opens at its 620 pt default height")
        let search = settings.searchFields["Search"]
        let paneList = settings.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Settings panes")).firstMatch
        let pane = settings.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "General"))
            .matching(NSPredicate(format: "elementType != %d", XCUIElement.ElementType.link.rawValue)).firstMatch
        // AppKit exposes overlay titlebar controls through the app query, not as children of
        // the webview window. Select the controls whose actual hit frames belong to Settings.
        let settingsTrafficLights = ["_XCUI:CloseWindow", "_XCUI:MinimizeWindow", "_XCUI:FullScreenWindow"].compactMap { identifier in
            app.buttons.matching(identifier: identifier).allElementsBoundByIndex.first { settings.frame.contains($0.frame) }
        }
        XCTAssertTrue(search.waitForExistence(timeout: 5), "the Settings search field is accessible")
        XCTAssertEqual(settingsTrafficLights.count, 3, "the Settings window exposes all three native traffic light hit targets")

        func assertHeaderHitTargetsClear(_ size: String, expectedSearchWidth: CGFloat) {
            for trafficLight in settingsTrafficLights {
                XCTAssertFalse(search.frame.intersects(trafficLight.frame), "Settings search clears the native traffic light hit target at \(size)")
            }
            XCTAssertEqual(search.frame.width, expectedSearchWidth, accuracy: 14, "the search input fills its available pane width at \(size)")
        }
        func verifySearchInput() {
            XCTAssertTrue(search.isHittable, "the Settings search target can receive a pointer click")
            search.click()
            let query = "not-a-settings-pane"
            search.typeText(query)
            XCTAssertTrue(waitUntil(5) { (search.value as? String) == query }, "clicking the field gives it keyboard focus and typing updates the full search query")
            search.typeKey("a", modifierFlags: .command)
            search.typeKey(.delete, modifierFlags: [])
            XCTAssertTrue(waitUntil(5) { (search.value as? String) == "" }, "the search remains editable after clearing its text")
            XCTAssertTrue(pane.waitForExistence(timeout: 5), "clearing the query restores the Settings pane content")
        }

        XCTAssertTrue(paneList.waitForExistence(timeout: 5) && pane.waitForExistence(timeout: 5), "Settings renders both its pane list and content pane")
        XCTAssertLessThanOrEqual(paneList.frame.maxX, pane.frame.minX, "the default pane list remains beside the content pane")
        XCTAssertEqual(paneList.frame.width, 200, accuracy: 6, "the default ST-R1 pane keeps its specified 200 pt width")
        // 200 pt pane minus 16 pt pane padding, 1 pt border, pill padding, glyph and gap leaves 146 pt for input.
        assertHeaderHitTargetsClear("820×620 default", expectedSearchWidth: paneList.frame.width - 54)
        attachSettingsScreenshot("settings-search-titlebar-default")
        verifySearchInput()

        let lowerRight = settings.coordinate(withNormalizedOffset: CGVector(dx: 1, dy: 1))
        lowerRight.press(forDuration: 0.1, thenDragTo: lowerRight.withOffset(CGVector(dx: -120, dy: -140)))
        XCTAssertTrue(waitUntil(5) { abs(settings.frame.width - 700) <= 8 && abs(settings.frame.height - 480) <= 8 }, "Settings can resize to its 700×480 minimum")
        XCTAssertLessThanOrEqual(paneList.frame.maxY, pane.frame.minY, "the narrow pane list stacks above, rather than overlaps, the content pane")
        XCTAssertGreaterThanOrEqual(paneList.frame.width, 680, "the narrow ST-R1 pane uses the available Settings width")
        // At the stacked width, ST-R1 has no right border: full pane width minus horizontal paddings and search chrome.
        assertHeaderHitTargetsClear("700×480 minimum", expectedSearchWidth: paneList.frame.width - 53)
        attachSettingsScreenshot("settings-search-titlebar-minimum")
        verifySearchInput()
    }

    private func attachSettingsScreenshot(_ name: String) {
        let environment = ProcessInfo.processInfo.environment
        let build = environment["NOTER_BUILD_SHA"] ?? environment["TEST_RUNNER_NOTER_BUILD_SHA"] ?? environment["GITHUB_SHA"] ?? "unset"
        let globalAppearance = UserDefaults.standard.persistentDomain(forName: UserDefaults.globalDomain)?["AppleInterfaceStyle"] as? String
        let appearance = globalAppearance == "Dark" ? "Dark" : "Light"
        let display = CGMainDisplayID()
        let bounds = CGDisplayBounds(display)
        let scale = bounds.width > 0 ? Double(CGDisplayPixelsWide(display)) / bounds.width : 0
        let metadata = XCTAttachment(string: "build_sha=\(build)\nos=\(ProcessInfo.processInfo.operatingSystemVersionString)\nappearance=\(appearance)\nscale=\(scale)x")
        metadata.name = "\(name)-environment"
        metadata.lifetime = .keepAlways
        add(metadata)
        let screenshot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        screenshot.name = name
        screenshot.lifetime = .keepAlways
        add(screenshot)
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
