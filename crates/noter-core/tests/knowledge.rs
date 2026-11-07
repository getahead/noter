//! FEATURE cpt-noter-feature-core-knowledge: folder sources through the five commands, the native
//! folder panel, the `source_sync` job on the scheduler and the scripted engine's bge-m3 vectors
//! (slice 1); indexed and live MCP sources over the scripted `McpSource`, Keychain token
//! references and revocation (slice 2).

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime};

use noter_core::{
    BoxFuture, Clock, Core, CoreDeps, EventEmitter, MemorySecrets, NativeOps, SaveKind,
    ScriptedMcp, ScriptedPage, ScriptedServer, SecretStore,
};
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
    mcp: Arc<ScriptedMcp>,
    secrets: Arc<MemorySecrets>,
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
    let now = clock.clone();
    let mcp = Arc::new(ScriptedMcp::new(Arc::new(move || now.now())));
    let secrets = Arc::new(MemorySecrets::default());
    let deps = CoreDeps::new(clock.clone(), events.clone())
        .with_engine(Arc::new(ScriptedEngine::new().with_container(&data)))
        .with_native_ops(panel.clone())
        .with_mcp_source(mcp.clone())
        .with_secrets(secrets.clone());
    let core = Arc::new(Core::open(&data, deps).unwrap());
    core.start_first_run();
    Rig {
        core,
        events,
        clock,
        panel,
        folder,
        mcp,
        secrets,
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
    let file_text = ["websockets", "Quarterly", "backoff", "system extension"];
    assert!(
        file_text.iter().all(|phrase| !all.contains(phrase)),
        "file text leaked into an event"
    );
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

// ── slice 2: MCP sources ─────────────────────────────────────

fn page(n: u32, hash: &str) -> ScriptedPage {
    ScriptedPage {
        uri: format!("notion://page/{n}"),
        title: format!("Page {n}"),
        hash: Some(hash.into()),
        text: format!("# Page {n}\n\n## Rollout\n\nThe rollout for page {n} ships on Friday.\n"),
        mime: Some("text/markdown".into()),
    }
}

fn server(pages: Vec<ScriptedPage>) -> ScriptedServer {
    ScriptedServer {
        pages,
        ..ScriptedServer::default()
    }
}

fn mcp_args(mode: SourceMode) -> SourceAddMcpArgs {
    SourceAddMcpArgs {
        server: "notion".into(),
        mode,
        schedule: None,
        privacy: PrivacyClass::Normal,
        scope: SourceScope::AllCalls,
    }
}

fn lookups(core: &Core) -> i64 {
    count(core, "SELECT COUNT(*) FROM audit_log WHERE kind = 'lookup'")
}

/// The last sync run's added, changed and removed counts and error code.
fn last_run(core: &Core) -> (i64, i64, i64, Option<String>) {
    read(core, |c| {
        c.query_row(
            "SELECT added, changed, removed, error FROM sync_runs
             ORDER BY started_at DESC, rowid DESC LIMIT 1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
    })
}

impl Rig {
    /// An indexed `notion` source with two pages, synced at `T0`.
    async fn add_mcp(&self) -> SourceRow {
        self.mcp
            .set("notion", server(vec![page(1, "h1"), page(2, "h2")]));
        let row = self
            .core
            .source_add_mcp(&ctx(), mcp_args(SourceMode::Indexed))
            .await
            .unwrap();
        self.synced_at(T0).await;
        row
    }

    fn token(&self, id: &SourceId) -> Option<Secret> {
        self.secrets
            .get(&format!("source:{}", id.as_str()))
            .unwrap()
    }
}

use noter_core::Secret;

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_indexed_mcp_source_signs_in_keeps_only_a_token_reference_and_indexes_its_pages() {
    let rig = open().await;
    let row = rig.add_mcp().await;
    assert_eq!(
        (
            row.kind,
            row.mode,
            row.location.as_str(),
            row.schedule.as_deref(),
            row.has_token
        ),
        (
            SourceKind::Mcp,
            SourceMode::Indexed,
            "notion",
            Some("daily"),
            true
        )
    );
    assert_eq!(rig.source().await.unwrap().documents, 2);
    let token = rig.token(&row.id).expect("the token is in the Keychain");
    let token_ref: Option<String> = read(&rig.core, |c| {
        c.query_row("SELECT token_ref FROM sources", [], |r| r.get(0))
    });
    assert_eq!(token_ref, Some(format!("source:{}", row.id.as_str())));

    // One audited lookup per request, before it left: the listing and each page.
    let audit: Vec<(String, String, Option<String>)> = read(&rig.core, |c| {
        let mut st = c.prepare(
            "SELECT what, destination, runtime_choice FROM audit_log WHERE kind = 'lookup'",
        )?;
        let rows = st.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?;
        rows.collect()
    });
    assert_eq!(audit.len(), 3);
    assert!(audit
        .iter()
        .all(|a| *a == ("live_mcp_query".into(), "notion".into(), None)));

    // The heading arrives as document evidence.
    let heading: String = read(&rig.core, |c| {
        c.query_row(
            "SELECT text FROM doc_chunks WHERE heading_path = '[\"Rollout\"]' LIMIT 1",
            [],
            |r| r.get(0),
        )
    });
    assert!(heading.starts_with("Page "), "{heading}");

    // The token is nowhere but the Keychain: not in the change log, the audit or an event.
    let secret = token.expose().to_string();
    let leaked: i64 = read(&rig.core, move |c| {
        c.query_row(
            "SELECT (SELECT COUNT(*) FROM changes WHERE instr(COALESCE(before, '') ||
                 COALESCE(after, '') || COALESCE(CAST(delta AS TEXT), '') || summary, ?1) > 0)
             + (SELECT COUNT(*) FROM sources WHERE instr(COALESCE(token_ref, ''), ?1) > 0)",
            [secret],
            |r| r.get(0),
        )
    });
    assert_eq!(leaked, 0);
    let events = format!("{:?}", rig.events.0.lock().unwrap());
    assert!(!events.contains(token.expose()));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_cancelled_or_offline_sign_in_an_unknown_server_or_a_locked_keychain_writes_nothing() {
    let rig = open().await;
    let add = |server: &str| {
        let mut args = mcp_args(SourceMode::Indexed);
        args.server = server.into();
        let core = rig.core.clone();
        async move { core.source_add_mcp(&ctx(), args).await }
    };
    for (name, oauth) in [
        ("cancelled", noter_core::ScriptedOauth::Cancelled),
        ("offline", noter_core::ScriptedOauth::Offline),
    ] {
        rig.mcp.set(
            name,
            ScriptedServer {
                oauth,
                ..server(vec![page(1, "h1")])
            },
        );
    }
    rig.mcp.set("locked", server(vec![page(1, "h1")]));
    assert_eq!(
        add("cancelled").await.unwrap_err().code,
        ErrorCode::SignInCancelled
    );
    assert_eq!(add("offline").await.unwrap_err().code, ErrorCode::Offline);
    assert_eq!(
        add("unknown").await.unwrap_err().code,
        ErrorCode::InvalidInput
    );
    rig.secrets.set_locked(true);
    assert_eq!(
        add("locked").await.unwrap_err().code,
        ErrorCode::KeychainLocked
    );
    rig.secrets.set_locked(false);
    // No row, no sync, no lookup, no event.
    assert_eq!(count(&rig.core, "SELECT COUNT(*) FROM sources"), 0);
    assert_eq!(count(&rig.core, "SELECT COUNT(*) FROM sync_runs"), 0);
    assert_eq!(lookups(&rig.core), 0);
    assert!(rig.events.named("entity:changed").is_empty());
    // An empty server name is refused before any sign-in.
    assert_eq!(add("  ").await.unwrap_err().code, ErrorCode::InvalidInput);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_live_source_is_stored_without_a_token_and_never_indexed() {
    let rig = open().await;
    let row = rig
        .core
        .source_add_mcp(&ctx(), mcp_args(SourceMode::Live))
        .await
        .unwrap();
    assert_eq!(
        (row.mode, row.has_token, row.schedule.clone(), row.documents),
        (SourceMode::Live, false, None, 0)
    );
    assert_eq!(rig.events.named("entity:changed").len(), 1);
    // Not scheduled, not reindexed, never signed in to.
    let mut scheduled = mcp_args(SourceMode::Live);
    scheduled.schedule = Some("daily".into());
    assert_eq!(
        rig.core
            .source_add_mcp(&ctx(), scheduled)
            .await
            .unwrap_err()
            .code,
        ErrorCode::InvalidInput
    );
    let args = SourceIdArgs {
        source_id: row.id.clone(),
    };
    assert_eq!(
        rig.core
            .source_reindex(&ctx(), args)
            .await
            .unwrap_err()
            .code,
        ErrorCode::InvalidInput
    );
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert_eq!(count(&rig.core, "SELECT COUNT(*) FROM sync_runs"), 0);
    assert_eq!(lookups(&rig.core), 0);
    assert!(rig.token(&row.id).is_none());
    // The same server twice is one source.
    assert_eq!(
        rig.core
            .source_add_mcp(&ctx(), mcp_args(SourceMode::Live))
            .await
            .unwrap_err()
            .code,
        ErrorCode::InvalidInput
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_indexed_source_needs_a_known_schedule() {
    let rig = open().await;
    rig.mcp.set("notion", server(vec![]));
    let mut args = mcp_args(SourceMode::Indexed);
    args.schedule = Some("every full moon".into());
    let err = rig.core.source_add_mcp(&ctx(), args).await.unwrap_err();
    assert_eq!(err.code, ErrorCode::InvalidInput);
    let mut args = mcp_args(SourceMode::Indexed);
    args.schedule = Some("hourly".into());
    let row = rig.core.source_add_mcp(&ctx(), args).await.unwrap();
    assert_eq!(row.schedule.as_deref(), Some("hourly"));
    let update = SourceUpdateArgs {
        source_id: row.id.clone(),
        rev: row.rev,
        name: None,
        schedule: Some("sometimes".into()),
        privacy: None,
        scope: None,
    };
    let err = rig.core.source_update(&ctx(), update).await.unwrap_err();
    assert_eq!(err.code, ErrorCode::InvalidInput);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn unchanged_hashes_skip_and_a_partial_listing_deletes_nothing() {
    let rig = open().await;
    let row = rig.add_mcp().await;
    let before = lookups(&rig.core);
    // Same hashes: the listing only, no page read, nothing written.
    rig.reindex(T0 + 1, &row.id).await;
    rig.synced_at(T0 + 1).await;
    assert_eq!(last_run(&rig.core), (0, 0, 0, None));
    assert_eq!(lookups(&rig.core), before + 1);
    // An incomplete listing that misses page 2 keeps it.
    rig.mcp.set(
        "notion",
        ScriptedServer {
            listing: noter_core::ScriptedListing::Partial,
            ..server(vec![page(1, "h1")])
        },
    );
    rig.reindex(T0 + 2, &row.id).await;
    let done = rig.synced_at(T0 + 2).await;
    assert_eq!((done.documents, last_run(&rig.core)), (2, (0, 0, 0, None)));
    // A complete one deletes it, and a changed hash re-reads only that page.
    rig.mcp.set("notion", server(vec![page(1, "h1-new")]));
    rig.reindex(T0 + 3, &row.id).await;
    let done = rig.synced_at(T0 + 3).await;
    assert_eq!((done.documents, last_run(&rig.core)), (1, (0, 1, 1, None)));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_server_without_resources_is_crawled_by_seed_query_and_never_pruned() {
    let rig = open().await;
    rig.mcp.set(
        "notion",
        ScriptedServer {
            listing: noter_core::ScriptedListing::None,
            ..server(vec![page(1, "h1"), page(2, "h2")])
        },
    );
    let row = rig
        .core
        .source_add_mcp(&ctx(), mcp_args(SourceMode::Indexed))
        .await
        .unwrap();
    let done = rig.synced_at(T0).await;
    assert_eq!(done.documents, 2);
    rig.mcp.set(
        "notion",
        ScriptedServer {
            listing: noter_core::ScriptedListing::None,
            ..server(vec![page(1, "h1")])
        },
    );
    rig.reindex(T0 + 1, &row.id).await;
    let done = rig.synced_at(T0 + 1).await;
    assert_eq!(done.documents, 2);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_expired_token_makes_the_source_sign_in_expired_and_keeps_its_last_sync() {
    let rig = open().await;
    let row = rig.add_mcp().await;
    rig.mcp.set(
        "notion",
        ScriptedServer {
            expires_at: Some(TimestampMs(T0 + 5)),
            ..server(vec![page(1, "h1"), page(2, "h2-new")])
        },
    );
    rig.reindex(T0 + 10, &row.id).await;
    let done = rig.until(|r| r.status == SourceStatus::SignInExpired).await;
    assert_eq!(
        (done.last_sync_at, done.documents),
        (Some(TimestampMs(T0)), 2)
    );
    assert_eq!(
        last_run(&rig.core).3.as_deref(),
        Some("source_sign_in_expired")
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_offline_server_fails_the_sync_and_a_retry_succeeds() {
    let rig = open().await;
    let row = rig.add_mcp().await;
    rig.mcp.set(
        "notion",
        ScriptedServer {
            offline: true,
            ..server(vec![page(1, "h1")])
        },
    );
    rig.reindex(T0 + 1, &row.id).await;
    let failed = rig
        .until(|r| matches!(r.status, SourceStatus::Failed { .. }))
        .await;
    assert_eq!(
        (failed.status, failed.last_sync_at),
        (
            SourceStatus::Failed {
                code: ErrorCode::Offline,
                at: TimestampMs(T0 + 1)
            },
            Some(TimestampMs(T0))
        )
    );
    rig.mcp
        .set("notion", server(vec![page(1, "h1"), page(2, "h2-new")]));
    rig.reindex(T0 + 2, &row.id).await;
    rig.synced_at(T0 + 2).await;
    assert_eq!(last_run(&rig.core), (0, 1, 0, None));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn revoking_deletes_the_token_stops_sync_and_marks_the_source_sign_in_expired() {
    let rig = open().await;
    let row = rig.add_mcp().await;
    let args = || SourceIdArgs {
        source_id: row.id.clone(),
    };
    // A locked Keychain keeps the token and says so.
    rig.secrets.set_locked(true);
    let err = rig
        .core
        .source_revoke_token(&ctx(), args())
        .await
        .unwrap_err();
    rig.secrets.set_locked(false);
    assert_eq!(err.code, ErrorCode::KeychainLocked);
    assert!(rig.token(&row.id).is_some());
    assert!(rig.source().await.unwrap().has_token);

    let events = rig.events.named("entity:changed").len();
    let revoked = rig.core.source_revoke_token(&ctx(), args()).await.unwrap();
    assert_eq!(
        (revoked.has_token, revoked.status.clone(), revoked.documents),
        (false, SourceStatus::SignInExpired, 2)
    );
    assert!(rig.token(&row.id).is_none());
    assert_eq!(rig.events.named("entity:changed").len(), events + 1);
    // No authenticated work after it: a retry ends sign-in-expired without a lookup.
    let before = lookups(&rig.core);
    rig.reindex(T0 + 1, &row.id).await;
    tokio::time::sleep(Duration::from_millis(200)).await;
    let after = rig.until(|r| r.status == SourceStatus::SignInExpired).await;
    assert_eq!(after.last_sync_at, Some(TimestampMs(T0)));
    assert_eq!(lookups(&rig.core), before);
    // A folder holds no token to revoke.
    let folder = rig
        .core
        .source_add_folder(&ctx(), folder_args())
        .await
        .unwrap();
    let err = rig
        .core
        .source_revoke_token(
            &ctx(),
            SourceIdArgs {
                source_id: folder.id,
            },
        )
        .await
        .unwrap_err();
    assert_eq!(err.code, ErrorCode::InvalidInput);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn removing_an_mcp_source_removes_its_token_and_index() {
    let rig = open().await;
    let row = rig.add_mcp().await;
    let args = || SourceIdArgs {
        source_id: row.id.clone(),
    };
    rig.secrets.set_locked(true);
    let err = rig.core.source_remove(&ctx(), args()).await.unwrap_err();
    rig.secrets.set_locked(false);
    assert_eq!(err.code, ErrorCode::KeychainLocked);
    assert_eq!(rig.source().await.unwrap().documents, 2);

    rig.core.source_remove(&ctx(), args()).await.unwrap();
    assert!(rig.token(&row.id).is_none());
    assert_eq!(count(&rig.core, "SELECT COUNT(*) FROM doc_chunks"), 0);
    assert!(rig.source().await.is_none());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_hourly_pass_syncs_an_indexed_source_once_its_schedule_has_passed() {
    let rig = open().await;
    let row = rig.add_mcp().await;
    let runs = || count(&rig.core, "SELECT COUNT(*) FROM sync_runs");
    let before = runs();
    // Two hours on: the pass runs, but a daily source is not due.
    rig.clock.0.store(T0 + 2 * 3_600_000, Ordering::SeqCst);
    noter_core::testing::jobs_tick(&rig.core);
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert_eq!(runs(), before);
    // A day on, it is.
    let later = T0 + 25 * 3_600_000;
    rig.clock.0.store(later, Ordering::SeqCst);
    noter_core::testing::jobs_tick(&rig.core);
    let done = rig.synced_at(later).await;
    assert_eq!(done.id, row.id);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_live_source_is_removed_even_with_the_keychain_locked() {
    let rig = open().await;
    let row = rig
        .core
        .source_add_mcp(&ctx(), mcp_args(SourceMode::Live))
        .await
        .unwrap();
    rig.secrets.set_locked(true);
    let args = SourceIdArgs { source_id: row.id };
    rig.core.source_remove(&ctx(), args).await.unwrap();
    assert!(rig.source().await.is_none());
}

// ── document hits in search (`permitted_chunks` behind retrieval's document seam) ──

fn search_args(query: &str, call_types: Vec<CallTypeId>) -> SearchArgs {
    SearchArgs {
        query: query.into(),
        filter: CallFilter {
            call_types,
            ..CallFilter::default()
        },
        limit: None,
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_indexed_heading_is_document_evidence_in_search_until_the_source_goes() {
    let rig = open().await;
    let row = rig.add_mcp().await;
    let main = CommandCtx {
        caller: Caller::Window {
            label: WindowLabel::Main,
        },
    };
    // A stem at a word start finds "ships"; the hit names its source, title and section.
    let found = rig
        .core
        .search(&main, search_args("shipping", vec![]))
        .await
        .unwrap();
    assert!(!found.documents.is_empty(), "{found:?}");
    let first = &found.documents[0];
    assert_eq!(first.strength, MatchStrength::Strong);
    assert!(matches!(first.target, HitTarget::Document { .. }));
    let Provenance::Document {
        source_id,
        title,
        section,
        source_name,
        ..
    } = &first.provenance
    else {
        panic!("{:?}", first.provenance);
    };
    assert_eq!(
        (
            source_id,
            title.starts_with("Page "),
            section.as_deref(),
            source_name.as_str()
        ),
        (&row.id, true, Some("Rollout"), "notion")
    );
    // A source limited to other call types is not evidence for a request about one type.
    let limited = SourceUpdateArgs {
        source_id: row.id.clone(),
        rev: rig.source().await.unwrap().rev,
        name: None,
        schedule: None,
        privacy: None,
        scope: Some(SourceScope::Limited {
            call_types: vec![],
            people: vec![PersonId::new("per_nobody")],
        }),
    };
    rig.core.source_update(&ctx(), limited).await.unwrap();
    let types = rig.core.call_types_list(&main, NoArgs {}).await.unwrap();
    let one = vec![types.call_types[0].id.clone()];
    let scoped = rig
        .core
        .search(&main, search_args("rollout", one))
        .await
        .unwrap();
    assert!(scoped.documents.is_empty());
    // Removed: no hits.
    let args = SourceIdArgs { source_id: row.id };
    rig.core.source_remove(&ctx(), args).await.unwrap();
    let gone = rig
        .core
        .search(&main, search_args("rollout", vec![]))
        .await
        .unwrap();
    assert!(gone.documents.is_empty());
}
