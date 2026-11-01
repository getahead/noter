//! noter-native services (2.21, part A): launch, clipboard, save panels and the Screen Share
//! Test. The pure parts run on every system; Launch Services, Apple Events and the panels are
//! behind injected seams, so nothing here opens an app or shows a TCC prompt.

use std::cell::RefCell;
use std::path::{Path, PathBuf};

use noter_native::*;
use noter_protocol::error::ErrorCode;
use noter_protocol::model::{
    CaptureTestOutcome, HandoffTarget, LaunchPath, LaunchPlan, NoterSurface, ShareTestRow,
    ShareVisibility,
};
use noter_protocol::{PermissionState, TimestampMs};

// ── launch ─────────────────────────────────────────────────────────────────

/// A Mac with these URL schemes and apps, recording every call.
#[derive(Default)]
struct FakeMac {
    schemes: Vec<&'static str>,
    apps: Vec<&'static str>,
    denied: Vec<&'static str>,
    granted: Vec<&'static str>,
    script_status: Option<i32>,
    opened: RefCell<Vec<String>>,
    scripted: RefCell<Vec<(String, String)>>,
}

impl LaunchSystem for FakeMac {
    fn has_handler(&self, scheme: &str) -> bool {
        self.schemes.contains(&scheme)
    }
    fn has_app(&self, bundle_id: &str) -> bool {
        self.apps.contains(&bundle_id)
    }
    fn automation(&self, bundle_id: &str) -> PermissionState {
        if self.denied.contains(&bundle_id) {
            PermissionState::Denied
        } else if self.granted.contains(&bundle_id) {
            PermissionState::Granted
        } else {
            PermissionState::NotAsked
        }
    }
    fn open_url(&self, url: &str) -> bool {
        self.opened.borrow_mut().push(url.into());
        true
    }
    fn run_in_terminal(&self, bundle_id: &str, command: &str) -> Result<(), i32> {
        self.scripted
            .borrow_mut()
            .push((bundle_id.into(), command.into()));
        self.script_status.map_or(Ok(()), Err)
    }
}

fn plan(path: LaunchPath, needs_automation: bool, automation_denied: bool) -> LaunchPlan {
    LaunchPlan {
        path,
        needs_automation,
        automation_denied,
    }
}

#[test]
fn claude_prefers_the_cli_link_then_the_desktop_app_then_a_terminal() {
    let all = FakeMac {
        schemes: vec!["claude-cli", "claude", "codex"],
        apps: vec![TERMINAL_APP],
        ..FakeMac::default()
    };
    assert_eq!(
        plan_launch(&all, HandoffTarget::ClaudeCode),
        plan(LaunchPath::ClaudeCliLink, false, false)
    );
    let desktop = FakeMac {
        schemes: vec!["claude"],
        apps: vec![TERMINAL_APP],
        ..FakeMac::default()
    };
    assert_eq!(
        plan_launch(&desktop, HandoffTarget::ClaudeCode),
        plan(LaunchPath::ClaudeDesktop, false, false)
    );
    let terminal = FakeMac {
        apps: vec![TERMINAL_APP],
        ..FakeMac::default()
    };
    assert_eq!(
        plan_launch(&terminal, HandoffTarget::ClaudeCode),
        plan(LaunchPath::Terminal, true, false)
    );
    // Inspection never opens anything and never asks.
    assert!(all.opened.borrow().is_empty() && all.scripted.borrow().is_empty());
}

#[test]
fn codex_prefers_its_app_and_iterm_wins_over_terminal() {
    let codex = FakeMac {
        schemes: vec!["claude-cli", "codex"],
        apps: vec![TERMINAL_APP],
        ..FakeMac::default()
    };
    assert_eq!(
        plan_launch(&codex, HandoffTarget::Codex),
        plan(LaunchPath::CodexApp, false, false)
    );
    // The Claude links never serve Codex.
    let iterm = FakeMac {
        schemes: vec!["claude-cli", "claude"],
        apps: vec![TERMINAL_APP, ITERM_APP],
        granted: vec![ITERM_APP],
        ..FakeMac::default()
    };
    assert_eq!(
        plan_launch(&iterm, HandoffTarget::Codex),
        plan(LaunchPath::Iterm, false, false)
    );
}

