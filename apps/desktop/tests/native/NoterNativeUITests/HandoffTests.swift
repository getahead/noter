// M2 Handoff drawer and Add Mapping (docs/features/ui/handoff.md): native interactions on the `handoff` scenario that
// puts the engineering item in the call “Backend sync”.
import XCTest

final class HandoffTests: NoterTestCase {
    /// An existing folder the panel "chooses": the core never creates one.
    private func makeRepo() -> String {
        let repo = home!.appendingPathComponent("repo")
        try? FileManager.default.createDirectory(at: repo, withIntermediateDirectories: true)
        return repo.path
    }

    private func answers(_ panels: [String?]) {
        var list: [Any] = []
        for panel in panels { if let panel { list.append(panel) } else { list.append(NSNull()) } }
        let data = try! JSONSerialization.data(withJSONObject: list)
        app.launchEnvironment["NOTER_TEST_FOLDER_PANELS"] = String(data: data, encoding: .utf8)
    }

    /// The saved call page's engineering item: its Handoff button opens the drawer.
    private func openDrawer(file: StaticString = #filePath, line: UInt = #line) {
        openCall("Backend sync")
        app.typeKey(.return, modifierFlags: []) // Return opens the selected call's page
        let handoff = app.buttons["Handoff"].firstMatch
        XCTAssertTrue(handoff.waitForExistence(timeout: 10), "the engineering item has no Handoff button — \(screen())", file: file, line: line)
        pressWithKeyboard(handoff, file: file, line: line)
        XCTAssertTrue(app.buttons["Copy Prompt"].firstMatch.waitForExistence(timeout: 10), "the Handoff drawer did not open — \(screen())", file: file, line: line)
    }

    /// A click on a web button can land on its neighbour in the native window (the Item inspector opened for another item
    /// on CI): reach the button with the keyboard instead, Tab until it has focus and Space runs it.
    private func pressWithKeyboard(_ button: XCUIElement, file: StaticString = #filePath, line: UInt = #line) {
        func focused(_ element: XCUIElement) -> Bool { (element.value(forKey: "hasKeyboardFocus") as? Bool) ?? false }
        for _ in 0..<80 where !focused(button) { app.typeKey(.tab, modifierFlags: []) }
        XCTAssertTrue(focused(button), "Tab never reached \(button.title) — \(screen())", file: file, line: line)
        app.typeKey(" ", modifierFlags: [])
    }

    /// What the window shows, for a failure message: the CI log is the only screen a native failure leaves.
    private func screen() -> String {
        // the page's part of the tree comes late in a long dump: keep the lines that name what these tests look for
        let wanted = ["Handoff", "Inspector", "Copy Prompt", "Add Mapping", "Choose", "Open in", "Keyboard Focused", "repository"]
        let lines = app.windows.firstMatch.debugDescription.split(separator: "\n").map(String.init).filter { line in wanted.contains { line.contains($0) } }
        return lines.prefix(40).map { $0.trimmingCharacters(in: .whitespaces) }.joined(separator: " ¦ ")
    }

    // the web button exposes a title, not a label: the buttons subscript matches either
    /// Any element of the window matching the predicate: the web content exposes a title, a label or a value by element.
    private func anyElement(_ predicate: String) -> XCUIElement {
        app.descendants(matching: .any).matching(NSPredicate(format: predicate)).firstMatch
    }

    private var addMapping: XCUIElement { app.buttons["Add Mapping…"].firstMatch }
    private var choose: XCUIElement { app.buttons["Choose…"].firstMatch }
    private var openButton: XCUIElement { app.buttons["Open in Claude Code"].firstMatch }

    /// Maps the unmapped project through Add Mapping… (the folder panel answers with `makeRepo()`), leaving a usable drawer.
    private func mapRepository(file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertTrue(addMapping.waitForExistence(timeout: 10), "Add Mapping… — \(screen())", file: file, line: line)
        addMapping.click()
        XCTAssertTrue(choose.waitForExistence(timeout: 5), "Choose… — \(screen())", file: file, line: line)
        choose.click()
        XCTAssertTrue(choose.waitForNonExistence(timeout: 10), "the chosen folder saves the mapping", file: file, line: line)
        XCTAssertTrue(openButton.waitForExistence(timeout: 10), file: file, line: line)
    }

    /// The failed-open line the drawer shows above its footer (handoff.open_failed).
    private var openFailed: XCUIElement { app.staticTexts["Couldn't open Claude Code · use Copy Prompt"].firstMatch }
    /// The item row's status chip (items.handed_off).
    private var handedOff: XCUIElement { app.staticTexts["Handed off · awaiting PR"].firstMatch }

