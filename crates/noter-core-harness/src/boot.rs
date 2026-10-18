//! The real core behind the wire (`cpt-noter-algo-core-harness-boot`): a fresh
//! `noter_core::Core` in a temporary data folder, scripted platform seams instead of the Mac,
//! the fixture world seeded through the core's own commands, and the scenario controls
//! `harness.world_get`, `harness.world_set` and `harness.push` (docs/TEST-PLAN.md).
//!
//! The fixture is seeded with the public commands (`settings_update` per section,
//! `glossary_upsert`, `setup_set_step`, `setup_set_call_display`) and `Core::set_banners`, so it
//! goes through the same change-logged write path a user's edit takes; the Mac's side
//! (permissions, displays, reachability, disk, update) lives in the scripted seams.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use noter_core::{
    BoxFuture as CoreFuture, BundleSpec, ChunkSink, Clock, Core, CoreDeps, EnvironmentReading,
    EventEmitter, FetchError, ModelSource, NativeServices, SystemClock, Updater,
};
use noter_protocol::fixtures::{world, FakeWorld};
use noter_protocol::ipc::{dispatch_json, Caller, CommandCtx};
use noter_protocol::model::*;
use noter_protocol::{CoreError, ErrorCode, PermissionKind, PermissionState, TimestampMs};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::{lock, BoxFuture, Controls, Lines};

/// Command-line options of the harness.
#[derive(Debug, Clone, Copy, Default)]
pub struct Options {
    /// `--fixture world`: seed the fixture world of noter-protocol.
    pub fixture: bool,
    /// `--clock fixed`: the core's clock stands at the fixture's `now`.
    pub fixed_clock: bool,
}

/// The harness around one real core.
pub struct Harness {
    core: Arc<Core>,
    native: Arc<ScriptedNative>,
    updater: Arc<ScriptedUpdater>,
    /// The last world `world_set` accepted, for the slices no M0 service owns.
    world: Mutex<FakeWorld>,
    dir: PathBuf,
}

