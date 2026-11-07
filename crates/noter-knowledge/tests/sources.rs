//! FEATURE cpt-noter-feature-core-knowledge, slice 1, on a real store: folder rows, the revision
//! guard, the privacy partition, the source policy (TL-45) and removal in one transaction.

use std::path::Path;

use noter_db::rusqlite::{params, Connection};
use noter_db::{ChangeMeta, Migration, Store};
use noter_protocol::error::ValidationRule;
use noter_protocol::model::*;
use noter_protocol::*;

/// The two call tables the policy reads (noter-core owns them in the app).
const CALLS: &[Migration] = &[Migration {
    owner: "test",
    version: 1,
    name: "calls",
    sql: "CREATE TABLE calls (id TEXT PRIMARY KEY, call_type TEXT NOT NULL);
          CREATE TABLE speakers (id TEXT PRIMARY KEY, call_id TEXT NOT NULL, person_id TEXT);",
}];

fn open(dir: &Path) -> Store {
    Store::open(
        &dir.join("noter.db"),
        &[noter_db::MIGRATIONS, CALLS, noter_knowledge::MIGRATIONS],
    )
    .unwrap()
}

/// A second connection for seeding and checks (sqlite-vec registers itself for it too).
fn raw(dir: &Path) -> Connection {
    Connection::open(dir.join("noter.db")).unwrap()
}

fn meta() -> ChangeMeta {
    ChangeMeta {
        actor: Actor::You,
        summary: "test".into(),
        reason: "test".into(),
        evidence_ids: vec![],
        batch_id: None,
        undoable: true,
        surface: None,
    }
}

fn count(c: &Connection, sql: &str) -> i64 {
    c.query_row(sql, [], |r| r.get(0)).unwrap()
}

fn changes(c: &Connection) -> i64 {
    count(c, "SELECT COUNT(*) FROM changes")
}

/// A folder source on a fresh folder under `dir`.
fn folder(
    store: &Store,
    dir: &Path,
    name: &str,
    privacy: PrivacyClass,
    scope: SourceScope,
) -> SourceRow {
    let path = dir.join(name);
    std::fs::create_dir_all(&path).unwrap();
    let path = noter_knowledge::validate_folder(path.to_str().unwrap()).unwrap();
    noter_knowledge::add_folder(store, meta(), &path, privacy, scope).unwrap()
}

/// One document of `source` with chunks `(id, text)`, each with a 1024-value embedding.
fn seed(c: &Connection, source: &SourceId, doc: &str, chunks: &[(&str, &str)]) {
    c.execute(
        "INSERT INTO documents (id, source_id, uri, title, mime, content_hash, indexed_at)
         VALUES (?1, ?2, ?3, 'Spec', 'text/markdown', 'h', 1)",
        params![doc, source.as_str(), format!("/f/{doc}.md")],
    )
    .unwrap();
    for (id, text) in chunks {
        let blob: Vec<u8> = (0..1024)
            .flat_map(|i| ((i % 7) as f32 + 1.0).to_le_bytes())
            .collect();
        c.execute(
            "INSERT INTO doc_chunks (id, document_id, heading_path, text, text_norm, token_count,
                 embedding) VALUES (?1, ?2, '[\"Limits\"]', ?3, ?4, 10, ?5)",
            params![id, doc, text, noter_knowledge::normalize(text), blob],
        )
        .unwrap();
    }
}

fn documents() -> AskScope {
    AskScope {
        include_documents: true,
        ..AskScope::default()
    }
}

