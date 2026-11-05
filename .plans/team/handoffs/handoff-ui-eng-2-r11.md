# ui-eng-2 r11 handoff: 2.12 menu-bar host (D-39), core lane

Landed:
- #219: core `tray.rs` builds the whole menu-bar content. Template glyphs and eye-slash forms (`icons/tray/`), title, VoiceOver label, MB-R2 lines, MB-R3/R4/R5/R7 items in order with registered hotkeys. A 1 s ticker updates the open menu in place. Every item is wired to its command.
- #222: quit-while-recording alert (catalogue strings, Cancel default, Stop and Quit), Noter's own ⌘Q app-menu item, the three menu-bar flows marked, the NT-3 click shows the call window, Open Call Screen ends hidden mode.
- Ticked:
  - menu-bar.md: glyph algo, status-item state, all three flows, and AC rows "Start Recording in every setup state" and "template glyphs".
  - dialogs-host.md: quit flow, `dod-ui-dialogs-host-delete`.
  - notifications.md: receive flow, `dod-ui-notifications-content`.

Left `[ ]`, with reasons:
- menu-bar `inst-mbr6-7`: **Next: <event> <time>** needs a calendar read, and M1 has none (`calendar_event_near` answers None, `today_get` is not implemented). So `algo-ui-menu-bar-build-menu`, `dod-ui-menu-bar-content`, featstatus and the feature line stay open. Everything else in build-menu is ticked.
- `dod-ui-menu-bar-native-tests` and AC rows "every MB_STATES by XCUITest" and "no dialog but the quit alert": ui-e2e's XCUITest (#203).
- Known M1 gaps, stated in #219: the second line has no languages; the closing line has no "Summary in about 2 minutes" (M2).

For ui-e2e (#203): no XCUITest expectation contradicts menu-bar.md. Watch in-place text updates of the open menu (Paused for 5 min), `statusItem.label`, and that ⌘Q is the app-menu item `AppQuit`.
