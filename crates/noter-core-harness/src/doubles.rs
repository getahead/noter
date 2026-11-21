use super::*;

/// The Mac on battery (`--power battery`).
pub(super) struct OnBattery;

impl noter_core::PowerSource for OnBattery {
    fn on_battery(&self) -> bool {
        true
    }
}

/// The harness host accepts shortcuts unless the test starts it with one held chord.
pub(super) struct ScriptedShortcuts(pub(super) Option<(String, String)>);

impl ShortcutRegistrar for ScriptedShortcuts {
    fn register(&self, chord: &str) -> Result<(), ShortcutTaken> {
        match &self.0 {
            Some((taken, owner)) if taken == chord => Err(ShortcutTaken {
                owner: Some(owner.clone()),
            }),
            _ => Ok(()),
        }
    }

    fn unregister(&self, _chord: &str) {}
}

/// The scenario's clock plus what `harness.advance_clock` added.
pub(super) struct Skewed(pub(super) Arc<dyn Clock>, pub(super) Arc<AtomicI64>);

impl Clock for Skewed {
    fn now(&self) -> TimestampMs {
        TimestampMs(self.0.now().0 + self.1.load(Ordering::SeqCst))
    }
}

pub(super) struct Fixed(pub(super) TimestampMs);

impl Clock for Fixed {
    fn now(&self) -> TimestampMs {
        self.0
    }
}

impl EventEmitter for Lines {
    fn emit(&self, event: &'static str, payload: Value) {
        self.event(event, payload);
    }
}

/// Core events to the wire (or the app's windows), once seeding is over.
pub(super) struct EventLines(pub(super) Arc<dyn EventEmitter>, pub(super) Arc<AtomicBool>);

impl EventEmitter for EventLines {
    fn emit(&self, event: &'static str, payload: Value) {
        // @cpt-begin:cpt-noter-flow-core-harness-session:p1:inst-write-events
        if !self.1.load(Ordering::SeqCst) {
            self.0.emit(event, payload);
        }
        // @cpt-end:cpt-noter-flow-core-harness-session:p1:inst-write-events
    }
}

/// The Mac, as the world says: permission states, displays, output, reachability and disk.
/// The core's listener for the Mac's change notices.
type OnChange = Box<dyn Fn(EnvironmentReading) + Send + Sync>;

pub(super) struct ScriptedNative(
    pub(super) Mutex<(HashMap<PermissionKind, PermissionState>, EnvironmentReading)>,
    pub(super) Mutex<Option<OnChange>>,
    /// The calendar's events: the cards the world's Today shows, as EventKit would list them.
    pub(super) Mutex<Vec<CalendarEvent>>,
    /// One-shot typed failures for native operations (`harness.native_fail`).
    pub(super) Mutex<HashMap<String, ErrorCode>>,
    /// A fixed local offset for deterministic host-time tests.
    pub(super) AtomicI64,
);

impl ScriptedNative {
    pub(super) fn update(&self, change: impl FnOnce(&mut EnvironmentReading)) {
        change(&mut lock(&self.0).1);
    }

    pub(super) fn new(env: &EnvironmentState) -> Self {
        let native = ScriptedNative(
            Mutex::new((HashMap::new(), EnvironmentReading::default())),
            Mutex::new(None),
            Mutex::new(vec![]),
            Mutex::new(HashMap::new()),
            AtomicI64::new(0),
        );
        native.set(env, &env.permissions);
        native
    }

    pub(super) fn set_calendar(&self, today: &TodayView) {
        *lock(&self.2) = today
            .today
            .iter()
            .chain(&today.this_week)
            .map(|c| CalendarEvent {
                event: CalendarEventRef {
                    id: c.event_id.clone(),
                    title: c.title.clone(),
                    starts_at: c.starts_at,
                    ends_at: c.ends_at,
                },
                platform: c.platform.clone(),
                attendees: c
                    .attendees
                    .iter()
                    .map(|a| CalendarAttendee {
                        name: a.name.clone(),
                        email: a.email.clone(),
                    })
                    .collect(),
            })
            .collect();
    }

