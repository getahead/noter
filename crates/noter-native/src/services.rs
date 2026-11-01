//! Native services for M2 (`docs/features/core/core-native-services.md`): launch through
//! Launch Services or Apple Events, rich clipboard writes, save and folder panels, and the
//! Screen Share Test's visibility rows and optional capture probe. Mechanisms only: which
//! prompt to launch, what to export and what the result means for an item belong to the
//! calling service. The decisions are plain functions over injected seams; the macOS half is
//! in `mac_services`.

use std::ffi::c_void;
use std::path::{Path, PathBuf};
use std::ptr::NonNull;

use noter_protocol::error::ErrorCode;
use noter_protocol::model::{
    CaptureTestOutcome, HandoffTarget, LaunchPath, LaunchPlan, NoterSurface, ShareTestArgs,
    ShareTestResult, ShareTestRow, ShareVisibility,
};
use noter_protocol::{PermissionKind, PermissionState, TimestampMs};

// ── launch ─────────────────────────────────────────────────────────────────

pub const TERMINAL_APP: &str = "com.apple.Terminal";
pub const ITERM_APP: &str = "com.googlecode.iterm2";

/// What a launch needs from macOS; [`launch_plan`] and [`launch`] use the Mac's own.
pub trait LaunchSystem {
    /// Whether Launch Services has an app for this URL scheme. Opens nothing.
    fn has_handler(&self, scheme: &str) -> bool;
    /// Whether the app with this bundle id is installed.
    fn has_app(&self, bundle_id: &str) -> bool;
    /// Whether Noter may send Apple Events to that app, without asking.
    fn automation(&self, bundle_id: &str) -> PermissionState;
    fn open_url(&self, url: &str) -> bool;
    /// Runs Noter's fixed open-in-a-new-window script in the terminal app with `command` as
    /// its argument (data, never script source). macOS asks for Automation the first time.
    /// `Err` carries the Apple Event status.
    fn run_in_terminal(&self, bundle_id: &str, command: &str) -> Result<(), i32>;
}

/// An explicit launch the handoff service asked for.
#[derive(Debug, Clone, PartialEq)]
pub struct LaunchRequest {
    pub target: HandoffTarget,
    /// The mapped repository folder the tool opens in.
    pub cwd: PathBuf,
    /// The saved prompt; only its path travels, never its text.
    pub prompt_file: PathBuf,
}

/// The path actually used: a URL handler (`claude_cli_link`, `claude_desktop`, `codex_app`)
/// or a terminal driven by Apple Events (`terminal`, `iterm`). `detail` is the URL opened or
/// the line typed into the terminal.
#[derive(Debug, Clone, PartialEq)]
pub struct LaunchOutcome {
    pub used: LaunchPath,
    pub detail: String,
}

fn scheme(path: LaunchPath) -> Option<&'static str> {
    match path {
        LaunchPath::ClaudeCliLink => Some("claude-cli"),
        LaunchPath::ClaudeDesktop => Some("claude"),
        LaunchPath::CodexApp => Some("codex"),
        _ => None,
    }
}

fn terminal_app(path: LaunchPath) -> Option<&'static str> {
    match path {
        LaunchPath::Terminal => Some(TERMINAL_APP),
        LaunchPath::Iterm => Some(ITERM_APP),
        _ => None,
    }
}

/// The URL handlers that serve `target`, most preferred first.
fn links(target: HandoffTarget) -> &'static [LaunchPath] {
    match target {
        HandoffTarget::ClaudeCode => &[LaunchPath::ClaudeCliLink, LaunchPath::ClaudeDesktop],
        HandoffTarget::Codex => &[LaunchPath::CodexApp],
    }
}

// @cpt-begin:cpt-noter-flow-core-native-services-operation:p1:inst-op-plan
/// The path a launch would take now: the target's first registered URL handler, else iTerm,
/// else Terminal, with Automation as macOS reports it. Never opens anything or asks.
pub fn plan_launch(sys: &impl LaunchSystem, target: HandoffTarget) -> LaunchPlan {
    let path = links(target)
        .iter()
        .copied()
        .find(|&p| scheme(p).is_some_and(|s| sys.has_handler(s)))
        .or_else(|| {
            [LaunchPath::Iterm, LaunchPath::Terminal]
                .into_iter()
                .find(|&p| terminal_app(p).is_some_and(|app| sys.has_app(app)))
        })
        .unwrap_or(LaunchPath::None);
    let automation = terminal_app(path).map(|app| sys.automation(app));
    LaunchPlan {
        path,
        needs_automation: automation == Some(PermissionState::NotAsked),
        automation_denied: automation == Some(PermissionState::Denied),
    }
}
// @cpt-end:cpt-noter-flow-core-native-services-operation:p1:inst-op-plan

