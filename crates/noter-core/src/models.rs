//! Model downloads for first run (`cpt-noter-algo-core-first-run-download-task`): the pinned
//! bundles into `models/` with range resume and checksums, reaching only the hosts that
//! `contracts/egress-hosts.json` allows for model downloads (decision D8 F4). A setup task in
//! M0; it moves onto the job scheduler in M2.
//!
//! A bundle's state follows its files: `models/<name>` is ready, `models/<name>.partial`
//! resumes from its length.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};

use noter_protocol::model::*;
use noter_protocol::*;
use sha2::{Digest, Sha256};

use crate::first_run::{BundleSpec, FetchError};
use crate::{lock, Core};

const MB: u64 = 1024 * 1024;
/// Free space kept beyond the remaining download.
const MARGIN_MB: u32 = 500;
/// Progress goes out at most twice a second.
const PROGRESS_EVERY: Duration = Duration::from_millis(500);

/// Whether `url` is an https URL on a host the egress allow-list names for model downloads.
pub fn allowed_download_url(url: &str) -> bool {
    static HOSTS: OnceLock<Vec<String>> = OnceLock::new();
    let hosts = HOSTS.get_or_init(|| {
        let list: serde_json::Value =
            serde_json::from_str(include_str!("../../../contracts/egress-hosts.json"))
                .unwrap_or_default();
        list["allow_without_audit"]["model_downloads"]["hosts"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|h| h.as_str().map(str::to_string))
            .collect()
    });
    let Some(rest) = url.strip_prefix("https://") else {
        return false;
    };
    let host = rest.split(['/', ':', '?', '#']).next().unwrap_or("");
    hosts.iter().any(|h| h == host)
}

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
}

