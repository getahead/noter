# ui-e2e r2 handoff
- Branch lane/ui/native-tests @ 9f2c804, draft PR #203 (XCUITest suite, 25 tests, project apps/desktop/tests/native/NoterNativeTests.xcodeproj). gate-fast green (engine/.build moved aside to scratchpad: arch flags skipped Swift tests in its checkouts).
- just native NOT completed: xcodebuild hangs at "Writing result bundle" waiting for UI-automation authorization (owner items in PR body). No per-test results yet.
- Recipe bug: "pnpm --dir apps/desktop tauri build" fails on pnpm 10.28; use "pnpm --dir apps/desktop exec tauri build --debug --bundles app" (harness owner). App is at apps/desktop/src-tauri/target/debug/bundle/macos/Noter.app, so set NOTER_APP_PATH.
- App boots the real core without fixture world: state-dependent tests need a steering mechanism.
- NOT done: assertion-drift list for #197/#191 copies (D-36 "Audio deleted", world_set keys) and aligning lane/ui/e2e-m1.
- Next: after owner enables automation, run just native, paste pass/fail in PR #203; then QA.
