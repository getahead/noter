import XCTest

// @cpt-dod:cpt-noter-dod-ui-main-window-shell-navigation:p1
final class NativeAppMenuTests: NoterTestCase {
    func test_cpt_noter_dod_ui_main_window_shell_navigation__call_menu_tracks_and_runs_core_state() {
        launch("idle")
        XCTAssertTrue(app.groups["Sidebar"].waitForExistence(timeout: 10), "the main window loaded")
        attachScreenshot("main-titlebar-sidebar-default")
        for title in ["Noter", "Edit", "View", "Window"] {
            captureMenu(title, as: "app-menu-\(title.lowercased())")
        }

        let fileMenu = app.menuBars.menuBarItems["File"]
        XCTAssertTrue(fileMenu.waitForExistence(timeout: 5), "the native File menu exists")
        fileMenu.click()
        attachScreenshot("app-menu-file")
        let export = app.menuItems["Export…"]
        XCTAssertTrue(export.waitForExistence(timeout: 5), "Export is present in the native File menu")
        XCTAssertFalse(export.isEnabled, "Export is unavailable until a call page is active")
        app.typeKey(.escape, modifierFlags: [])

        let callMenu = app.menuBars.menuBarItems["Call"]
        XCTAssertTrue(callMenu.waitForExistence(timeout: 5), "the native Call menu exists")
        callMenu.click()
        let start = app.menuItems["Start Recording"]
        XCTAssertTrue(start.waitForExistence(timeout: 5), "the Call menu reflects the idle core state")
        XCTAssertTrue(start.isEnabled, "Start Recording is available while idle")
        attachScreenshot("app-menu-call-idle")
        start.click()

        XCTAssertTrue(infoLine("Recording", in: openMenu()).waitForExistence(timeout: 10), "the native Call menu starts capture through the core")
        closeMenu()
        callMenu.click()
        let nativeCallMenu = callMenu.menus.firstMatch
        let stop = nativeCallMenu.menuItems["Stop Recording"]
        let pause = nativeCallMenu.menuItems["Pause"]
        XCTAssertTrue(stop.waitForExistence(timeout: 10) && stop.isEnabled, "Start Recording becomes Stop Recording while capturing")
        XCTAssertTrue(pause.exists && pause.isEnabled, "Pause is enabled while capturing")
        attachScreenshot("app-menu-call-recording")
        pause.click()

        callMenu.click()
        let resume = callMenu.menus.firstMatch.menuItems["Resume"]
        XCTAssertTrue(resume.waitForExistence(timeout: 10) && resume.isEnabled, "Pause becomes Resume when the core is paused")
        attachScreenshot("app-menu-call-paused")
        resume.click()
        app.typeKey("r", modifierFlags: [.control, .option, .command])
        XCTAssertTrue(waitUntil(10) { statusItem.label == "Noter, not recording" }, "the Call menu accelerator toggles recording through the core")
    }

    func test_cpt_noter_dod_ui_main_window_shell_navigation__native_menu_context_actions_and_window_titles() {
        launch("idle")
        let main = app.windows["Noter"]
        XCTAssertTrue(main.waitForExistence(timeout: 10), "the main window title is Noter")
        app.typeKey("w", modifierFlags: .command)
        let last = openMenu().menuItems.matching(NSPredicate(format: "title BEGINSWITH 'Open Last Summary — '" )).firstMatch
        XCTAssertTrue(last.waitForExistence(timeout: 10), "a ready summary is available from the native status menu")
        last.click()
        XCTAssertTrue(waitUntil(10) { accessibilityTreeContains("Backend sync", in: main) }, "the latest ready summary is open in the main window")
        XCTAssertTrue(waitUntil(10) { main.isHittable }, "the main window is key for its contextual menu actions")
        main.click()

        let file = app.menuBars.menuBarItems["File"]
        XCTAssertTrue(file.waitForExistence(timeout: 5))
        file.click()
        let export = app.menuItems["Export…"]
        XCTAssertTrue(export.waitForExistence(timeout: 5) && export.isEnabled, "Export becomes enabled for the focused ready call page")
        attachScreenshot("app-menu-file-call-context")
        export.click()
        XCTAssertTrue(app.staticTexts["Summary and items"].waitForExistence(timeout: 10), "File > Export opens the call export sheet")
        attachScreenshot("app-menu-file-export-sheet")
        app.typeKey(.escape, modifierFlags: [])

        let edit = app.menuBars.menuBarItems["Edit"]
        edit.click()
        let copySlack = app.menuItems["Copy for Slack"]
        XCTAssertTrue(copySlack.waitForExistence(timeout: 5) && copySlack.isEnabled, "Copy for Slack becomes enabled for a ready call page")
        attachScreenshot("app-menu-edit-call-context")
        copySlack.click()
        XCTAssertTrue(app.staticTexts["Copied for Slack"].waitForExistence(timeout: 10), "Edit > Copy for Slack runs the existing share handler")

        let noter = app.menuBars.menuBarItems["Noter"]
        noter.click()
        app.menuItems["Settings…"].click()
        let settings = app.windows["Settings"]
        XCTAssertTrue(settings.waitForExistence(timeout: 10), "the native Settings menu opens the Settings window")
        attachScreenshot("settings-native-titlebar")

        noter.click()
        app.menuItems["Run Setup Again…"].click()
        let firstRun = app.windows["Noter Setup"]
        XCTAssertTrue(firstRun.waitForExistence(timeout: 10), "the native setup menu opens the distinct First Run window")
        attachScreenshot("first-run-native-titlebar")
    }

    private func captureMenu(_ title: String, as name: String) {
        let menu = app.menuBars.menuBarItems[title]
        XCTAssertTrue(menu.waitForExistence(timeout: 5), "the native \(title) menu exists")
        menu.click()
        attachScreenshot(name)
        app.typeKey(.escape, modifierFlags: [])
    }

    private func attachScreenshot(_ name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
