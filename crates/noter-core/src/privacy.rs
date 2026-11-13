//! Current settings and call sensitivity for the router's release-time checks.

use noter_db::rusqlite::OptionalExtension;
use noter_llm::Privacy;
use noter_protocol::{CallId, CoreError, PrivacyMode};
use tokio::sync::watch;

use crate::{lock, Core};

// @cpt-algo:cpt-noter-algo-core-llm-gate-egress:p1
pub(crate) struct Watch {
    calls: Vec<CallId>,
    sender: watch::Sender<Privacy>,
}

impl Core {
    pub(crate) fn run_privacy(
        &self,
        mut calls: Vec<CallId>,
    ) -> Result<watch::Receiver<Privacy>, CoreError> {
        // @cpt-begin:cpt-noter-algo-core-llm-gate-egress:p1:inst-egress-recheck
        // Serialize subscription with policy publication; no task is needed to relay updates.
        let settings = lock(&self.settings);
        let mut watches = lock(&self.privacy_watches);
        watches.retain(|w| w.sender.receiver_count() > 0);
        calls.sort_by(|a, b| a.as_str().cmp(b.as_str()));
        calls.dedup();
        let (sender, receiver) = watch::channel(Privacy {
            mode: settings.privacy.mode,
            sensitive: self.calls_sensitive(&calls)?,
            offline: !self.app().environment.online,
        });
        watches.push(Watch { calls, sender });
        Ok(receiver)
        // @cpt-end:cpt-noter-algo-core-llm-gate-egress:p1:inst-egress-recheck
    }

    pub(crate) fn refresh_run_privacy(&self, mode: PrivacyMode) {
        // @cpt-begin:cpt-noter-algo-core-llm-gate-egress:p1:inst-egress-recheck
        let mut watches = lock(&self.privacy_watches);
        watches.retain(|w| w.sender.receiver_count() > 0);
        let offline = !self.app().environment.online;
        for w in watches.iter() {
            // An unreadable or removed call must never make its cached text cloud eligible.
            let sensitive = self.calls_sensitive(&w.calls).unwrap_or(true);
            w.sender.send_replace(Privacy {
                mode,
                sensitive,
                offline,
            });
        }
        // @cpt-end:cpt-noter-algo-core-llm-gate-egress:p1:inst-egress-recheck
    }

    fn calls_sensitive(&self, calls: &[CallId]) -> Result<bool, CoreError> {
        self.store().read(|c| {
            for call in calls {
                let sensitive = c
                    .query_row(
                        "SELECT privacy_class = 'sensitive' FROM calls WHERE id = ?1",
                        [call.as_str()],
                        |r| r.get::<_, bool>(0),
                    )
                    .optional()?
                    .unwrap_or(true);
                if sensitive {
                    return Ok(true);
                }
            }
            Ok(false)
        })
    }
}