    /// Calls the core's listener with the current reading, as the Mac's change notices do.
    pub(super) fn changed(&self) {
        if let Some(on_change) = lock(&self.1).as_ref() {
            on_change(self.environment());
        }
    }

    pub(super) fn fail_once(&self, operation: String, code: ErrorCode) {
        lock(&self.3).insert(operation, code);
    }

    fn take_failure(&self, operation: &str) -> Option<ErrorCode> {
        lock(&self.3).remove(operation)
    }

    pub(super) fn set(&self, env: &EnvironmentState, setup_rows: &[PermissionRow]) {
        let mut state = lock(&self.0);
        // The setup status and the environment show the same rows (`W.permission` writes both);
        // a row changed in either wins over the unchanged one.
        for row in env.permissions.iter().chain(setup_rows) {
            if state.0.get(&row.kind) != Some(&row.state) {
                state.0.insert(row.kind, row.state);
            }
        }
        state.1 = EnvironmentReading {
            native: env.native.clone(),
            displays: env.displays.clone(),
            output_device: env.output_device.clone(),
            output_route: env.output_route,
            notifications: env.notifications,
            online: env.online,
            disk_free_mb: env.disk_free_mb,
        };
    }
}

impl NativeServices for ScriptedNative {
    fn permission(&self, kind: PermissionKind) -> PermissionState {
        lock(&self.0)
            .0
            .get(&kind)
            .copied()
            .unwrap_or(PermissionState::NotAsked)
    }

    /// A prompt the user allows; an answered permission keeps its answer.
    fn request_permission(&self, kind: PermissionKind) -> CoreFuture<'_, PermissionState> {
        let mut state = lock(&self.0);
        let answer = if self.take_failure("permission_request").is_some() {
            PermissionState::Denied
        } else {
            match state.0.get(&kind) {
                None | Some(PermissionState::NotAsked) => PermissionState::Granted,
                Some(s) => *s,
            }
        };
        state.0.insert(kind, answer);
        // The notification centre's own state follows the answer, as macOS reports it.
        if kind == PermissionKind::Notifications {
            state.1.notifications = match answer {
                PermissionState::Granted => NotificationAuth::Authorized,
                PermissionState::Denied => NotificationAuth::Denied,
                _ => state.1.notifications,
            };
        }
        Box::pin(async move { answer })
    }

    fn environment(&self) -> EnvironmentReading {
        lock(&self.0).1.clone()
    }

    fn on_change(&self, on_change: OnChange) {
        *lock(&self.1) = Some(on_change);
    }

    fn set_login_item(&self, _: bool) -> Result<(), CoreError> {
        match self.take_failure("set_login_item") {
            Some(code) => Err(CoreError::new(code, "scripted login-item change failed")),
            None => Ok(()),
        }
    }

    fn calendar_event_near(&self, at: TimestampMs) -> Option<CalendarEventRef> {
        if self.permission(PermissionKind::Calendar) != PermissionState::Granted {
            return None;
        }
        let latest = at.0.saturating_add(10 * 60 * 1000);
        lock(&self.2)
            .iter()
            .filter(|event| {
                event.event.starts_at.0 <= at.0 && event.event.ends_at.0 > at.0
                    || (at.0..=latest).contains(&event.event.starts_at.0)
            })
            .min_by_key(|event| event.event.starts_at.0.abs_diff(at.0))
            .map(|event| event.event.clone())
    }

    fn utc_offset_minutes(&self, _: TimestampMs) -> i32 {
        self.4.load(Ordering::SeqCst) as i32
    }

    fn calendar_events(
        &self,
        from: TimestampMs,
        to: TimestampMs,
    ) -> Result<Vec<CalendarEvent>, CoreError> {
        let events = lock(&self.2).clone();
        Ok(events
            .into_iter()
            .filter(|e| e.event.starts_at.0 < to.0 && e.event.ends_at.0 > from.0)
            .collect())
    }
}

