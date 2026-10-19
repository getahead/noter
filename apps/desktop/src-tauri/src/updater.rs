//! The app updater: tauri-plugin-updater behind the core's `Updater`. A check downloads a newer
//! release from the feed, which is ready once its signature verified; `update_install` installs
//! it. M0 ships it wired but not released: tauri.conf.json names no feed and no signing key
//! (owner decision, 19 Oct 2026), so a check finds nothing and `update_install` answers
//! `not_found`.

use std::sync::Mutex;

use noter_core::{BoxFuture, Updater};
use noter_protocol::model::UpdateInfo;
use noter_protocol::{CoreError, ErrorCode};
use tauri::{AppHandle, Runtime};
use tauri_plugin_updater::{Update, UpdaterExt};

pub struct TauriUpdater<R: Runtime> {
    app: AppHandle<R>,
    /// The verified release and its bytes.
    ready: Mutex<Option<(Update, Vec<u8>)>>,
}

impl<R: Runtime> TauriUpdater<R> {
    pub fn new(app: AppHandle<R>) -> Self {
        Self {
            app,
            ready: Mutex::new(None),
        }
    }

    /// Checks the feed and downloads a newer release; `true` once it is verified and ready.
    pub async fn check(&self) -> Result<bool, tauri_plugin_updater::Error> {
        let Some(update) = self.app.updater()?.check().await? else {
            return Ok(false);
        };
        // `download` verifies the signature against the configured key before it answers.
        let bytes = update.download(|_, _| {}, || {}).await?;
        *self.lock() = Some((update, bytes));
        Ok(true)
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Option<(Update, Vec<u8>)>> {
        self.ready.lock().unwrap_or_else(|e| e.into_inner())
    }
}

// @cpt-dod:cpt-noter-dod-core-first-run-login-update:p2
impl<R: Runtime> Updater for TauriUpdater<R> {
    fn ready(&self) -> Option<UpdateInfo> {
        self.lock().as_ref().map(|(update, _)| UpdateInfo {
            version: update.version.clone(),
            notes_md: update.body.clone().unwrap_or_default(),
            ready: true,
        })
    }

    fn install(&self) -> BoxFuture<'_, Result<(), CoreError>> {
        Box::pin(async move {
            // @cpt-begin:cpt-noter-flow-core-first-run-update:p2:inst-install
            let ready = self.lock();
            let (update, bytes) = ready
                .as_ref()
                .ok_or_else(|| CoreError::new(ErrorCode::NotFound, "no update is ready"))?;
            // A failed install leaves the running app as it was; the core keeps running.
            update
                .install(bytes)
                .map_err(|e| CoreError::new(ErrorCode::Internal, format!("update install: {e}")))
            // @cpt-end:cpt-noter-flow-core-first-run-update:p2:inst-install
        })
    }

    fn relaunch(&self) {
        self.app.restart();
    }
}
