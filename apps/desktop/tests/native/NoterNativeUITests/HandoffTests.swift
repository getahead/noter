// M2 Handoff drawer and Add Mapping (docs/features/ui/handoff.md): the real native folder panel answered by the
// harness (NOTER_TEST_FOLDER_PANELS, a JSON list consumed in order, null is Cancel), on the `handoff` scenario that
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
        let list = panels.map { $0 as Any? ?? NSNull() }
        let data = try! JSONSerialization.data(withJSONObject: list)
        app.launchEnvironment["NOTER_TEST_FOLDER_PANELS"] = String(data: data, encoding: .utf8)
    }

    /// The saved call page's engineering item: its Handoff button opens the drawer.
    private func openDrawer(file: StaticString = #filePath, line: UInt = #line) {
        openCall("Backend sync")
        app.typeKey(.return, modifierFlags: []) // Return opens the selected call's page
        let handoff = app.buttons["Handoff"].firstMatch
        XCTAssertTrue(handoff.waitForExistence(timeout: 10), "the engineering item has no Handoff button — \(screen())", file: file, line: line)
        handoff.click()
    }

    /// What the window shows, for a failure message: the CI log is the only screen a native failure leaves.
    private func screen() -> String {
        // one snapshot, walked once: indexing live queries races elements that come and go
        guard let root = try? app.snapshot() else { return "no snapshot" }
        var labels: [String] = []
        func walk(_ element: XCUIElementSnapshot) {
            if [.button, .staticText, .popUpButton].contains(element.elementType), !element.label.isEmpty { labels.append("\(element.elementType.rawValue):\(element.label)") }
            element.children.forEach(walk)
        }
        walk(root)
        return labels.prefix(80).joined(separator: " | ")
    }

    private var addMapping: XCUIElement {
        app.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH 'Add Mapping'")).firstMatch
    }
    private var choose: XCUIElement { app.buttons["Choose…"].firstMatch }
    private var open: XCUIElement { app.buttons["Open in Claude Code"].firstMatch }

    func test_cpt_noter_seq_call_page_hand_off_item__error_no_repository_mapped_choose_folder() {
        answers([makeRepo()])
        launch("handoff")
        openDrawer()
        XCTAssertTrue(addMapping.waitForExistence(timeout: 10), "an unmapped project shows Add Mapping… — \(screen())")
        XCTAssertFalse(open.isEnabled, "Open waits for a repository")
        addMapping.click()
        XCTAssertTrue(choose.waitForExistence(timeout: 5), "Add Mapping… opens the sheet")
        choose.click()
        XCTAssertTrue(choose.waitForNonExistence(timeout: 10), "the folder the panel chose saves the mapping and closes the sheet")
        XCTAssertTrue(open.waitForExistence(timeout: 10))
        XCTAssertTrue(open.isEnabled, "Open is available once the project is mapped")
    }

    func test_cpt_noter_seq_call_page_hand_off_item__error_folder_panel_cancelled_keeps_the_draft() {
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

    func test_cpt_noter_seq_call_page_hand_off_item__other_copy_prompt_hands_the_item_off() {
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
        XCTAssertTrue(app.staticTexts["Copied"].firstMatch.waitForExistence(timeout: 5), "Copy Prompt says Copied")
        XCTAssertTrue(app.staticTexts["Handed off"].firstMatch.waitForExistence(timeout: 5), "copying hands the item off without launching")
    }
}
