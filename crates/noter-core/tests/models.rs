//! FEATURE cpt-noter-feature-core-first-run (part 2): resumable, verified model downloads
//! from the pinned manifest, reaching only the allow-listed hosts (D8 F4).

use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use noter_core::{
    allowed_download_url, BoxFuture, BundleSpec, ChunkSink, Clock, Core, CoreDeps,
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
    content: HashMap<String, Vec<u8>>,
    specs: Vec<BundleSpec>,
    /// Per bundle: fail with `Offline` after this many bytes on the next fetch.
    drop_after: Mutex<HashMap<String, usize>>,
    /// Every fetch, as (bundle, from_byte).
    fetches: Mutex<Vec<(String, u64)>>,
}

const CHUNK: usize = 64;

impl Bundles {
    fn with(
        mut self,
        name: &str,
        bytes: &[u8],
        url_host: &str,
        checksum_of: &[u8],
        required: bool,
    ) -> Self {
        self.content.insert(name.into(), bytes.to_vec());
        self.specs.push(BundleSpec {
            name: name.into(),
            url: format!("https://{url_host}/{name}.zip"),
            size_bytes: bytes.len() as u64,
            sha256: hex(&Sha256::digest(checksum_of)),
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
        bundle: &'a BundleSpec,
        from_byte: u64,
        mut chunk: ChunkSink<'a>,
    ) -> BoxFuture<'a, Result<(), FetchError>> {
        Box::pin(async move {
            self.fetches
                .lock()
                .unwrap()
                .push((bundle.name.clone(), from_byte));
            let data = &self.content[&bundle.name][from_byte as usize..];
            let drop_after = self.drop_after.lock().unwrap().remove(&bundle.name);
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
        let path = dir.path().join("models").join(name);
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
        .join("whisper-turbo.partial")
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
        vec![("whisper-turbo".into(), 0), ("whisper-turbo".into(), 0)]
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
        .insert("whisper-turbo".into(), 256);
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
        .filter(|(n, _)| n == "whisper-turbo")
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
        std::fs::read(dir.path().join("models").join("whisper-turbo")).unwrap(),
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
        .insert("whisper-turbo".into(), 2 * 1024 * 1024 + 100);
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
        let partial = dir.path().join("models").join("whisper-turbo.partial");
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
    std::fs::remove_file(dir.path().join("models").join("bge-m3")).unwrap();
    s.core.refresh_models();
    let st = s.core.setup_status(&first_run(), NoArgs {}).await.unwrap();
    assert_eq!(state(&st, "bge-m3"), BundleState::Pending);
    assert_eq!(state(&st, "whisper-turbo"), BundleState::Ready);
}

/// A Mac with plenty of disk whose network comes and goes.
struct Network(std::sync::atomic::AtomicBool);

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
    fn set_login_item(&self, _: bool) -> Result<(), CoreError> {
        Ok(())
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
    let network = Arc::new(Network(false.into()));
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