#[test]
fn the_plan_reports_denied_automation_and_nothing_to_launch() {
    let denied = FakeMac {
        apps: vec![TERMINAL_APP],
        denied: vec![TERMINAL_APP],
        ..FakeMac::default()
    };
    assert_eq!(
        plan_launch(&denied, HandoffTarget::ClaudeCode),
        plan(LaunchPath::Terminal, false, true)
    );
    assert_eq!(
        plan_launch(&FakeMac::default(), HandoffTarget::Codex),
        plan(LaunchPath::None, false, false)
    );
}

fn request(target: HandoffTarget, cwd: &str) -> LaunchRequest {
    LaunchRequest {
        target,
        cwd: PathBuf::from(cwd),
        prompt_file: PathBuf::from("/Users/me/Noter/handoffs/itm_1.md"),
    }
}

#[test]
fn a_link_carries_only_the_encoded_cwd_and_the_read_file_instruction() {
    let mac = FakeMac {
        schemes: vec!["claude-cli"],
        ..FakeMac::default()
    };
    let req = request(
        HandoffTarget::ClaudeCode,
        "/Users/me/src/Ünïcode repo & $(rm -rf ~)",
    );
    let outcome = launch_with(&mac, LaunchPath::ClaudeCliLink, &req).unwrap();
    assert_eq!(outcome.used, LaunchPath::ClaudeCliLink);
    let url = &mac.opened.borrow()[0];
    assert_eq!(url, &outcome.detail);
    assert_eq!(
        url,
        "claude-cli://open?cwd=%2FUsers%2Fme%2Fsrc%2F%C3%9Cn%C3%AFcode%20repo%20%26%20%24%28rm%20-rf%20~%29\
         &q=Read%20%2FUsers%2Fme%2FNoter%2Fhandoffs%2Fitm_1.md%20and%20follow%20the%20handoff%20in%20it."
    );
    assert_eq!(
        read_instruction(&req.prompt_file),
        "Read /Users/me/Noter/handoffs/itm_1.md and follow the handoff in it."
    );
}

#[test]
fn a_handler_that_disappeared_or_does_not_match_the_target_opens_nothing() {
    let gone = FakeMac::default();
    let claude = request(HandoffTarget::ClaudeCode, "/repo");
    assert_eq!(
        launch_with(&gone, LaunchPath::ClaudeDesktop, &claude).unwrap_err(),
        ErrorCode::NoLinkHandler
    );
    let codex_only = FakeMac {
        schemes: vec!["codex", "claude-cli"],
        ..FakeMac::default()
    };
    let codex = request(HandoffTarget::Codex, "/repo");
    assert_eq!(
        launch_with(&codex_only, LaunchPath::ClaudeCliLink, &codex).unwrap_err(),
        ErrorCode::NoLinkHandler
    );
    assert_eq!(
        launch_with(&codex_only, LaunchPath::None, &codex).unwrap_err(),
        ErrorCode::NoLinkHandler
    );
    assert!(gone.opened.borrow().is_empty() && codex_only.opened.borrow().is_empty());
}

#[test]
fn the_terminal_gets_the_command_as_data_prefilled_and_unsent() {
    let mac = FakeMac {
        apps: vec![TERMINAL_APP],
        ..FakeMac::default()
    };
    let req = request(HandoffTarget::Codex, "/Users/me/it's \"repo\"");
    let outcome = launch_with(&mac, LaunchPath::Terminal, &req).unwrap();
    assert_eq!(outcome.used, LaunchPath::Terminal);
    let (app, command) = mac.scripted.borrow()[0].clone();
    assert_eq!(app, TERMINAL_APP);
    assert_eq!(command, outcome.detail);
    // cd, then the tool line pushed into the shell's edit buffer (zsh `print -z`): never run.
    assert_eq!(
        command,
        terminal_command(
            HandoffTarget::Codex,
            &req.cwd,
            &read_instruction(&req.prompt_file)
        )
    );
    assert_eq!(
        command,
        r#"cd -- '/Users/me/it'\''s "repo"' && print -z -- 'codex '\''Read /Users/me/Noter/handoffs/itm_1.md and follow the handoff in it.'\'''"#
    );
}

#[test]
fn shell_quoting_keeps_any_text_one_literal_word() {
    for nasty in [
        "plain",
        "it's",
        "$(rm -rf ~) `id` ; | & > <",
        "Ünïcode 日本語 \"quoted\" \\back",
        "new\nline",
        "",
    ] {
        let out = std::process::Command::new("/bin/sh")
            .arg("-c")
            .arg(format!("printf %s {}", shell_quote(nasty)))
            .output()
            .unwrap();
        assert_eq!(String::from_utf8(out.stdout).unwrap(), nasty);
    }
}