/// [`plan_launch`] on this Mac (no handlers elsewhere).
pub fn launch_plan(target: HandoffTarget) -> LaunchPlan {
    plan_launch(&system(), target)
}

/// The short instruction the tool is pre-filled with.
pub fn read_instruction(prompt_file: &Path) -> String {
    format!(
        "Read {} and follow the handoff in it.",
        prompt_file.display()
    )
}

/// RFC 3986 percent-encoding of everything but the unreserved characters.
pub fn percent_encode(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                (b as char).to_string()
            }
            _ => format!("%{b:02X}"),
        })
        .collect()
}

/// The URL for a link path. The design names `claude-cli://open?cwd=…&q=…`; the desktop apps
/// get the same two parameters.
pub fn link_url(path: LaunchPath, cwd: &Path, instruction: &str) -> Option<String> {
    let base = match path {
        LaunchPath::ClaudeCliLink => "claude-cli://open",
        LaunchPath::ClaudeDesktop => "claude://code/new",
        LaunchPath::CodexApp => "codex://new",
        _ => return None,
    };
    Some(format!(
        "{base}?cwd={}&q={}",
        percent_encode(&cwd.to_string_lossy()),
        percent_encode(instruction)
    ))
}

/// `s` as one literal POSIX shell word.
pub fn shell_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', r"'\''"))
}

/// The line typed into a new terminal window: change to `cwd`, then push the tool's command
/// into the shell's edit buffer, so it shows at the prompt and runs only when the user
/// presses Return.
/// shortcut: `print -z` is zsh (the macOS default shell); a bash or fish login shell says
/// "command not found" and the user types the line; detect the shell if anyone uses one.
pub fn terminal_command(target: HandoffTarget, cwd: &Path, instruction: &str) -> String {
    let tool = match target {
        HandoffTarget::ClaudeCode => "claude",
        HandoffTarget::Codex => "codex",
    };
    let line = format!("{tool} {}", shell_quote(instruction));
    format!(
        "cd -- {} && print -z -- {}",
        shell_quote(&cwd.to_string_lossy()),
        shell_quote(&line)
    )
}

/// An Apple Event status from the terminal script as the launch's error.
pub fn apple_event_error(status: i32) -> ErrorCode {
    match status {
        -1743 => ErrorCode::AutomationDenied, // errAEEventNotPermitted
        // procNotFound, kLSApplicationNotFoundErr, errAENoSuchObject: the app is gone.
        -600 | -10814 | -1728 => ErrorCode::NoLinkHandler,
        _ => ErrorCode::Internal,
    }
}