impl Downloads {
    /// The manifest's bundles, capture model first, each in the state its files say.
    pub(crate) fn load(mut specs: Vec<BundleSpec>, dir: PathBuf) -> Downloads {
        specs.sort_by_key(|s| !s.required_for_capture);
        let bundles = specs
            .iter()
            .map(|s| {
                let partial = std::fs::metadata(partial_path(&dir, &s.name)).map_or(0, |m| m.len());
                let (state, done) = if dir.join(&s.name).is_file() {
                    (BundleState::Ready, s.size_bytes)
                } else if partial > 0 {
                    (BundleState::Paused, partial)
                } else {
                    (BundleState::Pending, 0)
                };
                ModelBundle {
                    name: s.name.clone(),
                    size_mb: ceil_mb(s.size_bytes),
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

fn sha256_hex(path: &Path) -> std::io::Result<String> {
    let mut hasher = Sha256::new();
    let mut file = std::fs::File::open(path)?;
    std::io::copy(&mut file, &mut hasher)?;
    Ok(hasher
        .finalize()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect())
}

/// How one bundle's download ended.
enum Outcome {
    Ready,
    Paused,
    Stop(BundleState, ErrorCode),
}

impl Core {
    // @cpt-flow:cpt-noter-flow-core-first-run-download:p1
    // @cpt-dod:cpt-noter-dod-core-first-run-models:p1
    pub(crate) fn download_models(
        &self,
        args: ModelsDownloadArgs,
    ) -> Result<SetupStatus, CoreError> {
        // @cpt-begin:cpt-noter-flow-core-first-run-download:p1:inst-download-call
        let mut d = lock(&self.downloads);
        // @cpt-end:cpt-noter-flow-core-first-run-download:p1:inst-download-call
        // @cpt-begin:cpt-noter-flow-core-first-run-download:p1:inst-other-actions
        if args.action == DownloadAction::Pause {
            d.pause.store(true, Ordering::SeqCst);
            drop(d);
            return Ok(self.setup_now());
        }
        if d.running {
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
            .map(|(s, b)| s.size_bytes.saturating_sub(u64::from(b.done_mb) * MB))
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
        d.running = true;
        d.pause.store(false, Ordering::SeqCst);
        drop(d);
        tokio::spawn(async move { core.run_downloads().await });
        // @cpt-end:cpt-noter-flow-core-first-run-download:p1:inst-start-task
        // @cpt-begin:cpt-noter-flow-core-first-run-download:p1:inst-return-started
        Ok(self.setup_now())
        // @cpt-end:cpt-noter-flow-core-first-run-download:p1:inst-return-started
    }

    // @cpt-algo:cpt-noter-algo-core-first-run-download-task:p1
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
                        d.set(&spec.name, BundleState::Ready, Some(spec.size_bytes));
                        false
                    }
                    Outcome::Paused => {
                        d.set(&spec.name, BundleState::Paused, None);
                        true
                    }
                    Outcome::Stop(state, error) => {
                        d.set(&spec.name, state, Some(0));
                        d.error = Some(error);
                        true
                    }
                }
            };
            self.refresh_setup();
            // @cpt-end:cpt-noter-algo-core-first-run-download-task:p1:inst-emit-progress
            if stop {
                break;
            }
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

    async fn download_one(&self, spec: &BundleSpec, dir: &Path) -> Outcome {
        if !allowed_download_url(&spec.url) {
            return Outcome::Stop(BundleState::Failed, ErrorCode::Internal);
        }
        let partial = partial_path(dir, &spec.name);
        let opened = std::fs::create_dir_all(dir).and_then(|_| {
            std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(&partial)
        });
        let Ok(mut file) = opened else {
            // @cpt-begin:cpt-noter-state-core-first-run-bundle:p1:inst-st-failed
            return Outcome::Stop(BundleState::Failed, ErrorCode::DiskFull);
            // @cpt-end:cpt-noter-state-core-first-run-bundle:p1:inst-st-failed
        };
        let mut done = file.metadata().map_or(0, |m| m.len());
        let pause = lock(&self.downloads).pause.clone();
        let mut write_failed = false;
        let mut last = Instant::now();
        let name = spec.name.clone();
        // @cpt-begin:cpt-noter-algo-core-first-run-download-task:p1:inst-try-download
        let from = done;
        let fetched = {
            let sink = Box::new(|bytes: &[u8]| {
                if pause.load(Ordering::SeqCst) {
                    return false;
                }
                if file.write_all(bytes).is_err() {
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
            self.deps.models.fetch(spec, from, sink).await
        };
        // @cpt-end:cpt-noter-algo-core-first-run-download-task:p1:inst-try-download
        if write_failed {
            return Outcome::Stop(BundleState::Failed, ErrorCode::DiskFull);
        }
        match fetched {
            // @cpt-begin:cpt-noter-algo-core-first-run-download-task:p1:inst-catch-offline
            // @cpt-begin:cpt-noter-state-core-first-run-bundle:p1:inst-st-pause
            Err(FetchError::Offline) => {
                return Outcome::Stop(BundleState::Paused, ErrorCode::Offline)
            }
            // @cpt-end:cpt-noter-state-core-first-run-bundle:p1:inst-st-pause
            // @cpt-end:cpt-noter-algo-core-first-run-download-task:p1:inst-catch-offline
            Err(_) => return Outcome::Stop(BundleState::Failed, ErrorCode::Internal),
            Ok(()) if pause.load(Ordering::SeqCst) => return Outcome::Paused,
            Ok(()) => {}
        }
        // @cpt-begin:cpt-noter-algo-core-first-run-download-task:p1:inst-verify
        // @cpt-begin:cpt-noter-state-core-first-run-bundle:p1:inst-st-verify
        lock(&self.downloads).set(&spec.name, BundleState::Verifying, Some(done));
        self.refresh_setup();
        // @cpt-end:cpt-noter-state-core-first-run-bundle:p1:inst-st-verify
        if sha256_hex(&partial).ok().as_deref() != Some(spec.sha256.as_str()) {
            // @cpt-begin:cpt-noter-state-core-first-run-bundle:p1:inst-st-checksum
            let _ = std::fs::remove_file(&partial);
            return Outcome::Stop(BundleState::ChecksumFailed, ErrorCode::ChecksumFailed);
            // @cpt-end:cpt-noter-state-core-first-run-bundle:p1:inst-st-checksum
        }
        // @cpt-end:cpt-noter-algo-core-first-run-download-task:p1:inst-verify
        // @cpt-begin:cpt-noter-algo-core-first-run-download-task:p1:inst-move-ready
        // @cpt-begin:cpt-noter-state-core-first-run-bundle:p1:inst-st-ready
        let ready = dir.join(&spec.name);
        if std::fs::rename(&partial, &ready).is_err() {
            return Outcome::Stop(BundleState::Failed, ErrorCode::DiskFull);
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&ready, std::fs::Permissions::from_mode(0o600));
        }
        Outcome::Ready
        // @cpt-end:cpt-noter-state-core-first-run-bundle:p1:inst-st-ready
        // @cpt-end:cpt-noter-algo-core-first-run-download-task:p1:inst-move-ready
    }
}
