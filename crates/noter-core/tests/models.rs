//! FEATURE cpt-noter-feature-core-first-run (part 2): resumable, verified model downloads
//! from the pinned manifest, reaching only the allow-listed hosts (D8 F4).

use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use noter_core::{
    allowed_download_url, BoxFuture, BundleFile, BundleSpec, ChunkSink, Clock, Core, CoreDeps,
    EnvironmentReading, EventEmitter, FetchError, ModelSource, NativeServices,
};
use noter_protocol::ipc::{event_names, Caller, CommandCtx, CoreApi};
use noter_protocol::model::*;
use noter_protocol::*;
use serde_json::Value;
use sha2::{Digest, Sha256};

#[derive(Default)]
struct Events(Mutex<Vec<&'static str>>);

impl EventEmitter for Events {
    fn emit(&self, event: &'static str, _payload: Value) {
        self.0.lock().unwrap().push(event);
    }
}

struct FixedClock;

impl Clock for FixedClock {
    fn now(&self) -> TimestampMs {
        TimestampMs(1_790_000_000_000)
    }
}

struct Disk(u32);

impl NativeServices for Disk {
    fn permission(&self, _: PermissionKind) -> PermissionState {
        PermissionState::NotAsked
    }
    fn request_permission(&self, _: PermissionKind) -> BoxFuture<'_, PermissionState> {
        Box::pin(async { PermissionState::NotAsked })
    }
    fn environment(&self) -> EnvironmentReading {
        EnvironmentReading {
            disk_free_mb: self.0,
            ..EnvironmentReading::default()
        }
    }
    fn set_login_item(&self, _: bool) -> Result<(), CoreError> {
        Ok(())
    }
}

/// Tiny bundles served from memory; each fetch can be told to fail part-way.
#[derive(Default)]
struct Bundles {
    /// File bytes by `<bundle>/<path>`.
    content: HashMap<String, Vec<u8>>,
    specs: Vec<BundleSpec>,
    /// Per file (`<bundle>/<path>`): fail with `Offline` after this many bytes on the next fetch.
    drop_after: Mutex<HashMap<String, usize>>,
    /// Every fetch, as (`<bundle>/<path>`, from_byte).
    fetches: Mutex<Vec<(String, u64)>>,
    /// Every fetch waits at its start while this is set.
    hold: std::sync::atomic::AtomicBool,
}

const CHUNK: usize = 64;

impl Bundles {
    /// A bundle of one file, `model.bin`.
    fn with(
        self,
        name: &str,
        bytes: &[u8],
        url_host: &str,
        checksum_of: &[u8],
        required: bool,
    ) -> Self {
        self.with_files(
            name,
            &[("model.bin", bytes, checksum_of)],
            url_host,
            required,
        )
    }

    /// A bundle of several files: (path in the bundle, bytes served, bytes the checksum is of).
    fn with_files(
        mut self,
        name: &str,
        files: &[(&str, &[u8], &[u8])],
        url_host: &str,
        required: bool,
    ) -> Self {
        let files = files
            .iter()
            .map(|(path, bytes, checksum_of)| {
                self.content
                    .insert(format!("{name}/{path}"), bytes.to_vec());
                BundleFile {
                    path: (*path).into(),
                    url: format!("https://{url_host}/{name}/{path}"),
                    size_bytes: bytes.len() as u64,
                    sha256: hex(&Sha256::digest(checksum_of)),
                }
            })
            .collect();
        self.specs.push(BundleSpec {
            name: name.into(),
            files,
            required_for_capture: required,
        });
        self
    }
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

impl ModelSource for Bundles {
    fn manifest(&self) -> Vec<BundleSpec> {
        self.specs.clone()
    }
    fn fetch<'a>(
        &'a self,
        file: &'a BundleFile,
        from_byte: u64,
        mut chunk: ChunkSink<'a>,
    ) -> BoxFuture<'a, Result<(), FetchError>> {
        Box::pin(async move {
            // `https://<host>/<bundle>/<path>` → `<bundle>/<path>`
            let key = file.url.splitn(4, '/').nth(3).unwrap().to_string();
            self.fetches.lock().unwrap().push((key.clone(), from_byte));
            while self.hold.load(std::sync::atomic::Ordering::SeqCst) {
                tokio::time::sleep(Duration::from_millis(1)).await;
            }
            let data = &self.content[&key][from_byte as usize..];
            let drop_after = self.drop_after.lock().unwrap().remove(&key);
            for (i, part) in data.chunks(CHUNK).enumerate() {
                if drop_after.is_some_and(|n| i * CHUNK >= n) {
                    return Err(FetchError::Offline);
                }
                if !chunk(part) {
                    return Ok(());
                }
                tokio::task::yield_now().await;
            }
            Ok(())
        })
    }
}