// @cpt-begin:cpt-noter-flow-core-native-services-operation:p1:inst-op-launch
/// Launches `req` by `path` (the one the handoff service chose from [`plan_launch`]) and
/// reports the path used. The prompt is pre-filled, never sent; the item's state is the
/// caller's.
// @cpt-algo:cpt-noter-algo-core-native-services-launch:p1
pub fn launch_with(
    sys: &impl LaunchSystem,
    path: LaunchPath,
    req: &LaunchRequest,
) -> Result<LaunchOutcome, ErrorCode> {
    // @cpt-begin:cpt-noter-algo-core-native-services-launch:p1:inst-launch-check
    let serves_target = links(req.target).contains(&path) || terminal_app(path).is_some();
    let present = match (scheme(path), terminal_app(path)) {
        (Some(s), _) => sys.has_handler(s),
        (_, Some(app)) => sys.has_app(app),
        _ => false,
    };
    if !serves_target || !present {
        return Err(ErrorCode::NoLinkHandler);
    }
    // @cpt-end:cpt-noter-algo-core-native-services-launch:p1:inst-launch-check
    // @cpt-begin:cpt-noter-algo-core-native-services-launch:p1:inst-launch-encode
    // Only the prompt file's path goes out, as URL-encoded data or one quoted shell word.
    let instruction = read_instruction(&req.prompt_file);
    // @cpt-end:cpt-noter-algo-core-native-services-launch:p1:inst-launch-encode
    let detail = if let Some(app) = terminal_app(path) {
        // @cpt-begin:cpt-noter-algo-core-native-services-launch:p1:inst-launch-denied
        if sys.automation(app) == PermissionState::Denied {
            return Err(ErrorCode::AutomationDenied);
        }
        // @cpt-end:cpt-noter-algo-core-native-services-launch:p1:inst-launch-denied
        // @cpt-begin:cpt-noter-algo-core-native-services-launch:p1:inst-launch-automation
        let command = terminal_command(req.target, &req.cwd, &instruction);
        sys.run_in_terminal(app, &command)
            .map_err(apple_event_error)?;
        // @cpt-end:cpt-noter-algo-core-native-services-launch:p1:inst-launch-automation
        command
    } else {
        // @cpt-begin:cpt-noter-algo-core-native-services-launch:p1:inst-launch-prefill
        let url = link_url(path, &req.cwd, &instruction).ok_or(ErrorCode::NoLinkHandler)?;
        if !sys.open_url(&url) {
            return Err(ErrorCode::Internal);
        }
        // @cpt-end:cpt-noter-algo-core-native-services-launch:p1:inst-launch-prefill
        url
    };
    // @cpt-begin:cpt-noter-algo-core-native-services-launch:p1:inst-launch-return
    Ok(LaunchOutcome { used: path, detail })
    // @cpt-end:cpt-noter-algo-core-native-services-launch:p1:inst-launch-return
}
// @cpt-end:cpt-noter-flow-core-native-services-operation:p1:inst-op-launch

/// [`launch_with`] on this Mac. Blocks while macOS asks for Automation: call it from a
/// blocking thread.
pub fn launch(path: LaunchPath, req: &LaunchRequest) -> Result<LaunchOutcome, ErrorCode> {
    launch_with(&system(), path, req)
}

#[cfg(target_os = "macos")]
fn system() -> crate::mac_services::MacLaunch {
    crate::mac_services::MacLaunch
}

#[cfg(not(target_os = "macos"))]
fn system() -> NoLaunch {
    NoLaunch
}

/// No Mac: nothing is installed and nothing opens.
#[cfg(not(target_os = "macos"))]
struct NoLaunch;

#[cfg(not(target_os = "macos"))]
impl LaunchSystem for NoLaunch {
    fn has_handler(&self, _: &str) -> bool {
        false
    }
    fn has_app(&self, _: &str) -> bool {
        false
    }
    fn automation(&self, _: &str) -> PermissionState {
        PermissionState::NotAsked
    }
    fn open_url(&self, _: &str) -> bool {
        false
    }
    fn run_in_terminal(&self, _: &str, _: &str) -> Result<(), i32> {
        Err(-600)
    }
}

// ── clipboard ──────────────────────────────────────────────────────────────

/// What `share_copy` and `handoff_copy` put on the clipboard: plain text always, the rich
/// forms when the caller has them.
#[derive(Debug, Clone, PartialEq)]
pub struct ClipboardText {
    pub plain: String,
    pub markdown: Option<String>,
    pub html: Option<String>,
}

/// The pasteboard types written, plain text first.
pub fn pasteboard_entries(text: &ClipboardText) -> Vec<(&'static str, &str)> {
    let mut entries = vec![("public.utf8-plain-text", text.plain.as_str())];
    if let Some(md) = &text.markdown {
        entries.push(("net.daringfireball.markdown", md.as_str()));
    }
    if let Some(html) = &text.html {
        entries.push(("public.html", html.as_str()));
    }
    entries
}

/// Replaces the general clipboard with one item carrying every representation; `Ok` only once
/// the pasteboard took it. Works from any thread.
pub fn clipboard_write(text: &ClipboardText) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    return crate::mac_services::clipboard_write(None, text);
    #[cfg(not(target_os = "macos"))]
    {
        let _ = text;
        Err("the clipboard needs macOS".into())
    }
}

/// [`clipboard_write`] to the named pasteboard (tests use a private one).
#[cfg(target_os = "macos")]
pub fn clipboard_write_to(name: &str, text: &ClipboardText) -> Result<(), String> {
    crate::mac_services::clipboard_write(Some(name), text)
}