#[test]
fn a_folder_is_validated_stored_once_and_listed() {
    let dir = tempfile::tempdir().unwrap();
    let store = open(dir.path());
    let missing = noter_knowledge::validate_folder("/no/such/folder").unwrap_err();
    assert_eq!(missing.code, ErrorCode::NotFound);
    let file = dir.path().join("a.txt");
    std::fs::write(&file, "x").unwrap();
    let not_dir = noter_knowledge::validate_folder(file.to_str().unwrap()).unwrap_err();
    assert_eq!(not_dir.code, ErrorCode::InvalidInput);

    let row = folder(
        &store,
        dir.path(),
        "Specs",
        PrivacyClass::Normal,
        SourceScope::AllCalls,
    );
    assert!(row.id.as_str().starts_with("src_"));
    assert_eq!(
        (
            row.kind,
            row.mode,
            row.name.as_str(),
            row.rev,
            row.documents
        ),
        (SourceKind::Folder, SourceMode::Indexed, "Specs", Rev(1), 0)
    );
    assert_eq!(
        (row.status.clone(), row.last_sync_at, row.has_token),
        (SourceStatus::Idle, None, false)
    );
    assert!(row.location.ends_with("/Specs"));

    let again = noter_knowledge::add_folder(
        &store,
        meta(),
        Path::new(&row.location),
        PrivacyClass::Normal,
        SourceScope::AllCalls,
    )
    .unwrap_err();
    assert_eq!(again.code, ErrorCode::InvalidInput);
    assert_eq!(
        again.detail,
        Some(ErrorDetail::Validation {
            field: "path".into(),
            rule: ValidationRule::Duplicate
        })
    );
    assert_eq!(noter_knowledge::list(&store).unwrap().sources, vec![row]);
    assert_eq!(changes(&raw(dir.path())), 1);
}

#[test]
fn a_stale_edit_is_a_conflict_with_nothing_written() {
    let dir = tempfile::tempdir().unwrap();
    let store = open(dir.path());
    let row = folder(
        &store,
        dir.path(),
        "Specs",
        PrivacyClass::Normal,
        SourceScope::AllCalls,
    );
    let c = raw(dir.path());
    let before = changes(&c);
    let edit = |rev: u32| SourceUpdateArgs {
        source_id: row.id.clone(),
        rev: Rev(rev),
        name: Some("Frontend specs".into()),
        schedule: None,
        privacy: None,
        scope: None,
    };
    let stale = noter_knowledge::update(&store, meta(), edit(7)).unwrap_err();
    assert_eq!(stale.code, ErrorCode::Conflict);
    assert_eq!(
        stale.detail,
        Some(ErrorDetail::Conflict {
            current_rev: Rev(1)
        })
    );
    assert_eq!(changes(&c), before);

    let renamed = noter_knowledge::update(&store, meta(), edit(1)).unwrap();
    assert_eq!(
        (renamed.name.as_str(), renamed.rev),
        ("Frontend specs", Rev(2))
    );
    assert_eq!(changes(&c), before + 1);
    // The same values again change nothing and write nothing.
    let same = noter_knowledge::update(&store, meta(), edit(2)).unwrap();
    assert_eq!(same, renamed);
    assert_eq!(changes(&c), before + 1);

    let mut scheduled = edit(2);
    scheduled.schedule = Some("hourly".into());
    let mut blank = edit(2);
    blank.name = Some("  ".into());
    let mut gone = edit(2);
    gone.source_id = SourceId::new("src_gone");
    for (args, code) in [
        (scheduled, ErrorCode::InvalidInput),
        (blank, ErrorCode::InvalidInput),
        (gone, ErrorCode::NotFound),
    ] {
        assert_eq!(
            noter_knowledge::update(&store, meta(), args)
                .unwrap_err()
                .code,
            code
        );
    }
    assert_eq!(changes(&c), before + 1);
}