impl Harness {
    /// Boots the core; `Err` with the reason when the data folder or the store cannot open.
    pub async fn start(options: Options, lines: Lines) -> Result<Arc<Harness>, String> {
        // @cpt-begin:cpt-noter-algo-core-harness-boot:p1:inst-temp-dir
        static NEXT: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
        let n = NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!(
            "noter-core-harness-{}-{}-{n}",
            std::process::id(),
            nanos()
        ));
        std::fs::create_dir_all(dir.join("models")).map_err(|e| e.to_string())?;
        // @cpt-end:cpt-noter-algo-core-harness-boot:p1:inst-temp-dir
        let w = if options.fixture {
            world()
        } else {
            blank(world())
        };
        let native = Arc::new(ScriptedNative::new(&w.app.environment));
        let updater = Arc::new(ScriptedUpdater(Mutex::new(
            w.app.environment.update.clone(),
        )));
        let models = Arc::new(TinyModels::new(&w.app.setup.models, native.clone()));
        models
            .place(&dir.join("models"), &w.app.setup.models)
            .map_err(|e| e.to_string())?;
        let clock: Arc<dyn Clock> = if options.fixed_clock {
            Arc::new(Fixed(w.now))
        } else {
            Arc::new(SystemClock)
        };
        let deps = CoreDeps::new(clock, Arc::new(EventLines(lines)))
            .with_native(native.clone())
            .with_models(models)
            .with_updater(updater.clone());
        // @cpt-begin:cpt-noter-algo-core-harness-boot:p1:inst-open-store
        // @cpt-begin:cpt-noter-algo-core-harness-boot:p1:inst-build-core
        let core = Arc::new(Core::open(&dir, deps).map_err(|e| e.to_string())?);
        core.start_first_run();
        // @cpt-end:cpt-noter-algo-core-harness-boot:p1:inst-build-core
        // @cpt-end:cpt-noter-algo-core-harness-boot:p1:inst-open-store
        let harness = Arc::new(Harness {
            core,
            native,
            updater,
            world: Mutex::new(w.clone()),
            dir,
        });
        // @cpt-begin:cpt-noter-algo-core-harness-boot:p1:inst-if-fixture
        // @cpt-begin:cpt-noter-algo-core-harness-boot:p1:inst-seed
        if options.fixture {
            harness
                .seed(&w)
                .await
                .map_err(|e| format!("seeding the fixture world: {}", e.message))?;
        }
        // @cpt-end:cpt-noter-algo-core-harness-boot:p1:inst-seed
        // @cpt-end:cpt-noter-algo-core-harness-boot:p1:inst-if-fixture
        // @cpt-begin:cpt-noter-algo-core-harness-boot:p1:inst-return-booted
        eprintln!("noter-core-harness: core open in {}", harness.dir.display());
        Ok(harness)
        // @cpt-end:cpt-noter-algo-core-harness-boot:p1:inst-return-booted
    }

    /// The core, for `serve_with`.
    pub fn core(&self) -> Arc<Core> {
        self.core.clone()
    }

    /// The fixture's owned slices, through the core's own commands.
    async fn seed(&self, w: &FakeWorld) -> Result<(), CoreError> {
        let wanted = to_json(w);
        self.write_settings(&wanted["settings"]).await?;
        for term in w.glossary.terms.iter() {
            let t = to_json(term);
            let args = json!({ "term": t["term"], "variants_latin": t["variants_latin"], "variants_cyrillic": t["variants_cyrillic"], "spoken_forms": t["spoken_forms"], "always_apply": t["always_apply"] });
            self.call(WindowLabel::Settings, "glossary_upsert", args)
                .await?;
        }
        self.write_setup(&wanted["app"]["setup"]).await?;
        if !w.app.banners.banners.is_empty() {
            self.core.set_banners(w.app.banners.banners.clone());
        }
        Ok(())
    }

    async fn call(&self, window: WindowLabel, cmd: &str, args: Value) -> Result<Value, CoreError> {
        dispatch_json(
            &*self.core,
            &CommandCtx {
                caller: Caller::Window { label: window },
            },
            cmd,
            args,
            None,
        )
        .await
    }

    /// Each settings section that differs, with the current `rev`.
    async fn write_settings(&self, wanted: &Value) -> Result<(), CoreError> {
        let current = self
            .call(WindowLabel::Settings, "settings_get", json!({}))
            .await?;
        for (section, value) in wanted.as_object().into_iter().flatten() {
            if matches!(section.as_str(), "rev" | "version") || current.get(section) == Some(value)
            {
                continue;
            }
            // The core's own reactions to a section (first run follows `general`) can bump `rev`
            // meanwhile; a conflict carries the current one, so try again with it.
            let mut rev = self
                .call(WindowLabel::Settings, "settings_get", json!({}))
                .await?["rev"]
                .clone();
            for attempt in 0..3 {
                let args = json!({ "rev": rev, "section": { "section": section, "value": value } });
                match self
                    .call(WindowLabel::Settings, "settings_update", args)
                    .await
                {
                    Ok(_) => break,
                    Err(e) if e.code == ErrorCode::Conflict && attempt < 2 => {
                        rev = to_json(&e.detail)["current_rev"].clone()
                    }
                    Err(e) => return Err(e),
                }
            }
        }
        Ok(())
    }

    /// Step states and the call display; a step the core refuses (Assistants done in M0) is
    /// left as the core has it, and `world_get` reports what the core holds.
    async fn write_setup(&self, wanted: &Value) -> Result<(), CoreError> {
        let current = self
            .call(WindowLabel::FirstRun, "setup_status", json!({}))
            .await?;
        for step in wanted["steps"].as_array().into_iter().flatten() {
            let now = current["steps"]
                .as_array()
                .into_iter()
                .flatten()
                .find(|s| s["step"] == step["step"]);
            if now.map(|s| &s["state"]) != Some(&step["state"]) {
                let _ = self
                    .call(WindowLabel::FirstRun, "setup_set_step", step.clone())
                    .await;
            }
        }
        if current["call_display"] != wanted["call_display"] {
            self.call(
                WindowLabel::FirstRun,
                "setup_set_call_display",
                json!({ "display_id": wanted["call_display"] }),
            )
            .await?;
        }
        Ok(())
    }

    /// The world as the core holds it: the real read models for every slice a service owns,
    /// the snapshot's slices, and the last accepted value for everything else.
    async fn world_get(&self) -> Result<Value, CoreError> {
        let mut w = to_json(&*lock(&self.world));
        w["settings"] = self
            .call(WindowLabel::Settings, "settings_get", json!({}))
            .await?;
        w["glossary"] = self
            .call(WindowLabel::Settings, "glossary_list", json!({}))
            .await?;
        w["app"] = self
            .call(WindowLabel::Main, "app_snapshot", json!({}))
            .await?;
        w["app"]["setup"] = self
            .call(WindowLabel::FirstRun, "setup_status", json!({}))
            .await?;
        Ok(w)
    }

    /// Applies the slices that changed, or refuses the whole world with `not_implemented`
    /// naming every changed slice no M0 service owns; nothing is applied then.
    async fn world_set(&self, args: Value) -> Result<Value, CoreError> {
        let typed = |v: Value| serde_json::from_value::<FakeWorld>(v);
        let parsed = typed(args.get("world").cloned().unwrap_or(Value::Null)).map_err(|_| {
            CoreError::new(
                ErrorCode::InvalidInput,
                "harness.world_set needs { world: FakeWorld }",
            )
        })?;
        // Both sides through the typed world: f32 fields do not survive a JSON round trip bit
        // for bit, so comparing raw values would see every confidence as changed.
        let wanted = to_json(&parsed);
        let current = to_json(&typed(self.world_get().await?).map_err(crate::internal)?);
        let mut refused = vec![];
        for (key, value) in wanted.as_object().into_iter().flatten() {
            if current.get(key) == Some(value) || matches!(key.as_str(), "now" | "settings" | "app")
            {
                continue;
            }
            refused.push(key.clone());
        }
        for (key, value) in wanted["app"].as_object().into_iter().flatten() {
            if current["app"].get(key) != Some(value) && !OWNED_APP.contains(&key.as_str()) {
                refused.push(format!("app.{key}"));
            }
        }
        for key in ["models", "self_test"] {
            if current["app"]["setup"][key] != wanted["app"]["setup"][key] {
                refused.push(format!("app.setup.{key}"));
            }
        }
        if !refused.is_empty() {
            return Err(CoreError::new(
                ErrorCode::NotImplemented,
                format!(
                    "harness.world_set: no M0 service owns {}",
                    refused.join(", ")
                ),
            ));
        }
        self.write_settings(&wanted["settings"]).await?;
        self.write_setup(&wanted["app"]["setup"]).await?;
        let env = &parsed.app.environment;
        if current["app"]["environment"] != wanted["app"]["environment"]
            || current["app"]["setup"]["permissions"] != wanted["app"]["setup"]["permissions"]
        {
            self.native.set(env, &parsed.app.setup.permissions);
            *lock(&self.updater.0) = env.update.clone();
            self.core.environment_changed(self.native.environment());
        }
        if current["app"]["banners"]["banners"] != wanted["app"]["banners"]["banners"] {
            self.core.set_banners(parsed.app.banners.banners.clone());
        }
        *lock(&self.world) = parsed;
        Ok(json!({}))
    }
}

