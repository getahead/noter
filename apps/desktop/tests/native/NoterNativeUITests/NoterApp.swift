// The app under test: the debug bundle `just native` builds (TEST_RUNNER_NOTER_APP_PATH), launched with the
// command log directory (TEST_RUNNER_NOTER_E2E_LOG_DIR) so what the core ran counts toward the E2E bar, on the
// harness's scripted Mac, engine and models (the launch hooks, NOTER_TEST_FIXTURE): no model, permission or call
// of the machine it runs on is needed.
// Story tests are named after the DESIGN story they prove (`cpt-noter-seq-…` with underscores, docs/HARNESS.md).
import AppKit
import ApplicationServices
import XCTest

class NoterTestCase: XCTestCase {
    var app: XCUIApplication!
    /// The app a test brings to the front to prove Noter does not take focus; hotkeys are typed on it.
    let other = XCUIApplication(bundleIdentifier: "com.apple.finder")

    var home: URL?

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
        // Each test starts from a fresh home (saved window frames, web storage) and temporary folder (the
        // harness's data folder), so what one test changes never reaches the next one or the Mac's own Noter.
        // The runner is not sandboxed (NoterNativeUITests.entitlements): a sandboxed one launches the app without
        // this environment, on the Mac's own data.
        let home = FileManager.default.temporaryDirectory.appendingPathComponent("noter-home-\(UUID().uuidString)")
        try? FileManager.default.createDirectory(at: home, withIntermediateDirectories: true)
        self.home = home
        app.launchEnvironment["HOME"] = home.path
        app.launchEnvironment["TMPDIR"] = home.path + "/"
    }

    /// Launches the app on the fixture world (a live call recording, the call “Backend sync” in the library) in
    /// `scenario` (`idle`, `low-disk`, `detected`, `new-meeting`, `call-seems-ended`, `switched-to-local`), or with
    /// `fixture: "none"` as a fresh install.
    func launch(_ scenario: String? = nil, fixture: String = "world") {
        app.launchEnvironment["NOTER_TEST_FIXTURE"] = fixture
        if let scenario { app.launchEnvironment["NOTER_TEST_SCENARIO"] = scenario }
        app.launch()
    }

    // The log is written when the app quits normally.
    override func tearDown() {
        app?.terminate()
        if let home { try? FileManager.default.removeItem(at: home) }
    }

    /// The menu bar extra.
    var statusItem: XCUIElement { app.menuBars.statusItems.firstMatch }

    /// Opens the menu (or returns it when it is already open).
    @discardableResult
    func openMenu(file: StaticString = #filePath, line: UInt = #line) -> XCUIElement {
        XCTAssertTrue(statusItem.waitForExistence(timeout: 10), "the menu bar extra is not in the menu bar", file: file, line: line)
        let menu = statusItem.menus.firstMatch
        if !isOpen(menu) { statusItem.click() }
        XCTAssertTrue(menu.waitForExistence(timeout: 5), "the menu did not open", file: file, line: line)
        return menu
    }

    /// Closes the menu with a second click: Escape does not reach a status menu.
    func closeMenu() {
        if isOpen(statusItem.menus.firstMatch) { statusItem.click() }
    }

    /// A closed status menu can stay in the accessibility tree with an empty frame.
    private func isOpen(_ menu: XCUIElement) -> Bool { menu.exists && menu.frame.height > 0 }

    func item(_ title: String, in menu: XCUIElement) -> XCUIElement { menu.menuItems[title] }

    /// An info line of the menu (macOS draws it as a disabled item) that starts with `prefix`.
    func infoLine(_ prefix: String, in menu: XCUIElement) -> XCUIElement {
        menu.menuItems.matching(NSPredicate(format: "title BEGINSWITH %@", prefix)).firstMatch
    }

    /// The state line while recording: **Recording · <title> · 23:14** (not **Recording stopped**).
    func recordingLine(in menu: XCUIElement) -> XCUIElement {
        menu.menuItems.matching(NSPredicate(format: "title == 'Recording' OR title BEGINSWITH 'Recording · '")).firstMatch
    }

    func assertItems(_ titles: [String], in menu: XCUIElement, file: StaticString = #filePath, line: UInt = #line) {
        for t in titles {
            XCTAssertTrue(item(t, in: menu).exists, "menu item “\(t)” is missing", file: file, line: line)
        }
    }

    /// Starts a capture with **Start Recording** and waits until the menu reads Recording.
    func startRecording(file: StaticString = #filePath, line: UInt = #line) {
        item("Start Recording", in: openMenu(file: file, line: line)).click()
        XCTAssertTrue(recordingLine(in: openMenu(file: file, line: line)).waitForExistence(timeout: 10),
                      "Start Recording did not start a capture", file: file, line: line)
    }

    /// The key macOS draws next to a menu item of the open status menu (AXMenuItemCmdChar, which XCUITest
    /// does not expose), or nil when the item shows none.
    func keyOf(_ title: String) -> String? {
        guard let pid = NSRunningApplication.runningApplications(withBundleIdentifier: "com.getahead.noter").first?.processIdentifier
        else { return nil }
        func attr(_ e: AXUIElement, _ name: String) -> AnyObject? {
            var v: AnyObject?
            return AXUIElementCopyAttributeValue(e, name as CFString, &v) == .success ? v : nil
        }
        func children(_ e: AXUIElement) -> [AXUIElement] { attr(e, kAXChildrenAttribute) as? [AXUIElement] ?? [] }
        guard let bar = attr(AXUIElementCreateApplication(pid), "AXExtrasMenuBar") else { return nil }
        for menu in children(bar as! AXUIElement).flatMap(children) {
            for item in children(menu) where attr(item, kAXTitleAttribute) as? String == title {
                let key = attr(item, kAXMenuItemCmdCharAttribute) as? String
                return key?.isEmpty == false ? key : nil
            }
        }
        return nil
    }

    /// Opens Calls (⌘3) and selects the call with this title.
    func openCall(_ title: String, file: StaticString = #filePath, line: UInt = #line) {
        app.typeKey("3", modifierFlags: .command)
        let row = app.staticTexts[title].firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 5), "no call “\(title)” in the library", file: file, line: line)
        row.click()
    }

    /// A window of the app with this title (the main window is “Noter”).
    func window(_ title: String) -> XCUIElement { app.windows[title] }

    /// The call window: a non-activating panel, which the accessibility tree lists as a dialog, not a window.
    var callWindow: XCUIElement { app.dialogs.matching(NSPredicate(format: "label != %@", "Record this call?")).firstMatch }

    /// The native alert sheet or dialog the app shows (the one with **Cancel**: the call panel is a dialog too).
    var alert: XCUIElement {
        let sheet = app.sheets.firstMatch
        return sheet.exists ? sheet : app.dialogs.containing(NSPredicate(format: "title == 'Cancel' OR label == 'Cancel'")).firstMatch
    }

    /// A global hotkey, typed while `other` is in front so it reaches Noter as a global shortcut.
    func hotkey(_ key: String) { other.typeKey(key, modifierFlags: [.control, .option, .command]) }
}
