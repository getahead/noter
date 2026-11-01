//! The thin Tauri host (DESIGN-core › IPC host): a handler for every contract command (and no
//! other name), forwarding to the core through `dispatch_json`. No product logic and no state
//! beyond the booted core.

// @cpt-component:cpt-noter-component-core-ipc-host:p1

mod alert_keys;
pub mod e2e_log;
mod keychain;
mod native;
pub mod surfaces;
#[cfg(debug_assertions)]
mod test_hooks;
pub mod updater;

use std::sync::{Arc, OnceLock};

use noter_core::{
    Adapters, CliConfig, Core, CoreDeps, EventEmitter, OllamaConfig, PinnedModels,
    ShortcutRegistrar, ShortcutTaken, SystemClock,
};
use noter_engine_client::ProcessLauncher;
use noter_protocol::ipc::{dispatch_json, Caller, CommandCtx, Sink};
use noter_protocol::model::WindowLabel;
use noter_protocol::{CoreError, ErrorCode};
use serde_json::Value;
use tauri::ipc::{Channel, Invoke, InvokeBody, InvokeError, JavaScriptChannelId};
use tauri::webview::PageLoadEvent;
use tauri::{AppHandle, Emitter, Manager, RunEvent, Runtime, Webview, WindowEvent};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

pub use native::Mac;

const WINDOWS: [WindowLabel; 5] = [
    WindowLabel::Main,
    WindowLabel::CallScreen,
    WindowLabel::RecordPrompt,
    WindowLabel::Settings,
    WindowLabel::FirstRun,
];

/// The core, or why it did not start (then every command answers `internal`).
pub struct Booted(pub Result<Arc<Core>, String>);

/// The host's handlers and webview reloads and closes reported to the stream hub. The core is
/// managed as `Booted` once it started; until then every command answers `not_ready`.
pub fn builder<R: Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
    builder
        .invoke_handler(invoke::<R>)
        .on_page_load(|webview, payload| {
            if payload.event() == PageLoadEvent::Started {
                reset(webview.label(), webview.try_state::<Booted>().as_deref());
            }
        })
        .on_window_event(|window, event| match event {
            WindowEvent::Destroyed => {
                reset(window.label(), window.try_state::<Booted>().as_deref())
            }
            // The user moved or resized the call window: its frame is saved (inst-frame).
            WindowEvent::Moved(_) | WindowEvent::Resized(_)
                if window.label() == WindowLabel::CallScreen.as_str() =>
            {
                if let Some(surfaces) = window.try_state::<Arc<surfaces::TauriSurfaces<R>>>() {
                    surfaces.call_window_changed(window);
                }
            }
            // Noter became active: the core re-checks what macOS cannot report (D-19).
            WindowEvent::Focused(true) => {
                if let Some(Ok(core)) = window.try_state::<Booted>().map(|b| b.0.clone()) {
                    core.app_activated();
                }
            }
            _ => {}
        })
}