    func test_cpt_noter_seq_call_page_hand_off_item__folder_picker_shows_native_panel() {
        app.launchEnvironment["NOTER_TEST_NATIVE_FOLDER_PANEL"] = "1"
        launch("handoff")
        openDrawer()
        addMapping.click()
        XCTAssertTrue(choose.waitForExistence(timeout: 5), "Add Mapping opens the repository sheet")
        let key = app.textFields["Jira project or component"]
        XCTAssertTrue(key.waitForExistence(timeout: 5), "the mapping sheet asks for a project key")
        XCTAssertFalse((key.value as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                       "the handoff sheet pre-fills the project key")
        XCTAssertTrue(choose.isEnabled, "Choose is enabled once the project key is valid")
        choose.click()
        let nativePanelTypes = NSPredicate(format: "elementType == %d OR elementType == %d OR elementType == %d",
                                           XCUIElement.ElementType.sheet.rawValue,
                                           XCUIElement.ElementType.dialog.rawValue,
                                           XCUIElement.ElementType.window.rawValue)
        let panelWithOpenAction = NSPredicate(format: "label == 'Open' OR title == 'Open'")
        let panel = app.descendants(matching: .any).matching(nativePanelTypes).containing(panelWithOpenAction).firstMatch
        XCTAssertTrue(panel.waitForExistence(timeout: 10), "the native folder picker is shown — \(screen())")
        XCTAssertTrue(panel.buttons["Open"].waitForExistence(timeout: 5), "the native folder picker offers its Open action")
        app.typeKey(.escape, modifierFlags: [])
        XCTAssertTrue(panel.waitForNonExistence(timeout: 5), "Escape cancels the native folder picker")
        XCTAssertTrue(choose.waitForExistence(timeout: 5), "cancelling leaves the mapping draft open")
        XCTAssertEqual(key.value as? String, "VSTOR", "cancelling preserves the project key")
    }

    func test_automation_denied_leaves_copy_prompt_available() {
        // The launch plan says macOS refused Automation: Open fails, nothing is marked Handed off, Copy Prompt stays.
        app.launchEnvironment["NOTER_TEST_LAUNCH_WORLD"] = #"{"plan":{"path":"terminal","needs_automation":false,"automation_denied":true}}"#
        answers([makeRepo()])
        launch("handoff")
        openDrawer()
        mapRepository()
        // not ⌘Return: after a denial the core makes Copy the default action, so Open is pressed itself
        pressWithKeyboard(openButton)
        XCTAssertTrue(openFailed.waitForExistence(timeout: 10), "a denied launch says it could not open — \(screen())")
        XCTAssertFalse(handedOff.waitForExistence(timeout: 3), "automation denial never marks the item Handed off")
        XCTAssertTrue(app.buttons["Copy Prompt"].firstMatch.isEnabled, "Copy Prompt stays available")
    }

    func test_no_link_handler_falls_back_to_the_terminal() {
        // Claude's link and iTerm both refuse: the core falls back to the terminal and the launch counts as opened.
        app.launchEnvironment["NOTER_TEST_LAUNCH_WORLD"] = #"{"plan":{"path":"claude_cli_link","needs_automation":false,"automation_denied":false},"fail":[{"path":"claude_cli_link","code":"no_link_handler"},{"path":"iterm","code":"no_link_handler"}]}"#
        answers([makeRepo()])
        launch("handoff")
        openDrawer()
        mapRepository()
        app.typeKey(.return, modifierFlags: .command)
        XCTAssertTrue(handedOff.waitForExistence(timeout: 10), "the terminal fallback hands the item off — \(screen())")
        XCTAssertFalse(openFailed.exists, "a fallback that worked shows no failure")
    }

    func test_repository_mapping_uses_the_harness_folder_answer() {
        answers([makeRepo()])
        launch("handoff")
        openDrawer()
        XCTAssertTrue(addMapping.waitForExistence(timeout: 10), "an unmapped project shows Add Mapping… — \(screen())")
        XCTAssertFalse(openButton.isEnabled, "Open waits for a repository")
        addMapping.click()
        XCTAssertTrue(choose.waitForExistence(timeout: 5), "Add Mapping… opens the sheet")
        choose.click()
        XCTAssertTrue(choose.waitForNonExistence(timeout: 10), "the folder the panel chose saves the mapping and closes the sheet")
        XCTAssertTrue(openButton.waitForExistence(timeout: 10))
        XCTAssertTrue(openButton.isEnabled, "Open is available once the project is mapped")
    }

    func test_cancelled_harness_folder_answer_keeps_the_draft() {
        answers([nil, makeRepo()])
        launch("handoff")
        openDrawer()
        XCTAssertTrue(addMapping.waitForExistence(timeout: 10), "Add Mapping… — \(screen())")
        addMapping.click()
        XCTAssertTrue(choose.waitForExistence(timeout: 5), "Choose… — \(screen())")
        choose.click()
        XCTAssertFalse(choose.waitForNonExistence(timeout: 3), "a cancelled panel keeps the sheet and its draft")
        choose.click()
        XCTAssertTrue(choose.waitForNonExistence(timeout: 10), "the second panel answer chose the folder")
    }

    func test_copy_prompt_marks_the_item_handed_off() {
        answers([makeRepo()])
        launch("handoff")
        openDrawer()
        XCTAssertTrue(addMapping.waitForExistence(timeout: 10), "Add Mapping… — \(screen())")
        addMapping.click()
        XCTAssertTrue(choose.waitForExistence(timeout: 5), "Choose… — \(screen())")
        choose.click()
        XCTAssertTrue(choose.waitForNonExistence(timeout: 10))
        let copy = app.buttons["Copy Prompt"].firstMatch
        XCTAssertTrue(copy.waitForExistence(timeout: 10))
        copy.click()
        XCTAssertTrue(anyElement("title == 'Copied' OR label == 'Copied' OR value == 'Copied'").waitForExistence(timeout: 5), "Copy Prompt says Copied")
        // the row's status chip (items.handed_off), matched exactly: a CONTAINS predicate throws on any element whose value is a number
        XCTAssertTrue(app.staticTexts["Handed off · awaiting PR"].firstMatch.waitForExistence(timeout: 5), "copying hands the item off without launching")
    }
}