#[test]
fn a_privacy_edit_moves_the_vectors_and_applies_to_old_chunks_at_once() {
    let dir = tempfile::tempdir().unwrap();
    let store = open(dir.path());
    let row = folder(
        &store,
        dir.path(),
        "Specs",
        PrivacyClass::Normal,
        SourceScope::AllCalls,
    );
    let c = raw(dir.path());
    seed(
        &c,
        &row.id,
        "doc_a",
        &[("chk_1", "Websocket limits"), ("chk_2", "Retry rules")],
    );
    let partition = |class: &str| -> i64 {
        c.query_row(
            "SELECT COUNT(*) FROM doc_vec WHERE privacy_class = ?1",
            [class],
            |r| r.get(0),
        )
        .unwrap()
    };
    assert_eq!((partition("normal"), partition("sensitive")), (2, 0));
    let all = [ChunkId::new("chk_1"), ChunkId::new("chk_2")];
    let cloud = |c: &Connection| {
        noter_knowledge::permitted_chunks(c, &all, &documents(), true)
            .unwrap()
            .len()
    };
    assert_eq!(cloud(&c), 2);

    let edit = SourceUpdateArgs {
        source_id: row.id.clone(),
        rev: row.rev,
        name: Some("Private specs".into()),
        schedule: None,
        privacy: Some(PrivacyClass::Sensitive),
        scope: None,
    };
    let sensitive = noter_knowledge::update(&store, meta(), edit).unwrap();
    assert_eq!(sensitive.privacy, PrivacyClass::Sensitive);
    assert_eq!((partition("normal"), partition("sensitive")), (0, 2));
    let delta: Vec<u8> = c
        .query_row(
            "SELECT delta FROM changes WHERE entity_type = 'source' ORDER BY rowid DESC LIMIT 1",
            [],
            |r| r.get(0),
        )
        .unwrap();
    let delta = String::from_utf8(delta).unwrap();
    assert!(
        delta.contains("privacy_class") && delta.contains("Private specs"),
        "{delta}"
    );
    assert!(!delta.contains("Websocket"));
    // Every cloud runtime loses the old chunks now; the local one keeps them, with provenance.
    assert_eq!(cloud(&c), 0);
    let local = noter_knowledge::permitted_chunks(&c, &all, &documents(), false).unwrap();
    assert_eq!(local[0].heading_path, ["Limits"]);
    assert_eq!(
        (
            local[0].title.as_str(),
            local[0].source_name.as_str(),
            local[0].document_id.as_str(),
            local[0].text.as_str()
        ),
        ("Spec", "Private specs", "doc_a", "Websocket limits")
    );
}

#[test]
fn scope_rules_follow_the_request_and_the_call_it_names() {
    let dir = tempfile::tempdir().unwrap();
    let store = open(dir.path());
    let everywhere = folder(
        &store,
        dir.path(),
        "All",
        PrivacyClass::Normal,
        SourceScope::AllCalls,
    );
    let limited = folder(
        &store,
        dir.path(),
        "Planning",
        PrivacyClass::Normal,
        SourceScope::Limited {
            call_types: vec![CallTypeId("planning".into())],
            people: vec![PersonId::new("per_ann")],
        },
    );
    let c = raw(dir.path());
    seed(&c, &everywhere.id, "doc_all", &[("chk_all", "General")]);
    seed(&c, &limited.id, "doc_plan", &[("chk_plan", "Roadmap")]);
    c.execute_batch(
        "INSERT INTO calls VALUES ('call_plan', 'planning'), ('call_1on1', 'one_on_one');
         INSERT INTO speakers VALUES ('spk_1', 'call_1on1', 'per_bob');",
    )
    .unwrap();
    let candidates = [
        ChunkId::new("chk_plan"),
        ChunkId::new("chk_missing"),
        ChunkId::new("chk_all"),
        ChunkId::new("chk_plan"),
    ];
    let ids = |scope: AskScope| -> Vec<String> {
        noter_knowledge::permitted_chunks(&c, &candidates, &scope, false)
            .unwrap()
            .into_iter()
            .map(|p| p.chunk_id.0)
            .collect()
    };
    let with = |f: &dyn Fn(&mut AskScope)| {
        let mut s = documents();
        f(&mut s);
        ids(s)
    };
    // Unscoped: both, in the order given, once each; an unknown chunk is dropped.
    assert_eq!(ids(documents()), ["chk_plan", "chk_all"]);
    assert!(ids(AskScope::default()).is_empty());
    assert_eq!(
        with(&|s| s.call_types = vec![CallTypeId("one_on_one".into())]),
        ["chk_all"]
    );
    assert_eq!(
        with(&|s| s.call_types = vec![CallTypeId("planning".into())]),
        ["chk_plan", "chk_all"]
    );
    assert_eq!(
        with(&|s| s.people = vec![PersonId::new("per_ann")]),
        ["chk_plan", "chk_all"]
    );
    // A named call brings its own type and people (TL-45).
    assert_eq!(
        with(&|s| s.call_id = Some(CallId::new("call_plan"))),
        ["chk_plan", "chk_all"]
    );
    assert_eq!(
        with(&|s| s.call_id = Some(CallId::new("call_1on1"))),
        ["chk_all"]
    );
}