/// The world's model bundles as tiny files with real checksums, served from memory.
pub(super) struct TinyModels {
    specs: Vec<(BundleSpec, Vec<u8>)>,
    native: Arc<ScriptedNative>,
    /// `harness.corrupt_next_download`: the next fetch serves wrong bytes, once.
    pub(super) corrupt_next: AtomicBool,
    /// `harness.hold_next_download`: the next fetch stops serving at this percent of the bundle.
    pub(super) hold_at: Mutex<Option<u64>>,
    /// `harness.release_download`: a held fetch serves the rest.
    pub(super) released: AtomicBool,
}

/// Each tiny bundle is one file in its folder.
const TINY_FILE: &str = "model.bin";

/// Two megabytes keep the partial-download fixture observable in whole megabytes.
const LIVE_BUNDLE_BYTES: usize = 2 << 20;

impl TinyModels {
    pub(super) fn new(models: &ModelsStatus, native: Arc<ScriptedNative>) -> Self {
        let specs = models
            .bundles
            .iter()
            .map(|b| {
                let line = format!("noter-core-harness model bundle {}\n", b.name);
                let times = if b.required_for_capture {
                    LIVE_BUNDLE_BYTES / line.len() + 1
                } else {
                    64
                };
                let bytes = line.repeat(times).into_bytes();
                let spec = BundleSpec {
                    name: b.name.clone(),
                    files: vec![BundleFile {
                        path: TINY_FILE.into(),
                        url: format!(
                            "https://huggingface.co/noter-harness/{}",
                            b.name.replace(' ', "-")
                        ),
                        size_bytes: bytes.len() as u64,
                        sha256: noter_db::hex(&Sha256::digest(&bytes)),
                    }],
                    required_for_capture: b.required_for_capture,
                };
                (spec, bytes)
            })
            .collect();
        TinyModels {
            specs,
            native,
            corrupt_next: AtomicBool::new(false),
            hold_at: Mutex::new(None),
            released: AtomicBool::new(false),
        }
    }

    /// Makes `models/` hold exactly the bundles the world shows as ready.
    pub(super) fn place(
        &self,
        dir: &std::path::Path,
        models: &ModelsStatus,
    ) -> std::io::Result<()> {
        for (spec, bytes) in &self.specs {
            if models
                .bundles
                .iter()
                .any(|b| b.name == spec.name && b.state == BundleState::Ready)
            {
                std::fs::create_dir_all(dir.join(&spec.name))?;
                std::fs::write(dir.join(&spec.name).join(TINY_FILE), bytes)?;
            } else if let Err(e) = std::fs::remove_dir_all(dir.join(&spec.name)) {
                if e.kind() != std::io::ErrorKind::NotFound {
                    return Err(e);
                }
            }
        }
        Ok(())
    }
}

impl ModelSource for TinyModels {
    fn manifest(&self) -> Vec<BundleSpec> {
        self.specs.iter().map(|(s, _)| s.clone()).collect()
    }

    fn fetch<'a>(
        &'a self,
        file: &'a BundleFile,
        from_byte: u64,
        mut chunk: ChunkSink<'a>,
    ) -> CoreFuture<'a, Result<(), FetchError>> {
        Box::pin(async move {
            if !self.native.environment().online {
                return Err(FetchError::Offline);
            }
            let bytes = &self
                .specs
                .iter()
                .find(|(s, _)| s.files.iter().any(|f| f.url == file.url))
                .ok_or(FetchError::Http(404))?
                .1;
            let mut bytes = bytes.clone();
            if self.corrupt_next.swap(false, Ordering::SeqCst) {
                bytes.iter_mut().for_each(|b| *b ^= 0xff);
            }
            let hold = lock(&self.hold_at)
                .take()
                .map(|pct| bytes.len() as u64 * pct / 100);
            let mut at = (from_byte as usize).min(bytes.len());
            while at < bytes.len() {
                if hold.is_some_and(|limit| at as u64 >= limit)
                    && !self.released.load(Ordering::SeqCst)
                {
                    // Held: an empty chunk tells the core's sink to say whether it was paused.
                    if !chunk(&[]) {
                        break;
                    }
                    tokio::time::sleep(std::time::Duration::from_millis(20)).await;
                    continue;
                }
                let end = (at + (16 << 10)).min(bytes.len());
                if !chunk(&bytes[at..end]) {
                    break;
                }
                at = end;
            }
            Ok(())
        })
    }
}

