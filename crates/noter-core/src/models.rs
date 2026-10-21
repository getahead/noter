//! Model downloads for first run (`cpt-noter-algo-core-first-run-download-task`): the pinned
//! bundles into `models/` with range resume and checksums, reaching only the hosts that
//! `contracts/egress-hosts.json` allows for model downloads (decision D8 F4). A setup task in
//! M0; it moves onto the job scheduler in M2.
//!
//! A bundle is the folder of its files (decision D12) and its state follows the folders:
//! `models/<name>` is ready; `models/<name>.partial` holds the files verified so far and the
//! one in progress as `<path>.part`, which resumes from its length.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use noter_protocol::model::*;
use noter_protocol::*;
use sha2::{Digest, Sha256};

use crate::allowed_download_url;
use crate::first_run::{BoxFuture, BundleFile, BundleSpec, ChunkSink, FetchError, ModelSource};
use crate::{lock, Core};

const MB: u64 = 1024 * 1024;
/// Free space kept beyond the remaining download.
const MARGIN_MB: u32 = 500;
/// Progress goes out at most twice a second.
const PROGRESS_EVERY: Duration = Duration::from_millis(500);

fn ceil_mb(bytes: u64) -> u32 {
    u32::try_from(bytes.div_ceil(MB)).unwrap_or(u32::MAX)
}

/// The downloads' state, shown in `SetupStatus.models`.
pub(crate) struct Downloads {
    pub(crate) specs: Vec<BundleSpec>,
    bundles: Vec<ModelBundle>,
    error: Option<ErrorCode>,
    running: bool,
    pause: Arc<AtomicBool>,
    dir: PathBuf,
    /// The network stopped a download (or refused one): start again once it is back.
    resume_online: bool,
}

impl Downloads {
    /// The manifest's bundles, capture model first, each in the state its files say.
    pub(crate) fn load(mut specs: Vec<BundleSpec>, dir: PathBuf) -> Downloads {
        specs.sort_by_key(|s| !s.required_for_capture);
        let bundles = specs
            .iter()
            .map(|s| {
                let partial = dir_len(&partial_path(&dir, &s.name));
                let (state, done) = if dir.join(&s.name).exists() {
                    (BundleState::Ready, s.size_bytes())
                } else if partial > 0 {
                    (BundleState::Paused, partial)
                } else {
                    (BundleState::Pending, 0)
                };
                ModelBundle {
                    name: s.name.clone(),
                    size_mb: ceil_mb(s.size_bytes()),
                    done_mb: if state == BundleState::Ready {
                        ceil_mb(done)
                    } else {
                        (done / MB) as u32
                    },
                    state,
                    required_for_capture: s.required_for_capture,
                }
            })
            .collect();
        Downloads {
            specs,
            bundles,
            error: None,
            running: false,
            pause: Arc::new(AtomicBool::new(false)),
            dir,
            resume_online: false,
        }
    }

    pub(crate) fn status(&self) -> ModelsStatus {
        ModelsStatus {
            total_mb: self.bundles.iter().map(|b| b.size_mb).sum(),
            done_mb: self.bundles.iter().map(|b| b.done_mb).sum(),
            bundles: self.bundles.clone(),
            error: self.error,
        }
    }

    /// The live model is downloaded: at least one bundle capture needs, and all of them ready.
    pub(crate) fn capture_ready(&self) -> bool {
        let mut needed = self
            .bundles
            .iter()
            .filter(|b| b.required_for_capture)
            .peekable();
        needed.peek().is_some() && needed.all(|b| b.state == BundleState::Ready)
    }

    fn set(&mut self, name: &str, state: BundleState, done_bytes: Option<u64>) {
        if let Some(b) = self.bundles.iter_mut().find(|b| b.name == name) {
            b.state = state;
            if let Some(bytes) = done_bytes {
                b.done_mb = if state == BundleState::Ready {
                    b.size_mb
                } else {
                    (bytes / MB) as u32
                };
            }
        }
    }
}

fn partial_path(dir: &Path, name: &str) -> PathBuf {
    dir.join(format!("{name}.partial"))
}

/// The bytes held under `dir`, files of every subfolder included.
fn dir_len(dir: &Path) -> u64 {
    std::fs::read_dir(dir).map_or(0, |entries| {
        entries
            .flatten()
            .map(|e| match e.file_type() {
                Ok(t) if t.is_dir() => dir_len(&e.path()),
                _ => e.metadata().map_or(0, |m| m.len()),
            })
            .sum()
    })
}