#[test]
fn removal_takes_the_whole_index_in_one_transaction_or_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let store = open(dir.path());
    let row = folder(
        &store,
        dir.path(),
        "Specs",
        PrivacyClass::Normal,
        SourceScope::AllCalls,
    );
    let keep = folder(
        &store,
        dir.path(),
        "Other",
        PrivacyClass::Normal,
        SourceScope::AllCalls,
    );
    let c = raw(dir.path());
    seed(
        &c,
        &row.id,
        "doc_a",
        &[("chk_1", "Websocket limits"), ("chk_2", "Retry rules")],
    );
    seed(&c, &keep.id, "doc_b", &[("chk_3", "Websocket keep")]);
    c.execute(
        "INSERT INTO sync_runs (id, source_id, started_at) VALUES ('syn_1', ?1, 1)",
        [row.id.as_str()],
    )
    .unwrap();
    let index = |c: &Connection| {
        [
            "SELECT COUNT(*) FROM sources",
            "SELECT COUNT(*) FROM documents",
            "SELECT COUNT(*) FROM doc_chunks",
            "SELECT COUNT(*) FROM doc_vec",
            "SELECT COUNT(*) FROM doc_chunks_fts WHERE doc_chunks_fts MATCH 'websocket'",
            "SELECT COUNT(*) FROM sync_runs",
        ]
        .map(|sql| count(c, sql))
    };
    assert_eq!(index(&c), [2, 2, 3, 3, 2, 1]);
    let before = changes(&c);

    // A writer failure halfway through the cascade rolls the whole removal back.
    c.execute_batch(
        "CREATE TRIGGER forced BEFORE DELETE ON doc_chunks
         BEGIN SELECT RAISE(ABORT, 'forced'); END",
    )
    .unwrap();
    let failed = noter_knowledge::remove(&store, meta(), &row.id).unwrap_err();
    assert_eq!(failed.code, ErrorCode::Internal);
    assert_eq!(index(&c), [2, 2, 3, 3, 2, 1]);
    assert_eq!(changes(&c), before);

    c.execute_batch("DROP TRIGGER forced").unwrap();
    let removed = noter_knowledge::remove(&store, meta(), &row.id).unwrap();
    assert_eq!(removed, DeleteResult { deleted: 2 });
    assert_eq!(index(&c), [1, 1, 1, 1, 1, 0]);
    let tombstone: (Option<String>, Option<String>, Option<String>, bool) = c
        .query_row(
            "SELECT field, after, delta, undoable FROM changes ORDER BY rowid DESC LIMIT 1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .unwrap();
    assert_eq!(tombstone, (None, None, None, false));
    // Late hits of the removed source resolve to nothing.
    let late = noter_knowledge::permitted_chunks(&c, &[ChunkId::new("chk_1")], &documents(), false)
        .unwrap();
    assert!(late.is_empty());
    assert_eq!(
        noter_knowledge::remove(&store, meta(), &row.id)
            .unwrap_err()
            .code,
        ErrorCode::NotFound
    );
}