/// The named pasteboard's text of one type.
#[cfg(target_os = "macos")]
pub fn clipboard_read(name: &str, uti: &str) -> Option<String> {
    crate::mac_services::clipboard_read(name, uti)
}

/// Frees a named pasteboard.
#[cfg(target_os = "macos")]
pub fn clipboard_release(name: &str) {
    crate::mac_services::clipboard_release(name)
}

// ── panels ─────────────────────────────────────────────────────────────────

/// The window a panel attaches to as a sheet: an `NSWindow` pointer (Tauri's `ns_window()`).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ParentWindow(NonNull<c_void>);

// SAFETY: the pointer is only dereferenced on the main thread (`mac_services`).
unsafe impl Send for ParentWindow {}

impl ParentWindow {
    /// # Safety
    /// `window` is a live `NSWindow` that outlives the panel.
    pub unsafe fn from_raw(window: *mut c_void) -> Option<Self> {
        NonNull::new(window).map(Self)
    }

    pub fn as_ptr(self) -> *mut c_void {
        self.0.as_ptr()
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct PanelRequest {
    pub suggested_name: String,
    /// File extensions the save panel allows (`md`, `json`); empty allows any.
    pub extensions: Vec<String>,
    /// Choose a folder (export to a folder) instead of naming a file.
    pub folder: bool,
    /// Attach as a sheet to the requesting window; `None` shows a free panel.
    pub parent: Option<ParentWindow>,
}

/// The name the panel offers: slashes and colons become dashes (the panel reads them as
/// folders), blank becomes `Untitled`.
fn panel_name(name: &str) -> String {
    let name = name.trim().replace(['/', ':'], "-");
    if name.is_empty() {
        "Untitled".into()
    } else {
        name
    }
}

/// Shows the panel through `present` and returns the chosen path; `None` when cancelled, which
/// the caller answers with `cancelled` and no file written.
pub fn save_panel_with(
    req: &PanelRequest,
    present: impl FnOnce(&PanelRequest) -> Option<PathBuf>,
) -> Option<PathBuf> {
    let req = PanelRequest {
        suggested_name: panel_name(&req.suggested_name),
        ..req.clone()
    };
    // @cpt-begin:cpt-noter-flow-core-native-services-operation:p1:inst-op-panel
    let chosen = present(&req);
    // @cpt-end:cpt-noter-flow-core-native-services-operation:p1:inst-op-panel
    // @cpt-begin:cpt-noter-flow-core-native-services-operation:p1:inst-op-cancel
    let path = chosen?;
    // @cpt-end:cpt-noter-flow-core-native-services-operation:p1:inst-op-cancel
    // @cpt-begin:cpt-noter-flow-core-native-services-operation:p1:inst-op-return
    Some(path)
    // @cpt-end:cpt-noter-flow-core-native-services-operation:p1:inst-op-return
}

/// The macOS save panel (or folder panel), on the main thread. Blocks the calling thread
/// until the user answers: call it from a blocking thread, never a tokio worker. `None` when
/// cancelled, and always on other systems.
pub fn save_panel(req: &PanelRequest) -> Option<PathBuf> {
    #[cfg(target_os = "macos")]
    return save_panel_with(req, crate::mac_services::present_panel);
    #[cfg(not(target_os = "macos"))]
    save_panel_with(req, |_| None)
}

// ── screen share test ──────────────────────────────────────────────────────

/// What the core's window registry knows of one surface.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SurfaceFacts {
    pub surface: NoterSurface,
    /// On screen now: open and not hidden for presenting.
    pub shown: bool,
    /// Excluded from capture by the window server (`sharingType = .none`).
    pub protected: bool,
}

const SURFACES: [NoterSurface; 5] = [
    NoterSurface::CallWindow,
    NoterSurface::RecordPrompt,
    NoterSurface::MainWindow,
    NoterSurface::SettingsWindow,
    NoterSurface::MenuBarTitle,
];

/// The row of one surface, `shown` and `protected` as the window server reports them.
fn visibility(surface: NoterSurface, shown: bool, protected: bool) -> ShareTestRow {
    use ShareVisibility::*;
    // @cpt-begin:cpt-noter-algo-core-native-services-visibility:p1:inst-visibility-report
    // @cpt-begin:cpt-noter-algo-core-native-services-visibility:p1:inst-visibility-presenting
    // Content protection never holds against a whole-display capture (DESIGN.md platform
    // constraint); only Hide for Presenting, which takes the surface off screen, does.
    let (window_share, app_share, display_share) = match (shown, protected, surface) {
        (false, _, _) => (Hidden, Hidden, Hidden),
        (true, _, NoterSurface::MenuBarTitle) | (true, true, _) => (Hidden, Hidden, Visible),
        (true, false, _) => (DependsOnApp, DependsOnApp, Visible),
    };
    // @cpt-end:cpt-noter-algo-core-native-services-visibility:p1:inst-visibility-presenting
    // @cpt-end:cpt-noter-algo-core-native-services-visibility:p1:inst-visibility-report
    ShareTestRow {
        surface,
        window_share,
        app_share,
        display_share,
    }
}

/// One row per Noter surface, in `NoterSurface` order; a surface with no facts is not open,
/// so no share sees it. Starts no capture and hides nothing.
// @cpt-algo:cpt-noter-algo-core-native-services-visibility:p1
pub fn share_rows(facts: &[SurfaceFacts]) -> Vec<ShareTestRow> {
    // @cpt-begin:cpt-noter-algo-core-native-services-visibility:p1:inst-visibility-return
    SURFACES
        .iter()
        .map(|&s| {
            let fact = facts.iter().find(|f| f.surface == s);
            visibility(
                s,
                fact.is_some_and(|f| f.shown),
                fact.is_some_and(|f| f.protected),
            )
        })
        .collect()
    // @cpt-end:cpt-noter-algo-core-native-services-visibility:p1:inst-visibility-return
}

/// A Noter window as the window server reports it.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct WindowState {
    pub on_screen: bool,
    /// `kCGWindowSharingState` is not `none`: a capture would include it.
    pub shareable: bool,
}

