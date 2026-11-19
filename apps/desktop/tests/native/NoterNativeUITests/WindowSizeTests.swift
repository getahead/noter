// The standard windows open at DESIGN's sizes (cpt-noter-topology-ui-windows): without one, AppKit's default of
// 800×600 pixels is 400×300 pt on a Retina display, where Settings stacks its pane list over the pane.
import XCTest
import CoreGraphics

final class WindowSizeTests: NoterTestCase {
    // @cpt-begin:cpt-noter-algo-core-native-surfaces-placement:p1:inst-frame
    func test_cpt_noter_seq_menu_bar_control_recording__main_frame_survives_relaunch() throws {
        launch("idle")
        XCTAssertTrue(app.groups["Sidebar"].waitForExistence(timeout: 10), "the main window did not load")
        let main = window("Noter")
        let initial = main.frame
        func moveMain(to origin: CGPoint) {
            for _ in 0..<3 {
                let frame = main.frame
                if abs(frame.minX - origin.x) <= 3 && abs(frame.minY - origin.y) <= 3 { break }
                // The blank sidebar titlebar is a native drag region, clear of the traffic lights.
                let title = main.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: 110, dy: 14))
                title.hover()
                title.click(forDuration: 0.1, thenDragTo: title.withOffset(CGVector(dx: origin.x - frame.minX, dy: origin.y - frame.minY)))
                _ = waitUntil(1) { abs(main.frame.minX - origin.x) <= 3 && abs(main.frame.minY - origin.y) <= 3 }
            }
        }
        func resizeEdge(horizontal: Bool, to target: CGFloat) {
            for _ in 0..<3 {
                let frame = main.frame
                let current = horizontal ? frame.width : frame.height
                if abs(current - target) <= 8 { break }
                let edge = main.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(
                    dx: horizontal ? frame.width - 1 : frame.width / 2,
                    dy: horizontal ? frame.height / 2 : frame.height - 1))
                edge.hover()
                edge.click(forDuration: 0.1, thenDragTo: edge.withOffset(CGVector(
                    dx: horizontal ? target - current : 0,
                    dy: horizontal ? 0 : target - current)))
                _ = waitUntil(1) { abs((horizontal ? main.frame.width : main.frame.height) - target) <= 8 }
            }
        }
        // CI's 1024 pt display opens this window flush to both sides. Move it first so the
        // right resize border is reachable; the initial frame also bounds the final placement.
        moveMain(to: CGPoint(x: initial.minX - 40, y: initial.minY))
        resizeEdge(horizontal: true, to: 1000)
        XCTAssertTrue(waitUntil(5) { abs(main.frame.width - 1000) <= 8 }, "the user resized the main window; actual=\(main.frame)")
        let targetHeight = min(700, initial.height - 40)
        resizeEdge(horizontal: false, to: targetHeight)
        XCTAssertTrue(waitUntil(5) { abs(main.frame.height - targetHeight) <= 8 }, "the user changed the main window height; actual=\(main.frame), target=\(targetHeight)")
        XCTAssertLessThan(main.frame.height, initial.height - 8, "the test genuinely resized the height")
        let beforeMove = main.frame
        moveMain(to: CGPoint(x: initial.minX + min(12, (initial.width - main.frame.width) / 2),
                             y: initial.minY + min(20, (initial.height - main.frame.height) / 2)))
        XCTAssertTrue(waitUntil(5) { main.frame.origin != beforeMove.origin }, "the user moved the main window")
        XCTAssertTrue(initial.contains(main.frame), "the saved frame fits the known visible initial frame")
        let expected = main.frame
        app.typeKey("q", modifierFlags: .command)
        XCTAssertTrue(app.wait(for: .notRunning, timeout: 10), "normal Quit finishes before relaunch")
        launch("idle")
        XCTAssertTrue(app.groups["Sidebar"].waitForExistence(timeout: 10), "the main window did not reload")
        XCTAssertTrue(waitUntil(5) {
            let actual = self.window("Noter").frame
            return abs(actual.minX - expected.minX) <= 3 && abs(actual.minY - expected.minY) <= 3
                && abs(actual.width - expected.width) <= 3 && abs(actual.height - expected.height) <= 3
        }, "relaunch restores the user's size and position; actual=\(window("Noter").frame), expected=\(expected)")
    }
    // @cpt-end:cpt-noter-algo-core-native-surfaces-placement:p1:inst-frame

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
        func focused() -> Bool { (search.value(forKey: "hasKeyboardFocus") as? Bool) ?? false }
        func verifySearchInput() {
            XCTAssertTrue(search.isHittable, "the Settings search target can receive a pointer click")
            let rowsBefore = paneList.descendants(matching: .any).count
            search.click()
            let query = "not-a-settings-pane"
            search.typeText(query)
            XCTAssertTrue(waitUntil(5) { (search.value as? String) == query }, "clicking the field gives it keyboard focus and typing updates the full search query")
            let rowsFiltered = paneList.descendants(matching: .any).count
            // The key goes to the app's focused element, as in every other native test, not through the element's own focus probe.
            app.typeKey(.escape, modifierFlags: [])
            let cleared = waitUntil(5) { (search.value as? String) == "" }
            // Only on failure, tell a page that never cleared (list size stays at its filtered count) from a stale AX value
            // (list size back to its full count), and whether a second Escape clears it (the first key was lost) or not.
            var diagnosis = ""
            if !cleared {
                let rowsAfter = paneList.descendants(matching: .any).count
                app.typeKey(.escape, modifierFlags: [])
                diagnosis = "field reads \(String(describing: search.value)), pane list elements before typing \(rowsBefore), filtered \(rowsFiltered), after Escape \(rowsAfter), second Escape clears \(waitUntil(3) { (search.value as? String) == "" }), focused \(focused())"
            }
            XCTAssertTrue(cleared, "the search remains editable after clearing its text (\(diagnosis))")
            XCTAssertTrue(pane.waitForExistence(timeout: 5), "clearing the query restores the Settings pane content")
        }

        XCTAssertTrue(paneList.waitForExistence(timeout: 5) && pane.waitForExistence(timeout: 5), "Settings renders both its pane list and content pane")
        XCTAssertLessThanOrEqual(paneList.frame.maxX, pane.frame.minX, "the default pane list remains beside the content pane")
        XCTAssertEqual(paneList.frame.width, 200, accuracy: 6, "the default ST-R1 pane keeps its specified 200 pt width")
        // 200 pt pane minus 16 pt pane padding, 1 pt border, pill padding, glyph and gap leaves 146 pt for input.
        assertHeaderHitTargetsClear("820×620 default", expectedSearchWidth: paneList.frame.width - 54)
        attachSettingsScreenshot("settings-search-titlebar-default")
        verifySearchInput()

        // Mouse gestures target straight resize edges, avoiding the rounded corner.
        let right = settings.coordinate(withNormalizedOffset: CGVector(dx: 1, dy: 0.5)).withOffset(CGVector(dx: -1, dy: 0))
        right.click(forDuration: 0.1, thenDragTo: right.withOffset(CGVector(dx: 700 - settings.frame.width, dy: 0)))
        XCTAssertTrue(waitUntil(5) { abs(settings.frame.width - 700) <= 8 }, "Settings resizes to 700 pt wide; actual frame=\(settings.frame)")
        let bottom = settings.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 1)).withOffset(CGVector(dx: 0, dy: -1))
        bottom.click(forDuration: 0.1, thenDragTo: bottom.withOffset(CGVector(dx: 0, dy: 480 - settings.frame.height)))
        XCTAssertTrue(waitUntil(5) { abs(settings.frame.width - 700) <= 8 && abs(settings.frame.height - 480) <= 8 }, "Settings can resize to its 700×480 minimum; actual frame=\(settings.frame)")
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

    // @cpt-flow:cpt-noter-flow-ui-first-run-complete-setup:p1
    func test_cpt_noter_seq_first_run_complete_setup__fresh_launch_opens_setup_automatically() {
        launch(fixture: "none")
        let wizard = window(around: "Setup steps")
        XCTAssertTrue(wizard.waitForExistence(timeout: 10), "an incomplete first launch opens setup without a menu action")
        XCTAssertTrue(accessibilityTreeContains("Welcome to Noter", in: wizard), "fresh setup opens at Welcome")
    }

    // @cpt-dod:cpt-noter-dod-ui-first-run-window:p1
    func test_cpt_noter_seq_first_run_complete_setup__completed_launch_keeps_setup_closed() {
        launch("idle")
        XCTAssertTrue(app.groups["Sidebar"].waitForExistence(timeout: 10), "the main window did not load")
        XCTAssertFalse(window(around: "Setup steps").waitForExistence(timeout: 3), "a completed installation does not reopen setup")
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
