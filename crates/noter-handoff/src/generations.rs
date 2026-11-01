//! The prompts being written, per item: one generation at a time, cancellable; a result
//! commits only while its generation is current (`cpt-noter-state-core-handoff-prompt`).

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard};

use noter_llm::Cancel;
use noter_protocol::model::{HandoffTarget, PromptState};
use noter_protocol::{CoreError, ErrorCode};

#[derive(Default)]
struct Slot {
    running: Option<(u64, Cancel)>,
    /// The last attempt's failure; kept until a later one commits (earlier versions stay).
    failed: Option<ErrorCode>,
    /// The wanted target (`handoff_set_target`).
    // shortcut: kept in memory, so a restart falls back to the mapping's default tool; store it
    // on the item if users ask for it to stick.
    target: Option<HandoffTarget>,
}

/// What [`Generations::begin`] did.
#[derive(Debug)]
pub enum Begin {
    /// A new generation; its result commits only through [`Generations::finish`] with `id`.
    Started { id: u64, cancel: Cancel },
    /// One is already running for the item: the request joins it.
    Running,
}

#[derive(Default)]
pub struct Generations {
    slots: Mutex<HashMap<String, Slot>>,
    next: AtomicU64,
}

impl Generations {
    fn slots(&self) -> MutexGuard<'_, HashMap<String, Slot>> {
        self.slots.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// The prompt state; `has_prompt` says whether a version is stored.
    pub fn state(&self, item: &str, has_prompt: bool) -> PromptState {
        let slots = self.slots();
        let slot = slots.get(item);
        match (
            slot.and_then(|s| s.running.as_ref()),
            slot.and_then(|s| s.failed),
        ) {
            (Some(_), _) => PromptState::Generating,
            (None, Some(code)) => PromptState::Failed { code },
            (None, None) if has_prompt => PromptState::Ready,
            (None, None) => PromptState::NotGenerated,
        }
    }

    // @cpt-begin:cpt-noter-flow-core-handoff-prompt:p1:inst-prompt-start
    // @cpt-begin:cpt-noter-state-core-handoff-prompt:p1:inst-st-generate
    // @cpt-begin:cpt-noter-state-core-handoff-prompt:p1:inst-st-retry
    // @cpt-begin:cpt-noter-state-core-handoff-prompt:p1:inst-st-regenerate
    /// Starts a generation, or joins the running one. The previous state stays as it is
    /// underneath, for cancellation to restore.
    pub fn begin(&self, item: &str) -> Begin {
        let mut slots = self.slots();
        let slot = slots.entry(item.to_string()).or_default();
        if slot.running.is_some() {
            return Begin::Running;
        }
        let id = self.next.fetch_add(1, Ordering::Relaxed);
        let cancel = Cancel::default();
        slot.running = Some((id, cancel.clone()));
        Begin::Started { id, cancel }
    }
    // @cpt-end:cpt-noter-state-core-handoff-prompt:p1:inst-st-regenerate
    // @cpt-end:cpt-noter-state-core-handoff-prompt:p1:inst-st-retry
    // @cpt-end:cpt-noter-state-core-handoff-prompt:p1:inst-st-generate
    // @cpt-end:cpt-noter-flow-core-handoff-prompt:p1:inst-prompt-start

    // @cpt-begin:cpt-noter-flow-core-handoff-prompt:p1:inst-prompt-cancel
    // @cpt-begin:cpt-noter-state-core-handoff-prompt:p1:inst-st-cancel-ready
    // @cpt-begin:cpt-noter-state-core-handoff-prompt:p1:inst-st-cancel-empty
    // @cpt-begin:cpt-noter-state-core-handoff-prompt:p1:inst-st-cancel-failed
    /// Cancels the router request and invalidates the generation: the state is again what it
    /// was (ready, not generated or failed). `false` when nothing was running.
    pub fn cancel(&self, item: &str) -> bool {
        let mut slots = self.slots();
        match slots.get_mut(item).and_then(|s| s.running.take()) {
            Some((_, cancel)) => {
                cancel.cancel();
                true
            }
            None => false,
        }
    }
    // @cpt-end:cpt-noter-state-core-handoff-prompt:p1:inst-st-cancel-failed
    // @cpt-end:cpt-noter-state-core-handoff-prompt:p1:inst-st-cancel-empty
    // @cpt-end:cpt-noter-state-core-handoff-prompt:p1:inst-st-cancel-ready
    // @cpt-end:cpt-noter-flow-core-handoff-prompt:p1:inst-prompt-cancel

    // @cpt-begin:cpt-noter-flow-core-handoff-prompt:p1:inst-prompt-late
    // @cpt-begin:cpt-noter-state-core-handoff-prompt:p1:inst-st-ready
    /// Commits generation `id`'s result while it is still current, under the registry's lock
    /// so a cancel cannot slip in between; a cancelled or superseded result is dropped
    /// (`None`). A commit that fails is the attempt's failure.
    pub fn finish<T>(
        &self,
        item: &str,
        id: u64,
        commit: impl FnOnce() -> Result<T, CoreError>,
    ) -> Option<Result<T, CoreError>> {
        let mut slots = self.slots();
        let slot = slots.get_mut(item)?;
        if slot.running.as_ref().map(|(r, _)| *r) != Some(id) {
            return None;
        }
        slot.running = None;
        let result = commit();
        slot.failed = result.as_ref().err().map(|e| e.code);
        Some(result)
    }
    // @cpt-end:cpt-noter-state-core-handoff-prompt:p1:inst-st-ready
    // @cpt-end:cpt-noter-flow-core-handoff-prompt:p1:inst-prompt-late

    // @cpt-begin:cpt-noter-state-core-handoff-prompt:p1:inst-st-failed
    /// The current generation failed; earlier versions stay. `false` for a stale `id`.
    pub fn fail(&self, item: &str, id: u64, code: ErrorCode) -> bool {
        self.finish(item, id, || Err::<(), _>(CoreError::new(code, "")))
            .is_some()
    }
    // @cpt-end:cpt-noter-state-core-handoff-prompt:p1:inst-st-failed

    pub fn target(&self, item: &str) -> Option<HandoffTarget> {
        self.slots().get(item).and_then(|s| s.target)
    }

    pub fn set_target(&self, item: &str, target: HandoffTarget) {
        self.slots().entry(item.to_string()).or_default().target = Some(target);
    }
}
