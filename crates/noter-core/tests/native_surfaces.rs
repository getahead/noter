//! FEATURE cpt-noter-feature-core-native-surfaces (core side): the call window's state and
//! placement, hide for presenting, the tray model, announcements, navigation and external opens,
//! over a native layer that records what the core asked of it.

use std::path::Path;
use std::sync::{Arc, Mutex};

use noter_core::{
    Clock, Core, CoreDeps, EnvironmentReading, EventEmitter, Placement, Surfaces, TrayAction,
    TrayGlyph, TrayModel,
};
use noter_protocol::ipc::{event_names, Caller, CommandCtx, CoreApi, NativeSurface};
use noter_protocol::model::*;
use noter_protocol::*;
use serde_json::Value;

#[derive(Default)]
struct Events(Mutex<Vec<(&'static str, Value)>>);

impl EventEmitter for Events {
    fn emit(&self, event: &'static str, payload: Value) {
        self.0.lock().unwrap().push((event, payload));
    }
}

impl Events {
    fn of(&self, name: &str) -> Vec<Value> {
        let mut all = self.0.lock().unwrap();
        let (hit, rest): (Vec<_>, Vec<_>) = std::mem::take(&mut *all)
            .into_iter()
            .partition(|(e, _)| *e == name);
        *all = rest;
        hit.into_iter().map(|(_, p)| p).collect()
    }
}

struct FixedClock;

impl Clock for FixedClock {
    fn now(&self) -> TimestampMs {
        TimestampMs(1_792_137_600_000)
    }
}

/// What the core asked of the native layer, in order.
#[derive(Default)]
struct Rec {
    calls: Mutex<Vec<String>>,
    tray: Mutex<Option<TrayModel>>,
}

impl Rec {
    fn take(&self) -> Vec<String> {
        std::mem::take(&mut *self.calls.lock().unwrap())
    }
    fn note(&self, s: impl Into<String>) {
        self.calls.lock().unwrap().push(s.into());
    }
}

impl Surfaces for Rec {
    fn show_record_prompt(&self) {}
    fn close_record_prompt(&self) {}
    fn show_call_window(&self, _placement: &Placement) {
        self.note("show_call_window");
    }
    fn make_call_window_key(&self) {
        self.note("make_call_window_key");
    }
    fn place_call_window(&self, _placement: &Placement, collapsed: bool) {
        self.note(format!("place_call_window collapsed={collapsed}"));
    }
    fn hide_call_window(&self) {
        self.note("hide_call_window");
    }
    fn hide_all(&self) {
        self.note("hide_all");
    }
    fn restore_all(&self) {
        self.note("restore_all");
    }
    fn set_tray(&self, tray: &TrayModel) {
        *self.tray.lock().unwrap() = Some(tray.clone());
        self.note("set_tray");
    }
    fn announce(&self, text: &str, _politeness: Politeness) {
        self.note(format!("announce {text}"));
    }
    fn open_external(&self, _target: &ExternalTarget) {
        self.note("open_external");
    }
    fn call_surface_visible(&self) -> bool {
        false
    }
    fn post_notification(&self, _: &noter_core::Notification) {}
    fn show_window(&self, window: WindowLabel) {
        self.note(format!("show_window {}", window.as_str()));
    }
}

fn open(dir: &Path) -> (Core, Arc<Events>, Arc<Rec>) {
    let events = Arc::new(Events::default());
    let rec = Arc::new(Rec::default());
    let deps = CoreDeps::new(Arc::new(FixedClock), events.clone()).with_surfaces(rec.clone());
    (Core::open(dir, deps).expect("core opens"), events, rec)
}

fn window(label: WindowLabel) -> CommandCtx {
    CommandCtx {
        caller: Caller::Window { label },
    }
}

fn display(id: &str, main: bool) -> DisplayInfo {
    DisplayInfo {
        id: DisplayId::new(id),
        name: id.into(),
        is_main: main,
        holds_call_app: false,
        width_pt: 1440,
        height_pt: 900,
    }
}

fn displays(core: &Core, list: Vec<DisplayInfo>) {
    core.environment_changed(EnvironmentReading {
        displays: list,
        ..EnvironmentReading::default()
    });
}

async fn choose(core: &Core, id: Option<&str>) {
    let ctx = window(WindowLabel::Settings);
    let stored = core.settings_get(&ctx, NoArgs {}).await.unwrap();
    let mut call_screen = stored.call_screen;
    call_screen.display_id = id.map(DisplayId::new);
    let args = SettingsUpdateArgs {
        rev: stored.rev,
        section: SettingsSection::CallScreen(call_screen),
    };
    core.settings_update(&ctx, args).await.unwrap();
}

fn item(t: &TrayModel, a: TrayAction) -> Option<bool> {
    t.items.iter().find(|i| i.action == a).map(|i| i.enabled)
}

#[tokio::test]
async fn the_call_window_shows_without_focus_then_takes_it_and_hides() {
    let dir = tempfile::tempdir().unwrap();
    let (core, events, rec) = open(dir.path());
    displays(
        &core,
        vec![display("d_main", true), display("d_side", false)],
    );
    choose(&core, Some("d_side")).await;
    rec.take();
    events.of(event_names::WINDOW_CALL);
    let main = window(WindowLabel::Main);
    let first = core.window_show_call(&main, NoArgs {}).await.unwrap();
    assert!(first.visible && !first.key);
    assert_eq!(first.layout, CallLayout::Dedicated);
    assert_eq!(first.display_id, Some(DisplayId::new("d_side")));
    assert!(!first.chosen_display_missing);
    assert_eq!(rec.take(), ["show_call_window"]);
    let second = core.window_show_call(&main, NoArgs {}).await.unwrap();
    assert!(second.visible && second.key);
    assert_eq!(rec.take(), ["make_call_window_key"]);
    // A third request changes nothing and says nothing.
    let third = core.window_show_call(&main, NoArgs {}).await.unwrap();
    assert_eq!(third, second);
    assert!(rec.take().is_empty());
    let sent = events.of(event_names::WINDOW_CALL);
    assert_eq!(sent.len(), 2);
    assert!(sent[1]["version"].as_u64() > sent[0]["version"].as_u64());
    let hidden = core
        .window_hide_call(&window(WindowLabel::CallScreen), NoArgs {})
        .await
        .unwrap();
    assert!(!hidden.visible && !hidden.key);
    assert_eq!(rec.take(), ["hide_call_window"]);
    assert_eq!(
        core.window_call_state(&main, NoArgs {}).await.unwrap(),
        hidden
    );
}

#[tokio::test]
async fn a_missing_call_display_falls_back_to_the_main_display_floating() {
    let dir = tempfile::tempdir().unwrap();
    let (core, _, _) = open(dir.path());
    displays(&core, vec![display("d_main", true)]);
    choose(&core, Some("d_gone")).await;
    let state = core
        .window_show_call(&window(WindowLabel::Main), NoArgs {})
        .await
        .unwrap();
    assert_eq!(state.display_id, Some(DisplayId::new("d_main")));
    assert_eq!(state.layout, CallLayout::Floating);
    assert!(state.chosen_display_missing);
}

#[tokio::test]
async fn unplugging_and_docking_moves_the_open_window_between_layouts() {
    let dir = tempfile::tempdir().unwrap();
    let (core, events, rec) = open(dir.path());
    displays(
        &core,
        vec![display("d_main", true), display("d_side", false)],
    );
    choose(&core, Some("d_side")).await;
    core.window_show_call(&window(WindowLabel::Main), NoArgs {})
        .await
        .unwrap();
    events.of(event_names::WINDOW_CALL);
    rec.take();
    displays(&core, vec![display("d_main", true)]);
    let state = core
        .window_call_state(&window(WindowLabel::Main), NoArgs {})
        .await
        .unwrap();
    assert_eq!(state.layout, CallLayout::Floating);
    assert!(state.chosen_display_missing && state.visible);
    assert_eq!(events.of(event_names::WINDOW_CALL).len(), 1);
    assert_eq!(rec.take(), ["place_call_window collapsed=false"]);
    displays(
        &core,
        vec![display("d_main", true), display("d_side", false)],
    );
    let back = core
        .window_call_state(&window(WindowLabel::Main), NoArgs {})
        .await
        .unwrap();
    assert_eq!(back.layout, CallLayout::Dedicated);
    assert!(!back.chosen_display_missing);
    assert_eq!(back.display_id, Some(DisplayId::new("d_side")));
}

#[tokio::test]
async fn collapse_needs_the_floating_layout_and_the_layout_is_a_setting() {
    let dir = tempfile::tempdir().unwrap();
    let (core, events, rec) = open(dir.path());
    displays(
        &core,
        vec![display("d_main", true), display("d_side", false)],
    );
    choose(&core, Some("d_side")).await;
    let call = window(WindowLabel::CallScreen);
    core.window_show_call(&call, NoArgs {}).await.unwrap();
    events.of(event_names::WINDOW_CALL);
    // Dedicated: collapse is returned unchanged, and the state still goes out whole so the
    // window that asked sees its answer as an event.
    let same = core
        .window_set_collapsed(&call, CollapseArgs { collapsed: true })
        .await
        .unwrap();
    assert!(!same.collapsed);
    assert_eq!(events.of(event_names::WINDOW_CALL).len(), 1);
    let floating = core
        .window_set_call_layout(
            &call,
            CallLayoutArgs {
                preference: CallLayoutPreference::Floating,
            },
        )
        .await
        .unwrap();
    assert_eq!(floating.layout, CallLayout::Floating);
    assert!(floating.show_share_warning);
    let stored = core.settings_get(&call, NoArgs {}).await.unwrap();
    assert_eq!(stored.call_screen.layout, CallLayoutPreference::Floating);
    rec.take();
    let strip = core
        .window_set_collapsed(&call, CollapseArgs { collapsed: true })
        .await
        .unwrap();
    assert!(strip.collapsed && strip.visible);
    assert_eq!(rec.take(), ["place_call_window collapsed=true"]);
    let open = core
        .window_set_collapsed(&call, CollapseArgs { collapsed: false })
        .await
        .unwrap();
    assert!(!open.collapsed);
}

#[tokio::test]
async fn hiding_for_presenting_hides_everything_and_restores_what_was_visible() {
    let dir = tempfile::tempdir().unwrap();
    let (core, events, rec) = open(dir.path());
    displays(&core, vec![display("d_main", true)]);
    let call = window(WindowLabel::CallScreen);
    core.window_show_call(&call, NoArgs {}).await.unwrap();
    events.of(event_names::WINDOW_CALL);
    rec.take();
    let hidden = core
        .app_set_hidden_for_presenting(&call, HiddenArgs { hidden: true })
        .await
        .unwrap();
    assert!(hidden.hidden);
    assert_eq!(events.of(event_names::APP_PRESENTING).len(), 1);
    let state = core.window_call_state(&call, NoArgs {}).await.unwrap();
    assert!(!state.visible);
    assert!(rec.take().contains(&"hide_all".to_string()));
    // Asked again: the current state, nothing sent.
    let again = core
        .app_set_hidden_for_presenting(&call, HiddenArgs { hidden: true })
        .await
        .unwrap();
    assert_eq!(again, hidden);
    assert!(events.of(event_names::APP_PRESENTING).is_empty());
    // A show request while hidden stays hidden.
    let shown = core.window_show_call(&call, NoArgs {}).await.unwrap();
    assert!(!shown.visible);
    let back = core
        .app_set_hidden_for_presenting(&call, HiddenArgs { hidden: false })
        .await
        .unwrap();
    assert!(!back.hidden && back.version > hidden.version);
    assert!(
        core.window_call_state(&call, NoArgs {})
            .await
            .unwrap()
            .visible
    );
    assert!(rec.take().contains(&"restore_all".to_string()));
}

#[tokio::test]
async fn a_surface_that_was_not_visible_stays_hidden_after_presenting() {
    let dir = tempfile::tempdir().unwrap();
    let (core, _, _) = open(dir.path());
    let main = window(WindowLabel::Main);
    core.app_set_hidden_for_presenting(&main, HiddenArgs { hidden: true })
        .await
        .unwrap();
    core.app_set_hidden_for_presenting(&main, HiddenArgs { hidden: false })
        .await
        .unwrap();
    assert!(
        !core
            .window_call_state(&main, NoArgs {})
            .await
            .unwrap()
            .visible
    );
}

#[tokio::test]
async fn the_tray_follows_capture_privacy_and_presenting() {
    let dir = tempfile::tempdir().unwrap();
    let (core, _, rec) = open(dir.path());
    let idle = rec.tray.lock().unwrap().clone().expect("a tray at start");
    assert_eq!(idle.glyph, TrayGlyph::Idle);
    assert_eq!(idle.privacy, PrivacyMode::CloudRedacted);
    assert_eq!(item(&idle, TrayAction::StartRecording), Some(true));
    assert_eq!(item(&idle, TrayAction::StopRecording), Some(false));
    assert_eq!(item(&idle, TrayAction::MarkMoment), Some(false));

    let mut live = core
        .app_snapshot(&window(WindowLabel::Main), NoArgs {})
        .await
        .unwrap()
        .capture;
    live.phase = CapturePhase::Recording;
    live.call_id = Some(CallId::new("call_x"));
    live.title = Some("Planning".into());
    noter_core::testing::seed_capture(&core, live)
        .await
        .unwrap();
    let recording = rec.tray.lock().unwrap().clone().unwrap();
    assert_eq!(recording.glyph, TrayGlyph::Recording);
    assert_eq!(recording.call_title.as_deref(), Some("Planning"));
    assert_eq!(item(&recording, TrayAction::StopRecording), Some(true));
    assert_eq!(item(&recording, TrayAction::MarkMoment), Some(true));
    assert_eq!(item(&recording, TrayAction::Pause), Some(true));

    core.app_set_hidden_for_presenting(&window(WindowLabel::Main), HiddenArgs { hidden: true })
        .await
        .unwrap();
    let hidden = rec.tray.lock().unwrap().clone().unwrap();
    assert_eq!(item(&hidden, TrayAction::ShowAfterPresenting), Some(true));
    assert_eq!(item(&hidden, TrayAction::HideForPresenting), None);
}

#[tokio::test]
async fn announce_navigate_and_external_opens_are_checked_before_the_native_layer() {
    let dir = tempfile::tempdir().unwrap();
    let (core, events, rec) = open(dir.path());
    rec.take();
    let main = window(WindowLabel::Main);
    let screen = window(WindowLabel::CallScreen);
    let announce = |text: &str| AnnounceArgs {
        text: text.into(),
        politeness: Politeness::Polite,
    };
    let blank = core
        .window_announce(&screen, announce(" "))
        .await
        .unwrap_err();
    assert_eq!(blank.code, ErrorCode::InvalidInput);
    core.window_announce(&screen, announce("Recording started"))
        .await
        .unwrap();
    assert_eq!(rec.take(), ["announce Recording started"]);

    let target = NavTarget::Settings {
        pane: SettingsPane::Privacy,
    };
    core.window_navigate(
        &main,
        NavigateArgs {
            target: Some(target),
        },
    )
    .await
    .unwrap();
    assert_eq!(rec.take(), ["show_window settings"]);
    let nav = events.of(event_names::NAV_REQUEST);
    assert_eq!(nav.len(), 1);
    assert_eq!(nav[0]["type"], "settings");
    core.window_navigate(&main, NavigateArgs { target: None })
        .await
        .unwrap();
    assert_eq!(rec.take(), ["show_window main"]);
    assert!(events.of(event_names::NAV_REQUEST).is_empty());

    let url = |u: &str| ExternalTarget::Url { url: u.into() };
    let reveal = |p: &str| ExternalTarget::RevealInFinder { path: p.into() };
    for bad in [
        url("file:///etc/passwd"),
        url("http://example.com"),
        reveal("relative/path"),
        reveal("/tmp/../etc"),
    ] {
        let err = core
            .open_external(&main, OpenExternalArgs { target: bad })
            .await
            .unwrap_err();
        assert_eq!(err.code, ErrorCode::InvalidInput);
    }
    assert!(rec.take().is_empty());
    for good in [
        url("https://example.com/docs"),
        ExternalTarget::SystemSettings {
            permission: PermissionKind::Microphone,
        },
        reveal(&dir.path().to_string_lossy()),
    ] {
        core.open_external(&main, OpenExternalArgs { target: good })
            .await
            .unwrap();
    }
    assert_eq!(rec.take().len(), 3);
}

#[tokio::test]
async fn a_native_caller_may_show_the_call_window_and_hide_for_presenting() {
    let dir = tempfile::tempdir().unwrap();
    let (core, _, _) = open(dir.path());
    let menu = CommandCtx {
        caller: Caller::Native {
            surface: NativeSurface::MenuBar,
        },
    };
    assert!(
        core.window_show_call(&menu, NoArgs {})
            .await
            .unwrap()
            .visible
    );
    let hidden = core
        .app_set_hidden_for_presenting(&menu, HiddenArgs { hidden: true })
        .await
        .unwrap();
    assert!(hidden.hidden);
}