/// A relative path that stays inside the bundle's folder.
fn inside_bundle(path: &str) -> bool {
    !path.is_empty()
        && Path::new(path)
            .components()
            .all(|c| matches!(c, std::path::Component::Normal(_)))
}

fn private_dir(dir: &Path) -> std::io::Result<()> {
    let mut builder = std::fs::DirBuilder::new();
    builder.recursive(true);
    #[cfg(unix)]
    std::os::unix::fs::DirBuilderExt::mode(&mut builder, 0o700);
    builder.create(dir)
}

fn sha256_hex(path: &Path) -> std::io::Result<String> {
    let mut hasher = Sha256::new();
    let mut file = std::fs::File::open(path)?;
    // sha2 0.11 hashers are not `io::Write`: feed them with `update`, which works on 0.10 too.
    let mut buf = [0u8; 64 * 1024];
    loop {
        let n = std::io::Read::read(&mut file, &mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(hasher
        .finalize()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect())
}

/// How one bundle's download ended.
enum Outcome {
    Ready,
    Paused(u64),
    Stop(BundleState, ErrorCode),
    /// The network dropped after this many bytes; the partial file stays.
    Offline(u64),
}

impl Core {
    /// Re-reads the models folder, so bundle states follow its files again after it changed
    /// outside the core (a restore, the harness's `world_set`). A running download keeps its
    /// own states; the setup status follows.
    pub fn refresh_models(&self) {
        {
            let mut d = lock(&self.downloads);
            if d.running {
                return;
            }
            let (specs, dir) = (d.specs.clone(), d.dir.clone());
            *d = Downloads::load(specs, dir);
        }
        self.refresh_setup();
    }

    /// Sets the bundle states and error the harness's world asks for (states the files cannot
    /// say); nothing while a download runs. Only `noter_core::testing` calls it.
    #[cfg(feature = "harness")]
    pub(crate) fn seed_models(&self, wanted: &ModelsStatus) {
        {
            let mut d = lock(&self.downloads);
            if d.running {
                return;
            }
            for b in &wanted.bundles {
                // Only a download part-way has progress; a world that held the bundle ready still
                // carries its full `done_mb`, which a pending or failed bundle must not show.
                let done = match b.state {
                    BundleState::Downloading | BundleState::Paused => u64::from(b.done_mb) * MB,
                    _ => 0,
                };
                d.set(&b.name, b.state, Some(done));
            }
            d.error = wanted.error;
        }
        self.refresh_setup();
    }

    // @cpt-flow:cpt-noter-flow-core-first-run-download:p1
    pub(crate) fn download_models(
        &self,
        args: ModelsDownloadArgs,
    ) -> Result<SetupStatus, CoreError> {
        // @cpt-begin:cpt-noter-flow-core-first-run-download:p1:inst-download-call
        let mut d = lock(&self.downloads);
        // @cpt-end:cpt-noter-flow-core-first-run-download:p1:inst-download-call
        // @cpt-begin:cpt-noter-flow-core-first-run-download:p1:inst-other-actions
        if args.action == DownloadAction::Pause {
            d.resume_online = false;
            d.pause.store(true, Ordering::SeqCst);
            drop(d);
            return Ok(self.setup_now());
        }
        // No connection: `offline` (retryable) at once, nothing is fetched (the fake core too).
        if !self.deps.native.environment().online {
            d.resume_online = true;
            return Err(CoreError::new(ErrorCode::Offline, "no connection"));
        }
        if d.running {
            // Resume (or start, retry) before the running task stopped: it keeps going.
            d.pause.store(false, Ordering::SeqCst);
            drop(d);
            return Ok(self.setup_now());
        }
        // @cpt-end:cpt-noter-flow-core-first-run-download:p1:inst-other-actions
        // @cpt-begin:cpt-noter-flow-core-first-run-download:p1:inst-check-disk
        let remaining: u64 = d
            .specs
            .iter()
            .zip(&d.bundles)
            .filter(|(_, b)| b.state != BundleState::Ready)
            .map(|(s, b)| s.size_bytes().saturating_sub(u64::from(b.done_mb) * MB))
            .sum();
        let needed_mb = ceil_mb(remaining) + MARGIN_MB;
        let free_mb = self.deps.native.environment().disk_free_mb;
        if free_mb < needed_mb {
            return Err(
                CoreError::new(ErrorCode::DiskFull, "not enough space for the models")
                    .with_detail(ErrorDetail::DiskSpace { free_mb, needed_mb }),
            );
        }
        // @cpt-end:cpt-noter-flow-core-first-run-download:p1:inst-check-disk
        let Some(core) = self.this() else {
            return Err(crate::internal("first run has not started"));
        };
        // @cpt-begin:cpt-noter-flow-core-first-run-download:p1:inst-start-task
        // @cpt-begin:cpt-noter-state-core-first-run-bundle:p1:inst-st-download
        // @cpt-begin:cpt-noter-state-core-first-run-bundle:p1:inst-st-resume
        // @cpt-begin:cpt-noter-state-core-first-run-bundle:p1:inst-st-retry
        for b in d
            .bundles
            .iter_mut()
            .filter(|b| b.state != BundleState::Ready)
        {
            b.state = BundleState::Downloading;
        }
        // @cpt-end:cpt-noter-state-core-first-run-bundle:p1:inst-st-retry
        // @cpt-end:cpt-noter-state-core-first-run-bundle:p1:inst-st-resume
        // @cpt-end:cpt-noter-state-core-first-run-bundle:p1:inst-st-download
        d.error = None;
        d.resume_online = false;
        d.running = true;
        d.pause.store(false, Ordering::SeqCst);
        drop(d);
        // The answer shows the bundles `downloading` before the task can move them on.
        let started = self.setup_now();
        self.spawn(async move { core.run_downloads().await });
        // @cpt-end:cpt-noter-flow-core-first-run-download:p1:inst-start-task
        // @cpt-begin:cpt-noter-flow-core-first-run-download:p1:inst-return-started
        Ok(started)
        // @cpt-end:cpt-noter-flow-core-first-run-download:p1:inst-return-started
    }

    /// Back online after the network stopped or refused a download: start it again (the user's
    /// own pause stays paused).
    pub(crate) fn resume_downloads_online(&self, reading: &crate::EnvironmentReading) {
        let resume = {
            let d = lock(&self.downloads);
            reading.online && d.resume_online && !d.running
        };
        if resume {
            let _ = self.download_models(ModelsDownloadArgs {
                action: DownloadAction::Resume,
            });
        }
    }

    // @cpt-state:cpt-noter-state-core-first-run-bundle:p1
    async fn run_downloads(self: Arc<Self>) {
        let (specs, dir) = {
            let d = lock(&self.downloads);
            (d.specs.clone(), d.dir.clone())
        };
        // @cpt-begin:cpt-noter-algo-core-first-run-download-task:p1:inst-for-bundles
        for spec in &specs {
            let downloading = lock(&self.downloads)
                .bundles
                .iter()
                .any(|b| b.name == spec.name && b.state == BundleState::Downloading);
            if !downloading {
                continue;
            }
            let outcome = self.download_one(spec, &dir).await;
            // @cpt-begin:cpt-noter-algo-core-first-run-download-task:p1:inst-emit-progress
            let stop = {
                let mut d = lock(&self.downloads);
                match outcome {
                    Outcome::Ready => {
                        d.set(&spec.name, BundleState::Ready, Some(spec.size_bytes()));
                        false
                    }
                    Outcome::Paused(done) => {
                        d.set(&spec.name, BundleState::Paused, Some(done));
                        true
                    }
                    Outcome::Offline(done) => {
                        d.set(&spec.name, BundleState::Paused, Some(done));
                        d.error = Some(ErrorCode::Offline);
                        d.resume_online = true;
                        true
                    }
                    Outcome::Stop(state, error) => {
                        d.set(&spec.name, state, Some(0));
                        d.error = Some(error);
                        true
                    }
                }
            };
            // A stop is announced once the task has stopped (below), so a back-online
            // notice that follows it can start the download again.
            if stop {
                break;
            }
            self.refresh_setup();
            // @cpt-end:cpt-noter-algo-core-first-run-download-task:p1:inst-emit-progress
        }
        // @cpt-end:cpt-noter-algo-core-first-run-download-task:p1:inst-for-bundles
        // @cpt-begin:cpt-noter-algo-core-first-run-download-task:p1:inst-return-task
        // A stopped task leaves the rest paused, to resume later.
        let mut d = lock(&self.downloads);
        for b in d
            .bundles
            .iter_mut()
            .filter(|b| b.state == BundleState::Downloading)
        {
            b.state = BundleState::Paused;
        }
        d.running = false;
        drop(d);
        self.refresh_setup();
        // @cpt-end:cpt-noter-algo-core-first-run-download-task:p1:inst-return-task
    }

    // @cpt-dod:cpt-noter-dod-core-first-run-models:p1
    async fn download_one(&self, spec: &BundleSpec, dir: &Path) -> Outcome {
        if spec
            .files
            .iter()
            .any(|f| !allowed_download_url(&f.url) || !inside_bundle(&f.path))
        {
            return Outcome::Stop(BundleState::Failed, ErrorCode::Internal);
        }
        let partial = partial_path(dir, &spec.name);
        let mut done = dir_len(&partial);
        let pause = lock(&self.downloads).pause.clone();
        for file in &spec.files {
            let verified = partial.join(&file.path);
            if verified.is_file() {
                continue;
            }
            // @cpt-begin:cpt-noter-algo-core-first-run-download-task:p1:inst-try-download
            let part = partial.join(format!("{}.part", file.path));
            let opened = private_dir(part.parent().unwrap_or(&partial)).and_then(|_| {
                let mut options = std::fs::OpenOptions::new();
                options.create(true).append(true);
                #[cfg(unix)]
                std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
                options.open(&part)
            });
            let Ok(mut out) = opened else {
                // @cpt-begin:cpt-noter-state-core-first-run-bundle:p1:inst-st-failed
                return Outcome::Stop(BundleState::Failed, ErrorCode::DiskFull);
                // @cpt-end:cpt-noter-state-core-first-run-bundle:p1:inst-st-failed
            };
            let from = out.metadata().map_or(0, |m| m.len());
            let mut write_failed = false;
            let mut last = Instant::now();
            let name = spec.name.clone();
            let fetched = {
                let sink = Box::new(|bytes: &[u8]| {
                    if pause.load(Ordering::SeqCst) {
                        return false;
                    }
                    if out.write_all(bytes).is_err() {
                        write_failed = true;
                        return false;
                    }
                    done += bytes.len() as u64;
                    if last.elapsed() >= PROGRESS_EVERY {
                        last = Instant::now();
                        lock(&self.downloads).set(&name, BundleState::Downloading, Some(done));
                        self.refresh_setup();
                    }
                    true
                });
                self.deps.models.fetch(file, from, sink).await
            };
            // @cpt-end:cpt-noter-algo-core-first-run-download-task:p1:inst-try-download
            if write_failed {
                return Outcome::Stop(BundleState::Failed, ErrorCode::DiskFull);
            }
            match fetched {
                // @cpt-begin:cpt-noter-algo-core-first-run-download-task:p1:inst-catch-offline
                // @cpt-begin:cpt-noter-state-core-first-run-bundle:p1:inst-st-pause
                Err(FetchError::Offline) => return Outcome::Offline(done),
                // @cpt-end:cpt-noter-state-core-first-run-bundle:p1:inst-st-pause
                // @cpt-end:cpt-noter-algo-core-first-run-download-task:p1:inst-catch-offline
                Err(_) => return Outcome::Stop(BundleState::Failed, ErrorCode::Internal),
                Ok(()) if pause.load(Ordering::SeqCst) => return Outcome::Paused(done),
                Ok(()) => {}
            }
            // @cpt-begin:cpt-noter-algo-core-first-run-download-task:p1:inst-verify
            // @cpt-begin:cpt-noter-state-core-first-run-bundle:p1:inst-st-verify
            lock(&self.downloads).set(&spec.name, BundleState::Verifying, Some(done));
            self.refresh_setup();
            // @cpt-end:cpt-noter-state-core-first-run-bundle:p1:inst-st-verify
            if sha256_hex(&part).ok().as_deref() != Some(file.sha256.as_str()) {
                // @cpt-begin:cpt-noter-state-core-first-run-bundle:p1:inst-st-checksum
                let _ = std::fs::remove_file(&part);
                return Outcome::Stop(BundleState::ChecksumFailed, ErrorCode::ChecksumFailed);
                // @cpt-end:cpt-noter-state-core-first-run-bundle:p1:inst-st-checksum
            }
            // @cpt-end:cpt-noter-algo-core-first-run-download-task:p1:inst-verify
            if std::fs::rename(&part, &verified).is_err() {
                return Outcome::Stop(BundleState::Failed, ErrorCode::DiskFull);
            }
        }
        // @cpt-begin:cpt-noter-algo-core-first-run-download-task:p1:inst-move-ready
        // @cpt-begin:cpt-noter-state-core-first-run-bundle:p1:inst-st-ready
        // Every file verified: the folder moves into place at once.
        if std::fs::rename(&partial, dir.join(&spec.name)).is_err() {
            return Outcome::Stop(BundleState::Failed, ErrorCode::DiskFull);
        }
        Outcome::Ready
        // @cpt-end:cpt-noter-state-core-first-run-bundle:p1:inst-st-ready
        // @cpt-end:cpt-noter-algo-core-first-run-download-task:p1:inst-move-ready
    }
}

/// The app's model source: the pinned manifest compiled into noter-llm, its files grouped into
/// bundles in manifest order (decision D12), each file fetched through noter-llm's
/// `RangeFetcher`, the egress gate (D11).
pub struct PinnedModels {
    files: Vec<noter_llm::PinnedFile>,
    fetcher: noter_llm::RangeFetcher,
}

impl PinnedModels {
    pub fn new() -> Self {
        Self::with(noter_llm::manifest(), noter_llm::RangeFetcher::new())
    }

    pub fn with(files: Vec<noter_llm::PinnedFile>, fetcher: noter_llm::RangeFetcher) -> Self {
        Self { files, fetcher }
    }
}

impl Default for PinnedModels {
    fn default() -> Self {
        Self::new()
    }
}

impl ModelSource for PinnedModels {
    fn manifest(&self) -> Vec<BundleSpec> {
        let mut bundles: Vec<BundleSpec> = Vec::new();
        for f in &self.files {
            let file = BundleFile {
                path: f.path.clone(),
                url: f.url.clone(),
                size_bytes: f.size_bytes,
                sha256: f.sha256.clone(),
            };
            match bundles.iter_mut().find(|b| b.name == f.bundle) {
                Some(b) => b.files.push(file),
                None => bundles.push(BundleSpec {
                    name: f.bundle.clone(),
                    files: vec![file],
                    required_for_capture: f.required_for_capture,
                }),
            }
        }
        bundles
    }

    fn fetch<'a>(
        &'a self,
        file: &'a BundleFile,
        from_byte: u64,
        mut chunk: ChunkSink<'a>,
    ) -> BoxFuture<'a, Result<(), FetchError>> {
        Box::pin(async move {
            // @cpt-begin:cpt-noter-algo-core-first-run-download-task:p1:inst-try-download
            let fetched = self.fetcher.fetch(&file.url, from_byte, &mut *chunk).await;
            // @cpt-end:cpt-noter-algo-core-first-run-download-task:p1:inst-try-download
            fetched.map_err(|e| match e {
                noter_llm::FetchError::Offline => FetchError::Offline,
                noter_llm::FetchError::Http(code) => FetchError::Http(code),
                noter_llm::FetchError::NotAllowed => {
                    FetchError::Io("off the model-download allow-list".into())
                }
                noter_llm::FetchError::Io(e) => FetchError::Io(e),
            })
        })
    }
}

#[cfg(test)]
mod sha256_tests {
    use super::sha256_hex;

    #[test]
    fn hashes_a_file_in_chunks_like_the_reference_digest() {
        let dir = std::env::temp_dir().join(format!("noter-sha-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let small = dir.join("abc");
        std::fs::write(&small, b"abc").unwrap();
        assert_eq!(
            sha256_hex(&small).unwrap(),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        // Larger than one read buffer, so the loop runs more than once.
        let big = dir.join("big");
        std::fs::write(&big, vec![b'a'; 200_000]).unwrap();
        assert_eq!(
            sha256_hex(&big).unwrap(),
            "2287d207f24a941ff3b56c04c8a25ad56b63e3023207b3bb5b4ac0c9869d74be"
        );
        assert!(sha256_hex(&dir.join("missing")).is_err());
        std::fs::remove_dir_all(&dir).ok();
    }
}