/// App snapshot slices the harness can set on the M0 core; `window` is the caller's own and the
/// version-only slices follow their owners.
const OWNED_APP: &[&str] = &["setup", "environment", "banners", "window"];

impl Controls for Harness {
    fn control<'a>(
        &'a self,
        name: &'a str,
        args: Value,
    ) -> BoxFuture<'a, Result<Value, CoreError>> {
        Box::pin(async move {
            match name {
                "world_get" => self.world_get().await,
                "world_set" => self.world_set(args).await,
                // shortcut: no M0 Channel has a scripted source yet (self_test_run is not in
                // noter-core); push arrives with the scripted engine behind the self-test.
                "push" => Err(CoreError::new(
                    ErrorCode::NotImplemented,
                    "harness.push: no scripted stream in the M0 core yet",
                )),
                _ => Err(CoreError::new(
                    ErrorCode::InvalidInput,
                    format!("no control harness.{name}"),
                )),
            }
        })
    }

    // @cpt-state:cpt-noter-state-core-harness-process:p1
    fn shutdown(&self) -> BoxFuture<'_, ()> {
        Box::pin(async move {
            // @cpt-begin:cpt-noter-state-core-harness-process:p1:inst-st-shutdown
            self.core.shutdown().await;
            // @cpt-end:cpt-noter-state-core-harness-process:p1:inst-st-shutdown
            let _ = std::fs::remove_dir_all(&self.dir);
        })
    }
}