struct Setup {
    core: Arc<Core>,
    source: Arc<Bundles>,
    events: Arc<Events>,
}

fn open(dir: &Path, source: Bundles, disk_free_mb: u32) -> Setup {
    let events = Arc::new(Events::default());
    let source = Arc::new(source);
    let deps = CoreDeps::new(Arc::new(FixedClock), events.clone())
        .with_native(Arc::new(Disk(disk_free_mb)))
        .with_models(source.clone());
    let core = Arc::new(Core::open(dir, deps).expect("core opens"));
    core.start_first_run();
    Setup {
        core,
        source,
        events,
    }
}

fn first_run() -> CommandCtx {
    CommandCtx {
        caller: Caller::Window {
            label: WindowLabel::FirstRun,
        },
    }
}

async fn download(core: &Core, action: DownloadAction) -> Result<SetupStatus, CoreError> {
    core.models_download(&first_run(), ModelsDownloadArgs { action })
        .await
}

/// Waits until `test` holds for the setup status, or fails after 5 s.
async fn until(core: &Core, what: &str, test: impl Fn(&SetupStatus) -> bool) -> SetupStatus {
    for _ in 0..500 {
        let s = core.setup_status(&first_run(), NoArgs {}).await.unwrap();
        if test(&s) {
            return s;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    panic!("timed out waiting for {what}");
}

fn state(s: &SetupStatus, name: &str) -> BundleState {
    s.models
        .bundles
        .iter()
        .find(|b| b.name == name)
        .unwrap()
        .state
}

fn two_bundles() -> Bundles {
    let speech = vec![7u8; 1000];
    let embed = vec![9u8; 300];
    Bundles::default()
        .with("whisper-turbo", &speech, "huggingface.co", &speech, true)
        .with("bge-m3", &embed, "cdn-lfs.hf.co", &embed, false)
}

#[test]
fn only_https_urls_of_the_model_download_hosts_are_allowed() {
    assert!(allowed_download_url(
        "https://huggingface.co/argmaxinc/whisperkit/x.zip"
    ));
    assert!(allowed_download_url("https://cdn-lfs.hf.co/a/b"));
    assert!(!allowed_download_url("http://huggingface.co/x"));
    assert!(!allowed_download_url("https://evil.example/x"));
    assert!(!allowed_download_url(
        "https://huggingface.co.evil.example/x"
    ));
    assert!(!allowed_download_url("https://api.anthropic.com/v1"));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn bundles_download_verify_and_become_ready_while_the_user_does_other_steps() {
    let dir = tempfile::tempdir().unwrap();
    let s = open(dir.path(), two_bundles(), 90_000);
    let pending = s.core.setup_status(&first_run(), NoArgs {}).await.unwrap();
    assert_eq!(pending.models.bundles.len(), 2);
    assert!(pending
        .models
        .bundles
        .iter()
        .all(|b| b.state == BundleState::Pending));
    // The capture model comes first.
    assert_eq!(pending.models.bundles[0].name, "whisper-turbo");

    let started = download(&s.core, DownloadAction::Start).await.unwrap();
    assert!(started
        .models
        .bundles
        .iter()
        .all(|b| b.state == BundleState::Downloading));
    // Other steps meanwhile.
    s.core
        .setup_set_step(
            &first_run(),
            StepArgs {
                step: SetupStep::Welcome,
                state: StepState::Done,
            },
        )
        .await
        .unwrap();
    let done = until(&s.core, "both bundles ready", |st| {
        st.models
            .bundles
            .iter()
            .all(|b| b.state == BundleState::Ready)
    })
    .await;
    assert_eq!(done.models.done_mb, done.models.total_mb);
    assert!(done.models.error.is_none());
    for name in ["whisper-turbo", "bge-m3"] {
        let path = dir.path().join("models").join(name).join("model.bin");
        assert!(path.is_file(), "{name} in models/");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
    }
    assert!(
        s.events
            .0
            .lock()
            .unwrap()
            .iter()
            .filter(|e| **e == event_names::SETUP_CHANGED)
            .count()
            >= 3
    );
    // Ready bundles survive a restart and are not downloaded again.
    drop(s);
    let again = open(dir.path(), two_bundles(), 90_000);
    let st = again
        .core
        .setup_status(&first_run(), NoArgs {})
        .await
        .unwrap();
    assert!(st
        .models
        .bundles
        .iter()
        .all(|b| b.state == BundleState::Ready));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_checksum_mismatch_deletes_the_partial_file_and_retry_downloads_again() {
    let dir = tempfile::tempdir().unwrap();
    let bytes = vec![1u8; 200];
    let source = Bundles::default().with(
        "whisper-turbo",
        &bytes,
        "huggingface.co",
        b"something else",
        true,
    );
    let s = open(dir.path(), source, 90_000);
    download(&s.core, DownloadAction::Start).await.unwrap();
    let failed = until(&s.core, "checksum_failed", |st| {
        state(st, "whisper-turbo") == BundleState::ChecksumFailed
    })
    .await;
    assert_eq!(failed.models.error, Some(ErrorCode::ChecksumFailed));
    assert!(!dir.path().join("models").join("whisper-turbo").exists());
    assert!(!dir
        .path()
        .join("models")
        .join("whisper-turbo.partial/model.bin.part")
        .exists());
    // Retry fetches from the first byte again.
    download(&s.core, DownloadAction::Retry).await.unwrap();
    until(&s.core, "checksum_failed again", |st| {
        state(st, "whisper-turbo") == BundleState::ChecksumFailed
            && st.models.error == Some(ErrorCode::ChecksumFailed)
    })
    .await;
    let fetches = s.source.fetches.lock().unwrap().clone();
    assert_eq!(
        fetches,
        vec![
            ("whisper-turbo/model.bin".into(), 0),
            ("whisper-turbo/model.bin".into(), 0)
        ]
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn offline_pauses_with_the_partial_file_and_resume_continues_from_it() {
    let dir = tempfile::tempdir().unwrap();
    let s = open(dir.path(), two_bundles(), 90_000);
    s.source
        .drop_after
        .lock()
        .unwrap()
        .insert("whisper-turbo/model.bin".into(), 256);
    download(&s.core, DownloadAction::Start).await.unwrap();
    let paused = until(&s.core, "paused offline", |st| {
        state(st, "whisper-turbo") == BundleState::Paused
    })
    .await;
    assert_eq!(paused.models.error, Some(ErrorCode::Offline));
    download(&s.core, DownloadAction::Resume).await.unwrap();
    until(&s.core, "ready after resume", |st| {
        state(st, "whisper-turbo") == BundleState::Ready
    })
    .await;
    let fetches = s.source.fetches.lock().unwrap().clone();
    let speech: Vec<u64> = fetches
        .iter()
        .filter(|(n, _)| n == "whisper-turbo/model.bin")
        .map(|(_, f)| *f)
        .collect();
    assert_eq!(speech, vec![0, 256], "resumed from the partial file");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn not_enough_disk_is_disk_full_with_the_space_needed() {
    let dir = tempfile::tempdir().unwrap();
    let s = open(dir.path(), two_bundles(), 10);
    let err = download(&s.core, DownloadAction::Start).await.unwrap_err();
    assert_eq!(err.code, ErrorCode::DiskFull);
    assert!(matches!(
        err.detail,
        Some(ErrorDetail::DiskSpace { free_mb: 10, .. })
    ));
    assert!(s.source.fetches.lock().unwrap().is_empty());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_bundle_on_an_unlisted_host_fails_without_a_request() {
    let dir = tempfile::tempdir().unwrap();
    let bytes = vec![3u8; 100];
    let source = Bundles::default().with("odd", &bytes, "models.example.com", &bytes, false);
    let s = open(dir.path(), source, 90_000);
    download(&s.core, DownloadAction::Start).await.unwrap();
    until(&s.core, "failed", |st| {
        state(st, "odd") == BundleState::Failed
    })
    .await;
    assert!(s.source.fetches.lock().unwrap().is_empty());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn pause_stops_the_download_and_keeps_the_partial_file() {
    let dir = tempfile::tempdir().unwrap();
    let big = vec![5u8; 64 * 4000];
    let source = Bundles::default().with("whisper-turbo", &big, "huggingface.co", &big, true);
    let s = open(dir.path(), source, 90_000);
    download(&s.core, DownloadAction::Start).await.unwrap();
    let paused = download(&s.core, DownloadAction::Pause).await.unwrap();
    assert_ne!(state(&paused, "whisper-turbo"), BundleState::Ready);
    until(&s.core, "paused", |st| {
        state(st, "whisper-turbo") == BundleState::Paused
    })
    .await;
    download(&s.core, DownloadAction::Resume).await.unwrap();
    until(&s.core, "ready", |st| {
        state(st, "whisper-turbo") == BundleState::Ready
    })
    .await;
    assert_eq!(
        std::fs::read(dir.path().join("models/whisper-turbo/model.bin")).unwrap(),
        big
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn offline_keeps_the_progress_of_the_partial_file_and_it_is_private() {
    let dir = tempfile::tempdir().unwrap();
    let big = vec![4u8; 3 * 1024 * 1024];
    let source = Bundles::default().with("whisper-turbo", &big, "huggingface.co", &big, true);
    let s = open(dir.path(), source, 90_000);
    s.source
        .drop_after
        .lock()
        .unwrap()
        .insert("whisper-turbo/model.bin".into(), 2 * 1024 * 1024 + 100);
    download(&s.core, DownloadAction::Start).await.unwrap();
    let paused = until(&s.core, "paused offline", |st| {
        state(st, "whisper-turbo") == BundleState::Paused
    })
    .await;
    let bundle = &paused.models.bundles[0];
    assert_eq!(bundle.done_mb, 2, "the partial file's progress is kept");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let partial = dir
            .path()
            .join("models/whisper-turbo.partial/model.bin.part");
        assert_eq!(
            std::fs::metadata(partial).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn resume_right_after_pause_keeps_the_running_download_going() {
    let dir = tempfile::tempdir().unwrap();
    let big = vec![6u8; 64 * 4000];
    let source = Bundles::default().with("whisper-turbo", &big, "huggingface.co", &big, true);
    let s = open(dir.path(), source, 90_000);
    download(&s.core, DownloadAction::Start).await.unwrap();
    download(&s.core, DownloadAction::Pause).await.unwrap();
    download(&s.core, DownloadAction::Resume).await.unwrap();
    until(&s.core, "ready", |st| {
        state(st, "whisper-turbo") == BundleState::Ready
    })
    .await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn refresh_models_rereads_the_models_folder() {
    let dir = tempfile::tempdir().unwrap();
    let s = open(dir.path(), two_bundles(), 90_000);
    download(&s.core, DownloadAction::Start).await.unwrap();
    until(&s.core, "ready", |st| {
        st.models
            .bundles
            .iter()
            .all(|b| b.state == BundleState::Ready)
    })
    .await;
    // The folder changed outside the core (a restore, the harness's world_set).
    std::fs::remove_dir_all(dir.path().join("models").join("bge-m3")).unwrap();
    s.core.refresh_models();
    let st = s.core.setup_status(&first_run(), NoArgs {}).await.unwrap();
    assert_eq!(state(&st, "bge-m3"), BundleState::Pending);
    assert_eq!(state(&st, "whisper-turbo"), BundleState::Ready);
}

/// The harness's `world_set` seeds states the files cannot say (`checksum_failed`,
/// `downloading` part-way): the status shows them and the download task moves on from them.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn seed_models_sets_the_states_the_files_cannot_say() {
    let dir = tempfile::tempdir().unwrap();
    let s = open(dir.path(), two_bundles(), 90_000);
    let mut wanted = s
        .core
        .setup_status(&first_run(), NoArgs {})
        .await
        .unwrap()
        .models;
    let speech = wanted
        .bundles
        .iter_mut()
        .find(|b| b.name == "whisper-turbo")
        .unwrap();
    speech.state = BundleState::ChecksumFailed;
    wanted.error = Some(ErrorCode::ChecksumFailed);
    noter_core::testing::seed_models(&s.core, &wanted);
    let st = s.core.setup_status(&first_run(), NoArgs {}).await.unwrap();
    assert_eq!(state(&st, "whisper-turbo"), BundleState::ChecksumFailed);
    assert_eq!(st.models.error, Some(ErrorCode::ChecksumFailed));
    assert_eq!(state(&st, "bge-m3"), BundleState::Pending);
    // Try Again downloads the bundle again and it checks out.
    let again = download(&s.core, DownloadAction::Retry).await.unwrap();
    assert_eq!(state(&again, "whisper-turbo"), BundleState::Downloading);
    assert_eq!(again.models.error, None);
    // The download task ignores a seed while it runs: wait until it has fetched every bundle.
    until(&s.core, "every bundle ready", |st| {
        st.models
            .bundles
            .iter()
            .all(|b| b.state == BundleState::Ready)
    })
    .await;

    // A download part-way: the status shows the progress the world says.
    let speech = wanted
        .bundles
        .iter_mut()
        .find(|b| b.name == "whisper-turbo")
        .unwrap();
    speech.state = BundleState::Downloading;
    speech.done_mb = 1;
    wanted.error = None;
    // The task may still be ending after the last bundle: seed again until the status shows it.
    let st = until(&s.core, "the seeded download", |st| {
        let seeded = state(st, "whisper-turbo") == BundleState::Downloading;
        if !seeded {
            noter_core::testing::seed_models(&s.core, &wanted);
        }
        seeded
    })
    .await;
    assert_eq!(
        st.models
            .bundles
            .iter()
            .find(|b| b.name == "whisper-turbo")
            .unwrap()
            .done_mb,
        1
    );
}

/// A world that held a ready bundle still carries its full `done_mb`; seeding the bundle as
/// pending or checksum-failed must not show that progress (only downloading and paused have any).
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn seed_models_gives_pending_and_failed_bundles_no_progress() {
    let dir = tempfile::tempdir().unwrap();
    let s = open(dir.path(), two_bundles(), 90_000);
    let mut wanted = s
        .core
        .setup_status(&first_run(), NoArgs {})
        .await
        .unwrap()
        .models;
    for (name, seeded) in [
        ("whisper-turbo", BundleState::Pending),
        ("whisper-turbo", BundleState::ChecksumFailed),
    ] {
        let b = wanted.bundles.iter_mut().find(|b| b.name == name).unwrap();
        b.state = seeded;
        b.done_mb = b.size_mb.max(1); // what a world that was ready says
        noter_core::testing::seed_models(&s.core, &wanted);
        let st = s.core.setup_status(&first_run(), NoArgs {}).await.unwrap();
        let shown = st.models.bundles.iter().find(|b| b.name == name).unwrap();
        assert_eq!(shown.state, seeded);
        assert_eq!(shown.done_mb, 0, "{seeded:?} shows no progress");
    }
}

/// A Mac with plenty of disk whose network comes and goes.
struct Network(
    std::sync::atomic::AtomicBool,
    /// The core's change listener, to tell it the network came back.
    Mutex<Option<Listener>>,
);

type Listener = Box<dyn Fn(EnvironmentReading) + Send + Sync>;

impl NativeServices for Network {
    fn permission(&self, _: PermissionKind) -> PermissionState {
        PermissionState::NotAsked
    }
    fn request_permission(&self, _: PermissionKind) -> BoxFuture<'_, PermissionState> {
        Box::pin(async { PermissionState::NotAsked })
    }
    fn environment(&self) -> EnvironmentReading {
        EnvironmentReading {
            online: self.0.load(std::sync::atomic::Ordering::SeqCst),
            disk_free_mb: 100_000,
            ..EnvironmentReading::default()
        }
    }
    fn on_change(&self, on_change: Listener) {
        *self.1.lock().unwrap() = Some(on_change);
    }
    fn set_login_item(&self, _: bool) -> Result<(), CoreError> {
        Ok(())
    }
}

impl Network {
    /// The network comes back (or goes), and macOS says so.
    fn set_online(&self, online: bool) {
        self.0.store(online, std::sync::atomic::Ordering::SeqCst);
        let reading = self.environment();
        (self.1.lock().unwrap().as_ref().unwrap())(reading);
    }
}

/// Like the fake core: with no connection a start answers `offline` (retryable) at once and
/// nothing is fetched; pausing still works; once online, a start downloads the bundle.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn starting_while_offline_answers_offline_at_once_and_works_once_online() {
    let dir = tempfile::tempdir().unwrap();
    let source = Arc::new(Bundles::default().with(
        "whisper-turbo",
        b"model",
        "huggingface.co",
        b"model",
        true,
    ));
    let network = Arc::new(Network(false.into(), Mutex::new(None)));
    let deps = CoreDeps::new(Arc::new(FixedClock), Arc::new(Events::default()))
        .with_native(network.clone())
        .with_models(source.clone());
    let core = Arc::new(Core::open(dir.path(), deps).expect("core opens"));
    core.start_first_run();
    for action in [
        DownloadAction::Start,
        DownloadAction::Resume,
        DownloadAction::Retry,
    ] {
        let err = download(&core, action).await.unwrap_err();
        assert_eq!((err.code, err.retryable), (ErrorCode::Offline, true));
    }
    assert!(source.fetches.lock().unwrap().is_empty());
    assert!(download(&core, DownloadAction::Pause).await.is_ok());

    network.0.store(true, std::sync::atomic::Ordering::SeqCst);
    download(&core, DownloadAction::Start).await.unwrap();
    until(&core, "ready once online", |st| {
        state(st, "whisper-turbo") == BundleState::Ready
    })
    .await;
}

fn open_on(dir: &Path, source: Arc<Bundles>, network: Arc<Network>) -> Arc<Core> {
    let deps = CoreDeps::new(Arc::new(FixedClock), Arc::new(Events::default()))
        .with_native(network)
        .with_models(source);
    let core = Arc::new(Core::open(dir, deps).expect("core opens"));
    core.start_first_run();
    core
}

/// After an offline refusal, the download starts by itself once macOS says the network is
/// back; a pause the user asked for never resumes by itself.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_offline_refusal_downloads_by_itself_once_back_online() {
    let dir = tempfile::tempdir().unwrap();
    let source = Arc::new(two_bundles());
    let network = Arc::new(Network(false.into(), Mutex::new(None)));
    let core = open_on(dir.path(), source.clone(), network.clone());
    let err = download(&core, DownloadAction::Start).await.unwrap_err();
    assert_eq!(err.code, ErrorCode::Offline);
    network.set_online(true);
    until(&core, "ready once back online", |st| {
        st.models
            .bundles
            .iter()
            .all(|b| b.state == BundleState::Ready)
    })
    .await;
}

/// A transfer the network cut off resumes from its partial file once the network is back.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_download_cut_off_by_the_network_resumes_by_itself() {
    let dir = tempfile::tempdir().unwrap();
    let source = Arc::new(two_bundles());
    source
        .drop_after
        .lock()
        .unwrap()
        .insert("whisper-turbo/model.bin".into(), 2 * CHUNK);
    let network = Arc::new(Network(true.into(), Mutex::new(None)));
    let core = open_on(dir.path(), source.clone(), network.clone());
    download(&core, DownloadAction::Start).await.unwrap();
    until(&core, "paused offline", |st| {
        st.models.error == Some(ErrorCode::Offline)
    })
    .await;
    network.set_online(false);
    network.set_online(true);
    until(&core, "ready after the network came back", |st| {
        st.models
            .bundles
            .iter()
            .all(|b| b.state == BundleState::Ready)
    })
    .await;
    assert!(source
        .fetches
        .lock()
        .unwrap()
        .iter()
        .any(|(name, from)| name == "whisper-turbo/model.bin" && *from > 0));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_pause_the_user_asked_for_stays_paused_when_the_network_comes_back() {
    let dir = tempfile::tempdir().unwrap();
    let source = Arc::new(two_bundles());
    let network = Arc::new(Network(false.into(), Mutex::new(None)));
    let core = open_on(dir.path(), source.clone(), network.clone());
    download(&core, DownloadAction::Start).await.unwrap_err();
    download(&core, DownloadAction::Pause).await.unwrap();
    network.set_online(true);
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert!(source.fetches.lock().unwrap().is_empty());
}

/// macOS sends its notices on its own threads, outside any async runtime: the download still
/// starts (on the runtime the core started on).
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_back_online_notice_from_a_plain_thread_still_resumes() {
    let dir = tempfile::tempdir().unwrap();
    let source = Arc::new(two_bundles());
    let network = Arc::new(Network(false.into(), Mutex::new(None)));
    let core = open_on(dir.path(), source.clone(), network.clone());
    download(&core, DownloadAction::Start).await.unwrap_err();
    let n = network.clone();
    std::thread::spawn(move || n.set_online(true))
        .join()
        .unwrap();
    until(&core, "ready once back online", |st| {
        st.models
            .bundles
            .iter()
            .all(|b| b.state == BundleState::Ready)
    })
    .await;
}

/// The capture model as three files; the second is big enough to stop part-way.
fn three_files(bad: Option<&str>) -> Bundles {
    let (a, b, c) = (vec![1u8; 300], vec![2u8; 64 * 40], vec![3u8; 200]);
    let sum = |path: &str, bytes: &[u8]| -> Vec<u8> {
        if bad == Some(path) {
            b"not these bytes".to_vec()
        } else {
            bytes.to_vec()
        }
    };
    let (sa, sb, sc) = (sum("a.bin", &a), sum("dir/b.bin", &b), sum("c.json", &c));
    Bundles::default().with_files(
        "whisper-turbo",
        &[
            ("a.bin", &a, &sa),
            ("dir/b.bin", &b, &sb),
            ("c.json", &c, &sc),
        ],
        "huggingface.co",
        true,
    )
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_bundle_of_files_resumes_the_half_done_file_and_keeps_the_verified_ones() {
    let dir = tempfile::tempdir().unwrap();
    let s = open(dir.path(), three_files(None), 90_000);
    s.source
        .drop_after
        .lock()
        .unwrap()
        .insert("whisper-turbo/dir/b.bin".into(), 640);
    download(&s.core, DownloadAction::Start).await.unwrap();
    let paused = until(&s.core, "paused offline", |st| {
        state(st, "whisper-turbo") == BundleState::Paused
    })
    .await;
    assert_eq!(paused.models.error, Some(ErrorCode::Offline));
    let partial = dir.path().join("models/whisper-turbo.partial");
    assert!(partial.join("a.bin").is_file(), "the verified file stays");
    assert_eq!(
        std::fs::metadata(partial.join("dir/b.bin.part"))
            .unwrap()
            .len(),
        640
    );
    assert!(!dir.path().join("models/whisper-turbo").exists());
    // A restart reads the half-done bundle as paused.
    drop(s);
    let s = open(dir.path(), three_files(None), 90_000);
    let st = s.core.setup_status(&first_run(), NoArgs {}).await.unwrap();
    assert_eq!(state(&st, "whisper-turbo"), BundleState::Paused);
    download(&s.core, DownloadAction::Resume).await.unwrap();
    until(&s.core, "ready", |st| {
        state(st, "whisper-turbo") == BundleState::Ready
    })
    .await;
    // Only the half-done file is fetched again, from where it stopped.
    let fetches = s.source.fetches.lock().unwrap().clone();
    assert_eq!(
        fetches,
        vec![
            ("whisper-turbo/dir/b.bin".into(), 640),
            ("whisper-turbo/c.json".into(), 0)
        ]
    );
    let ready = dir.path().join("models/whisper-turbo");
    assert_eq!(
        std::fs::read(ready.join("dir/b.bin")).unwrap(),
        vec![2u8; 64 * 40]
    );
    assert!(ready.join("a.bin").is_file() && ready.join("c.json").is_file());
    assert!(!partial.exists());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn one_bad_file_fails_the_bundle_and_deletes_only_its_partial_file() {
    let dir = tempfile::tempdir().unwrap();
    let s = open(dir.path(), three_files(Some("dir/b.bin")), 90_000);
    download(&s.core, DownloadAction::Start).await.unwrap();
    let failed = until(&s.core, "checksum_failed", |st| {
        state(st, "whisper-turbo") == BundleState::ChecksumFailed
    })
    .await;
    assert_eq!(failed.models.error, Some(ErrorCode::ChecksumFailed));
    let partial = dir.path().join("models/whisper-turbo.partial");
    assert!(partial.join("a.bin").is_file(), "the verified file stays");
    assert!(!partial.join("dir/b.bin.part").exists());
    assert!(!partial.join("dir/b.bin").exists());
    assert!(
        !partial.join("c.json").exists(),
        "nothing after the bad file"
    );
    // Never renamed into place while a file is unverified.
    assert!(!dir.path().join("models/whisper-turbo").exists());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_bundle_file_outside_the_bundle_folder_fails_without_a_request() {
    let dir = tempfile::tempdir().unwrap();
    let bytes = vec![3u8; 100];
    let source = Bundles::default().with_files(
        "whisper-turbo",
        &[("../escape.bin", &bytes, &bytes)],
        "huggingface.co",
        true,
    );
    let s = open(dir.path(), source, 90_000);
    download(&s.core, DownloadAction::Start).await.unwrap();
    until(&s.core, "failed", |st| {
        state(st, "whisper-turbo") == BundleState::Failed
    })
    .await;
    assert!(s.source.fetches.lock().unwrap().is_empty());
    assert!(!dir.path().join("models/escape.bin").exists());
}

fn model_runs(core: &Core) -> Vec<JobRunRow> {
    core.scheduler()
        .runs()
        .unwrap()
        .into_iter()
        .filter(|r| r.kind == JobKind::ModelDownload)
        .collect()
}

// @cpt-flow:cpt-noter-flow-core-jobs-scheduler-run:p1
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_download_runs_as_a_model_download_job_with_the_same_setup_status() {
    let dir = tempfile::tempdir().unwrap();
    let s = open(dir.path(), two_bundles(), 90_000);
    download(&s.core, DownloadAction::Start).await.unwrap();
    until(&s.core, "ready", |st| {
        st.models
            .bundles
            .iter()
            .all(|b| b.state == BundleState::Ready)
    })
    .await;
    for _ in 0..500 {
        if model_runs(&s.core)
            .iter()
            .all(|r| r.status == JobRunStatus::Succeeded)
            && !model_runs(&s.core).is_empty()
        {
            break;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    let runs = model_runs(&s.core);
    assert_eq!(runs.len(), 1);
    assert_eq!(runs[0].status, JobRunStatus::Succeeded);
}

// @cpt-flow:cpt-noter-flow-core-jobs-scheduler-interrupt:p1
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_live_call_pauses_the_download_job_and_it_goes_on_when_the_call_ends() {
    let dir = tempfile::tempdir().unwrap();
    let big = vec![5u8; 64 * 30_000];
    let source = Bundles::default().with("whisper-turbo", &big, "huggingface.co", &big, true);
    let s = open(dir.path(), source, 90_000);
    s.core
        .capture_guard()
        .send(noter_jobs::CaptureGuardState {
            live: true,
            resumed_call: None,
        })
        .unwrap();
    download(&s.core, DownloadAction::Start).await.unwrap();
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert_ne!(
        model_runs(&s.core).last().map(|r| r.status),
        Some(JobRunStatus::Running),
        "nothing downloads during a live call"
    );
    assert!(!dir.path().join("models/whisper-turbo.partial").exists());
    s.core
        .capture_guard()
        .send(noter_jobs::CaptureGuardState::default())
        .unwrap();
    until(&s.core, "ready", |st| {
        state(st, "whisper-turbo") == BundleState::Ready
    })
    .await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_call_that_starts_mid_download_pauses_it_and_the_run_waits_paused() {
    let dir = tempfile::tempdir().unwrap();
    let big = vec![5u8; 64 * 30_000];
    let source = Bundles::default().with("whisper-turbo", &big, "huggingface.co", &big, true);
    let s = open(dir.path(), source, 90_000);
    s.source
        .hold
        .store(true, std::sync::atomic::Ordering::SeqCst);
    download(&s.core, DownloadAction::Start).await.unwrap();
    for _ in 0..500 {
        if !s.source.fetches.lock().unwrap().is_empty() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    s.core
        .capture_guard()
        .send(noter_jobs::CaptureGuardState {
            live: true,
            resumed_call: None,
        })
        .unwrap();
    until(&s.core, "paused", |st| {
        state(st, "whisper-turbo") == BundleState::Paused
    })
    .await;
    s.source
        .hold
        .store(false, std::sync::atomic::Ordering::SeqCst);
    for _ in 0..500 {
        if model_runs(&s.core).last().map(|r| r.status) == Some(JobRunStatus::Paused) {
            break;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    assert_eq!(
        model_runs(&s.core).last().map(|r| r.status),
        Some(JobRunStatus::Paused)
    );
    s.core
        .capture_guard()
        .send(noter_jobs::CaptureGuardState::default())
        .unwrap();
    until(&s.core, "ready", |st| {
        state(st, "whisper-turbo") == BundleState::Ready
    })
    .await;
}
