//! FEATURE cpt-noter-feature-core-first-run: the host's `NativeServices` over `noter-native`.

use noter_core::NativeServices;
use noter_desktop::Mac;
use noter_protocol::{PermissionKind, PermissionState};

#[test]
fn the_mac_reads_the_environment_of_the_storage_volume() {
    let dir = tempfile::tempdir().unwrap();
    let mac = Mac::new(dir.path());
    assert!(mac.environment().disk_free_mb > 0);
}

#[test]
fn system_audio_is_never_asked_through_the_mac() {
    let mac = Mac::new(&std::env::temp_dir());
    assert_eq!(
        mac.permission(PermissionKind::SystemAudio),
        PermissionState::NotAsked
    );
    let asked = tauri::async_runtime::block_on(mac.request_permission(PermissionKind::SystemAudio));
    assert_eq!(asked, PermissionState::NotAsked);
}

#[test]
fn a_login_item_macos_refuses_is_an_error_the_core_logs() {
    // A test binary is not an app bundle: SMAppService answers an error or "not found".
    let mac = Mac::new(&std::env::temp_dir());
    if let Err(e) = mac.set_login_item(false) {
        assert!(!e.message.is_empty());
    }
}

#[test]
fn the_calendar_is_read_only_with_access_and_never_asked_here() {
    // A test binary has no calendar access: no event, and no prompt.
    let mac = Mac::new(&std::env::temp_dir());
    assert_eq!(
        mac.calendar_event_near(noter_protocol::TimestampMs(1_790_000_000_000)),
        None
    );
}

// FEATURE cpt-noter-feature-core-native-services: the host's `NativeOps` over `noter-native`,
// with the window server, the panel and the pasteboard behind seams a test can stand in for.

use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::thread::ThreadId;

use noter_core::{ClipboardText, NativeOps, SaveKind};
use noter_desktop::{MacOps, Windows};
use noter_native::{PanelRequest, ParentWindow};
use noter_protocol::model::*;
use noter_protocol::{ErrorCode, TimestampMs};

/// Windows the test describes: their ids, and no focused window (a free panel).
struct TestWindows(Vec<(NoterSurface, u32)>);

impl Windows for TestWindows {
    fn ids(&self) -> Vec<(NoterSurface, u32)> {
        self.0.clone()
    }
    fn focused(&self) -> Option<ParentWindow> {
        None
    }
}

fn no_windows() -> Arc<dyn Windows> {
    Arc::new(TestWindows(vec![]))
}

/// The panels shown, and on which thread.
static PANELS: Mutex<Vec<(PanelRequest, ThreadId)>> = Mutex::new(Vec::new());

fn chooses(req: &PanelRequest) -> Option<PathBuf> {
    PANELS
        .lock()
        .unwrap()
        .push((req.clone(), std::thread::current().id()));
    Some(PathBuf::from("/Users/me/Exports").join(&req.suggested_name))
}

fn cancels(_: &PanelRequest) -> Option<PathBuf> {
    None
}

fn no_pasteboard(_: &noter_native::ClipboardText) -> Result<(), String> {
    Err("no pasteboard in this test".into())
}

#[test]
fn the_save_panel_is_shown_off_the_async_runtime_with_the_kind_asked() {
    let ops = MacOps::with(no_windows(), chooses, no_pasteboard);
    let me = std::thread::current().id();
    let chosen =
        tauri::async_runtime::block_on(ops.save_panel("Week 44: notes", SaveKind::Markdown));
    assert_eq!(
        chosen,
        Some(PathBuf::from("/Users/me/Exports/Week 44: notes"))
    );
    let folder = tauri::async_runtime::block_on(ops.save_panel("noter", SaveKind::Folder));
    assert_eq!(folder, Some(PathBuf::from("/Users/me/Exports/noter")));
    let shown = std::mem::take(&mut *PANELS.lock().unwrap());
    let (file, file_thread) = &shown[0];
    assert_eq!(file.extensions, ["md"]);
    assert!(!file.folder);
    assert_eq!(file.parent, None);
    let (dir, dir_thread) = &shown[1];
    assert!(dir.folder);
    assert!(dir.extensions.is_empty());
    // Never on the thread that awaits: the main thread may be waiting on the runtime (#233).
    assert_ne!(*file_thread, me);
    assert_ne!(*dir_thread, me);
}

#[test]
fn a_cancelled_panel_answers_no_path() {
    let ops = MacOps::with(no_windows(), cancels, no_pasteboard);
    let json = tauri::async_runtime::block_on(ops.save_panel("history", SaveKind::Json));
    assert_eq!(json, None);
}

#[cfg(target_os = "macos")]
fn private_pasteboard(text: &noter_native::ClipboardText) -> Result<(), String> {
    noter_native::clipboard_write_to("dev.noter.tests.macops", text)
}