/// A downloaded update, as the world says. The core shuts down after `update_install` answers (its
/// streams end with `shutdown`), but the process keeps serving: relaunching is the app's job, not
/// the harness's.
/// The native asks, scripted (TL-15): the save panel answers `<data>/exports/<suggested name>`
/// (a folder for `SaveKind::Folder`), or cancelled once after `harness.cancel_next_save_panel`;
/// launches follow `harness.launch_world` and, like clipboard writes, are recorded for
/// `harness.native_log`; the Screen Share Test answers fixed rows (the fake core's) and its
/// probe passes unless `harness.share_test_probe` says it fails.
pub(super) struct ScriptedPanel {
    pub(super) dir: PathBuf,
    pub(super) cancel_next: AtomicBool,
    pub(super) launch: Mutex<LaunchWorld>,
    pub(super) folder_panels: Mutex<Option<VecDeque<Option<PathBuf>>>>,
    pub(super) log: Mutex<Value>,
    pub(super) probe_fails: Mutex<Option<ErrorCode>>,
}

/// What the Mac reports for launches: the plan, and the paths that fail with a code.
#[derive(Debug, Clone, serde::Deserialize)]
pub struct LaunchWorld {
    plan: LaunchPlan,
    #[serde(default)]
    fail: Vec<FailedLaunch>,
}

#[derive(Debug, Clone, serde::Deserialize)]
struct FailedLaunch {
    path: LaunchPath,
    code: ErrorCode,
}

impl Default for LaunchWorld {
    /// Claude Code's `claude-cli://` handler and Codex's app are installed.
    fn default() -> Self {
        Self {
            plan: LaunchPlan {
                path: LaunchPath::ClaudeCliLink,
                needs_automation: false,
                automation_denied: false,
            },
            fail: vec![],
        }
    }
}

impl NativeOps for ScriptedPanel {
    fn save_panel<'a>(&'a self, name: &'a str, kind: SaveKind) -> CoreFuture<'a, Option<PathBuf>> {
        Box::pin(async move {
            if self.cancel_next.swap(false, Ordering::SeqCst) {
                return None;
            }
            // @cpt-flow:cpt-noter-flow-core-handoff-repositories:p1
            if kind == SaveKind::Folder {
                if let Some(answers) = lock(&self.folder_panels).as_mut() {
                    return answers.pop_front().flatten();
                }
            }
            let path = self.dir.join(name);
            let folder = if kind == SaveKind::Folder {
                &path
            } else {
                &self.dir
            };
            std::fs::create_dir_all(folder).ok()?;
            Some(path)
        })
    }

    fn launch_plan(&self, target: HandoffTarget) -> LaunchPlan {
        let mut plan = lock(&self.launch).plan.clone();
        // The scripted plan names Claude's link; Codex has none that carries the prompt
        // (D-33), so it opens in a terminal.
        if target == HandoffTarget::Codex
            && matches!(
                plan.path,
                LaunchPath::ClaudeCliLink | LaunchPath::ClaudeDesktop
            )
        {
            plan.path = LaunchPath::Terminal;
        }
        plan
    }

