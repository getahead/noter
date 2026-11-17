// M1 dialogs (docs/features/ui/dialogs-host.md): the native alerts have Cancel as the default button.
import XCTest

final class DialogsTests: NoterTestCase {
    func test_cpt_noter_seq_dialogs_delete_call__error_return_pressed_by_habit() {
        // Nothing recording: the live call's window would cover the library (its fixture display is not this Mac's).
        launch("idle")
        openCall("Backend sync")
        app.typeKey(.delete, modifierFlags: .command)
        let cancel = alert.buttons["Cancel"]
        XCTAssertTrue(cancel.waitForExistence(timeout: 5), "Delete Call… shows no alert")
        app.typeKey(.return, modifierFlags: [])
        XCTAssertTrue(alert.waitForNonExistence(timeout: 5), "Return closes the alert")
        app.typeKey("3", modifierFlags: .command)
        let library = app.tables["Calls"].firstMatch
        XCTAssertTrue(library.waitForExistence(timeout: 5), "⌘3 returns to the Calls library")
        let row = library.descendants(matching: .staticText)["Backend sync"]
        XCTAssertFalse(row.waitForNonExistence(timeout: 3), "Return chose Cancel: the call remains in the refreshed library")
    }

    func test_cpt_noter_seq_dialogs_delete_call__other_several_calls_selected() {
        // Nothing recording: the live call's window would cover the library (its fixture display is not this Mac's).
        launch("idle")
        openCall("Backend sync")
        app.typeKey("a", modifierFlags: .command)
        app.typeKey(.delete, modifierFlags: .command)
        XCTAssertTrue(alert.staticTexts.matching(NSPredicate(format: "value BEGINSWITH 'Delete' AND value ENDSWITH 'calls?'")).firstMatch.waitForExistence(timeout: 5))
        XCTAssertTrue(alert.buttons["Cancel"].isEnabled)
        app.typeKey(.return, modifierFlags: [])
        XCTAssertTrue(alert.waitForNonExistence(timeout: 5))
    }

    func test_cpt_noter_seq_menu_bar_control_recording__repeated_quit_keeps_one_alert() {
        launch("idle")
        startRecording()
        closeMenu()
        app.typeKey("q", modifierFlags: .command)
        XCTAssertTrue(alert.buttons["Cancel"].waitForExistence(timeout: 5))
        let quitAlerts = alerts
        app.typeKey("q", modifierFlags: .command)
        XCTAssertEqual(quitAlerts.count, 1, "a repeated quit request must not queue another alert")
        alert.buttons["Cancel"].click()
        XCTAssertTrue(waitUntil(5) { quitAlerts.count == 0 }, "Cancel should close the only quit alert")
        XCTAssertTrue(recordingLine(in: openMenu()).exists, "Cancel keeps the recording active")
    }

    func test_cpt_noter_seq_menu_bar_control_recording__macos_terminate_uses_quit_alert() {
        let terminate = FileManager.default.temporaryDirectory.appendingPathComponent("noter-terminate-\(UUID().uuidString)")
        app.launchEnvironment["NOTER_TEST_TERMINATE_APP_FILE"] = terminate.path
        defer { try? FileManager.default.removeItem(at: terminate) }
        launch("idle")
        startRecording()
        closeMenu()
        XCTAssertTrue(FileManager.default.createFile(atPath: terminate.path, contents: nil), "could not request AppKit termination")
        XCTAssertTrue(alert.buttons["Stop and Quit"].waitForExistence(timeout: 10), "the system quit path must ask before stopping a recording")
        alert.buttons["Cancel"].click()
        XCTAssertTrue(waitUntil(5) { app.state == .runningForeground }, "Cancel should leave Noter running")
    }

    func test_cpt_noter_seq_menu_bar_control_recording__quit_while_recording() {
        launch("idle")
        startRecording()
        // ⌘Q while no menu is open: an open status menu takes the keys.
        closeMenu()
        app.typeKey("q", modifierFlags: .command)
        XCTAssertTrue(alert.buttons["Stop and Quit"].waitForExistence(timeout: 5))
        app.typeKey(.return, modifierFlags: [])
        XCTAssertTrue(alert.waitForNonExistence(timeout: 5), "Return closes the alert")
        XCTAssertTrue(recordingLine(in: openMenu()).exists, "Return chose Cancel: the recording goes on")
    }

