// The app under test: the debug bundle `just native` builds (TEST_RUNNER_NOTER_APP_PATH), launched with the
// command log directory (TEST_RUNNER_NOTER_E2E_LOG_DIR) so what the core ran counts toward the E2E bar, on the
// harness's scripted Mac, engine and models (the launch hooks, NOTER_TEST_FIXTURE): no model, permission or call
// of the machine it runs on is needed.
// Story tests are named after the DESIGN story they prove (`cpt-noter-seq-…` with underscores, docs/HARNESS.md).
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
    /// `scenario` (`idle`, `low-disk`, `detected`, `new-meeting`, `call-seems-ended`, `switched-to-local`, `first-call`), or with
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

    /// The key macOS draws next to a menu item of the open status menu (AXMenuItemCmdChar), or nil when the item
    /// shows none. XCUITest does not expose the attribute, and the runner is not trusted for accessibility (a direct
    /// AXUIElement read fails with kAXErrorAPIDisabled), so it is read through XCUITest's own accessibility interface.
    // shortcut: private XCUIAutomation API (XCUIDevice.accessibilityInterface, XCElementSnapshot.accessibilityElement);
    // switch to a public one if XCUITest ever exposes key equivalents.
    func keyOf(_ title: String, file: StaticString = #filePath, line: UInt = #line) -> String? {
        typealias Attributes = @convention(c) (AnyObject, Selector, AnyObject, NSArray, UnsafeMutablePointer<NSError?>?) -> NSDictionary?
        let item = statusItem.menus.firstMatch.menuItems[title]
        guard let snapshot = try? item.snapshot() as AnyObject, let element = snapshot.value(forKey: "accessibilityElement"),
              let interface = (XCUIDevice.shared as NSObject).value(forKey: "accessibilityInterface") as? NSObject
        else { XCTFail("menu item “\(title)” has no accessibility element", file: file, line: line); return nil }
        let selector = NSSelectorFromString("attributesForElement:attributes:error:")
        let read = unsafeBitCast(interface.method(for: selector), to: Attributes.self)
        var error: NSError?
        let attributes = read(interface, selector, element as AnyObject, ["AXMenuItemCmdChar"], &error)
        XCTAssertNil(error, "could not read the key of “\(title)”", file: file, line: line)
        let key = attributes?["AXMenuItemCmdChar"] as? String
        return key?.isEmpty == false ? key : nil
    }

    /// Opens Calls (⌘3) and selects the call with this title.
    func openCall(_ title: String, file: StaticString = #filePath, line: UInt = #line) {
        // The page takes keys once it has loaded: right after launch ⌘3 can reach an empty web view.
        XCTAssertTrue(app.groups["Sidebar"].waitForExistence(timeout: 10), "the main window did not load", file: file, line: line)
        app.typeKey("3", modifierFlags: .command)
        let row = app.staticTexts[title].firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 5), "no call “\(title)” in the library", file: file, line: line)
        row.click()
    }

    /// A window of the app with this title (the main window is “Noter”).
    func window(_ title: String) -> XCUIElement { app.windows[title] }

    /// The call window: a non-activating panel, which the accessibility tree lists as a dialog, not a window.
    var callWindow: XCUIElement { app.dialogs.matching(NSPredicate(format: "label != %@", "Record this call?")).firstMatch }

    /// The native alert the app shows: a sheet on its window, or a dialog when no window parents it (the one with
    /// **Cancel**: the call panel is a dialog too). One lazy query, so a wait sees the alert whenever it appears.
    var alert: XCUIElement {
        let sheetOrDialog = NSPredicate(format: "elementType == %d OR elementType == %d",
                                        XCUIElement.ElementType.sheet.rawValue, XCUIElement.ElementType.dialog.rawValue)
        return app.descendants(matching: .any).matching(sheetOrDialog)
            .containing(NSPredicate(format: "title == 'Cancel' OR label == 'Cancel'")).firstMatch
    }

    /// The record prompt: a panel titled Noter around the group “Record this call?”.
    var recordPrompt: XCUIElement { app.dialogs.containing(NSPredicate(format: "label == 'Record this call?'")).firstMatch }

    /// Clicks `element` as a user clicks the menu bar: XCUITest activates the app whose element it clicks, so the
    /// click goes through `other`, which stays in front unless Noter itself takes focus.
    func clickKeepingFocus(_ element: XCUIElement) {
        let (at, origin) = (element.frame, other.frame.origin)
        other.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: at.midX - origin.x, dy: at.midY - origin.y)).click()
    }

    /// A global hotkey, typed while `other` is in front so it reaches Noter as a global shortcut.
    func hotkey(_ key: String) { other.typeKey(key, modifierFlags: [.control, .option, .command]) }
}