/// The facts of the windows the core registered (`CGWindowID`s of the call window, record
/// prompt, main and Settings windows) plus the menu bar title, read from the window server,
/// not from what a WebView reports. Needs no permission for Noter's own windows.
pub fn surface_facts(
    windows: &[(NoterSurface, u32)],
    menu_bar_title_shown: bool,
) -> Vec<SurfaceFacts> {
    // @cpt-begin:cpt-noter-algo-core-native-services-visibility:p1:inst-visibility-enumerate
    let mut facts: Vec<SurfaceFacts> = windows
        .iter()
        .map(|&(surface, id)| {
            // @cpt-begin:cpt-noter-algo-core-native-services-visibility:p1:inst-visibility-properties
            let state = window_state(id);
            SurfaceFacts {
                surface,
                shown: state.is_some_and(|w| w.on_screen),
                protected: state.is_some_and(|w| !w.shareable),
            }
            // @cpt-end:cpt-noter-algo-core-native-services-visibility:p1:inst-visibility-properties
        })
        .collect();
    facts.push(SurfaceFacts {
        surface: NoterSurface::MenuBarTitle,
        shown: menu_bar_title_shown,
        protected: false,
    });
    // @cpt-end:cpt-noter-algo-core-native-services-visibility:p1:inst-visibility-enumerate
    facts
}

fn window_state(id: u32) -> Option<WindowState> {
    #[cfg(target_os = "macos")]
    return crate::mac_services::window_state(id);
    #[cfg(not(target_os = "macos"))]
    {
        let _ = id;
        None
    }
}

/// The probe's failure for a Screen Recording state; `None` when granted.
pub fn screen_recording_error(state: PermissionState) -> Option<ErrorCode> {
    match state {
        PermissionState::Granted => None,
        PermissionState::Denied => Some(ErrorCode::PermissionDenied),
        _ => Some(ErrorCode::PermissionMissing),
    }
}

/// The probe's comparison: a protected surface on screen that a capture would include fails
/// it (`internal`: no narrower code exists for it).
pub fn protected_leak(protected: &[WindowState]) -> Result<(), ErrorCode> {
    // @cpt-begin:cpt-noter-flow-core-native-services-share-test:p1:inst-test-outcome
    if protected.iter().any(|w| w.on_screen && w.shareable) {
        return Err(ErrorCode::Internal);
    }
    Ok(())
    // @cpt-end:cpt-noter-flow-core-native-services-share-test:p1:inst-test-outcome
}