/// Runs the app: opens the core on Application Support once the app exists (its hotkeys need the
/// global-shortcut plugin), serves the windows, shuts the core down on exit.
pub fn run() {
    let events = Arc::new(TauriEvents::default());
    let app = builder(tauri::Builder::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_nspanel::init())
        .menu(surfaces::app_menu)
        .on_menu_event(|app, event| {
            if event.id() == surfaces::APP_QUIT {
                surfaces::quit(app);
            }
        })
        .setup(move |app| {
            let _ = events.0.set(app.handle().clone());
            alert_keys::return_chooses_cancel();
            // Once, before the event loop: noter-native runs the handler on the main thread.
            let clicked = app.handle().clone();
            noter_native::on_notification_click(Box::new(move |target| {
                surfaces::notification_clicked(&clicked, target)
            }));
            let shortcuts = Arc::new(TauriShortcuts(app.handle().clone()));
            let updater = Arc::new(updater::TauriUpdater::new(app.handle().clone()));
            let group = noter_core::default_data_dir()
                .map(|dir| noter_native::app_group_container().unwrap_or(dir))
                .unwrap_or_default();
            let surfaces = surfaces::TauriSurfaces::new(app.handle().clone(), group);
            app.manage(surfaces.clone());
            app.manage(boot(events.clone(), shortcuts, updater.clone(), surfaces));
            // Without a feed (M0) the check ends at once and nothing is ever ready.
            tauri::async_runtime::spawn(async move {
                let _ = updater.check().await;
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("Noter could not build its windows");
    app.run(move |app, event| {
        if let RunEvent::Exit = event {
            e2e_log::write_on_quit();
            if let Some(surfaces) = app.try_state::<Arc<surfaces::TauriSurfaces<tauri::Wry>>>() {
                surfaces.save_frames();
            }
            if let Some(Ok(core)) = app.try_state::<Booted>().map(|b| b.0.clone()) {
                tauri::async_runtime::block_on(core.shutdown());
            }
        }
    });
}

fn boot<R: Runtime>(
    events: Arc<dyn EventEmitter>,
    shortcuts: Arc<dyn ShortcutRegistrar>,
    updater: Arc<dyn noter_core::Updater>,
    surfaces: Arc<surfaces::TauriSurfaces<R>>,
) -> Booted {
    // The native UI tests launch a debug build on the harness's scripted Mac (test_hooks).
    #[cfg(debug_assertions)]
    if let Some(booted) = test_hooks::boot(events.clone(), shortcuts.clone(), &surfaces) {
        return booted;
    }
    let Some(dir) = noter_core::default_data_dir() else {
        return Booted(Err("no home folder".into()));
    };
    // D14: the App Group container the sandboxed engine shares (its models/); unsigned
    // development runs have none and use the data folder.
    let group = noter_native::app_group_container().unwrap_or_else(|| dir.clone());
    // The engine sits next to the app binary (Contents/MacOS) or at NOTER_ENGINE_PATH in
    // development.
    let bundled = std::env::current_exe()
        .ok()
        .and_then(|exe| Some(exe.parent()?.join("noter-engine")))
        .unwrap_or_else(|| "noter-engine".into());
    let engine = ProcessLauncher::from_env(bundled).app_group(&group);
    // The app's version (this crate's, as tauri.conf.json), for app_snapshot.
    let deps = CoreDeps::new(Arc::new(SystemClock), events)
        .with_app_version(env!("CARGO_PKG_VERSION"))
        .with_shortcuts(shortcuts)
        .with_engine(Arc::new(engine))
        .with_native(Arc::new(Mac::new(&group)))
        .with_native_ops(Arc::new(native::MacOps))
        .with_models_dir(group.join("models"))
        .with_models(Arc::new(PinnedModels::new()))
        .with_updater(updater)
        .with_surfaces(surfaces.clone())
        .with_llm(runtimes(&dir))
        .with_secrets(Arc::new(keychain::Keychain));
    match Core::open(&dir, deps) {
        Ok(core) => {
            let core = Arc::new(core);
            surfaces.attach(&core);
            // On the async runtime, which first run keeps for macOS's notices (other threads).
            tauri::async_runtime::block_on(async { core.start_first_run() });
            Booted(Ok(core))
        }
        Err(e) => {
            eprintln!("noter: {e}");
            Booted(Err(e.to_string()))
        }
    }
}

/// The real runtimes: Claude Code and Codex run locked down from `<data>/runtimes`, Ollama on
/// this Mac. Own-account sign-in is M3, so only the API-key and local runtimes run in M2.
fn runtimes(data: &std::path::Path) -> Adapters {
    let home = std::env::var_os("HOME")
        .map(std::path::PathBuf::from)
        .unwrap_or_default();
    let cli = |name: &str| CliConfig {
        program: find_cli(&home, name),
        home: home.clone(),
        run_root: data.join("runtimes"),
        signed_in: false,
        models: Vec::new(),
    };
    let ollama = OllamaConfig {
        url: "http://127.0.0.1:11434".into(),
        models: Vec::new(),
    };
    Adapters::real(cli("claude"), cli("codex"), ollama)
}

/// shortcut: an app started from Finder has no shell PATH, so the usual install folders are
/// tried first; a CLI elsewhere is found by name on PATH (CLI install, M3, records its path).
fn find_cli(home: &std::path::Path, name: &str) -> std::path::PathBuf {
    let dirs = [
        home.join(".local/bin"),
        home.join(".claude/local"),
        "/opt/homebrew/bin".into(),
        "/usr/local/bin".into(),
    ];
    dirs.iter()
        .map(|d| d.join(name))
        .find(|p| p.is_file())
        .unwrap_or_else(|| name.into())
}

/// Tauri's invoke handler: a name in `COMMANDS` is answered (one handler per command, with
/// `{ args, channel? }` as the generated transport sends it); any other name is not handled.
fn invoke<R: Runtime>(invoke: Invoke<R>) -> bool {
    let Some(spec) = noter_protocol::ipc::command(invoke.message.command()) else {
        return false;
    };
    let webview = invoke.message.webview();
    let body = match invoke.message.payload() {
        InvokeBody::Json(body) => body.clone(),
        InvokeBody::Raw(_) => Value::Null,
    };
    let args = body.get("args").cloned().unwrap_or(Value::Null);
    let channel = spec
        .channel
        .and_then(|_| body.get("channel").cloned())
        .and_then(|id| serde_json::from_value::<JavaScriptChannelId>(id).ok())
        .map(|id| id.channel_on(webview.clone()));
    let Some(booted) = webview.try_state::<Booted>().map(|b| Booted(b.0.clone())) else {
        let starting = CoreError::new(ErrorCode::NotReady, "the core is starting");
        invoke
            .resolver
            .respond_async(async move { Err::<Value, _>(InvokeError::from(starting)) });
        return true;
    };
    invoke.resolver.respond_async(async move {
        let answer = handle(&webview, &booted, spec.name, args, channel).await;
        answer.map_err(InvokeError::from)
    });
    true
}

/// One contract command from a window.
// @cpt-flow:cpt-noter-flow-core-ipc-host-command:p1
// @cpt-dod:cpt-noter-dod-core-ipc-host-handlers:p1
pub async fn handle<R: Runtime>(
    webview: &Webview<R>,
    booted: &Booted,
    name: &str,
    args: Value,
    channel: Option<Channel<Value>>,
) -> Result<Value, CoreError> {
    // @cpt-begin:cpt-noter-flow-core-ipc-host-command:p1:inst-invoke
    let core = booted
        .0
        .as_ref()
        .map_err(|why| CoreError::new(ErrorCode::Internal, why.clone()))?;
    // @cpt-end:cpt-noter-flow-core-ipc-host-command:p1:inst-invoke
    // @cpt-begin:cpt-noter-flow-core-ipc-host-command:p1:inst-build-ctx
    let label = window_label(webview.label()).ok_or_else(|| {
        CoreError::new(
            ErrorCode::WindowNotAllowed,
            format!("{name} from {}", webview.label()),
        )
    })?;
    let ctx = CommandCtx {
        caller: Caller::Window { label },
    };
    // @cpt-end:cpt-noter-flow-core-ipc-host-command:p1:inst-build-ctx
    // @cpt-begin:cpt-noter-flow-core-ipc-host-command:p1:inst-adapt-sink
    let sink = channel.map(|c| Sink::new(move |m: Value| c.send(m).is_ok()));
    // @cpt-end:cpt-noter-flow-core-ipc-host-command:p1:inst-adapt-sink
    // `dispatch_json` (noter-protocol) runs the scope check (`CommandSpec::check_caller`: a native
    // caller passes, a listed window passes, anything else is refused), then parses the arguments
    // and calls the core, so every transport shares one scope check and one parse path.
    // @cpt-algo:cpt-noter-algo-core-ipc-host-scope-check:p1
    // @cpt-begin:cpt-noter-flow-core-ipc-host-command:p1:inst-scope-check
    // @cpt-begin:cpt-noter-flow-core-ipc-host-command:p1:inst-if-refused
    // @cpt-begin:cpt-noter-flow-core-ipc-host-command:p1:inst-return-not-allowed
    // @cpt-begin:cpt-noter-flow-core-ipc-host-command:p1:inst-parse-args
    // @cpt-begin:cpt-noter-flow-core-ipc-host-command:p1:inst-call-core
    // @cpt-begin:cpt-noter-algo-core-ipc-host-scope-check:p1:inst-if-native
    // @cpt-begin:cpt-noter-algo-core-ipc-host-scope-check:p1:inst-return-native
    // @cpt-begin:cpt-noter-algo-core-ipc-host-scope-check:p1:inst-if-in-scope
    // @cpt-begin:cpt-noter-algo-core-ipc-host-scope-check:p1:inst-return-allowed
    // @cpt-begin:cpt-noter-algo-core-ipc-host-scope-check:p1:inst-return-refused
    let result = dispatch_json(core.as_ref(), &ctx, name, args, sink).await;
    if result.is_ok() {
        e2e_log::record(name);
    }
    // @cpt-end:cpt-noter-algo-core-ipc-host-scope-check:p1:inst-return-refused
    // @cpt-end:cpt-noter-algo-core-ipc-host-scope-check:p1:inst-return-allowed
    // @cpt-end:cpt-noter-algo-core-ipc-host-scope-check:p1:inst-if-in-scope
    // @cpt-end:cpt-noter-algo-core-ipc-host-scope-check:p1:inst-return-native
    // @cpt-end:cpt-noter-algo-core-ipc-host-scope-check:p1:inst-if-native
    // @cpt-end:cpt-noter-flow-core-ipc-host-command:p1:inst-call-core
    // @cpt-end:cpt-noter-flow-core-ipc-host-command:p1:inst-parse-args
    // @cpt-end:cpt-noter-flow-core-ipc-host-command:p1:inst-return-not-allowed
    // @cpt-end:cpt-noter-flow-core-ipc-host-command:p1:inst-if-refused
    // @cpt-end:cpt-noter-flow-core-ipc-host-command:p1:inst-scope-check
    // @cpt-begin:cpt-noter-flow-core-ipc-host-command:p1:inst-return-result
    result
    // @cpt-end:cpt-noter-flow-core-ipc-host-command:p1:inst-return-result
}

/// The app's windows by label; any other webview (devtools, a stray page) is no window.
fn window_label(label: &str) -> Option<WindowLabel> {
    WINDOWS.into_iter().find(|w| w.as_str() == label)
}

/// A webview loaded a page or closed: its subscriptions end and the page subscribes again.
fn reset(label: &str, booted: Option<&Booted>) {
    if let (Some(label), Some(Booted(Ok(core)))) = (window_label(label), booted) {
        core.webview_reset(label);
    }
}

/// The app's global shortcuts, through the Tauri global-shortcut plugin: each registered chord's
/// press goes to the core as `Caller::Native { surface: hotkey }`.
struct TauriShortcuts<R: Runtime>(AppHandle<R>);

impl<R: Runtime> ShortcutRegistrar for TauriShortcuts<R> {
    fn register(&self, chord: &str) -> Result<(), ShortcutTaken> {
        let pressed = chord.to_string();
        let handler =
            move |app: &AppHandle<R>,
                  _: &tauri_plugin_global_shortcut::Shortcut,
                  event: tauri_plugin_global_shortcut::ShortcutEvent| {
                if event.state() == ShortcutState::Pressed {
                    hotkey_pressed(app, &pressed);
                }
            };
        // macOS refuses a chord another app holds without naming that app.
        self.0
            .global_shortcut()
            .on_shortcut(chord, handler)
            .map_err(|_| ShortcutTaken { owner: None })
    }

    fn unregister(&self, chord: &str) {
        let _ = self.0.global_shortcut().unregister(chord);
    }
}

/// A pressed hotkey: the core runs its action's command as `Caller::Native { surface: hotkey }`
/// (commands of later milestones answer `not_implemented`). `None` while the core is not up.
pub fn hotkey_pressed<R: Runtime>(
    app: &AppHandle<R>,
    chord: &str,
) -> Option<tauri::async_runtime::JoinHandle<Result<Value, CoreError>>> {
    let core = app.try_state::<Booted>()?.0.clone().ok()?;
    let chord = chord.to_string();
    Some(tauri::async_runtime::spawn(async move {
        let answer = core.hotkey_pressed(&chord).await;
        if let (Ok(_), Ok((_, name, _))) = (&answer, core.hotkey_command(&chord)) {
            e2e_log::record(name);
        }
        // Refusals (not_recording, not_implemented) are expected; a failure leaves a trace without content.
        if matches!(&answer, Err(e) if e.code == ErrorCode::Internal) {
            eprintln!("noter: the hotkey {chord} failed (internal)");
        }
        answer
    }))
}

/// Core events to every window, through Tauri's `emit`, once the app exists.
#[derive(Default)]
struct TauriEvents(OnceLock<tauri::AppHandle>);

impl EventEmitter for TauriEvents {
    fn emit(&self, event: &'static str, payload: Value) {
        if let Some(app) = self.0.get() {
            let _ = app.emit(event, payload);
        }
    }
}