/// The fixture world without the rows a fresh install has none of (no `--fixture`).
fn blank(mut w: FakeWorld) -> FakeWorld {
    w.glossary.terms.clear();
    w.app.banners.banners.clear();
    w
}

fn to_json<T: serde::Serialize>(v: &T) -> Value {
    serde_json::to_value(v).unwrap_or(Value::Null)
}

fn nanos() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_nanos())
}

struct Fixed(TimestampMs);

impl Clock for Fixed {
    fn now(&self) -> TimestampMs {
        self.0
    }
}

/// Core events as event lines.
struct EventLines(Lines);

impl EventEmitter for EventLines {
    fn emit(&self, event: &'static str, payload: Value) {
        self.0.event(event, payload);
    }
}

/// The Mac, as the world says: permission states, displays, output, reachability and disk.
struct ScriptedNative(Mutex<(HashMap<PermissionKind, PermissionState>, EnvironmentReading)>);

impl ScriptedNative {
    fn new(env: &EnvironmentState) -> Self {
        let native = ScriptedNative(Mutex::new((HashMap::new(), EnvironmentReading::default())));
        native.set(env, &env.permissions);
        native
    }

    fn set(&self, env: &EnvironmentState, setup_rows: &[PermissionRow]) {
        let mut state = lock(&self.0);
        // The setup status and the environment show the same rows (`W.permission` writes both);
        // a row changed in either wins over the unchanged one.
        for row in env.permissions.iter().chain(setup_rows) {
            if state.0.get(&row.kind) != Some(&row.state) {
                state.0.insert(row.kind, row.state);
            }
        }
        state.1 = EnvironmentReading {
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
        let answer = match state.0.get(&kind) {
            None | Some(PermissionState::NotAsked) => PermissionState::Granted,
            Some(s) => *s,
        };
        state.0.insert(kind, answer);
        Box::pin(async move { answer })
    }

    fn environment(&self) -> EnvironmentReading {
        lock(&self.0).1.clone()
    }

    fn set_login_item(&self, _: bool) -> Result<(), CoreError> {
        Ok(())
    }
}

/// The world's model bundles as tiny files with real checksums, served from memory.
struct TinyModels {
    specs: Vec<(BundleSpec, Vec<u8>)>,
    native: Arc<ScriptedNative>,
}

impl TinyModels {
    fn new(models: &ModelsStatus, native: Arc<ScriptedNative>) -> Self {
        let specs = models
            .bundles
            .iter()
            .map(|b| {
                let bytes = format!("noter-core-harness model bundle {}\n", b.name)
                    .repeat(64)
                    .into_bytes();
                let spec = BundleSpec {
                    name: b.name.clone(),
                    url: format!(
                        "https://huggingface.co/noter-harness/{}",
                        b.name.replace(' ', "-")
                    ),
                    size_bytes: bytes.len() as u64,
                    sha256: hex(&Sha256::digest(&bytes)),
                    required_for_capture: b.required_for_capture,
                };
                (spec, bytes)
            })
            .collect();
        TinyModels { specs, native }
    }

    /// Writes the bundles the world shows as ready, before the core reads `models/`.
    fn place(&self, dir: &std::path::Path, models: &ModelsStatus) -> std::io::Result<()> {
        for (spec, bytes) in &self.specs {
            if models
                .bundles
                .iter()
                .any(|b| b.name == spec.name && b.state == BundleState::Ready)
            {
                std::fs::write(dir.join(&spec.name), bytes)?;
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
        bundle: &'a BundleSpec,
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
                .find(|(s, _)| s.name == bundle.name)
                .ok_or(FetchError::Http(404))?
                .1;
            for part in bytes[(from_byte as usize).min(bytes.len())..].chunks(256) {
                if !chunk(part) {
                    break;
                }
            }
            Ok(())
        })
    }
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// A downloaded update, as the world says; installing it answers and the process keeps serving
/// (relaunching is the app's job, not the harness's).
struct ScriptedUpdater(Mutex<Option<UpdateInfo>>);

impl Updater for ScriptedUpdater {
    fn ready(&self) -> Option<UpdateInfo> {
        lock(&self.0).clone()
    }

    fn install(&self) -> CoreFuture<'_, Result<(), CoreError>> {
        Box::pin(async { Ok(()) })
    }
}