/// The optional capture probe's result for a fresh `share_test_run`: not run unless asked,
/// refused during a call (no prompt, no probe), else the probe's answer. Every request starts
/// at not_run: nothing from an earlier test carries over.
// @cpt-state:cpt-noter-state-core-native-services-probe:p1
pub fn capture_outcome(
    requested: bool,
    call_live: bool,
    now: TimestampMs,
    probe: impl FnOnce() -> Result<(), ErrorCode>,
) -> CaptureTestOutcome {
    // @cpt-begin:cpt-noter-state-core-native-services-probe:p1:inst-st-retry
    // @cpt-begin:cpt-noter-flow-core-native-services-share-test:p1:inst-test-not-run
    if !requested {
        return CaptureTestOutcome::NotRun;
    }
    // @cpt-end:cpt-noter-flow-core-native-services-share-test:p1:inst-test-not-run
    // @cpt-end:cpt-noter-state-core-native-services-probe:p1:inst-st-retry
    // @cpt-begin:cpt-noter-flow-core-native-services-share-test:p1:inst-test-blocked
    // @cpt-begin:cpt-noter-state-core-native-services-probe:p1:inst-st-blocked
    if call_live {
        return CaptureTestOutcome::BlockedByCall;
    }
    // @cpt-end:cpt-noter-state-core-native-services-probe:p1:inst-st-blocked
    // @cpt-end:cpt-noter-flow-core-native-services-share-test:p1:inst-test-blocked
    match probe() {
        // @cpt-begin:cpt-noter-state-core-native-services-probe:p1:inst-st-passed
        Ok(()) => CaptureTestOutcome::Passed { at: now },
        // @cpt-end:cpt-noter-state-core-native-services-probe:p1:inst-st-passed
        // @cpt-begin:cpt-noter-state-core-native-services-probe:p1:inst-st-failed
        Err(code) => CaptureTestOutcome::Failed { code },
        // @cpt-end:cpt-noter-state-core-native-services-probe:p1:inst-st-failed
    }
}

/// The probe on this Mac: asks for Screen Recording if needed (this explicit action is the
/// only place that does), then checks with the window server that every protected Noter
/// window on screen is excluded from capture. Blocks while macOS asks.
pub fn capture_probe(protected_windows: &[u32]) -> Result<(), ErrorCode> {
    // @cpt-begin:cpt-noter-flow-core-native-services-share-test:p1:inst-test-probe
    let mut state = crate::permission(PermissionKind::ScreenRecording);
    if state != PermissionState::Granted {
        state = crate::request_permission(PermissionKind::ScreenRecording);
    }
    if let Some(code) = screen_recording_error(state) {
        return Err(code);
    }
    // @cpt-end:cpt-noter-flow-core-native-services-share-test:p1:inst-test-probe
    // @cpt-begin:cpt-noter-flow-core-native-services-share-test:p1:inst-test-dispose
    // Window-server properties only, never pixels: no frame is held, kept or sent.
    let states: Vec<WindowState> = protected_windows
        .iter()
        .filter_map(|&id| window_state(id))
        .collect();
    // @cpt-end:cpt-noter-flow-core-native-services-share-test:p1:inst-test-dispose
    protected_leak(&states)
}

/// The whole Screen Share Test for `share_test_run`: rows from the registered windows, then
/// the optional probe over the protected ones. Call it from a blocking thread (the probe may
/// wait on the Screen Recording prompt).
pub fn share_test(
    args: &ShareTestArgs,
    call_live: bool,
    windows: &[(NoterSurface, u32)],
    menu_bar_title_shown: bool,
    now: TimestampMs,
) -> ShareTestResult {
    // @cpt-begin:cpt-noter-flow-core-native-services-share-test:p1:inst-test-rows
    let facts = surface_facts(windows, menu_bar_title_shown);
    let rows = share_rows(&facts);
    // @cpt-end:cpt-noter-flow-core-native-services-share-test:p1:inst-test-rows
    let protected: Vec<u32> = windows
        .iter()
        .zip(&facts)
        .filter(|(_, f)| f.protected)
        .map(|(&(_, id), _)| id)
        .collect();
    let capture_test = capture_outcome(args.run_capture_test, call_live, now, || {
        capture_probe(&protected)
    });
    // @cpt-begin:cpt-noter-flow-core-native-services-share-test:p1:inst-test-return
    ShareTestResult { rows, capture_test }
    // @cpt-end:cpt-noter-flow-core-native-services-share-test:p1:inst-test-return
}
