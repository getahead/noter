//! Folder watching through `notify` (FSEvents on macOS, TL-29): a change to a file the index
//! reads marks its source changed and asks for a sync. The sync job reads every file's
//! modification time and hash, so a burst of events for the same files coalesces into one run.

use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::{Arc, Mutex, MutexGuard};

use noter_protocol::SourceId;
use notify::{EventKind, RecursiveMode, Watcher};

use crate::extract::Format;

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
}

/// The watched folders, and the sources changed since their sync last looked.
#[derive(Default)]
pub struct Watchers {
    watching: Mutex<HashMap<SourceId, notify::RecommendedWatcher>>,
    dirty: Arc<Mutex<HashSet<SourceId>>>,
}

/// Whether an event is about a file the index reads under `root`, outside hidden entries.
fn relevant(event: &notify::Event, root: &Path) -> bool {
    !matches!(event.kind, EventKind::Access(_))
        && event.paths.iter().any(|p| {
            Format::of(p).is_some()
                && p.strip_prefix(root).is_ok_and(|rel| {
                    !rel.iter()
                        .any(|part| part.to_string_lossy().starts_with('.'))
                })
        })
}

impl Watchers {
    /// Watches `dir` for `id`, replacing an earlier watch; `changed` runs on the watcher's thread
    /// for each relevant event.
    pub fn watch(
        &self,
        id: &SourceId,
        dir: &Path,
        changed: impl Fn(&SourceId) + Send + 'static,
    ) -> Result<(), String> {
        let dirty = self.dirty.clone();
        let source = id.clone();
        let root = dir.to_path_buf();
        let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
            if res.as_ref().is_ok_and(|e| relevant(e, &root)) {
                lock(&dirty).insert(source.clone());
                changed(&source);
            }
        })
        .map_err(|e| e.to_string())?;
        watcher
            .watch(dir, RecursiveMode::Recursive)
            .map_err(|e| e.to_string())?;
        lock(&self.watching).insert(id.clone(), watcher);
        Ok(())
    }

    /// Stops watching the source's folder (removal); its pending mark goes too.
    pub fn unwatch(&self, id: &SourceId) {
        lock(&self.watching).remove(id);
        lock(&self.dirty).remove(id);
    }

    /// Marks the source changed: a sync running now looks at the folder again.
    pub fn mark(&self, id: &SourceId) {
        lock(&self.dirty).insert(id.clone());
    }

    /// Whether the folder changed since the last call, clearing the mark.
    pub fn take_changed(&self, id: &SourceId) -> bool {
        lock(&self.dirty).remove(id)
    }

    /// Whether the source is marked changed, leaving the mark.
    pub fn is_changed(&self, id: &SourceId) -> bool {
        lock(&self.dirty).contains(id)
    }

    pub fn is_watching(&self, id: &SourceId) -> bool {
        lock(&self.watching).contains_key(id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn event(kind: EventKind, path: &str) -> notify::Event {
        notify::Event::new(kind).add_path(PathBuf::from(path))
    }

    #[test]
    fn only_changes_to_indexed_visible_files_count() {
        let root = Path::new("/u/.config/f");
        let modify = EventKind::Modify(notify::event::ModifyKind::Any);
        let seen = |kind, path| relevant(&event(kind, path), root);
        assert!(seen(modify, "/u/.config/f/notes.md"));
        assert!(seen(modify, "/u/.config/f/sub/notes.md"));
        assert!(!seen(modify, "/u/.config/f/photo.png"));
        assert!(!seen(modify, "/u/.config/f/.notes.md"));
        assert!(!seen(modify, "/u/.config/f/.git/notes.md"));
        assert!(!seen(modify, "/elsewhere/notes.md"));
        let access = EventKind::Access(notify::event::AccessKind::Any);
        assert!(!seen(access, "/u/.config/f/notes.md"));
    }

    #[test]
    fn marks_are_taken_once_and_go_with_the_watch() {
        let w = Watchers::default();
        let id = SourceId::new("src_1");
        assert!(!w.take_changed(&id));
        w.mark(&id);
        assert!(w.is_changed(&id) && w.take_changed(&id) && !w.is_changed(&id));
        w.mark(&id);
        w.unwatch(&id);
        assert!(!w.is_changed(&id) && !w.is_watching(&id));
    }
}
