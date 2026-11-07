//! FEATURE cpt-noter-feature-core-knowledge, slice 1: folder sources through the five commands,
//! the native folder panel, the `source_sync` job on the scheduler and the scripted engine's
//! bge-m3 vectors.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime};

use noter_core::{BoxFuture, Clock, Core, CoreDeps, EventEmitter, NativeOps, SaveKind};
use noter_engine_client::scripted::ScriptedEngine;
use noter_protocol::ipc::{Caller, CommandCtx, CoreApi};
use noter_protocol::model::*;
use noter_protocol::*;
use serde_json::Value;

const T0: i64 = 1_790_000_000_000;

struct StepClock(AtomicI64);

impl Clock for StepClock {
    fn now(&self) -> TimestampMs {
        TimestampMs(self.0.load(Ordering::SeqCst))
    }
}

#[derive(Default)]
struct Events(Mutex<Vec<(&'static str, Value)>>);

impl EventEmitter for Events {
    fn emit(&self, event: &'static str, payload: Value) {
        self.0.lock().unwrap().push((event, payload));
    }
}

impl Events {
    fn named(&self, name: &str) -> Vec<Value> {
        let all = self.0.lock().unwrap();
        all.iter()
            .filter(|(e, _)| *e == name)
            .map(|(_, p)| p.clone())
            .collect()
    }
}

/// The open panel: answers the folder, or is closed.
struct Panel {
    folder: PathBuf,
    cancel: AtomicBool,
}

impl NativeOps for Panel {
    fn save_panel<'a>(&'a self, _: &'a str, kind: SaveKind) -> BoxFuture<'a, Option<PathBuf>> {
        assert_eq!(kind, SaveKind::Folder);
        let answer = (!self.cancel.load(Ordering::SeqCst)).then(|| self.folder.clone());
        Box::pin(async move { answer })
    }
}

struct Rig {
    core: Arc<Core>,
    events: Arc<Events>,
    clock: Arc<StepClock>,
    panel: Arc<Panel>,
    folder: PathBuf,
    _dir: tempfile::TempDir,
}

fn ctx() -> CommandCtx {
    CommandCtx {
        caller: Caller::Window {
            label: WindowLabel::Settings,
        },
    }
}

/// A core with a scripted engine, and a folder holding the six fixture formats plus files the
/// index leaves out (hidden, unsupported).
async fn open() -> Rig {
    let dir = tempfile::tempdir().unwrap();
    let folder = dir.path().join("Specs");
    std::fs::create_dir(&folder).unwrap();
    let fixtures = Path::new(env!("CARGO_MANIFEST_DIR")).join("../noter-knowledge/tests/fixtures");
    for f in std::fs::read_dir(fixtures).unwrap() {
        let f = f.unwrap().path();
        std::fs::copy(&f, folder.join(f.file_name().unwrap())).unwrap();
    }
    std::fs::create_dir(folder.join(".git")).unwrap();
    std::fs::write(folder.join(".git/notes.md"), "# hidden").unwrap();
    std::fs::write(folder.join("photo.png"), "not text").unwrap();
    let data = dir.path().join("data");
    let events = Arc::new(Events::default());
    let clock = Arc::new(StepClock(AtomicI64::new(T0)));
    let panel = Arc::new(Panel {
        folder: folder.clone(),
        cancel: AtomicBool::new(false),
    });
    let deps = CoreDeps::new(clock.clone(), events.clone())
        .with_engine(Arc::new(ScriptedEngine::new().with_container(&data)))
        .with_native_ops(panel.clone());
    let core = Arc::new(Core::open(&data, deps).unwrap());
    core.start_first_run();
    Rig {
        core,
        events,
        clock,
        panel,
        folder,
        _dir: dir,
    }
}

type Conn = noter_db::rusqlite::Connection;

fn read<T: Send + 'static>(
    core: &Core,
    f: impl FnOnce(&Conn) -> noter_db::rusqlite::Result<T> + Send + 'static,
) -> T {
    core.store().read(f).unwrap()
}

fn count(core: &Core, sql: &'static str) -> i64 {
    read(core, move |c| c.query_row(sql, [], |r| r.get(0)))
}

/// Each document's file name with its chunk ids.
fn chunk_ids(core: &Core) -> BTreeMap<String, Vec<String>> {
    read(core, |c| {
        let mut st = c.prepare(
            "SELECT d.uri, ch.id FROM documents d JOIN doc_chunks ch ON ch.document_id = d.id
             ORDER BY ch.rowid",
        )?;
        let rows = st.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
        let mut out: BTreeMap<String, Vec<String>> = BTreeMap::new();
        for row in rows {
            let (uri, id) = row?;
            let name = Path::new(&uri)
                .file_name()
                .unwrap()
                .to_string_lossy()
                .into_owned();
            out.entry(name).or_default().push(id);
        }
        Ok(out)
    })
}

fn folder_args() -> SourceAddFolderArgs {
    SourceAddFolderArgs {
        path: None,
        privacy: PrivacyClass::Normal,
        scope: SourceScope::AllCalls,
    }
}

impl Rig {
    async fn source(&self) -> Option<SourceRow> {
        let list = self.core.sources_list(&ctx(), NoArgs {}).await.unwrap();
        list.sources.into_iter().next()
    }

    /// Waits until the source satisfies `done`.
    async fn until(&self, done: impl Fn(&SourceRow) -> bool) -> SourceRow {
        for _ in 0..1500 {
            if let Some(row) = self.source().await.filter(|r| done(r)) {
                return row;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        panic!("the source never settled: {:?}", self.source().await);
    }

    /// Waits for a successful sync at `at` on the clock.
    async fn synced_at(&self, at: i64) -> SourceRow {
        self.until(|r| r.status == SourceStatus::Idle && r.last_sync_at == Some(TimestampMs(at)))
            .await
    }

    async fn add(&self) -> SourceRow {
        let row = self
            .core
            .source_add_folder(&ctx(), folder_args())
            .await
            .unwrap();
        self.synced_at(T0).await;
        row
    }

    async fn reindex(&self, at: i64, id: &SourceId) {
        self.clock.0.store(at, Ordering::SeqCst);
        let args = SourceIdArgs {
            source_id: id.clone(),
        };
        self.core.source_reindex(&ctx(), args).await.unwrap();
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_picked_folder_is_indexed_in_six_formats_with_progress_count_and_last_sync() {
    let rig = open().await;
    let row = rig
        .core
        .source_add_folder(&ctx(), folder_args())
        .await
        .unwrap();
    assert_eq!(
        (row.status.clone(), row.last_sync_at, row.name.as_str()),
        (SourceStatus::Idle, None, "Specs")
    );
    let done = rig.synced_at(T0).await;
    assert_eq!(done.documents, 6);

    // Every format, with its title and headings in front of the text.
    let titles: Vec<String> = read(&rig.core, |c| {
        let mut st = c.prepare("SELECT title FROM documents ORDER BY title")?;
        let rows = st.query_map([], |r| r.get(0))?;
        rows.collect()
    });
    assert_eq!(
        titles,
        [
            "Design Spec",
            "Install Guide",
            "Release Notes",
            "notes",
            "report",
            "retry"
        ]
    );
    let heading: String = read(&rig.core, |c| {
        c.query_row(
            "SELECT text FROM doc_chunks WHERE heading_path = '[\"Setup\",\"macOS\"]'",
            [],
            |r| r.get(0),
        )
    });
    assert!(
        heading.starts_with("Install Guide › Setup › macOS\n\n"),
        "{heading}"
    );
    assert_eq!(
        count(
            &rig.core,
            "SELECT COUNT(*) FROM doc_chunks WHERE embedding IS NULL"
        ),
        0
    );
    assert_eq!(
        count(&rig.core, "SELECT COUNT(*) FROM doc_vec"),
        count(&rig.core, "SELECT COUNT(*) FROM doc_chunks")
    );
    let run: (i64, i64, i64, Option<String>) = read(&rig.core, |c| {
        c.query_row(
            "SELECT added, changed, removed, error FROM sync_runs",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
    });
    assert_eq!(run, (6, 0, 0, None));

    // Settings heard the indexing progress and the job its run; neither carries file text.
    let sources = rig.events.named("entity:changed");
    assert!(sources.iter().any(
        |e| e["source"]["status"]["type"] == "indexing" && e["source"]["status"]["total"] == 6
    ));
    let progress = rig.events.named("jobs:progress");
    assert!(progress
        .iter()
        .any(|p| p["run"]["kind"] == "source_sync" && p["run"]["counts"][0]["label"] == "added"));
    let all = format!("{sources:?}{progress:?}");
    for secret in ["websockets", "Quarterly", "backoff", "system extension"] {
        assert!(!all.contains(secret), "{secret} leaked into an event");
    }
    let logged: Vec<String> = read(&rig.core, |c| {
        let mut st = c.prepare(
            "SELECT summary || coalesce(after, '') FROM changes WHERE entity_type = 'source'",
        )?;
        let rows = st.query_map([], |r| r.get(0))?;
        rows.collect()
    });
    assert!(logged.len() >= 8, "{logged:?}");
    assert!(logged
        .iter()
        .all(|l| !l.contains("websockets") && !l.contains("Install Guide")));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn changing_one_file_re_embeds_only_that_file_and_same_content_adds_nothing() {
    let rig = open().await;
    let row = rig.add().await;
    let before = chunk_ids(&rig.core);
    assert_eq!(before.len(), 6);

    std::fs::write(
        rig.folder.join("guide.md"),
        "# Install Guide\n\nNew single section.\n",
    )
    .unwrap();
    // Same bytes under a new modification time: hashed again and found unchanged.
    let later = SystemTime::now() + Duration::from_secs(60);
    for name in ["guide.md", "notes.txt"] {
        std::fs::File::options()
            .write(true)
            .open(rig.folder.join(name))
            .unwrap()
            .set_modified(later)
            .unwrap();
    }
    std::fs::remove_file(rig.folder.join("retry.rs")).unwrap();
    rig.reindex(T0 + 1_000, &row.id).await;
    let after = rig.synced_at(T0 + 1_000).await;
    assert_eq!(after.documents, 5);

    let now = chunk_ids(&rig.core);
    assert_ne!(now["guide.md"], before["guide.md"]);
    assert_eq!(now["guide.md"].len(), 1);
    for name in ["notes.txt", "page.html", "report.pdf", "spec.docx"] {
        assert_eq!(now[name], before[name], "{name} was re-embedded");
    }
    assert!(!now.contains_key("retry.rs"));
    // Over every run since the first (the watcher may have run one of its own): one changed
    // document, one removed, nothing added.
    let runs: (i64, i64, i64) = read(&rig.core, |c| {
        c.query_row(
            "SELECT SUM(added), SUM(changed), SUM(removed) FROM sync_runs
             WHERE rowid > (SELECT MIN(rowid) FROM sync_runs)",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
    });
    assert_eq!(runs, (0, 1, 1));
    assert_eq!(
        count(&rig.core, "SELECT COUNT(*) FROM doc_vec"),
        count(&rig.core, "SELECT COUNT(*) FROM doc_chunks")
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_cancelled_picker_writes_nothing() {
    let rig = open().await;
    rig.panel.cancel.store(true, Ordering::SeqCst);
    let changes = count(&rig.core, "SELECT COUNT(*) FROM changes");
    let e = rig
        .core
        .source_add_folder(&ctx(), folder_args())
        .await
        .unwrap_err();
    assert_eq!(e.code, ErrorCode::Cancelled);
    assert!(rig.source().await.is_none());
    assert_eq!(count(&rig.core, "SELECT COUNT(*) FROM changes"), changes);
    assert!(rig.events.named("entity:changed").is_empty());

    // A limited scope names known call types only; nothing is asked or written otherwise.
    let unknown = SourceAddFolderArgs {
        scope: SourceScope::Limited {
            call_types: vec![CallTypeId("no_such_type".into())],
            people: vec![],
        },
        ..folder_args()
    };
    let e = rig
        .core
        .source_add_folder(&ctx(), unknown)
        .await
        .unwrap_err();
    assert_eq!(e.code, ErrorCode::InvalidInput);
    assert!(rig.source().await.is_none());

    // A supplied path is checked, never taken as a grant.
    let missing = SourceAddFolderArgs {
        path: Some("/no/such/folder".into()),
        ..folder_args()
    };
    let e = rig
        .core
        .source_add_folder(&ctx(), missing)
        .await
        .unwrap_err();
    assert_eq!(e.code, ErrorCode::NotFound);
    assert!(rig.source().await.is_none());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_unreadable_folder_fails_with_its_code_and_keeps_the_last_sync_until_retry() {
    let rig = open().await;
    let row = rig.add().await;
    let moved = rig.folder.with_file_name("Moved");
    std::fs::rename(&rig.folder, &moved).unwrap();
    rig.reindex(T0 + 5_000, &row.id).await;
    let failed = rig
        .until(|r| matches!(r.status, SourceStatus::Failed { .. }))
        .await;
    assert_eq!(
        failed.status,
        SourceStatus::Failed {
            code: ErrorCode::SourceSyncFailed,
            at: TimestampMs(T0 + 5_000)
        }
    );
    // The previous successful sync and its documents stay: a failed listing deletes nothing.
    assert_eq!(
        (failed.last_sync_at, failed.documents),
        (Some(TimestampMs(T0)), 6)
    );
    let error: Option<String> = read(&rig.core, |c| {
        c.query_row("SELECT error FROM sync_runs ORDER BY rowid DESC", [], |r| {
            r.get(0)
        })
    });
    assert_eq!(error.as_deref(), Some("source_sync_failed"));

    // The drive is back: retry goes through indexing to idle.
    std::fs::rename(&moved, &rig.folder).unwrap();
    rig.reindex(T0 + 9_000, &row.id).await;
    let back = rig.synced_at(T0 + 9_000).await;
    assert_eq!(back.documents, 6);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_stale_update_is_a_conflict_without_a_write_or_event() {
    let rig = open().await;
    let row = rig.add().await;
    let heard = rig.events.named("entity:changed").len();
    let edit = |rev: Rev| SourceUpdateArgs {
        source_id: row.id.clone(),
        rev,
        name: None,
        schedule: None,
        privacy: Some(PrivacyClass::Sensitive),
        scope: Some(SourceScope::Limited {
            call_types: vec![CallTypeId("planning".into())],
            people: vec![],
        }),
    };
    let current = rig.source().await.unwrap();
    let stale = rig
        .core
        .source_update(&ctx(), edit(Rev(current.rev.0 + 5)))
        .await
        .unwrap_err();
    assert_eq!(stale.code, ErrorCode::Conflict);
    assert_eq!(
        stale.detail,
        Some(ErrorDetail::Conflict {
            current_rev: current.rev
        })
    );
    // A watcher sync may write its own status rows meanwhile; the edit wrote nothing.
    assert_eq!(
        count(
            &rig.core,
            "SELECT COUNT(*) FROM changes WHERE reason = 'source_update'"
        ),
        0
    );
    let heard: Vec<Value> = rig.events.named("entity:changed")[heard..].to_vec();
    assert!(heard
        .iter()
        .all(|e| e["source"]["rev"] == current.rev.0 && e["source"]["privacy"] == "normal"));

    let updated = rig
        .core
        .source_update(&ctx(), edit(current.rev))
        .await
        .unwrap();
    assert_eq!(
        (updated.privacy, updated.rev),
        (PrivacyClass::Sensitive, Rev(current.rev.0 + 1))
    );
    let last = rig.events.named("entity:changed").pop().unwrap();
    assert_eq!(last["source"]["privacy"], "sensitive");
    assert_eq!(
        count(
            &rig.core,
            "SELECT COUNT(*) FROM doc_vec WHERE privacy_class = 'sensitive'"
        ),
        count(&rig.core, "SELECT COUNT(*) FROM doc_chunks")
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn removal_deletes_the_index_stops_the_source_and_leaves_the_files() {
    let rig = open().await;
    let row = rig.add().await;
    let args = SourceIdArgs {
        source_id: row.id.clone(),
    };
    let removed = rig.core.source_remove(&ctx(), args.clone()).await.unwrap();
    assert_eq!(removed, DeleteResult { deleted: 7 });
    assert!(rig.source().await.is_none());
    for table in [
        "SELECT COUNT(*) FROM documents",
        "SELECT COUNT(*) FROM doc_chunks",
        "SELECT COUNT(*) FROM doc_vec",
        "SELECT COUNT(*) FROM sync_runs",
    ] {
        assert_eq!(count(&rig.core, table), 0, "{table}");
    }
    let last = rig.events.named("entity:changed").pop().unwrap();
    assert_eq!(
        (&last["type"], &last["kind"]),
        (&"removed".into(), &"source".into())
    );
    assert!(rig.folder.join("guide.md").exists());
    for e in [
        rig.core
            .source_reindex(&ctx(), args.clone())
            .await
            .unwrap_err(),
        rig.core.source_remove(&ctx(), args).await.unwrap_err(),
    ] {
        assert_eq!(e.code, ErrorCode::NotFound);
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_new_file_in_the_watched_folder_is_indexed_on_its_own() {
    let rig = open().await;
    rig.add().await;
    std::fs::write(
        rig.folder.join("later.md"),
        "# Later\n\nAdded after the first sync.\n",
    )
    .unwrap();
    let row = rig
        .until(|r| r.documents == 7 && r.status == SourceStatus::Idle)
        .await;
    assert_eq!(row.documents, 7);
    assert!(chunk_ids(&rig.core).contains_key("later.md"));
}
