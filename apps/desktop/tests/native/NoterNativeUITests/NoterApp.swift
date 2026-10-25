// The app under test: the debug bundle `just native` builds (TEST_RUNNER_NOTER_APP_PATH), launched with the
// command log directory (TEST_RUNNER_NOTER_E2E_LOG_DIR) so what the core ran counts toward the E2E bar.
// Story tests are named after the DESIGN story they prove (`cpt-noter-seq-…` with underscores, docs/HARNESS.md).
import XCTest

class NoterTestCase: XCTestCase {
    var app: XCUIApplication!

    override func setUp() {
        continueAfterFailure = false
        guard let path = ProcessInfo.processInfo.environment["NOTER_APP_PATH"], !path.isEmpty else {
            XCTFail("NOTER_APP_PATH is not set: run the suite with `just native`")
            return
        }
        app = XCUIApplication(url: URL(fileURLWithPath: path))
        if let dir = ProcessInfo.processInfo.environment["NOTER_E2E_LOG_DIR"] {
            app.launchEnvironment["NOTER_E2E_LOG_DIR"] = dir
        }
        app.launch()
    }

    // The log is written when the app quits normally.
    override func tearDown() { app?.terminate() }

    /// The menu bar extra.
    var statusItem: XCUIElement { app.menuBars.statusItems.firstMatch }

    /// Opens the menu and returns it.
    @discardableResult
    func openMenu(file: StaticString = #filePath, line: UInt = #line) -> XCUIElement {
        XCTAssertTrue(statusItem.waitForExistence(timeout: 10), "the menu bar extra is not in the menu bar", file: file, line: line)
        statusItem.click()
        let menu = statusItem.menus.firstMatch
        XCTAssertTrue(menu.waitForExistence(timeout: 5), "the menu did not open", file: file, line: line)
        return menu
    }

    func item(_ title: String, in menu: XCUIElement) -> XCUIElement { menu.menuItems[title] }

    func assertItems(_ titles: [String], in menu: XCUIElement, file: StaticString = #filePath, line: UInt = #line) {
        for t in titles {
            XCTAssertTrue(item(t, in: menu).exists, "menu item “\(t)” is missing", file: file, line: line)
        }
    }

    /// A window of the app with this title (the main window is “Noter”).
    func window(_ title: String) -> XCUIElement { app.windows[title] }

    /// The native alert sheet or dialog the app shows.
    var alert: XCUIElement {
        let sheet = app.sheets.firstMatch
        return sheet.exists ? sheet : app.dialogs.firstMatch
    }

    func hotkey(_ key: String) { app.typeKey(key, modifierFlags: [.control, .option, .command]) }
}