    fn launch<'a>(
        &'a self,
        path: LaunchPath,
        req: &'a LaunchRequest,
    ) -> CoreFuture<'a, Result<(), ErrorCode>> {
        Box::pin(async move {
            let failed = lock(&self.launch)
                .fail
                .iter()
                .find(|f| f.path == path)
                .map(|f| f.code);
            if let Some(code) = failed {
                return Err(code);
            }
            let launch = json!({
                "path": path,
                "target": req.target,
                "cwd": req.cwd,
                "prompt_file": req.prompt_file,
            });
            push(&self.log, "launches", launch);
            Ok(())
        })
    }

    fn clipboard_write<'a>(
        &'a self,
        text: &'a ClipboardText,
    ) -> CoreFuture<'a, Result<(), String>> {
        let entry = json!({ "plain": text.plain, "markdown": text.markdown, "html": text.html });
        push(&self.log, "clipboard", entry);
        Box::pin(async { Ok(()) })
    }

    fn share_test<'a>(
        &'a self,
        args: &'a ShareTestArgs,
        call_live: bool,
        _menu_bar_title_shown: bool,
        now: TimestampMs,
    ) -> CoreFuture<'a, Result<ShareTestResult, ErrorCode>> {
        use ShareVisibility::*;
        let rows = [
            NoterSurface::CallWindow,
            NoterSurface::RecordPrompt,
            NoterSurface::MainWindow,
            NoterSurface::SettingsWindow,
            NoterSurface::MenuBarTitle,
        ]
        .map(|surface| ShareTestRow {
            surface,
            window_share: Hidden,
            app_share: Hidden,
            display_share: if surface == NoterSurface::MenuBarTitle {
                Visible
            } else {
                DependsOnApp
            },
        });
        let fails = *lock(&self.probe_fails);
        // The probe's states are noter-native's: not run, blocked by the call, passed or failed.
        let capture_test =
            noter_native::capture_outcome(args.run_capture_test, call_live, now, || {
                fails.map_or(Ok(()), Err)
            });
        Box::pin(async move {
            Ok(ShareTestResult {
                rows: rows.to_vec(),
                capture_test,
            })
        })
    }
}

fn push(log: &Mutex<Value>, key: &str, entry: Value) {
    if let Some(list) = lock(log)[key].as_array_mut() {
        list.push(entry);
    }
}

/// The native layer's windows, as the calls the core made (TL-2).
#[derive(Default)]
pub(super) struct ScriptedSurfaces(pub(super) Mutex<Vec<String>>, AtomicBool, AtomicBool);

impl ScriptedSurfaces {
    fn note(&self, call: impl Into<String>) {
        lock(&self.0).push(call.into());
    }
}

impl Surfaces for ScriptedSurfaces {
    fn show_record_prompt(&self, _: &Placement) {
        self.note("show_record_prompt");
    }
    fn close_record_prompt(&self) {
        self.note("close_record_prompt");
    }
    fn show_call_window(&self, _: &Placement) {
        self.1.store(true, Ordering::SeqCst);
        // The name the capture stories look for: the call window opens without taking focus.
        self.note("open_call_window_inactive");
    }
    fn make_call_window_key(&self) {
        self.note("make_call_window_key");
    }
    fn place_call_window(&self, placement: &Placement, collapsed: bool) {
        self.note(format!(
            "place_call_window {:?} collapsed={collapsed}",
            placement.layout
        ));
    }
    fn hide_call_window(&self) {
        self.1.store(false, Ordering::SeqCst);
        self.note("hide_call_window");
    }
    fn hide_all(&self) {
        self.2
            .store(self.1.swap(false, Ordering::SeqCst), Ordering::SeqCst);
        self.note("hide_all");
    }
    fn restore_all(&self) {
        self.1
            .store(self.2.load(Ordering::SeqCst), Ordering::SeqCst);
        self.note("restore_all");
    }
    fn set_tray(&self, tray: &TrayModel) {
        self.note(format!(
            "set_tray {:?} {}",
            tray.glyph,
            tray.lines().join(" | ")
        ));
    }
    fn announce(&self, text: &str, _politeness: Politeness) {
        self.note(format!("announce {text}"));
    }
    fn open_external(&self, target: &ExternalTarget) {
        let kind = match target {
            ExternalTarget::Url { .. } => "url",
            ExternalTarget::Document { .. } => "document",
            ExternalTarget::SystemSettings { .. } => "system_settings",
            ExternalTarget::RevealInFinder { .. } => "reveal_in_finder",
        };
        self.note(format!("open_external {kind}"));
    }
    fn show_window(&self, window: WindowLabel) {
        self.note(format!("show_window {}", window.as_str()));
    }
    fn hide_window(&self, window: WindowLabel) {
        self.note(format!("hide_window {}", window.as_str()));
    }
    fn fit_record_prompt(&self, width: u32, height: u32) {
        self.note(format!("fit_record_prompt {width}x{height}"));
    }
    fn call_surface_visible(&self) -> bool {
        self.1.load(Ordering::SeqCst)
    }
    fn post_notification(&self, n: &noter_core::Notification) {
        let kind = match n.kind {
            noter_core::NotificationKind::CaptureProblem(_) => "capture_problem",
            noter_core::NotificationKind::SummaryReady => "summary_ready",
            noter_core::NotificationKind::SummaryFailed => "summary_failed",
        };
        self.note(format!("post_notification {kind} {}", n.call_id.as_str()));
    }
}

