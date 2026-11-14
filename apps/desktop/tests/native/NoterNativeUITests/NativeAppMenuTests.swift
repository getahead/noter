import XCTest
import AppKit
import CoreGraphics

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
        let newQuestion = app.menuItems["New Question"]
        XCTAssertTrue(newQuestion.waitForExistence(timeout: 5), "the future Ask command remains visible in the File menu")
        XCTAssertFalse(newQuestion.isEnabled, "New Question stays disabled until the Ask M3 feature is available")
        let export = app.menuItems["Export…"]
        XCTAssertTrue(export.waitForExistence(timeout: 5), "Export is present in the native File menu")
        XCTAssertFalse(export.isEnabled, "Export is unavailable until a call page is active")
        app.typeKey(.escape, modifierFlags: [])

        let editMenu = app.menuBars.menuBarItems["Edit"]
        editMenu.click()
        for label in ["Accept Item", "Accept All Suggestions", "Reject Item"] {
            let item = app.menuItems[label]
            XCTAssertTrue(item.waitForExistence(timeout: 5), "\(label) remains in the native Edit menu")
            XCTAssertFalse(item.isEnabled, "\(label) is unavailable without a focused suggested item")
        }
        XCTAssertFalse(app.menuItems["Copy for Slack"].isEnabled, "Copy for Slack is unavailable without a focused ready call page")
        app.typeKey(.escape, modifierFlags: [])

        let callMenu = app.menuBars.menuBarItems["Call"]
        XCTAssertTrue(callMenu.waitForExistence(timeout: 5), "the native Call menu exists")
        callMenu.click()
        let start = app.menuItems["Start Recording"]
        XCTAssertTrue(start.waitForExistence(timeout: 5), "the Call menu reflects the idle core state")
        XCTAssertTrue(start.isEnabled, "Start Recording is available while idle")
        for label in ["Catch Me Up", "Ask About This Call…", "Mute Copilot"] {
            let item = app.menuItems[label]
            XCTAssertTrue(item.waitForExistence(timeout: 5), "\(label) remains in the native Call menu")
            XCTAssertFalse(item.isEnabled, "\(label) stays disabled until Copilot's M4 flag is available")
        }
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
        attachScreenshot("navigation-arrival-last-summary")
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
        app.typeKey(.escape, modifierFlags: [])

        let noter = app.menuBars.menuBarItems["Noter"]
        noter.click()
        app.menuItems["Settings…"].click()
        let settings = app.windows["Settings"]
        XCTAssertTrue(settings.waitForExistence(timeout: 10), "the native Settings menu opens the Settings window")
        attachScreenshot("settings-native-titlebar")
        edit.click()
        XCTAssertFalse(app.menuItems["Copy for Slack"].isEnabled, "Settings does not retain call-page share actions")
        app.typeKey(.escape, modifierFlags: [])

        noter.click()
        app.menuItems["Run Setup Again…"].click()
        let firstRun = app.windows["Noter Setup"]
        XCTAssertTrue(firstRun.waitForExistence(timeout: 10), "the native setup menu opens the distinct First Run window")
        attachScreenshot("first-run-native-titlebar")
    }

    func test_cpt_noter_seq_call_page_review_suggested_items__native_menu_accepts_focused_action_item() {
        let main = openMenuReviewCall()
        let outcome = main.staticTexts.matching(NSPredicate(format: "label == %@", "Accepted"))
        XCTAssertEqual(outcome.count, 0, "the fresh fixture has no prior Accepted outcome")
        let suggestion = main.staticTexts["Replay buffer for websocket reconnects"]
        XCTAssertTrue(suggestion.waitForExistence(timeout: 10), "the suggested action item is visible")
        suggestion.click()
        let edit = app.menuBars.menuBarItems["Edit"]
        edit.click()
        XCTAssertTrue(app.menuItems["Accept Item"].waitForExistence(timeout: 5) && app.menuItems["Accept Item"].isEnabled, "Accept Item enables for the focused action item")
        XCTAssertTrue(app.menuItems["Reject Item"].isEnabled, "Reject Item enables for the focused action item")
        attachScreenshot("app-menu-edit-focused-action")
        app.menuItems["Accept Item"].click()
        XCTAssertTrue(waitUntil(10) { outcome.count == 1 }, "the focused action item produces one Accepted outcome")
    }

    func test_cpt_noter_seq_call_page_review_suggested_items__native_menu_rejects_focused_decision() {
        let main = openMenuReviewCall()
        let outcome = main.staticTexts.matching(NSPredicate(format: "label == %@", "Rejected"))
        XCTAssertEqual(outcome.count, 0, "the fresh fixture has no prior Rejected outcome")
        let suggestion = main.staticTexts["Drawer events go through the notification service."]
        XCTAssertTrue(suggestion.waitForExistence(timeout: 10), "the suggested decision is visible")
        suggestion.click()
        let edit = app.menuBars.menuBarItems["Edit"]
        edit.click()
        XCTAssertTrue(app.menuItems["Accept Item"].waitForExistence(timeout: 5) && app.menuItems["Accept Item"].isEnabled, "Accept Item enables for the focused decision")
        XCTAssertTrue(app.menuItems["Reject Item"].isEnabled, "Reject Item enables for the focused decision")
        attachScreenshot("app-menu-edit-focused-decision")
        app.menuItems["Reject Item"].click()
        XCTAssertTrue(waitUntil(10) { outcome.count == 1 }, "the focused decision produces one Rejected outcome")
    }

    func test_cpt_noter_seq_call_page_review_suggested_items__native_menu_accepts_focused_question() {
        let main = openMenuReviewCall()
        let outcome = main.staticTexts.matching(NSPredicate(format: "label == %@", "Accepted"))
        XCTAssertEqual(outcome.count, 0, "the fresh fixture has no prior Accepted outcome")
        let suggestion = main.staticTexts["Who owns the acceptance criteria for the reconnect?"]
        XCTAssertTrue(suggestion.waitForExistence(timeout: 10), "the suggested question is visible")
        suggestion.click()
        let edit = app.menuBars.menuBarItems["Edit"]
        edit.click()
        XCTAssertTrue(app.menuItems["Accept Item"].waitForExistence(timeout: 5) && app.menuItems["Accept Item"].isEnabled, "Accept Item enables for the focused question")
        XCTAssertTrue(app.menuItems["Reject Item"].isEnabled, "Reject Item enables for the focused question")
        attachScreenshot("app-menu-edit-focused-question")
        app.menuItems["Accept Item"].click()
        XCTAssertTrue(waitUntil(10) { outcome.count == 1 }, "the focused question produces one Accepted outcome")
    }

    func test_cpt_noter_dod_ui_main_window_shell_navigation__native_menu_copy_for_slack_writes_once() throws {
        let pasteboardName = NSPasteboard.Name(rawValue: "org.getahead.noter.native-uitests")
        let pasteboard = NSPasteboard(name: pasteboardName)
        pasteboard.clearContents()
        let testHome = try XCTUnwrap(self.home)
        let writeLog = testHome.appendingPathComponent("native-clipboard-writes.txt")
        app.launchEnvironment["NOTER_TEST_NATIVE_CLIPBOARD"] = "1"
        app.launchEnvironment["NOTER_TEST_CLIPBOARD_LOG"] = writeLog.path

        launch("idle")
        let main = app.windows["Noter"]
        XCTAssertTrue(main.waitForExistence(timeout: 10))
        app.typeKey("w", modifierFlags: .command)
        let last = openMenu().menuItems.matching(NSPredicate(format: "title BEGINSWITH 'Open Last Summary — '" )).firstMatch
        XCTAssertTrue(last.waitForExistence(timeout: 10), "the native status menu offers the ready summary")
        last.click()
        XCTAssertTrue(waitUntil(10) { accessibilityTreeContains("Backend sync", in: main) && main.isHittable })

        let edit = app.menuBars.menuBarItems["Edit"]
        edit.click()
        let copySlack = app.menuItems["Copy for Slack"]
        XCTAssertTrue(copySlack.waitForExistence(timeout: 5) && copySlack.isEnabled, "Copy for Slack is enabled for the focused ready call")
        attachScreenshot("app-menu-edit-copy-slack-menu-click")
        copySlack.click()
        let copiedFeedback = app.staticTexts["Copied for Slack"]
        XCTAssertTrue(copiedFeedback.waitForExistence(timeout: 10), "the native menu dispatches to the existing share handler")
        XCTAssertTrue(waitUntil(5) { Self.clipboardWriteCount(at: writeLog) == 1 }, "the menu action writes once to the private pasteboard")
        XCTAssertEqual(Self.clipboardWriteCount(at: writeLog), 1, "the menu action dispatches one clipboard write")
        XCTAssertTrue((pasteboard.string(forType: .string) ?? "").contains("Backend sync"), "the private pasteboard contains the selected call's Slack payload")
        attachScreenshot("app-menu-edit-copy-slack-click-confirmed")
        XCTAssertTrue(waitUntil(10) { !copiedFeedback.exists }, "the click confirmation clears before testing the accelerator")

        app.typeKey("c", modifierFlags: [.command, .shift])
        XCTAssertTrue(copiedFeedback.waitForExistence(timeout: 10), "Shift-Command-C dispatches to the same share handler")
        XCTAssertTrue(waitUntil(5) { Self.clipboardWriteCount(at: writeLog) == 2 }, "the accelerator writes once to the private pasteboard")
        XCTAssertEqual(Self.clipboardWriteCount(at: writeLog), 2, "menu click and accelerator each dispatch one clipboard write")
        XCTAssertTrue((pasteboard.string(forType: .string) ?? "").contains("Backend sync"), "the accelerator refreshes the private pasteboard payload")
        attachScreenshot("app-menu-edit-copy-slack-shortcut-confirmed")
    }

    func test_cpt_noter_seq_call_page_review_suggested_items__native_menu_accept_all_batches_every_suggested_kind() {
        launch("menu-review")
        let main = app.windows["Noter"]
        XCTAssertTrue(main.waitForExistence(timeout: 10))
        app.typeKey("w", modifierFlags: .command)
        let last = openMenu().menuItems.matching(NSPredicate(format: "title BEGINSWITH 'Open Last Summary — '" )).firstMatch
        XCTAssertTrue(last.waitForExistence(timeout: 10))
        last.click()
        XCTAssertTrue(waitUntil(10) { accessibilityTreeContains("Backend sync", in: main) && main.isHittable })

        let edit = app.menuBars.menuBarItems["Edit"]
        edit.click()
        XCTAssertFalse(app.menuItems["Accept Item"].isEnabled, "Accept Item requires a focused suggested row")
        XCTAssertFalse(app.menuItems["Reject Item"].isEnabled, "Reject Item requires a focused suggested row")
        let acceptAll = app.menuItems["Accept All Suggestions"]
        XCTAssertTrue(acceptAll.waitForExistence(timeout: 5) && acceptAll.isEnabled, "Accept All enables while all three item kinds have suggestions")
        attachScreenshot("app-menu-edit-all-kinds-suggested")
        acceptAll.click()
        XCTAssertTrue(waitUntil(10) { main.staticTexts["Accepted 3 suggested items"].exists }, "Accept All reviews action items, decisions and questions in one batch")
    }

    private func captureMenu(_ title: String, as name: String) {
        let menu = app.menuBars.menuBarItems[title]
        XCTAssertTrue(menu.waitForExistence(timeout: 5), "the native \(title) menu exists")
        menu.click()
        attachScreenshot(name)
        app.typeKey(.escape, modifierFlags: [])
    }

    private func openMenuReviewCall() -> XCUIElement {
        launch("menu-review")
        let main = app.windows["Noter"]
        XCTAssertTrue(main.waitForExistence(timeout: 10), "the main window opens for the fresh menu-review fixture")
        app.typeKey("w", modifierFlags: .command)
        let last = openMenu().menuItems.matching(NSPredicate(format: "title BEGINSWITH 'Open Last Summary — '" )).firstMatch
        XCTAssertTrue(last.waitForExistence(timeout: 10), "the native status menu offers Backend sync")
        last.click()
        XCTAssertTrue(waitUntil(10) { accessibilityTreeContains("Backend sync", in: main) && main.isHittable }, "the ready summary arrives in the main window")
        return main
    }

    private static func clipboardWriteCount(at path: URL) -> Int {
        (try? String(contentsOf: path, encoding: .utf8))?.split(whereSeparator: \.isNewline).count ?? 0
    }

    private func attachScreenshot(_ name: String) {
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
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
