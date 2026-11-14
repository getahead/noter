import XCTest
import AppKit

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
        let pasteboard = NSPasteboard.general
        let beforeClick = pasteboard.changeCount
        copySlack.click()
        let copiedFeedback = app.staticTexts["Copied for Slack"]
        XCTAssertTrue(copiedFeedback.waitForExistence(timeout: 10), "Edit > Copy for Slack runs the existing share handler")
        XCTAssertTrue(waitUntil(5) { pasteboard.changeCount > beforeClick }, "the menu click writes a clipboard result")
        XCTAssertEqual(pasteboard.changeCount, beforeClick + 1, "the menu click invokes the share handler exactly once")
        XCTAssertTrue(waitUntil(10) { !copiedFeedback.exists }, "the click confirmation clears before testing the shortcut")
        let beforeShortcut = pasteboard.changeCount
        app.typeKey("c", modifierFlags: [.command, .shift])
        XCTAssertTrue(copiedFeedback.waitForExistence(timeout: 10), "Shift-Command-C reaches the same Copy for Slack handler")
        XCTAssertTrue(waitUntil(5) { pasteboard.changeCount > beforeShortcut }, "the native accelerator writes a clipboard result")
        XCTAssertEqual(pasteboard.changeCount, beforeShortcut + 1, "the accelerator invokes the share handler exactly once")
        attachScreenshot("app-menu-edit-copy-slack-confirmed")

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

    func test_cpt_noter_seq_call_page_review_suggested_items__native_menu_reviews_focused_suggestions_of_each_kind() {
        launch("menu-review")
        let main = app.windows["Noter"]
        XCTAssertTrue(main.waitForExistence(timeout: 10))
        app.typeKey("w", modifierFlags: .command)
        let last = openMenu().menuItems.matching(NSPredicate(format: "title BEGINSWITH 'Open Last Summary — '" )).firstMatch
        XCTAssertTrue(last.waitForExistence(timeout: 10))
        last.click()
        XCTAssertTrue(waitUntil(10) { accessibilityTreeContains("Backend sync", in: main) && main.isHittable })

        for (text, decision, state) in [
            ("Replay buffer for websocket reconnects", "menu.accept_item", "Accepted"),
            ("Drawer events go through the notification service.", "menu.reject_item", "Rejected"),
            ("Who owns the acceptance criteria for the reconnect?", "menu.accept_item", "Accepted"),
        ] {
            XCTAssertTrue(waitUntil(state == "Rejected" ? 12 : 6) { !main.staticTexts[state].exists }, "no earlier \(state) outcome remains to satisfy this item's assertion")
            let suggestion = main.staticTexts[text]
            XCTAssertTrue(suggestion.waitForExistence(timeout: 10), "the \(text) suggestion is visible")
            suggestion.click()
            let edit = app.menuBars.menuBarItems["Edit"]
            edit.click()
            let accept = app.menuItems["Accept Item"]
            let reject = app.menuItems["Reject Item"]
            XCTAssertTrue(accept.waitForExistence(timeout: 5) && accept.isEnabled, "Accept Item enables for focused suggested rows of every kind")
            XCTAssertTrue(reject.waitForExistence(timeout: 5) && reject.isEnabled, "Reject Item enables for focused suggested rows of every kind")
            attachScreenshot("app-menu-edit-focused-\(text == "Replay buffer for websocket reconnects" ? "action" : text.hasPrefix("Who owns") ? "question" : "decision")")
            app.menuItems[decision == "menu.accept_item" ? "Accept Item" : "Reject Item"].click()
            XCTAssertTrue(waitUntil(10) { main.staticTexts[state].exists }, "the selected \(text) row produces its own \(state) outcome")
            XCTAssertTrue(waitUntil(state == "Rejected" ? 12 : 6) { !main.staticTexts[state].exists }, "this item's \(state) outcome clears before another item is reviewed")
        }
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

    private func attachScreenshot(_ name: String) {
        let build = ProcessInfo.processInfo.environment["NOTER_BUILD_SHA"] ?? "unset"
        let appearance = NSApp.effectiveAppearance.name.rawValue
        let scale = NSScreen.main?.backingScaleFactor ?? 0
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