pub(super) struct ScriptedUpdater {
    pub(super) ready: Mutex<Option<UpdateInfo>>,
    pub(super) failure: Mutex<Option<ErrorCode>>,
}

impl ScriptedUpdater {
    pub(super) fn fail_once(&self, code: ErrorCode) {
        *lock(&self.failure) = Some(code);
    }
}

impl Updater for ScriptedUpdater {
    fn ready(&self) -> Option<UpdateInfo> {
        lock(&self.ready).clone()
    }

    fn install(&self) -> CoreFuture<'_, Result<(), CoreError>> {
        let result = match lock(&self.failure).take() {
            Some(code) => Err(CoreError::new(code, "scripted updater installation failed")),
            None => Ok(()),
        };
        Box::pin(async move { result })
    }
}

/// What the scripted engine's system-audio tap hears for the world's permission row; a row not
/// asked yet is a prompt the user allows, as in `ScriptedNative::request_permission`.
pub(super) fn system_audio(rows: &[PermissionRow]) -> PermissionState {
    match rows.iter().find(|r| r.kind == PermissionKind::SystemAudio) {
        Some(r) if r.state == PermissionState::Denied => PermissionState::Denied,
        _ => PermissionState::Granted,
    }
}

/// A world's `ChangeRow` as the `changes` row the core would have written for it.
#[cfg(test)]
mod scripted_native_tests {
    use super::*;
    use noter_protocol::CalendarEventId;

    #[test]
    fn calendar_reads_include_overlaps_and_host_time_uses_the_configured_offset() {
        let mut env = world().app.environment;
        env.permissions
            .retain(|permission| permission.kind != PermissionKind::Calendar);
        env.permissions.push(PermissionRow {
            kind: PermissionKind::Calendar,
            state: PermissionState::Granted,
        });
        let native = ScriptedNative::new(&env);
        let event = CalendarEvent {
            event: CalendarEventRef {
                id: CalendarEventId::new("evt_overlap"),
                title: "Overlapping meeting".into(),
                starts_at: TimestampMs(100),
                ends_at: TimestampMs(300),
            },
            platform: Some("zoom".into()),
            attendees: vec![CalendarAttendee {
                name: "Ada Lovelace".into(),
                email: Some("ada@example.com".into()),
            }],
        };
        lock(&native.2).push(event.clone());

        assert_eq!(
            native
                .calendar_events(TimestampMs(200), TimestampMs(250))
                .unwrap(),
            vec![event],
            "a calendar range read includes events that began before the range"
        );
        assert_eq!(
            native.calendar_event_near(TimestampMs(200)).unwrap().id,
            CalendarEventId::new("evt_overlap"),
            "the meeting running at the requested time is a nearby event"
        );
        native.4.store(90, Ordering::SeqCst);
        assert_eq!(native.utc_offset_minutes(TimestampMs(200)), 90);
    }
}