#[test]
fn denied_automation_refuses_without_trying_another_route() {
    let denied = FakeMac {
        schemes: vec!["claude-cli"],
        apps: vec![TERMINAL_APP],
        denied: vec![TERMINAL_APP],
        ..FakeMac::default()
    };
    let req = request(HandoffTarget::ClaudeCode, "/repo");
    assert_eq!(
        launch_with(&denied, LaunchPath::Terminal, &req).unwrap_err(),
        ErrorCode::AutomationDenied
    );
    assert!(denied.scripted.borrow().is_empty() && denied.opened.borrow().is_empty());
    // Denied at the prompt the launch itself raised.
    let at_prompt = FakeMac {
        apps: vec![ITERM_APP],
        script_status: Some(-1743),
        ..FakeMac::default()
    };
    assert_eq!(
        launch_with(&at_prompt, LaunchPath::Iterm, &req).unwrap_err(),
        ErrorCode::AutomationDenied
    );
    assert!(at_prompt.opened.borrow().is_empty());
}

#[test]
fn apple_event_failures_map_to_typed_errors() {
    assert_eq!(apple_event_error(-1743), ErrorCode::AutomationDenied);
    assert_eq!(apple_event_error(-600), ErrorCode::NoLinkHandler);
    assert_eq!(apple_event_error(-10814), ErrorCode::NoLinkHandler);
    assert_eq!(apple_event_error(-1708), ErrorCode::Internal);
    let missing = FakeMac::default();
    let req = request(HandoffTarget::ClaudeCode, "/repo");
    assert_eq!(
        launch_with(&missing, LaunchPath::Iterm, &req).unwrap_err(),
        ErrorCode::NoLinkHandler
    );
}

// ── clipboard ──────────────────────────────────────────────────────────────

#[test]
fn one_pasteboard_item_carries_plain_markdown_and_html() {
    let rich = ClipboardText {
        plain: "Ship it".into(),
        markdown: Some("**Ship** it".into()),
        html: Some("<b>Ship</b> it".into()),
    };
    assert_eq!(
        pasteboard_entries(&rich),
        vec![
            ("public.utf8-plain-text", "Ship it"),
            ("net.daringfireball.markdown", "**Ship** it"),
            ("public.html", "<b>Ship</b> it"),
        ]
    );
    let plain = ClipboardText {
        plain: "only".into(),
        markdown: None,
        html: None,
    };
    assert_eq!(
        pasteboard_entries(&plain),
        vec![("public.utf8-plain-text", "only")]
    );
}

#[cfg(target_os = "macos")]
#[test]
fn the_pasteboard_reads_back_every_representation() {
    // A private pasteboard: the user's clipboard is never touched.
    let name = format!("ai.noter.test.{}", std::process::id());
    let rich = ClipboardText {
        plain: "Ship it — ü".into(),
        markdown: Some("**Ship** it".into()),
        html: Some("<b>Ship</b> it".into()),
    };
    clipboard_write_to(&name, &rich).unwrap();
    for (uti, text) in pasteboard_entries(&rich) {
        assert_eq!(clipboard_read(&name, uti).as_deref(), Some(text), "{uti}");
    }
    let plain = ClipboardText {
        plain: "second".into(),
        markdown: None,
        html: None,
    };
    clipboard_write_to(&name, &plain).unwrap();
    // The write replaced every earlier representation.
    assert_eq!(clipboard_read(&name, "public.html"), None);
    assert_eq!(
        clipboard_read(&name, "public.utf8-plain-text").as_deref(),
        Some("second")
    );
    clipboard_release(&name);
}

// ── panels ─────────────────────────────────────────────────────────────────

fn panel(name: &str, folder: bool) -> PanelRequest {
    PanelRequest {
        suggested_name: name.into(),
        extensions: vec!["md".into()],
        folder,
        parent: None,
    }
}

#[test]
fn a_cancelled_panel_answers_none() {
    let mut asked = Vec::new();
    let answer = save_panel_with(&panel("Call 31/10: review", false), |req| {
        asked.push(req.suggested_name.clone());
        None
    });
    assert_eq!(answer, None);
    // Slashes and colons would be read as folders by the panel.
    assert_eq!(asked, ["Call 31-10- review"]);
}