    // M3 People (docs/features/ui/people.md › Edit, merge or delete a person): Delete Person… asks with a native alert
    // whose default is Cancel; Delete removes the person and returns to People.
    func test_cpt_noter_seq_people_name_unnamed_speaker__delete_a_person() {
        launch("idle")
        // The page takes keys once it has loaded: right after launch ⌘4 can reach an empty web view.
        XCTAssertTrue(app.groups["Sidebar"].waitForExistence(timeout: 10), "the main window did not load")
        app.typeKey("4", modifierFlags: .command)
        // The web view may expose a row/cell with combined text rather than a bare static text.
        func person(_ name: String) -> XCUIElement {
            app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@ OR title CONTAINS %@", name, name)).firstMatch
        }
        let row = person("Oleg M.")
        if !row.waitForExistence(timeout: 10) {
            let tree = XCTAttachment(string: app.debugDescription)
            tree.lifetime = .keepAlways
            add(tree)
            print("PEOPLE AX TREE\n\(app.debugDescription)")
        }
        XCTAssertTrue(row.exists, "⌘4 shows People with Oleg M.")
        // The ⋯ menu is a web popover: its items are not native menu items.
        func clickDelete() {
            let item = app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS 'Delete Person' OR title CONTAINS 'Delete Person'")).firstMatch
            if !item.waitForExistence(timeout: 5) {
                let tree = XCTAttachment(string: app.debugDescription)
                tree.lifetime = .keepAlways
                add(tree)
                print("MENU AX TREE\n\(app.debugDescription)")
            }
            XCTAssertTrue(item.exists, "the ⋯ menu offers Delete Person…")
            item.click()
        }
        row.doubleClick() // opens the person, as Return does
        // The ⋯ button may be exposed as a button, a pop-up or a menu button: match by label.
        let more = app.descendants(matching: .any).matching(NSPredicate(format: "label == 'More'")).firstMatch
        if !more.waitForExistence(timeout: 5) {
            let tree = XCTAttachment(string: app.debugDescription)
            tree.lifetime = .keepAlways
            add(tree)
            print("PERSON AX TREE\n\(app.debugDescription)")
        }
        XCTAssertTrue(more.exists, "Oleg M.'s page has its ⋯ menu")
        more.click()
        clickDelete()
        XCTAssertTrue(alert.staticTexts["Delete Oleg M.?"].waitForExistence(timeout: 5), "Delete Person… shows no alert")
        app.typeKey(.return, modifierFlags: []) // Return by habit chooses Cancel
        XCTAssertTrue(alert.waitForNonExistence(timeout: 5), "Return closes the alert")
        XCTAssertTrue(more.exists, "Cancel keeps the person's page")
        more.click()
        clickDelete()
        XCTAssertTrue(alert.buttons["Delete"].waitForExistence(timeout: 5))
        alert.buttons["Delete"].click()
        XCTAssertTrue(alert.waitForNonExistence(timeout: 5))
        XCTAssertTrue(person("Anna K.").waitForExistence(timeout: 5), "the deleted person's page gives way to People")
        XCTAssertTrue(person("Oleg M.").waitForNonExistence(timeout: 5), "Oleg M. is gone from People")
    }

    // M3 People (docs/features/ui/people.md › Voice profile): Delete Profile… asks with a native alert whose default is
    // Cancel; Delete Profile removes the profile and the page offers Set Up Voice Profile… again.
    func test_cpt_noter_seq_dialogs_set_up_voice_profile__delete_profile() {
        launch("idle")
        XCTAssertTrue(app.groups["Sidebar"].waitForExistence(timeout: 10), "the main window did not load")
        app.typeKey("4", modifierFlags: .command)
        func any(_ text: String) -> XCUIElement {
            app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@ OR title CONTAINS %@", text, text)).firstMatch
        }
        func expect(_ el: XCUIElement, _ message: String) {
            if !el.waitForExistence(timeout: 10) {
                let tree = XCTAttachment(string: app.debugDescription)
                tree.lifetime = .keepAlways
                add(tree)
            }
            XCTAssertTrue(el.exists, message)
        }
        let row = any("Anna K.")
        expect(row, "⌘4 shows People with Anna K.")
        row.doubleClick()
        // a button, not the first element whose label mentions it: clicking a container's centre would miss the button
        let delete = app.descendants(matching: .button).matching(NSPredicate(format: "label CONTAINS 'Delete Profile' OR title CONTAINS 'Delete Profile'")).firstMatch
        expect(delete, "Anna K. has a voice profile to delete")
        delete.click()
        if !alert.staticTexts["Delete Anna K.'s voice profile?"].waitForExistence(timeout: 5) {
            let tree = XCTAttachment(string: app.debugDescription)
            tree.lifetime = .keepAlways
            add(tree)
            print("PROFILE AX TREE\n\(app.debugDescription)")
        }
        XCTAssertTrue(alert.staticTexts["Delete Anna K.'s voice profile?"].exists, "Delete Profile… shows no alert")
        app.typeKey(.return, modifierFlags: []) // Return by habit chooses Cancel
        XCTAssertTrue(alert.waitForNonExistence(timeout: 5), "Return closes the alert")
        XCTAssertTrue(delete.exists, "Cancel keeps the profile")
        delete.click()
        XCTAssertTrue(alert.buttons["Delete Profile"].waitForExistence(timeout: 5))
        alert.buttons["Delete Profile"].click()
        XCTAssertTrue(alert.waitForNonExistence(timeout: 5))
        expect(any("Set Up Voice Profile…"), "the profile is gone: the page offers to set one up")
    }
}