#[cfg(target_os = "macos")]
#[test]
fn the_clipboard_carries_the_rich_forms_and_the_plain_text() {
    let ops = MacOps::with(no_windows(), cancels, private_pasteboard);
    let text = ClipboardText {
        plain: "Ship the fix".into(),
        markdown: Some("**Ship** the fix".into()),
        html: Some("<b>Ship</b> the fix".into()),
    };
    tauri::async_runtime::block_on(ops.clipboard_write(&text)).unwrap();
    let read = |uti| noter_native::clipboard_read("dev.noter.tests.macops", uti);
    assert_eq!(
        read("public.utf8-plain-text").as_deref(),
        Some("Ship the fix")
    );
    assert_eq!(
        read("net.daringfireball.markdown").as_deref(),
        Some("**Ship** the fix")
    );
    assert_eq!(read("public.html").as_deref(), Some("<b>Ship</b> the fix"));
    noter_native::clipboard_release("dev.noter.tests.macops");
}

#[test]
fn a_refused_clipboard_write_is_an_error() {
    let ops = MacOps::with(no_windows(), cancels, no_pasteboard);
    let text = ClipboardText {
        plain: "x".into(),
        markdown: None,
        html: None,
    };
    assert!(tauri::async_runtime::block_on(ops.clipboard_write(&text)).is_err());
}

#[test]
fn the_share_test_reports_every_surface_and_never_probes_during_a_call() {
    // No window the window server knows: every window is closed, so no share sees it.
    let ops = MacOps::with(
        Arc::new(TestWindows(vec![(NoterSurface::MainWindow, u32::MAX)])),
        cancels,
        no_pasteboard,
    );
    let at = TimestampMs(1_792_137_600_000);
    let args = |run_capture_test| ShareTestArgs { run_capture_test };
    let quiet =
        tauri::async_runtime::block_on(ops.share_test(&args(false), false, true, at)).unwrap();
    let surfaces: Vec<_> = quiet.rows.iter().map(|r| r.surface).collect();
    assert_eq!(
        surfaces,
        [
            NoterSurface::CallWindow,
            NoterSurface::RecordPrompt,
            NoterSurface::MainWindow,
            NoterSurface::SettingsWindow,
            NoterSurface::MenuBarTitle,
        ]
    );
    assert_eq!(quiet.rows[2].display_share, ShareVisibility::Hidden);
    // The menu bar title is on screen: only a whole-display share shows it.
    assert_eq!(quiet.rows[4].window_share, ShareVisibility::Hidden);
    assert_eq!(quiet.rows[4].display_share, ShareVisibility::Visible);
    assert_eq!(quiet.capture_test, CaptureTestOutcome::NotRun);
    let live =
        tauri::async_runtime::block_on(ops.share_test(&args(true), true, false, at)).unwrap();
    assert_eq!(live.capture_test, CaptureTestOutcome::BlockedByCall);
    assert_eq!(live.rows[4].display_share, ShareVisibility::Hidden);
}

#[test]
fn a_launch_without_its_handler_fails_typed() {
    // Nothing to launch by: the plan's `none` path never opens anything.
    let ops = MacOps::with(no_windows(), cancels, no_pasteboard);
    let req = noter_core::LaunchRequest {
        target: HandoffTarget::ClaudeCode,
        cwd: std::env::temp_dir(),
        prompt_file: std::env::temp_dir().join("prompt.md"),
    };
    let got = tauri::async_runtime::block_on(ops.launch(LaunchPath::None, &req));
    assert_eq!(got, Err(ErrorCode::NoLinkHandler));
}

// FEATURE cpt-noter-feature-core-handoff, AC "long prompts use a short file instruction below
// the query cap": `q` carries only the instruction to read the prompt file, never the prompt.
#[test]
fn a_long_prompt_travels_as_a_short_file_instruction_below_the_query_cap() {
    // claude-cli://open caps `q` at 5,000 characters (PRD › Handoff).
    const Q_CAP: usize = 5_000;
    let dir = tempfile::tempdir().unwrap();
    let prompt_file = dir
        .path()
        .join("Application Support/Noter/handoffs/itm_ünïcode $(whoami) 'quote'.md");
    std::fs::create_dir_all(prompt_file.parent().unwrap()).unwrap();
    let prompt = "Ship the fix; `touch pwned` && echo $HOME\n".repeat(2_000);
    std::fs::write(&prompt_file, &prompt).unwrap();
    let instruction = noter_native::read_instruction(&prompt_file);
    let cwd = dir.path().join("vhi frontend");
    let url = noter_native::link_url(LaunchPath::ClaudeCliLink, &cwd, &instruction).unwrap();
    let q = url.split("&q=").nth(1).unwrap();
    assert!(q.len() < Q_CAP, "q is {} characters", q.len());
    assert!(!url.contains("touch"), "the link carries the prompt's text");
    // Percent-encoded: no shell or URL syntax survives as itself.
    assert!(!q.contains(['$', '\'', ' ', '&', '(', '`']), "{q}");
    // Only claude-cli://open carries the prompt; the desktop apps drop `cwd` or `q` (D-33).
    for path in [LaunchPath::ClaudeDesktop, LaunchPath::CodexApp] {
        assert_eq!(noter_native::link_url(path, &cwd, &instruction), None);
    }
    assert!(instruction.contains(&*prompt_file.to_string_lossy()));
}