#[test]
fn a_chosen_path_comes_back_and_an_empty_name_gets_a_default() {
    let chosen = save_panel_with(&panel("  ", true), |req| {
        assert!(req.folder);
        assert_eq!(req.suggested_name, "Untitled");
        Some(Path::new("/Users/me/Exports").to_path_buf())
    });
    assert_eq!(chosen, Some(PathBuf::from("/Users/me/Exports")));
}

// ── share test ─────────────────────────────────────────────────────────────

fn row(
    surface: NoterSurface,
    window: ShareVisibility,
    app: ShareVisibility,
    display: ShareVisibility,
) -> ShareTestRow {
    ShareTestRow {
        surface,
        window_share: window,
        app_share: app,
        display_share: display,
    }
}

#[test]
fn visibility_follows_protection_and_what_is_on_screen() {
    use ShareVisibility::*;
    let facts = [
        SurfaceFacts {
            surface: NoterSurface::CallWindow,
            shown: true,
            protected: true,
        },
        SurfaceFacts {
            surface: NoterSurface::MainWindow,
            shown: true,
            protected: false,
        },
        SurfaceFacts {
            surface: NoterSurface::MenuBarTitle,
            shown: true,
            protected: false,
        },
        // Hidden for presenting: ordered out.
        SurfaceFacts {
            surface: NoterSurface::SettingsWindow,
            shown: false,
            protected: false,
        },
    ];
    assert_eq!(
        share_rows(&facts),
        vec![
            // Excluded from window and app shares; a whole-display capture still sees it.
            row(NoterSurface::CallWindow, Hidden, Hidden, Visible),
            // The record prompt is not open: nothing to see.
            row(NoterSurface::RecordPrompt, Hidden, Hidden, Hidden),
            // Over another window, whether it shows depends on how the meeting app captures.
            row(
                NoterSurface::MainWindow,
                DependsOnApp,
                DependsOnApp,
                Visible
            ),
            row(NoterSurface::SettingsWindow, Hidden, Hidden, Hidden),
            // The menu bar belongs to the display only.
            row(NoterSurface::MenuBarTitle, Hidden, Hidden, Visible),
        ]
    );
}

#[test]
fn the_probe_runs_only_when_asked_and_never_during_a_call() {
    let at = TimestampMs(1_700_000_000_000);
    let never = || -> Result<(), ErrorCode> { panic!("the probe must not run") };
    assert_eq!(
        capture_outcome(false, false, at, never),
        CaptureTestOutcome::NotRun
    );
    assert_eq!(
        capture_outcome(false, true, at, never),
        CaptureTestOutcome::NotRun
    );
    assert_eq!(
        capture_outcome(true, true, at, never),
        CaptureTestOutcome::BlockedByCall
    );
    assert_eq!(
        capture_outcome(true, false, at, || Ok(())),
        CaptureTestOutcome::Passed { at }
    );
    assert_eq!(
        capture_outcome(true, false, at, || Err(ErrorCode::PermissionDenied)),
        CaptureTestOutcome::Failed {
            code: ErrorCode::PermissionDenied
        }
    );
    // A fresh request after a failure probes again: nothing is remembered.
    assert_eq!(
        capture_outcome(true, false, at, || Ok(())),
        CaptureTestOutcome::Passed { at }
    );
}

#[test]
fn screen_recording_states_map_to_probe_failures() {
    assert_eq!(screen_recording_error(PermissionState::Granted), None);
    assert_eq!(
        screen_recording_error(PermissionState::Denied),
        Some(ErrorCode::PermissionDenied)
    );
    assert_eq!(
        screen_recording_error(PermissionState::NeedsRelaunch),
        Some(ErrorCode::PermissionMissing)
    );
    assert_eq!(
        screen_recording_error(PermissionState::NotAsked),
        Some(ErrorCode::PermissionMissing)
    );
}

#[test]
fn the_probe_fails_when_a_protected_surface_would_be_captured() {
    let leak = WindowState {
        on_screen: true,
        shareable: true,
    };
    let excluded = WindowState {
        on_screen: true,
        shareable: false,
    };
    assert_eq!(protected_leak(&[excluded, excluded]), Ok(()));
    assert_eq!(protected_leak(&[excluded, leak]), Err(ErrorCode::Internal));
    // A window that is not on screen cannot leak.
    assert_eq!(
        protected_leak(&[WindowState {
            on_screen: false,
            shareable: true
        }]),
        Ok(())
    );
}
