//! Retrieval over a seeded library on the real migrations: synthetic EN/RU/DE calls (TL-35).

use std::sync::{Arc, Mutex};

use noter_db::rusqlite::{params, Connection};
use noter_db::{ChangeMeta, Store};
use noter_jobs::{BoxFuture, Stop};
use noter_protocol::model::*;
use noter_protocol::*;
use tempfile::TempDir;

use crate::retrieve::fuse;
use crate::*;

const DAY: i64 = 86_400_000;
/// 2026-10-01T00:00:00Z.
const OCT_1: i64 = 1_790_812_800_000;

struct Library {
    dir: TempDir,
    store: Arc<Store>,
    db: Connection,
}

fn vector(seed: u32) -> Vec<f32> {
    (0..DIMS as u32)
        .map(|i| (((seed.wrapping_mul(7919) ^ i.wrapping_mul(104_729)) % 997) as f32) / 997.0 - 0.5)
        .collect()
}

fn blob(v: &[f32]) -> Vec<u8> {
    v.iter().flat_map(|x| x.to_le_bytes()).collect()
}

fn library() -> Library {
    library_with_migrations(crate::MIGRATIONS)
}

fn library_with_migrations(migrations: &[noter_db::Migration]) -> Library {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("noter.db");
    let store = Store::open(
        &path,
        &[noter_db::MIGRATIONS, noter_core::MIGRATIONS, migrations],
    )
    .unwrap();
    let db = Connection::open(&path).unwrap();
    db.execute_batch("PRAGMA foreign_keys = ON").unwrap();
    let lib = Library {
        dir,
        store: Arc::new(store),
        db,
    };
    lib.call("call_a", "Backend sync", "planning", "normal", OCT_1);
    lib.call("call_b", "Ретро", "retro", "normal", OCT_1 + 9 * DAY);
    lib.call(
        "call_c",
        "HR one on one",
        "one_on_one",
        "sensitive",
        OCT_1 + 19 * DAY,
    );
    lib.call("call_d", "Planung", "planning", "normal", OCT_1 + 25 * DAY);
    lib.speaker("spk_anna", "call_a", Some("per_anna"), "Anna Petrova");
    lib.speaker("spk_ivan", "call_b", Some("per_ivan"), "Ivan");
    lib.speaker("spk_hr", "call_c", None, "Speaker 1");
    lib.speaker("spk_jonas", "call_d", Some("per_jonas"), "Jonas");
    let en = "We decided to use WebSockets for drawer notifications.";
    let ru = "Мы решили перейти на вебсокеты в ящике уведомлений.";
    lib.segment("seg_a1", "call_a", "spk_anna", 1_000, en, "en");
    lib.segment(
        "seg_a2",
        "call_a",
        "spk_anna",
        5_000,
        "Polling stays for the admin page.",
        "en",
    );
    lib.segment("seg_b1", "call_b", "spk_ivan", 2_000, ru, "ru");
    lib.segment(
        "seg_b2",
        "call_b",
        "spk_ivan",
        7_000,
        "ЁЛКА тоже переедет.",
        "ru",
    );
    let budget = "The websocket budget is confidential.";
    lib.segment("seg_c1", "call_c", "spk_hr", 3_000, budget, "en");
    let de = "Die Entscheidung über die Straße ist vertagt.";
    lib.segment("seg_d1", "call_d", "spk_jonas", 4_000, de, "de");
    let ws = "Use WebSockets for drawer notifications";
    lib.item(
        "itm_ws",
        "call_a",
        "decision",
        ws,
        "en",
        "open",
        "accepted",
        Some("per_anna"),
    );
    let plan = "Подготовить план миграции на вебсокеты";
    lib.item(
        "itm_plan",
        "call_b",
        "action_item",
        plan,
        "ru",
        "open",
        "suggested",
        None,
    );
    let doc = "Entscheidung zur Straße dokumentieren";
    lib.item(
        "itm_done",
        "call_d",
        "action_item",
        doc,
        "de",
        "done",
        "accepted",
        None,
    );
    let no = "Drop websockets entirely";
    lib.item(
        "itm_no", "call_a", "decision", no, "en", "open", "rejected", None,
    );
    lib.db
        .execute_batch(
            "INSERT INTO item_spans (item_id, call_id, channel, t0_ms, t1_ms)
               VALUES ('itm_ws', 'call_a', 'sys', 1000, 4000);
             INSERT INTO call_tags (call_id, tag, tag_norm) VALUES ('call_a', 'Backend', 'backend');",
        )
        .unwrap();
    lib.chunk(
        "chk_a",
        "call_a",
        1_000,
        9_000,
        &format!("Anna Petrova: {en}"),
        Some(1),
    );
    lib.chunk(
        "chk_b",
        "call_b",
        2_000,
        9_000,
        &format!("Ivan: {ru}"),
        Some(2),
    );
    lib.chunk(
        "chk_c",
        "call_c",
        3_000,
        4_000,
        &format!("Speaker 1: {budget}"),
        Some(3),
    );
    lib
}

impl Library {
    fn call(&self, id: &str, title: &str, call_type: &str, privacy: &str, started: i64) {
        self.db
            .execute(
                "INSERT INTO calls (id, rev, started_at, ended_at, title, call_type, privacy_class,
                                    status, mode_used)
                 VALUES (?1, 1, ?2, ?3, ?4, ?5, ?6, 'ready', 'cloud')",
                params![id, started, started + 3_600_000, title, call_type, privacy],
            )
            .unwrap();
    }

    fn speaker(&self, id: &str, call: &str, person: Option<&str>, name: &str) {
        self.db
            .execute(
                "INSERT INTO speakers (id, call_id, label, n, channel, person_id, name, pass)
                 VALUES (?1, ?2, 'speaker_1', 1, 'sys', ?3, ?4, 'archive')",
                params![id, call, person, name],
            )
            .unwrap();
    }

    fn segment(&self, id: &str, call: &str, speaker: &str, t0: i64, text: &str, lang: &str) {
        // As capture stores it: `transcript::shadow` folds case, ё and ß.
        let norm = text.to_lowercase().replace('ё', "е").replace('ß', "ss");
        self.db
            .execute(
                "INSERT INTO segments (id, call_id, speaker_id, channel, t0_ms, t1_ms, text,
                                       text_norm, lang, pass)
                 VALUES (?1, ?2, ?3, 'sys', ?4, ?5, ?6, ?7, ?8, 'archive')",
                params![id, call, speaker, t0, t0 + 3_000, text, norm, lang],
            )
            .unwrap();
    }

    #[allow(clippy::too_many_arguments)]
    fn item(
        &self,
        id: &str,
        call: &str,
        kind: &str,
        text: &str,
        lang: &str,
        status: &str,
        review: &str,
        owner: Option<&str>,
    ) {
        self.db
            .execute(
                "INSERT INTO items (id, rev, call_id, kind, text, lang, owner_person_id, status,
                                    review_state, created_by)
                 VALUES (?1, 1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'llm')",
                params![id, call, kind, text, lang, owner, status, review],
            )
            .unwrap();
    }

    fn chunk(&self, id: &str, call: &str, t0: i64, t1: i64, body: &str, seed: Option<u32>) {
        let text = format!("Call: header\n{body}");
        let norm = text.to_lowercase().replace('ё', "е").replace('ß', "ss");
        self.db
            .execute(
                "INSERT INTO chunks (id, call_id, t0_ms, t1_ms, text, text_norm, token_count,
                                     embedding)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, 20, ?7)",
                params![id, call, t0, t1, text, norm, seed.map(|s| blob(&vector(s)))],
            )
            .unwrap();
    }

    fn count(&self, sql: &str) -> i64 {
        self.db.query_row(sql, [], |r| r.get(0)).unwrap()
    }

    fn find(&self, q: Query) -> Retrieved {
        retrieve(&self.db, &prepare(q).unwrap(), &NoDocuments).unwrap()
    }

    fn path(&self) -> std::path::PathBuf {
        self.dir.path().join("noter.db")
    }
}

fn query(text: &str) -> Query {
    Query {
        text: text.into(),
        wanted: 20,
        ..Query::default()
    }
}

fn ids(hits: &[Hit]) -> Vec<String> {
    hits.iter()
        .map(|h| match &h.evidence {
            Evidence::Segment(id) => id.0.clone(),
            Evidence::Chunk(id) => id.0.clone(),
            Evidence::Item(id) => id.0.clone(),
            Evidence::Document { chunk_id, .. } => chunk_id.0.clone(),
        })
        .collect()
}

#[test]
fn the_triggers_keep_keyword_shadows_and_vectors_current() {
    let lib = library();
    assert_eq!(lib.count("SELECT count(*) FROM segments_fts"), 6);
    assert_eq!(lib.count("SELECT count(*) FROM items_fts"), 4);
    // A chunk with an embedding lands in `chunk_vec` as it is written; one without does not.
    assert_eq!(lib.count("SELECT count(*) FROM chunk_vec"), 3);
    lib.chunk("chk_none", "call_d", 4_000, 7_000, "Jonas: nichts", None);
    assert_eq!(lib.count("SELECT count(*) FROM chunk_vec"), 3);
    assert_eq!(lib.count("SELECT count(*) FROM chunks_fts"), 4);
    // An edit moves the shadow; a delete removes it with the vector.
    lib.db
        .execute(
            "UPDATE segments SET text = 'Kafka instead', text_norm = 'kafka instead'
             WHERE id = 'seg_a2'",
            [],
        )
        .unwrap();
    assert_eq!(ids(&lib.find(query("kafka")).calls), ["seg_a2"]);
    assert!(lib.find(query("polling")).calls.is_empty());
    lib.db
        .execute("DELETE FROM chunks WHERE id = 'chk_a'", [])
        .unwrap();
    assert_eq!(lib.count("SELECT count(*) FROM chunk_vec"), 2);
    assert_eq!(lib.count("SELECT count(*) FROM chunks_fts"), 3);
    // An item whose text changes loses its vector: the rebuild embeds it again.
    lib.db
        .execute(
            "INSERT INTO item_vec (item_id, embedding, call_id, started_at)
             VALUES ('itm_ws', ?1, 'call_a', 0)",
            params![blob(&vector(9))],
        )
        .unwrap();
    // A write that leaves the text as it was keeps the vector.
    lib.db
        .execute(
            "UPDATE items SET text = text, status = 'done' WHERE id = 'itm_ws'",
            [],
        )
        .unwrap();
    assert_eq!(lib.count("SELECT count(*) FROM item_vec"), 1);
    lib.db
        .execute("UPDATE items SET text = 'Use SSE' WHERE id = 'itm_ws'", [])
        .unwrap();
    assert_eq!(lib.count("SELECT count(*) FROM item_vec"), 0);
    assert_eq!(ids(&lib.find(query("sse")).items), ["itm_ws"]);
    // A word that starts a line (a chunk's later speaker lines) is a word start too.
    lib.chunk(
        "chk_lines",
        "call_d",
        9_000,
        12_000,
        "Jonas: eins\nLena: zwei",
        None,
    );
    assert_eq!(ids(&lib.find(query("lena")).calls), ["chk_lines"]);
    // An item with two spans at the same earliest time is still one hit.
    lib.db
        .execute(
            "INSERT INTO item_spans (item_id, call_id, channel, t0_ms, t1_ms)
             VALUES ('itm_ws', 'call_b', 'mic', 1000, 2000)",
            [],
        )
        .unwrap();
    assert_eq!(ids(&lib.find(query("sse")).items), ["itm_ws"]);
}

// cpt-noter-algo-core-retrieval-ask-retrieve: inst-retrieve-keywords
#[test]
fn keywords_find_words_after_punctuation() {
    let lib = library();
    for (i, (text, term)) in [
        ("**Kubernetes** rollout", "kubernetes"),
        ("`websocket`", "websocket"),
        ("[Runbook](url)", "runbook"),
        ("noter.db", "db"),
        ("'quoted'", "quoted"),
        ("noter_db::Store", "store"),
        ("noter_db::Store", "db"),
        ("user@example.com", "example"),
        ("\tindented", "indented"),
        ("—Überblick", "überblick"),
        ("🙂Решили", "решили"),
    ]
    .iter()
    .enumerate()
    {
        let segment = format!("seg_punctuation_{i}");
        let item = format!("itm_punctuation_{i}");
        let chunk = format!("chk_punctuation_{i}");
        lib.segment(&segment, "call_a", "spk_anna", 20_000, text, "en");
        lib.item(
            &item, "call_a", "decision", text, "en", "open", "accepted", None,
        );
        lib.chunk(&chunk, "call_a", 20_000, 23_000, text, None);
        let found = lib.find(query(term));
        assert!(ids(&found.items).contains(&item), "item: {text:?} / {term}");
        for (table, index, id) in [
            ("segments", "segments_fts", &segment),
            ("chunks", "chunks_fts", &chunk),
        ] {
            let expression = crate::normalize::match_expr(&terms(&normalize(term))).unwrap();
            let hits: i64 = lib
                .db
                .query_row(
                    &format!(
                        "SELECT count(*) FROM {index} WHERE {index} MATCH ?1
                           AND rowid = (SELECT rowid FROM {table} WHERE id = ?2)"
                    ),
                    params![expression, id],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(hits, 1, "{index}: {text:?} / {term}");
        }
    }
}

#[test]
fn keywords_match_normalized_stems_in_english_russian_and_german() {
    let lib = library();
    let en = lib.find(query("WEBSOCKETS"));
    // BM25: the shorter segment with the term first.
    assert_eq!(ids(&en.calls), ["seg_c1", "seg_a1"]);
    assert_eq!(ids(&en.items), ["itm_ws"]);
    assert!(en
        .calls
        .iter()
        .chain(&en.items)
        .all(|h| h.keyword && !h.semantic));
    assert_eq!(en.calls[1].strength(), MatchStrength::Strong);
    // Russian stems; ё and Ё fold to е on both sides.
    assert_eq!(ids(&lib.find(query("решили")).calls), ["seg_b1"]);
    assert_eq!(ids(&lib.find(query("вебсокетов")).items), ["itm_plan"]);
    assert_eq!(ids(&lib.find(query("ёлки")).calls), ["seg_b2"]);
    // German: ß → ss, and the stem finds the plural.
    assert_eq!(ids(&lib.find(query("Strasse")).calls), ["seg_d1"]);
    assert_eq!(ids(&lib.find(query("Entscheidungen")).calls), ["seg_d1"]);
    // Terms match at word starts only: "socket" is inside "WebSockets", not a word of its own.
    assert!(lib.find(query("socket")).is_empty());
    // A rejected item is never evidence.
    assert!(lib.find(query("entirely")).items.is_empty());
    // Several terms: any of them, the segments with more of them first (BM25).
    let both = lib.find(query("admin websockets"));
    assert_eq!(both.calls.len(), 3);
    assert_eq!(both.normalized, "admin websockets");
    assert_eq!(both.terms, ["admin", "websocket"]);
    // The item hit carries its first span and the call.
    let item = &en.items[0];
    assert_eq!(
        item.target,
        HitTarget::Item {
            item_id: ItemId::new("itm_ws")
        }
    );
    let Provenance::PastCall { call, span } = &item.provenance else {
        panic!("{:?}", item.provenance);
    };
    assert_eq!(
        (call.title.as_str(), span.t0_ms.0, span.channel),
        ("Backend sync", 1_000, Some(AudioChannel::Sys))
    );
}

#[test]
fn filters_narrow_every_section_in_sql() {
    let lib = library();
    let with = |f: CallFilter| {
        let r = lib.find(Query {
            filter: f,
            ..query("websockets вебсокеты Entscheidung")
        });
        let (mut calls, mut items) = (ids(&r.calls), ids(&r.items));
        calls.sort();
        items.sort();
        (calls, items, r.filters_applied)
    };
    let all = with(CallFilter::default());
    assert_eq!(all.0, ["seg_a1", "seg_b1", "seg_c1", "seg_d1"]);
    assert_eq!(all.2, 0);
    let planning = with(CallFilter {
        call_types: vec![CallTypeId(String::from("planning"))],
        ..CallFilter::default()
    });
    assert_eq!(planning.0, ["seg_a1", "seg_d1"]);
    assert_eq!(planning.1, ["itm_done", "itm_ws"]);
    assert_eq!(planning.2, 1);
    let tagged = with(CallFilter {
        tags: vec!["BACKEND".into()],
        ..CallFilter::default()
    });
    assert_eq!(tagged.0, ["seg_a1"]);
    let russian = with(CallFilter {
        languages: vec![Lang::Ru],
        ..CallFilter::default()
    });
    assert_eq!(
        (russian.0, russian.1),
        (vec!["seg_b1".into()], vec!["itm_plan".into()])
    );
    // People: calls where they spoke; items they own or from those calls.
    let anna = with(CallFilter {
        people: vec![PersonId::new("per_anna")],
        ..CallFilter::default()
    });
    assert_eq!(
        (anna.0, anna.1),
        (vec!["seg_a1".into()], vec!["itm_ws".into()])
    );
    let dates = with(CallFilter {
        from: Some(LocalDate("2026-10-10".into())),
        to: Some(LocalDate("2026-10-20".into())),
        ..CallFilter::default()
    });
    assert_eq!(dates.0, ["seg_b1", "seg_c1"]);
    assert_eq!(dates.2, 2);
    // Open items: the calls that have one, and only open items.
    let open = with(CallFilter {
        has_open_items: Some(true),
        ..CallFilter::default()
    });
    assert_eq!(open.0, ["seg_a1", "seg_b1"]);
    assert_eq!(open.1, ["itm_plan", "itm_ws"]);
    let closed = with(CallFilter {
        has_open_items: Some(false),
        ..CallFilter::default()
    });
    assert_eq!(closed.1, ["itm_done"]);
    // Scope: one call, one topic.
    let one = lib.find(Query {
        scope: Scope {
            call_id: Some(CallId::new("call_b")),
            ..Scope::default()
        },
        ..query("вебсокеты websockets")
    });
    assert_eq!(ids(&one.calls), ["seg_b1"]);
    lib.db
        .execute(
            "UPDATE items SET topic_id = 'top_ws' WHERE id = 'itm_ws'",
            [],
        )
        .unwrap();
    let topic = lib.find(Query {
        scope: Scope {
            topic_id: Some(TopicId::new("top_ws")),
            ..Scope::default()
        },
        ..query("websockets")
    });
    assert_eq!(ids(&topic.calls), ["seg_a1"]);
    assert_eq!(ids(&topic.items), ["itm_ws"]);
}

#[test]
fn bad_dates_are_invalid_input_before_any_read() {
    let bad = |from: &str, to: &str| {
        prepare(Query {
            filter: CallFilter {
                from: Some(LocalDate(from.into())),
                to: Some(LocalDate(to.into())),
                ..CallFilter::default()
            },
            ..query("x")
        })
        .unwrap_err()
    };
    let e = bad("2026-02-30", "2026-03-01");
    assert_eq!(e.code, ErrorCode::InvalidInput);
    assert!(
        matches!(e.detail, Some(ErrorDetail::Validation { ref field, .. }) if field == "filter.from")
    );
    let e = bad("2026-03-02", "2026-03-01");
    assert!(matches!(
        e.detail,
        Some(ErrorDetail::Validation { ref field, rule: error::ValidationRule::OutOfRange })
            if field == "filter.to"
    ));
    assert!(prepare(query("x")).is_ok());
}

#[test]
fn cloud_requests_skip_sensitive_calls_and_count_them() {
    let lib = library();
    lib.item(
        "itm_sensitive",
        "call_c",
        "decision",
        "websocket budget approved",
        "en",
        "open",
        "accepted",
        None,
    );
    lib.db
        .execute(
            "INSERT INTO item_vec (item_id, embedding, call_id, started_at)
             VALUES ('itm_sensitive', ?1, 'call_c', ?2)",
            params![blob(&vector(3)), OCT_1 + 19 * DAY],
        )
        .unwrap();
    let local = lib.find(query("websocket budget"));
    assert!(ids(&local.calls).contains(&"seg_c1".to_owned()));
    assert!(ids(&local.items).contains(&"itm_sensitive".to_owned()));
    assert_eq!(local.sensitive_skipped, 0);
    let cloud = lib.find(Query {
        privacy: Privacy::Cloud,
        vector: Some(vector(3)),
        ..query("websocket budget")
    });
    assert!(!ids(&cloud.calls)
        .iter()
        .any(|id| id == "seg_c1" || id == "chk_c"));
    assert!(!ids(&cloud.items).contains(&"itm_sensitive".to_owned()));
    // One sensitive call, however many of its rows matched.
    assert_eq!(cloud.sensitive_skipped, 1);
}

#[test]
fn calls_only_scope_leaves_documents_out() {
    struct OneDoc;
    impl DocumentSource for OneDoc {
        fn permitted_chunks(
            &self,
            _: &Connection,
            q: &DocQuery<'_>,
        ) -> noter_db::rusqlite::Result<DocHits> {
            assert_eq!(q.fts, "\" websocket\"");
            let target = HitTarget::Document {
                document_id: DocumentId::new("doc_1"),
                chunk_id: ChunkId::new("chk_doc"),
            };
            let doc = Hit {
                evidence: Evidence::Document {
                    document_id: DocumentId::new("doc_1"),
                    chunk_id: ChunkId::new("chk_doc"),
                },
                target,
                title: "ADR".into(),
                text: "WebSockets".into(),
                lang: Some(Lang::En),
                call: None,
                provenance: Provenance::Jira {
                    key: "X".into(),
                    url: None,
                    looked_up_at: TimestampMs(0),
                },
                keyword: false,
                semantic: false,
                score: 0.0,
            };
            Ok(DocHits {
                keyword: vec![doc],
                semantic: vec![],
                sensitive_skipped: 2,
            })
        }
    }
    let lib = library();
    let run = |include_documents| {
        let p = prepare(Query {
            scope: Scope {
                include_documents,
                ..Scope::default()
            },
            ..query("websockets")
        })
        .unwrap();
        retrieve(&lib.db, &p, &OneDoc).unwrap()
    };
    let with = run(true);
    assert_eq!(ids(&with.documents), ["chk_doc"]);
    assert!(with.documents[0].keyword);
    assert_eq!(with.sensitive_skipped, 2);
    let without = run(false);
    assert!(without.documents.is_empty());
    assert_eq!(without.sensitive_skipped, 0);
}

fn hit(id: &str, call: &str, t0: u32, t1: u32) -> Hit {
    let span = TimeSpan {
        call_id: CallId::new(call),
        channel: None,
        t0_ms: OffsetMs(t0),
        t1_ms: OffsetMs(t1),
    };
    let call = CallRef {
        id: CallId::new(call),
        title: "t".into(),
        started_at: TimestampMs(0),
        call_type: CallTypeId(String::from("planning")),
    };
    Hit {
        evidence: if id.starts_with("chk") {
            Evidence::Chunk(ChunkId::new(id))
        } else {
            Evidence::Segment(SegmentId::new(id))
        },
        target: HitTarget::Segment { span: span.clone() },
        title: "t".into(),
        text: id.into(),
        lang: None,
        call: Some(call.clone()),
        provenance: Provenance::PastCall { call, span },
        keyword: false,
        semantic: false,
        score: 0.0,
    }
}

#[test]
fn reciprocal_rank_fusion_orders_and_deduplicates_evidence() {
    let fused = fuse(vec![
        (
            vec![hit("seg_1", "c", 0, 10), hit("seg_2", "c", 20, 30)],
            true,
        ),
        (
            vec![hit("chk_x", "d", 0, 99), hit("chk_y", "c", 5, 25)],
            true,
        ),
        (
            vec![hit("chk_z", "e", 0, 9), hit("chk_x", "d", 0, 99)],
            false,
        ),
    ]);
    // chk_y overlaps seg_1 (the first such hit) and folds into it; chk_x is in two rankings.
    assert_eq!(ids(&fused), ["seg_1", "chk_x", "chk_z", "seg_2"]);
    let k = RRF_K;
    let two = 1.0 / (k + 1.0) + 1.0 / (k + 2.0);
    assert!((fused[0].score - two).abs() < 1e-12);
    assert!((fused[1].score - two).abs() < 1e-12);
    assert_eq!(fused[1].strength(), MatchStrength::Strong);
    assert!(fused[1].semantic && fused[1].keyword);
    // Semantic only: weak.
    assert_eq!(fused[2].strength(), MatchStrength::Weak);
    assert!(fused[2].semantic);
    // A different call never folds, however the spans compare.
    let apart = fuse(vec![
        (vec![hit("seg_1", "c", 0, 10)], true),
        (vec![hit("chk_q", "q", 0, 10)], false),
    ]);
    assert_eq!(apart.len(), 2);
}

#[test]
fn vectors_add_weak_cross_language_hits_and_keyword_only_has_none() {
    let lib = library();
    // The query's vector equals call_b's chunk: a semantic hit without a keyword one.
    let hybrid = lib.find(Query {
        vector: Some(vector(2)),
        ..query("notifications")
    });
    assert_eq!(ids(&hybrid.calls), ["seg_a1", "chk_b"]);
    let chunk = &hybrid.calls[1];
    assert_eq!(chunk.strength(), MatchStrength::Weak);
    assert_eq!(chunk.lang, Some(Lang::Ru));
    assert_eq!(
        chunk.text,
        "Ivan: Мы решили перейти на вебсокеты в ящике уведомлений."
    );
    assert_eq!(hybrid.semantic_hits, 1);
    // Keyword-only: no vector, no semantic hits.
    let keyword = lib.find(query("notifications"));
    assert_eq!(keyword.semantic_hits, 0);
    assert_eq!(ids(&keyword.calls), ["seg_a1"]);
    // A semantic hit inside a keyword hit's span folds into it.
    let both = lib.find(Query {
        vector: Some(vector(1)),
        ..query("notifications")
    });
    assert_eq!(ids(&both.calls), ["seg_a1"]);
    assert!(both.calls[0].keyword && both.calls[0].semantic);
    // Dates reach the vector scan too (`started_at` metadata): call_b is before the 20th.
    let later = lib.find(Query {
        vector: Some(vector(2)),
        filter: CallFilter {
            from: Some(LocalDate("2026-10-20".into())),
            ..CallFilter::default()
        },
        ..query("zzz")
    });
    assert!(later.is_empty());
    let earlier = lib.find(Query {
        vector: Some(vector(2)),
        filter: CallFilter {
            to: Some(LocalDate("2026-10-10".into())),
            ..CallFilter::default()
        },
        ..query("zzz")
    });
    assert_eq!(ids(&earlier.calls), ["chk_b"]);
    // Item vectors: once the item has one, it is found by meaning too.
    lib.db
        .execute(
            "INSERT INTO item_vec (item_id, embedding, call_id, started_at)
             VALUES ('itm_plan', ?1, 'call_b', 0)",
            params![blob(&vector(7))],
        )
        .unwrap();
    let items = lib.find(Query {
        vector: Some(vector(7)),
        ..query("migration")
    });
    assert_eq!(ids(&items.items), ["itm_plan"]);
    assert_eq!(items.items[0].strength(), MatchStrength::Weak);
    // Items come first in the ranked list an answer reads.
    let ranked: Vec<String> = items
        .ranked(30)
        .into_iter()
        .map(|h| h.title.clone())
        .collect();
    assert_eq!(ranked[0], "Подготовить план миграции на вебсокеты");
}

#[test]
fn ranked_keeps_call_evidence_when_many_items_match_common_words() {
    let lib = library();
    for i in 0..35 {
        lib.item(
            &format!("itm_common_{i}"),
            "call_a",
            "decision",
            &format!("we decided common item {i}"),
            "en",
            "open",
            "accepted",
            None,
        );
    }
    lib.segment(
        "seg_common_answer",
        "call_b",
        "spk_ivan",
        20_000,
        "We decided the pricing page will show monthly prices.",
        "en",
    );

    let found = lib.find(query("we"));
    let ranked = found.ranked(30);

    assert!(ranked.iter().any(|hit| hit.text.contains("pricing page")));
    assert!(
        ranked
            .iter()
            .filter(|hit| matches!(hit.evidence, Evidence::Item(_)))
            .count()
            <= 10
    );
}

#[test]
fn vector_call_scope_is_applied_before_the_nearest_neighbor_limit() {
    let lib = library();
    let query_vector = vector(991);
    let target = query_vector.iter().map(|x| x + 0.001).collect::<Vec<_>>();
    for i in 0..100 {
        let id = format!("chk_decoy_{i}");
        lib.chunk(&id, "call_a", 20_000, 23_000, "unrelated decoy", None);
        lib.db
            .execute(
                "INSERT INTO chunk_vec (chunk_id, embedding, call_id, started_at)
                 VALUES (?1, ?2, 'call_a', ?3)",
                params![id, blob(&query_vector), OCT_1],
            )
            .unwrap();
    }
    lib.chunk(
        "chk_scoped_target",
        "call_b",
        20_000,
        23_000,
        "scoped answer",
        None,
    );
    lib.db
        .execute(
            "INSERT INTO chunk_vec (chunk_id, embedding, call_id, started_at)
             VALUES ('chk_scoped_target', ?1, 'call_b', ?2)",
            params![blob(&target), OCT_1 + 9 * DAY],
        )
        .unwrap();

    let found = lib.find(Query {
        vector: Some(target),
        wanted: 1,
        scope: Scope {
            call_id: Some(CallId::new("call_b")),
            ..Scope::default()
        },
        ..query("semantic answer")
    });

    assert!(ids(&found.calls).contains(&"chk_scoped_target".to_owned()));
}

#[test]
fn archiving_a_call_removes_live_segments_from_the_keyword_index() {
    let lib = library();
    lib.call("call_live_only", "Live only", "planning", "normal", OCT_1);
    lib.speaker("spk_live_only", "call_live_only", None, "Speaker 1");
    let existing = lib.count("SELECT count(*) FROM segments_fts");
    lib.db
        .execute(
            "INSERT INTO segments (id, call_id, speaker_id, channel, t0_ms, t1_ms, text,
                               text_norm, lang, pass)
         VALUES ('seg_live_only', 'call_live_only', 'spk_live_only', 'sys', 30_000, 33_000,
                 'transientphrase live', 'transientphrase live', 'en', 'live')",
            [],
        )
        .unwrap();
    assert_eq!(lib.count("SELECT count(*) FROM segments_fts"), existing + 1);

    lib.segment(
        "seg_archive_switch",
        "call_live_only",
        "spk_live_only",
        30_000,
        "archived replacement",
        "en",
    );

    assert_eq!(lib.count("SELECT count(*) FROM segments_fts"), existing + 1);
    assert!(!ids(&lib.find(query("transientphrase")).calls).contains(&"seg_live_only".to_owned()));
}

#[test]
fn active_transcript_migration_rebuilds_existing_keyword_rows() {
    let lib = library_with_migrations(&crate::MIGRATIONS[..4]);
    lib.call("call_upgrade", "Upgrade", "planning", "normal", OCT_1);
    lib.speaker("spk_upgrade", "call_upgrade", None, "Speaker 1");
    lib.db
        .execute_batch(
            "INSERT INTO segments (id, call_id, speaker_id, channel, t0_ms, t1_ms, text,
                               text_norm, lang, pass)
         VALUES ('seg_old_live', 'call_upgrade', 'spk_upgrade', 'sys', 1, 2,
                 'oldtranscript live', 'oldtranscript live', 'en', 'live');
         INSERT INTO segments (id, call_id, speaker_id, channel, t0_ms, t1_ms, text,
                               text_norm, lang, pass)
         VALUES ('seg_new_archive', 'call_upgrade', 'spk_upgrade', 'sys', 1, 2,
                 'newtranscript archive', 'newtranscript archive', 'en', 'archive');",
        )
        .unwrap();
    assert_eq!(
        lib.count(
            "SELECT count(*) FROM segments_fts WHERE segments_fts MATCH '\" oldtranscript\"'"
        ),
        1
    );

    let path = lib.path();
    let Library { dir, store, db } = lib;
    drop(db);
    drop(store);
    let store = Store::open(
        &path,
        &[
            noter_db::MIGRATIONS,
            noter_core::MIGRATIONS,
            crate::MIGRATIONS,
        ],
    )
    .unwrap();
    let lib = Library {
        dir,
        store: Arc::new(store),
        db: Connection::open(path).unwrap(),
    };

    assert!(ids(&lib.find(query("oldtranscript")).calls).is_empty());
    assert_eq!(
        ids(&lib.find(query("newtranscript")).calls),
        ["seg_new_archive"]
    );
}

fn args(query: &str, limit: Option<u32>) -> SearchArgs {
    SearchArgs {
        query: query.into(),
        filter: CallFilter::default(),
        limit,
    }
}

fn run_search(lib: &Library, p: &Prepared, mode: SearchMode) -> SearchResults {
    search(&lib.db, p.text(), p, mode, &NoDocuments).unwrap()
}

#[test]
fn search_sections_explain_strength_and_validate_limits() {
    let lib = library();
    for limit in [0, MAX_LIMIT + 1] {
        let e = search_request(&args("x", Some(limit))).unwrap_err();
        assert_eq!(e.code, ErrorCode::InvalidInput);
    }
    let p = search_request(&args("WebSockets", None)).unwrap();
    assert_eq!(p.wanted(), DEFAULT_LIMIT as usize);
    let r = run_search(&lib, &p, SearchMode::Hybrid);
    assert_eq!(r.query, "WebSockets");
    assert_eq!((r.calls.len(), r.items.len(), r.documents.len()), (2, 1, 0));
    assert!(!r.only_weak);
    assert_eq!(r.explain.normalized_query, "websockets");
    assert_eq!((r.explain.keyword_hits, r.explain.semantic_hits), (3, 0));
    let first = &r.calls[1];
    assert_eq!(first.title, "Backend sync");
    let h = first.highlights[0];
    let utf16: Vec<u16> = first.snippet.encode_utf16().collect();
    assert_eq!(
        String::from_utf16_lossy(&utf16[h.start as usize..h.end as usize]),
        "WebSockets"
    );
    assert!(!first.cross_language);
    // No hits: empty sections, not weak.
    let none = run_search(
        &lib,
        &search_request(&args("zzz", None)).unwrap(),
        SearchMode::Hybrid,
    );
    assert!(none.calls.is_empty() && none.items.is_empty() && none.topics.is_empty());
    assert!(!none.only_weak);
    // Only weak hits: said so, and the semantic hit in Russian is a cross-language match.
    let p = search_request(&args("zzz", Some(5)))
        .unwrap()
        .with_vector(Some(vector(2)));
    let weak = run_search(&lib, &p, SearchMode::Hybrid);
    assert_eq!(weak.calls.len(), 1);
    assert!(weak.only_weak);
    assert!(weak.calls[0].cross_language);
    assert_eq!(weak.calls[0].strength, MatchStrength::Weak);
    // Keyword-only mode is reported as given.
    let mode = SearchMode::KeywordOnly {
        rebuild_progress: 0.5,
    };
    let r = run_search(
        &lib,
        &search_request(&args("x", None)).unwrap(),
        mode.clone(),
    );
    assert_eq!(r.mode, mode);
    // Topics whose name or alias a term starts.
    lib.db
        .execute_batch(
            "INSERT INTO topics (id, rev, name, first_seen, last_seen)
               VALUES ('top_ws', 2, 'Drawer notifications', 0, 5);
             INSERT INTO topic_aliases (topic_id, alias) VALUES ('top_ws', 'Вебсокеты');
             UPDATE items SET topic_id = 'top_ws' WHERE id IN ('itm_ws', 'itm_plan');",
        )
        .unwrap();
    let r = run_search(
        &lib,
        &search_request(&args("вебсокет", None)).unwrap(),
        SearchMode::Hybrid,
    );
    assert_eq!(r.topics.len(), 1);
    let t = &r.topics[0];
    assert_eq!(
        (t.name.as_str(), t.rev, t.calls, t.decisions, t.open_items),
        ("Drawer notifications", Rev(2), 2, 1, 2)
    );
    assert_eq!(t.aliases, ["Вебсокеты"]);
}

#[test]
fn presets_come_from_the_library() {
    let lib = library();
    let types: Vec<CallTypeInfo> = [("planning", "Planning"), ("retro", "Retro")]
        .into_iter()
        .map(|(id, label)| CallTypeInfo {
            id: CallTypeId(String::from(id)),
            label: label.into(),
            builtin: true,
            skill_path: String::new(),
        })
        .collect();
    lib.db
        .execute_batch(
            "INSERT INTO topics (id, rev, name, first_seen, last_seen)
               VALUES ('top_ws', 1, 'Drawer', 0, 5)",
        )
        .unwrap();
    let now = TimestampMs(OCT_1 + 30 * DAY);
    let list = scope_presets(&lib.db, now, &types).unwrap();
    let ids: Vec<&str> = list.presets.iter().map(|p| p.id.as_str()).collect();
    assert_eq!(
        ids,
        [
            "all",
            "calls_only",
            "last_30_days",
            "type:planning",
            "type:retro",
            "person:per_anna",
            "person:per_ivan",
            "person:per_jonas",
            "topic:top_ws",
            "call:call_d"
        ]
    );
    let by = |id: &str| list.presets.iter().find(|p| p.id == id).unwrap();
    assert!(by("all").scope.include_documents);
    assert!(!by("calls_only").scope.include_documents);
    assert_eq!(
        by("last_30_days").scope.from,
        Some(LocalDate("2026-10-01".into()))
    );
    assert_eq!(
        by("type:planning").label,
        "Planning calls in the last 30 days"
    );
    assert_eq!(by("person:per_anna").label, "Calls with Anna Petrova");
    assert_eq!(by("call:call_d").scope.call_id, Some(CallId::new("call_d")));
    assert_eq!(
        by("topic:top_ws").scope.preset.as_deref(),
        Some("topic:top_ws")
    );
}

/// A rebuild run without a scheduler: every boundary passes, every batch is a job's change.
struct TestRun;

impl Run for TestRun {
    fn checkpoint(&mut self) -> BoxFuture<'_, Result<(), Stop>> {
        Box::pin(async { Ok(()) })
    }

    fn change_meta(&self, summary: &str) -> Option<ChangeMeta> {
        Some(ChangeMeta {
            actor: Actor::Job {
                job_id: JobId::new("job_index_rebuild"),
                name: "Index rebuild".into(),
            },
            summary: summary.into(),
            reason: "job".into(),
            evidence_ids: vec![],
            batch_id: None,
            undoable: false,
            surface: None,
        })
    }
}

/// Embeds by text length; can fail, and runs `during` on each call.
#[derive(Default)]
struct Engine {
    fail: bool,
    calls: Mutex<u32>,
    during: Option<Box<dyn Fn(u32) + Send + Sync>>,
}

impl Embedder for Engine {
    fn embed(&self, texts: Vec<String>) -> BoxFuture<'_, Result<Vec<Vec<f32>>, String>> {
        Box::pin(async move {
            let n = {
                let mut calls = self.calls.lock().unwrap();
                *calls += 1;
                *calls
            };
            if let Some(during) = &self.during {
                during(n);
            }
            if self.fail {
                return Err("engine down".into());
            }
            Ok(texts.iter().map(|t| vector(t.len() as u32)).collect())
        })
    }
}

#[tokio::test]
async fn the_rebuild_fills_missing_vectors_reconciles_edits_and_reports_readiness() {
    let lib = library();
    lib.db.execute("DELETE FROM chunk_vec", []).unwrap();
    assert!(stale(&lib.db).unwrap());
    // Three chunks and three items need vectors (a rejected item never does).
    assert_eq!(missing(&lib.db).unwrap(), (3, 3));
    let index = Index::default();
    assert_eq!(
        index.mode(),
        SearchMode::KeywordOnly {
            rebuild_progress: 0.0
        }
    );
    // While the first item batch is embedded an item is edited: no vector is stored for its old
    // text, and the second pass embeds the new one.
    let path = lib.path();
    let engine = Engine {
        during: Some(Box::new(move |n| {
            if n == 1 {
                let c = Connection::open(&path).unwrap();
                c.execute(
                    "UPDATE items SET text = 'Use SSE instead' WHERE id = 'itm_ws'",
                    [],
                )
                .unwrap();
            }
        })),
        ..Engine::default()
    };
    rebuild(&lib.store, &engine, &index, &mut TestRun)
        .await
        .unwrap();
    assert_eq!(index.readiness(), Readiness::Hybrid);
    assert_eq!(index.mode(), SearchMode::Hybrid);
    assert_eq!(*engine.calls.lock().unwrap(), 2);
    assert!(!stale(&lib.db).unwrap());
    assert_eq!(lib.count("SELECT count(*) FROM chunk_vec"), 3);
    assert_eq!(lib.count("SELECT count(*) FROM item_vec"), 3);
    let stored: Vec<u8> = lib
        .db
        .query_row(
            "SELECT embedding FROM item_vec WHERE item_id = 'itm_ws'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(stored, blob(&vector("Use SSE instead".len() as u32)));
    // Each batch is one logged, non-undoable job change without content.
    let changes = "SELECT count(*) FROM changes WHERE entity_type = 'index' AND undoable = 0";
    assert_eq!(lib.count(changes), 3);
    // Nothing missing: another run changes nothing.
    rebuild(&lib.store, &engine, &index, &mut TestRun)
        .await
        .unwrap();
    assert_eq!(lib.count(changes), 3);
}

#[tokio::test]
async fn a_failed_batch_keeps_keyword_only_and_a_retry_does_not_duplicate() {
    let lib = library();
    lib.db.execute("DELETE FROM chunk_vec", []).unwrap();
    let index = Index::default();
    index.ready();
    let down = Engine {
        fail: true,
        ..Engine::default()
    };
    let e = rebuild(&lib.store, &down, &index, &mut TestRun)
        .await
        .unwrap_err();
    assert!(matches!(e, Stop::Failed(ref e) if e.code == ErrorCode::Internal));
    // The chunk batch committed before the engine failed; the run stays keyword-only.
    assert_eq!(lib.count("SELECT count(*) FROM chunk_vec"), 3);
    assert_eq!(index.readiness(), Readiness::KeywordOnly { progress: 0.5 });
    rebuild(&lib.store, &Engine::default(), &index, &mut TestRun)
        .await
        .unwrap();
    assert_eq!(index.readiness(), Readiness::Hybrid);
    assert_eq!(lib.count("SELECT count(*) FROM chunk_vec"), 3);
    assert_eq!(lib.count("SELECT count(*) FROM item_vec"), 3);
}

// ── Ask (slice 2): threads, turns and the citation check ──────────────────────────────

fn you(summary: &str) -> ChangeMeta {
    ChangeMeta {
        actor: Actor::You,
        summary: summary.into(),
        reason: "test".into(),
        evidence_ids: vec![],
        batch_id: None,
        undoable: false,
        surface: None,
    }
}

/// The speaker's name as a chip, as the core reads it from the person row.
fn chip(c: &Connection, segment: &SegmentId) -> noter_db::rusqlite::Result<Option<PersonChip>> {
    use noter_db::rusqlite::OptionalExtension;
    c.query_row(
        "SELECT sp.person_id, sp.name FROM segments s JOIN speakers sp ON sp.id = s.speaker_id
         WHERE s.id = ?1 AND sp.person_id IS NOT NULL",
        [segment.as_str()],
        |r| {
            let name: String = r.get(1)?;
            Ok(PersonChip {
                id: PersonId::new(r.get::<_, String>(0)?),
                short_name: name.clone(),
                initials: name.chars().take(1).collect(),
                display_name: name,
                is_you: false,
            })
        },
    )
    .optional()
}

fn cites(n: u16, segments: &[&str], chunks: &[&str]) -> noter_protocol::skills::AnswerCitation {
    noter_protocol::skills::AnswerCitation {
        n,
        segment_ids: segments.iter().map(|s| SegmentId::new(*s)).collect(),
        chunk_ids: chunks.iter().map(|s| ChunkId::new(*s)).collect(),
        quote: "model quote".into(),
    }
}

fn output(
    md: &str,
    citations: Vec<noter_protocol::skills::AnswerCitation>,
) -> noter_protocol::skills::AskAnswerOutput {
    noter_protocol::skills::AskAnswerOutput {
        answer_md: md.into(),
        citations,
        found: true,
    }
}

#[test]
fn ask_citations_resolve_against_the_runs_evidence_and_follow_the_text() {
    let lib = library();
    let found = lib.find(query("websockets drawer"));
    let hits = found.ranked(ASK_HITS);
    let out = output(
        "Use them [7], as Anna said [2]; maybe [5] too. Again [7].",
        vec![
            cites(2, &["seg_a1"], &[]),
            cites(5, &["seg_nowhere"], &[]),
            cites(7, &["itm_ws"], &[]),
            cites(9, &["chk_a"], &[]),
        ],
    );
    let checked = check_answer(&lib.db, &out, &hits, Privacy::Local, &chip).unwrap();
    assert!(checked.found);
    // Numbered as the text first references them; the unknown and the unreferenced go.
    assert_eq!(
        checked.answer_md,
        "Use them [1], as Anna said [2]; maybe  too. Again [1]."
    );
    let ns: Vec<u16> = checked.citations.iter().map(|c| c.n).collect();
    assert_eq!(ns, [1, 2]);
    // Built from the stored evidence, not the model's quote.
    assert_eq!(
        checked.citations[0].quote,
        "Use WebSockets for drawer notifications"
    );
    assert_eq!(
        checked.citations[1].quote,
        "We decided to use WebSockets for drawer notifications."
    );
    assert_eq!(
        checked.citations[1].speaker.as_ref().map(|s| s.id.as_str()),
        Some("per_anna")
    );
    assert_eq!(checked.citations[1].strength, MatchStrength::Strong);
    assert!(matches!(
        &checked.citations[1].provenance,
        Provenance::PastCall { call, .. } if call.id.as_str() == "call_a"
    ));
    assert!(checked.citations.iter().all(|c| !c.deleted));
}

#[test]
fn ask_without_valid_citations_is_not_found() {
    let lib = library();
    let found = lib.find(query("websockets"));
    let hits = found.ranked(ASK_HITS);
    let unknown = output("It was decided [1].", vec![cites(1, &["seg_made_up"], &[])]);
    let checked = check_answer(&lib.db, &unknown, &hits, Privacy::Local, &chip).unwrap();
    assert_eq!(
        (
            checked.found,
            checked.answer_md.as_str(),
            checked.citations.len()
        ),
        (false, NOT_FOUND_MD, 0)
    );
    // The model's own "not found" never keeps its citations.
    let mut said_no = output("Nothing [1].", vec![cites(1, &["seg_a1"], &[])]);
    said_no.found = false;
    let checked = check_answer(&lib.db, &said_no, &hits, Privacy::Local, &chip).unwrap();
    assert!(!checked.found);
}

#[test]
fn ask_cites_sensitive_calls_only_on_the_mac() {
    let lib = library();
    let found = lib.find(query("websocket budget"));
    let hits = found.ranked(ASK_HITS);
    assert!(ids(&found.calls).contains(&"seg_c1".to_owned()));
    let out = output("Confidential [1].", vec![cites(1, &["seg_c1"], &[])]);
    let cloud = check_answer(&lib.db, &out, &hits, Privacy::Cloud, &chip).unwrap();
    assert!(
        !cloud.found,
        "a sensitive call is never cited to a cloud answer"
    );
    let local = check_answer(&lib.db, &out, &hits, Privacy::Local, &chip).unwrap();
    assert!(local.found);
    assert_eq!(
        local.citations[0].speaker, None,
        "an unnamed speaker has no chip"
    );
    // A source gone since retrieval is not cited either.
    lib.db.execute("PRAGMA foreign_keys = OFF", []).unwrap();
    lib.db
        .execute("DELETE FROM segments WHERE id = 'seg_c1'", [])
        .unwrap();
    let gone = check_answer(&lib.db, &out, &hits, Privacy::Local, &chip).unwrap();
    assert!(!gone.found);
}

fn answer(turn: &str, citations: Vec<Citation>, runtime: RuntimeChoice) -> AskAnswer {
    AskAnswer {
        turn_id: AskTurnId::new(turn),
        question: String::new(),
        answer_md: "Use WebSockets [1].".into(),
        citations,
        found: true,
        runtime,
        answered_locally: runtime == RuntimeChoice::Local,
        sensitive_sources_skipped: 2,
        keyword_only: true,
        only_weak_evidence: false,
        asked_at: TimestampMs(0),
    }
}

fn turn(thread: &str, turn: &str, new_thread: bool, question: &str, at: i64) -> NewTurn {
    NewTurn {
        thread_id: AskThreadId::new(thread),
        new_thread,
        turn_id: AskTurnId::new(turn),
        question: question.into(),
        scope: AskScope {
            call_id: Some(CallId::new("call_a")),
            ..AskScope::default()
        },
        now: TimestampMs(at),
    }
}

#[test]
fn ask_threads_keep_turns_in_order_and_mark_deleted_sources() {
    let lib = library();
    let found = lib.find(query("websockets drawer"));
    let hits = found.ranked(ASK_HITS);
    let out = output("Yes [1].", vec![cites(1, &["seg_a1"], &[])]);
    let cited = check_answer(&lib.db, &out, &hits, Privacy::Local, &chip).unwrap();

    begin_turn(
        &lib.store,
        you("ask"),
        turn("ask_1", "turn_1", true, " Websockets? ", OCT_1),
    )
    .unwrap();
    let first = answer(
        "turn_1",
        cited.citations.clone(),
        RuntimeChoice::ClaudeAccount,
    );
    let run = LlmRunId::new("llm_1");
    finish_turn(
        &lib.store,
        you("answer"),
        &AskThreadId::new("ask_1"),
        &first,
        Some(&run),
        Ending::Answered,
        TimestampMs(OCT_1 + 10),
    )
    .unwrap();
    begin_turn(
        &lib.store,
        you("ask"),
        turn("ask_2", "turn_2", true, "Polling?", OCT_1 + 20),
    )
    .unwrap();
    begin_turn(
        &lib.store,
        you("ask"),
        turn("ask_1", "turn_3", false, "And the admin page?", OCT_1 + 30),
    )
    .unwrap();

    let list = threads(&lib.db).unwrap().threads;
    let rows: Vec<(&str, &str, u32)> = list
        .iter()
        .map(|t| (t.id.as_str(), t.title.as_str(), t.turns))
        .collect();
    assert_eq!(
        rows,
        [("ask_1", "Websockets?", 2), ("ask_2", "Polling?", 1)]
    );
    assert_eq!(list[0].updated_at, TimestampMs(OCT_1 + 30));

    let got = thread(&lib.db, &AskThreadId::new("ask_1")).unwrap();
    assert_eq!(
        got.scope.call_id.as_ref().map(CallId::as_str),
        Some("call_a")
    );
    let turns: Vec<&str> = got.turns.iter().map(|t| t.turn_id.as_str()).collect();
    assert_eq!(turns, ["turn_1", "turn_3"]);
    let t1 = &got.turns[0];
    assert_eq!(t1.question, " Websockets? ");
    assert_eq!(
        (t1.found, t1.runtime, t1.answered_locally),
        (true, RuntimeChoice::ClaudeAccount, false)
    );
    assert_eq!(
        (
            t1.sensitive_sources_skipped,
            t1.keyword_only,
            t1.only_weak_evidence
        ),
        (2, true, false)
    );
    assert!(!t1.citations[0].deleted);
    let llm: String = lib
        .db
        .query_row(
            "SELECT llm_run_id FROM ask_turns WHERE id = 'turn_1'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(llm, "llm_1");
    // The pending turn has no answer yet.
    assert_eq!(
        (got.turns[1].answer_md.as_str(), got.turns[1].found),
        ("", false)
    );
    // Change rows name the rows, never the question or the answer.
    let leaked = lib.count("SELECT count(*) FROM changes WHERE coalesce(before, '') || coalesce(after, '') || coalesce(delta, '') LIKE '%ebsocket%'");
    assert_eq!(leaked, 0);

    // A follow-up's context: answered turns before it; a cloud answer of a normal call may go.
    let prior = prior_turns(
        &lib.db,
        &AskThreadId::new("ask_1"),
        &AskTurnId::new("turn_3"),
    )
    .unwrap();
    assert_eq!(prior.len(), 1);
    assert!(!prior[0].sensitive);
    assert_eq!(prior[0].calls, vec![CallId::new("call_a")]);

    lib.db.execute("PRAGMA foreign_keys = OFF", []).unwrap();
    lib.db
        .execute("DELETE FROM calls WHERE id = 'call_a'", [])
        .unwrap();
    let got = thread(&lib.db, &AskThreadId::new("ask_1")).unwrap();
    assert!(got.turns[0].citations[0].deleted, "the cited call is gone");
    let prior = prior_turns(
        &lib.db,
        &AskThreadId::new("ask_1"),
        &AskTurnId::new("turn_3"),
    )
    .unwrap();
    assert!(
        prior[0].sensitive,
        "a turn citing a call that is gone stays on the Mac"
    );
}

#[test]
fn follow_up_rechecks_the_current_privacy_of_cited_documents() {
    let lib = library();
    lib.db
        .execute_batch(
            "CREATE TABLE sources (id TEXT PRIMARY KEY, privacy_class TEXT NOT NULL);
         CREATE TABLE documents (id TEXT PRIMARY KEY, source_id TEXT NOT NULL);
         INSERT INTO sources (id, privacy_class)
         VALUES ('src_1', 'normal');
         INSERT INTO documents (id, source_id) VALUES ('doc_1', 'src_1');",
        )
        .unwrap();
    begin_turn(
        &lib.store,
        you("ask"),
        turn("ask_docs", "turn_1", true, "Plan?", OCT_1),
    )
    .unwrap();
    let first = AskAnswer {
        turn_id: AskTurnId::new("turn_1"),
        question: "Plan?".into(),
        answer_md: "Use the plan [1].".into(),
        citations: vec![Citation {
            n: 1,
            provenance: Provenance::Document {
                source_id: SourceId::new("src_1"),
                document_id: DocumentId::new("doc_1"),
                chunk_id: ChunkId::new("chk_1"),
                title: "Plan".into(),
                section: None,
                source_name: "Docs".into(),
            },
            quote: "Use the plan".into(),
            speaker: None,
            strength: MatchStrength::Strong,
            deleted: false,
        }],
        found: true,
        runtime: RuntimeChoice::ClaudeAccount,
        answered_locally: false,
        sensitive_sources_skipped: 0,
        keyword_only: true,
        only_weak_evidence: false,
        asked_at: TimestampMs(OCT_1),
    };
    finish_turn(
        &lib.store,
        you("answer"),
        &AskThreadId::new("ask_docs"),
        &first,
        None,
        Ending::Answered,
        TimestampMs(OCT_1 + 1),
    )
    .unwrap();
    begin_turn(
        &lib.store,
        you("ask"),
        turn("ask_docs", "turn_2", false, "Follow up", OCT_1 + 2),
    )
    .unwrap();
    let prior = || {
        prior_turns(
            &lib.db,
            &AskThreadId::new("ask_docs"),
            &AskTurnId::new("turn_2"),
        )
        .unwrap()
    };
    assert!(!prior()[0].sensitive);
    lib.db
        .execute(
            "UPDATE sources SET privacy_class = 'sensitive' WHERE id = 'src_1'",
            [],
        )
        .unwrap();
    assert!(prior()[0].sensitive);
    lib.db
        .execute("DELETE FROM sources WHERE id = 'src_1'", [])
        .unwrap();
    assert!(prior()[0].sensitive, "a missing source fails closed");
}

#[test]
fn ask_a_deleted_thread_takes_no_late_answer() {
    let lib = library();
    begin_turn(
        &lib.store,
        you("ask"),
        turn("ask_1", "turn_1", true, "Q", OCT_1),
    )
    .unwrap();
    assert!(delete_thread(&lib.store, you("delete"), &AskThreadId::new("ask_1")).unwrap());
    assert_eq!(lib.count("SELECT count(*) FROM ask_turns"), 0);
    let late = finish_turn(
        &lib.store,
        you("answer"),
        &AskThreadId::new("ask_1"),
        &answer("turn_1", vec![], RuntimeChoice::Local),
        None,
        Ending::Answered,
        TimestampMs(OCT_1),
    );
    assert_eq!(late.unwrap_err().code, ErrorCode::NotFound);
    assert_eq!(lib.count("SELECT count(*) FROM ask_threads"), 0);
    assert!(!delete_thread(&lib.store, you("delete"), &AskThreadId::new("ask_1")).unwrap());
    assert_eq!(
        thread(&lib.db, &AskThreadId::new("ask_1"))
            .unwrap_err()
            .code,
        ErrorCode::NotFound
    );
    // A local answer is never cloud context.
    begin_turn(
        &lib.store,
        you("ask"),
        turn("ask_2", "turn_2", true, "Q", OCT_1),
    )
    .unwrap();
    finish_turn(
        &lib.store,
        you("answer"),
        &AskThreadId::new("ask_2"),
        &answer("turn_2", vec![], RuntimeChoice::Local),
        None,
        Ending::Answered,
        TimestampMs(OCT_1),
    )
    .unwrap();
    let prior = prior_turns(
        &lib.db,
        &AskThreadId::new("ask_2"),
        &AskTurnId::new("turn_next"),
    )
    .unwrap();
    assert!(prior[0].sensitive);
}

#[test]
fn ask_start_checks_the_question_thread_and_scope() {
    let lib = library();
    let args = |thread: Option<&str>, question: &str, scope: AskScope| AskStartArgs {
        thread_id: thread.map(AskThreadId::new),
        question: question.into(),
        scope,
    };
    let code = |a: AskStartArgs| check_start(&lib.db, &a).err().map(|e| e.code);
    assert_eq!(
        code(args(None, "  ", AskScope::default())),
        Some(ErrorCode::InvalidInput)
    );
    assert_eq!(
        code(args(Some("ask_none"), "Q", AskScope::default())),
        Some(ErrorCode::NotFound)
    );
    let call = AskScope {
        call_id: Some(CallId::new("call_none")),
        ..AskScope::default()
    };
    assert_eq!(code(args(None, "Q", call)), Some(ErrorCode::NotFound));
    let topic = AskScope {
        topic_id: Some(TopicId::new("top_none")),
        ..AskScope::default()
    };
    assert_eq!(code(args(None, "Q", topic)), Some(ErrorCode::NotFound));
    let person = AskScope {
        people: vec![PersonId::new("per_none")],
        ..AskScope::default()
    };
    assert_eq!(code(args(None, "Q", person)), Some(ErrorCode::NotFound));
    let fine = AskScope {
        call_id: Some(CallId::new("call_a")),
        // `per_anna` has speaker rows but no `people` row, as presets name people.
        people: vec![PersonId::new("per_you"), PersonId::new("per_anna")],
        ..AskScope::default()
    };
    assert_eq!(code(args(None, "Q", fine.clone())), None);
    // The scope's dates are checked where every retrieval checks them.
    let q = ask_query(
        "Q",
        &AskScope {
            from: Some(LocalDate("2026-13-01".into())),
            ..fine
        },
        Privacy::Cloud,
    );
    assert_eq!(prepare(q).unwrap_err().code, ErrorCode::InvalidInput);
    assert!(only_weak([MatchStrength::Weak, MatchStrength::Weak]));
    assert!(!only_weak([MatchStrength::Weak, MatchStrength::Strong]));
    assert!(!only_weak([]));
}

// ── Topics (slice 3): threads, edits, merge and undo, Keep Separate, attachment ───────

/// An independent direction in [-0.5, 0.5] per seed (xorshift), so cosines between seeds are
/// near 0 and `v + k·noise` has a cosine to `v` of about `1 / sqrt(1 + k²)`.
fn noise(seed: u32) -> Vec<f32> {
    let mut x = seed.wrapping_mul(2_654_435_761) | 1;
    (0..DIMS)
        .map(|_| {
            x ^= x << 13;
            x ^= x >> 17;
            x ^= x << 5;
            (x % 10_000) as f32 / 10_000.0 - 0.5
        })
        .collect()
}

fn plus(v: &[f32], seed: u32, k: f32) -> Vec<f32> {
    v.iter().zip(noise(seed)).map(|(a, b)| a + k * b).collect()
}

fn cos(a: &[f32], b: &[f32]) -> f32 {
    let dot: f32 = a.iter().zip(b).map(|(x, y)| x * y).sum();
    let n = |v: &[f32]| v.iter().map(|x| x * x).sum::<f32>().sqrt();
    dot / (n(a) * n(b))
}

fn writer(summary: &str) -> ChangeMeta {
    ChangeMeta {
        undoable: true,
        ..you(summary)
    }
}

impl Library {
    fn topic(&self, id: &str, name: &str, centroid: Option<&[f32]>, first: i64, last: i64) {
        self.db
            .execute(
                "INSERT INTO topics (id, rev, name, centroid, first_seen, last_seen)
                 VALUES (?1, 1, ?2, ?3, ?4, ?5)",
                params![id, name, centroid.map(blob), first, last],
            )
            .unwrap();
    }

    fn link(&self, topic: &str, items: &[&str], vectors: &[&[f32]]) {
        for (item, v) in items.iter().zip(vectors) {
            self.db
                .execute(
                    "UPDATE items SET topic_id = ?1 WHERE id = ?2",
                    params![topic, item],
                )
                .unwrap();
            self.db
                .execute(
                    "INSERT INTO item_vec (item_id, embedding, call_id, started_at)
                     SELECT i.id, ?2, i.call_id, c.started_at FROM items i
                     JOIN calls c ON c.id = i.call_id WHERE i.id = ?1",
                    params![item, blob(v)],
                )
                .unwrap();
        }
    }

    fn text(&self, sql: &str) -> String {
        self.db.query_row(sql, [], |r| r.get(0)).unwrap()
    }

    fn centroid(&self, topic: &str) -> Option<Vec<f32>> {
        let b: Option<Vec<u8>> = self
            .db
            .query_row("SELECT centroid FROM topics WHERE id = ?1", [topic], |r| {
                r.get(0)
            })
            .unwrap();
        b.map(|b| {
            b.chunks_exact(4)
                .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
                .collect()
        })
    }

    fn aliases(&self, topic: &str) -> Vec<String> {
        self.db
            .prepare("SELECT alias FROM topic_aliases WHERE topic_id = ?1 ORDER BY alias")
            .unwrap()
            .query_map([topic], |r| r.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap()
    }
}

#[test]
fn topics_read_counts_aliases_threads_and_merge_suggestions() {
    let lib = library();
    let ws = noise(1);
    let twin = plus(&ws, 2, 0.2);
    assert!(cos(&ws, &twin) > SUGGEST_SIMILARITY);
    assert!(cos(&ws, &noise(3)) < 0.5);
    lib.topic(
        "top_ws",
        "Drawer notifications",
        Some(&ws),
        OCT_1,
        OCT_1 + 9 * DAY,
    );
    lib.topic(
        "top_notif",
        "Notification service",
        Some(&twin),
        0,
        OCT_1 + 30 * DAY,
    );
    lib.topic(
        "top_road",
        "Street decision",
        Some(&noise(3)),
        0,
        OCT_1 + DAY,
    );
    lib.topic("top_empty", "Nothing left", None, 0, 0);
    lib.db
        .execute_batch(
            "INSERT INTO topic_aliases (topic_id, alias) VALUES ('top_ws', 'Вебсокеты');
             UPDATE items SET topic_id = 'top_ws' WHERE id IN ('itm_ws', 'itm_plan', 'itm_no');
             UPDATE items SET topic_id = 'top_road' WHERE id = 'itm_done';",
        )
        .unwrap();
    let list = topic_list(&lib.db).unwrap();
    let ids: Vec<&str> = list.iter().map(|t| t.id.as_str()).collect();
    assert_eq!(ids, ["top_notif", "top_ws", "top_road", "top_empty"]);
    let ws_row = &list[1];
    // The rejected item counts nowhere.
    assert_eq!(
        (ws_row.calls, ws_row.decisions, ws_row.open_items),
        (2, 1, 2)
    );
    assert_eq!(ws_row.aliases, ["Вебсокеты"]);
    let chip = |t: &TopicRow| {
        t.merge_suggestion
            .as_ref()
            .map(|c| c.id.as_str().to_owned())
    };
    assert_eq!(chip(ws_row).as_deref(), Some("top_notif"));
    assert_eq!(chip(&list[0]).as_deref(), Some("top_ws"));
    assert_eq!(chip(&list[2]), None);
    assert_eq!(
        topic_row(&lib.db, "top_ws")
            .unwrap()
            .unwrap()
            .merge_suggestion,
        ws_row.merge_suggestion
    );
    assert!(topic_row(&lib.db, "top_none").unwrap().is_none());
    // The thread: newest call first, items in their order; an empty topic has none.
    assert_eq!(
        thread_items(&lib.db, "top_ws").unwrap(),
        ["itm_plan", "itm_ws"]
    );
    assert!(thread_items(&lib.db, "top_empty").unwrap().is_empty());

    // Keep Separate: one canonical pair whichever way round, and no suggestion after it.
    let keep = |a: &str, b: &str| {
        let (a, b) = (a.to_owned(), b.to_owned());
        let now = TimestampMs(OCT_1);
        lib.store
            .write_with(you("keep"), move |tx| keep_separate(tx, &a, &b, now))
    };
    keep("top_ws", "top_notif").unwrap();
    keep("top_notif", "top_ws").unwrap();
    assert_eq!(
        lib.text("SELECT key FROM suppressions WHERE kind = 'topic_merge'"),
        "top_notif|top_ws"
    );
    assert_eq!(lib.count("SELECT count(*) FROM suppressions"), 1);
    let list = topic_list(&lib.db).unwrap();
    assert!(list.iter().all(|t| t.merge_suggestion.is_none()));
    let changes = lib.count("SELECT count(*) FROM changes");
    assert_eq!(
        keep("top_ws", "top_ws").unwrap_err().code,
        ErrorCode::InvalidInput
    );
    assert_eq!(
        keep("top_ws", "top_none").unwrap_err().code,
        ErrorCode::NotFound
    );
    // An unknown topic is not_found even paired with itself, as the fake answers it.
    assert_eq!(
        keep("top_none", "top_none").unwrap_err().code,
        ErrorCode::NotFound
    );
    assert_eq!(lib.count("SELECT count(*) FROM changes"), changes);
}

#[test]
fn topic_suggestion_migration_caches_existing_neighbours() {
    let lib = library_with_migrations(&MIGRATIONS[..5]);
    let ws = noise(71);
    let twin = plus(&ws, 72, 0.2);
    lib.topic("top_ws", "Drawer notifications", Some(&ws), 0, 1);
    lib.topic("top_notif", "Notification service", Some(&twin), 0, 1);
    lib.topic("top_empty", "No centroid", None, 0, 1);

    let path = lib.path();
    let Library { dir, store, db } = lib;
    drop(db);
    drop(store);
    let store = Store::open(
        &path,
        &[noter_db::MIGRATIONS, noter_core::MIGRATIONS, MIGRATIONS],
    )
    .unwrap();
    let db = Connection::open(&path).unwrap();
    let lib = Library {
        dir,
        store: Arc::new(store),
        db,
    };

    assert_eq!(
        topic_row(&lib.db, "top_ws")
            .unwrap()
            .unwrap()
            .merge_suggestion
            .unwrap()
            .id
            .as_str(),
        "top_notif"
    );
    assert_eq!(
        lib.count("SELECT count(*) FROM topic_suggestions"),
        lib.count("SELECT count(*) FROM topics")
    );
}

#[test]
fn topic_rename_checks_the_name_and_the_revision() {
    let lib = library();
    lib.topic("top_ws", "Drawer notifications", None, 0, 5);
    let id = TopicId::new("top_ws");
    assert_eq!(
        rename(&id, Rev(1), "   ").unwrap_err().code,
        ErrorCode::InvalidInput
    );
    let done = lib
        .store
        .write(
            rename(&id, Rev(1), " Websockets ").unwrap(),
            writer("rename"),
        )
        .unwrap();
    assert_eq!(done.rev, Rev(2));
    assert_eq!(lib.text("SELECT name FROM topics"), "Websockets");
    let stale = lib
        .store
        .write(rename(&id, Rev(1), "Again").unwrap(), writer("rename"))
        .unwrap_err();
    assert_eq!(stale.code, ErrorCode::Conflict);
    assert_eq!(
        stale.detail,
        Some(ErrorDetail::Conflict {
            current_rev: Rev(2)
        })
    );
    assert_eq!(lib.text("SELECT name FROM topics"), "Websockets");
    assert_eq!(
        lib.text("SELECT field FROM changes WHERE entity_type = 'topic'"),
        "name"
    );
}

#[test]
fn topics_merge_is_one_undoable_batch_that_keeps_the_source_names() {
    let lib = library();
    let (a, b, c) = (noise(1), noise(2), noise(3));
    lib.topic("top_ws", "Websockets", Some(&a), OCT_1, OCT_1 + 9 * DAY);
    lib.topic(
        "top_notif",
        "Notification service",
        Some(&c),
        OCT_1 + 19 * DAY,
        OCT_1 + 25 * DAY,
    );
    lib.link("top_ws", &["itm_ws", "itm_plan"], &[&a, &b]);
    lib.link("top_notif", &["itm_done"], &[&c]);
    lib.db
        .execute_batch(
            "INSERT INTO topic_aliases (topic_id, alias) VALUES ('top_ws', 'Вебсокеты');
             INSERT INTO topic_aliases (topic_id, alias) VALUES ('top_ws', 'Notifications');
             INSERT INTO topic_aliases (topic_id, alias) VALUES ('top_notif', 'notifications');
             INSERT INTO topic_aliases (topic_id, alias) VALUES ('top_notif', 'Push');",
        )
        .unwrap();
    let merge_of = |s: &str, t: &str| {
        let (s, t) = (s.to_owned(), t.to_owned());
        lib.store
            .write_with(writer("merge"), move |tx| merge(tx, &s, &t))
    };
    let changes = lib.count("SELECT count(*) FROM changes");
    assert_eq!(
        merge_of("top_ws", "top_ws").unwrap_err().code,
        ErrorCode::InvalidInput
    );
    assert_eq!(
        merge_of("top_none", "top_ws").unwrap_err().code,
        ErrorCode::NotFound
    );
    assert_eq!(
        merge_of("top_ws", "top_none").unwrap_err().code,
        ErrorCode::NotFound
    );
    assert_eq!(lib.count("SELECT count(*) FROM changes"), changes);

    let done = merge_of("top_notif", "top_ws").unwrap();
    assert_eq!(done.value, ["itm_done"]);
    assert_eq!(
        lib.count("SELECT count(*) FROM topics WHERE id = 'top_notif'"),
        0
    );
    assert_eq!(
        lib.count("SELECT count(*) FROM items WHERE topic_id = 'top_ws'"),
        3
    );
    // The source's name and its aliases stay findable on the target, once each.
    assert_eq!(
        lib.aliases("top_ws"),
        ["Notification service", "Notifications", "Push", "Вебсокеты"]
    );
    let row = topic_row(&lib.db, "top_ws").unwrap().unwrap();
    assert_eq!(
        (row.rev, row.last_seen),
        (Rev(2), TimestampMs(OCT_1 + 25 * DAY))
    );
    assert_eq!(
        lib.count("SELECT first_seen FROM topics WHERE id = 'top_ws'"),
        OCT_1
    );
    let mean: Vec<f32> = (0..DIMS).map(|i| (a[i] + b[i] + c[i]) / 3.0).collect();
    assert!(cos(&lib.centroid("top_ws").unwrap(), &mean) > 0.999);
    // One batch: undo puts every link, alias and row back.
    let batch = done.batch_id.expect("a merge is one batch");
    let undone = lib
        .store
        .reverse(
            noter_db::Direction::Undo,
            noter_db::Handle::Batch(batch),
            OCT_1,
        )
        .unwrap();
    assert_eq!(undone.skipped, 0);
    assert_eq!(
        lib.text("SELECT name FROM topics WHERE id = 'top_notif'"),
        "Notification service"
    );
    assert_eq!(lib.aliases("top_notif"), ["Push", "notifications"]);
    assert_eq!(lib.aliases("top_ws"), ["Notifications", "Вебсокеты"]);
    assert_eq!(
        lib.text("SELECT topic_id FROM items WHERE id = 'itm_done'"),
        "top_notif"
    );
    let row = topic_row(&lib.db, "top_ws").unwrap().unwrap();
    assert_eq!(
        (row.rev, row.last_seen),
        (Rev(1), TimestampMs(OCT_1 + 9 * DAY))
    );
    // Centroids are derived from the items' vectors: refreshed after the undo.
    refresh_centroids(&lib.db, &["top_notif".into(), "top_ws".into()]).unwrap();
    assert!(cos(&lib.centroid("top_notif").unwrap(), &c) > 0.999);
    let pair: Vec<f32> = (0..DIMS).map(|i| (a[i] + b[i]) / 2.0).collect();
    assert!(cos(&lib.centroid("top_ws").unwrap(), &pair) > 0.999);
}

fn new_item(id: &str, text: &str, hint: Option<&str>, vector: Vec<f32>) -> NewItem {
    NewItem {
        id: id.into(),
        text: text.into(),
        hint: hint.map(String::from),
        vector,
    }
}

#[test]
fn attachment_joins_the_nearest_topic_above_the_threshold_or_names_a_new_one() {
    let lib = library();
    let started = OCT_1 + 30 * DAY;
    lib.call("call_e", "Weekly", "planning", "normal", started);
    let ws = noise(1);
    let twin = plus(&ws, 2, 0.3);
    lib.topic("top_ws", "Websockets", Some(&ws), OCT_1, OCT_1 + 9 * DAY);
    lib.topic(
        "top_twin",
        "Socket push",
        Some(&twin),
        OCT_1,
        OCT_1 + 2 * DAY,
    );
    lib.link("top_ws", &["itm_ws"], &[&ws]);
    lib.link("top_twin", &["itm_plan"], &[&twin]);
    let texts = [
        ("itm_e1", "Ship the drawer over websockets"),
        ("itm_e2", "Budget review"),
        ("itm_e3", "Move the release to Friday, after QA signs off"),
        ("itm_e4", "Budget numbers by Monday"),
        ("itm_e5", "Something loosely related"),
    ];
    for (id, text) in texts {
        lib.item(
            id,
            "call_e",
            "action_item",
            text,
            "en",
            "open",
            "suggested",
            None,
        );
    }
    let near = plus(&ws, 5, 0.6);
    let far = plus(&ws, 6, 1.0);
    assert!(cos(&near, &ws) >= ATTACH_SIMILARITY && cos(&near, &ws) > cos(&near, &twin));
    assert!(cos(&far, &ws) < ATTACH_SIMILARITY && cos(&far, &twin) < ATTACH_SIMILARITY);
    let budget = noise(7);
    let items = vec![
        new_item(
            "itm_e1",
            texts[0].1,
            Some("Ignored: it joins a topic"),
            near.clone(),
        ),
        new_item("itm_e2", texts[1].1, Some(" Budget "), budget.clone()),
        new_item("itm_e3", texts[2].1, None, noise(9)),
        // Joins the topic the item before it started in this same call.
        new_item("itm_e4", texts[3].1, None, plus(&budget, 11, 0.1)),
        new_item("itm_e5", texts[4].1, Some("  "), far),
    ];
    let done = lib
        .store
        .write_with(writer("topics"), move |tx| {
            attach_topics(tx, "call_e", &items)
        })
        .unwrap();
    let topic_of = |item: &str| {
        lib.text(&format!(
            "SELECT t.name FROM items i JOIN topics t ON t.id = i.topic_id WHERE i.id = '{item}'"
        ))
    };
    assert_eq!(topic_of("itm_e1"), "Websockets");
    assert_eq!(topic_of("itm_e2"), "Budget");
    assert_eq!(topic_of("itm_e3"), "Move the release to Friday");
    assert_eq!(topic_of("itm_e4"), "Budget");
    assert_eq!(topic_of("itm_e5"), "Something loosely related");
    assert_eq!(done.value.items.len(), 5);
    assert_eq!(done.value.topics.len(), 4);
    // Every new item has its vector now, without waiting for a rebuild.
    assert_eq!(
        lib.count("SELECT count(*) FROM item_vec WHERE item_id LIKE 'itm_e%'"),
        5
    );
    // Seen dates follow the call; the joined topic's centroid moved towards the item.
    let seen = |t: &str| {
        lib.db
            .query_row(
                "SELECT first_seen, last_seen FROM topics WHERE name = ?1",
                [t],
                |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?)),
            )
            .unwrap()
    };
    assert_eq!(seen("Websockets"), (OCT_1, started));
    assert_eq!(seen("Budget"), (started, started));
    let joined: Vec<f32> = (0..DIMS).map(|i| (ws[i] + near[i]) / 2.0).collect();
    assert!(cos(&lib.centroid("top_ws").unwrap(), &joined) > 0.999);
    // Suggested, never merged: the twin pair is above 0.9, until it is kept separate.
    assert!(cos(&joined, &twin) > SUGGEST_SIMILARITY);
    assert_eq!(
        done.value.suggestions,
        [("top_twin".to_owned(), "top_ws".to_owned())]
    );
    assert_eq!(lib.count("SELECT count(*) FROM topics"), 5);
    lib.store
        .write_with(you("keep"), |tx| {
            keep_separate(tx, "top_ws", "top_twin", TimestampMs(OCT_1))
        })
        .unwrap();
    lib.call("call_f", "Weekly", "planning", "normal", started + DAY);
    lib.item(
        "itm_f1",
        "call_f",
        "decision",
        "Ship it",
        "en",
        "open",
        "suggested",
        None,
    );
    let again = vec![new_item("itm_f1", "Ship it", None, near)];
    let done = lib
        .store
        .write_with(writer("topics"), move |tx| {
            attach_topics(tx, "call_f", &again)
        })
        .unwrap();
    assert!(done.value.suggestions.is_empty());
    assert_eq!(topic_of("itm_f1"), "Websockets");
}

#[test]
fn new_topic_names_are_the_first_clause_in_six_words() {
    assert_eq!(
        topic_name("Move the release to Friday, after QA signs off"),
        "Move the release to Friday"
    );
    assert_eq!(
        topic_name("We will migrate every single service to websockets next quarter"),
        "We will migrate every single service"
    );
    assert_eq!(topic_name("  Бюджет: утвердить до пятницы"), "Бюджет");
    assert_eq!(topic_name("Ship it."), "Ship it");
    assert_eq!(topic_name(" … "), "Untitled topic");
}

// cpt-noter-algo-core-retrieval-ask-retrieve: inst-retrieve-keywords
#[test]
fn keyword_upgrade_rebuilds_existing_rows_and_keeps_edits_current() {
    let lib = library_with_migrations(&crate::MIGRATIONS[..3]);
    lib.segment(
        "seg_upgrade",
        "call_a",
        "spk_anna",
        20_000,
        "**Kubernetes**",
        "en",
    );
    lib.item(
        "itm_upgrade",
        "call_a",
        "decision",
        "**Kubernetes**",
        "en",
        "open",
        "accepted",
        None,
    );
    lib.chunk(
        "chk_upgrade",
        "call_a",
        20_000,
        23_000,
        "**Kubernetes**",
        Some(9),
    );
    assert!(lib.find(query("kubernetes")).items.is_empty());
    let path = lib.path();
    let Library { dir, store, db } = lib;
    drop(db);
    drop(store);
    let store = Store::open(
        &path,
        &[
            noter_db::MIGRATIONS,
            noter_core::MIGRATIONS,
            crate::MIGRATIONS,
        ],
    )
    .unwrap();
    let lib = Library {
        dir,
        store: Arc::new(store),
        db: Connection::open(path).unwrap(),
    };
    assert_eq!(ids(&lib.find(query("kubernetes")).items), ["itm_upgrade"]);
    for index in ["segments_fts", "items_fts", "chunks_fts"] {
        assert_eq!(
            lib.count(&format!(
                r#"SELECT count(*) FROM {index} WHERE {index} MATCH '" kubernet"'"#
            )),
            1
        );
    }
    assert_eq!(lib.count("SELECT count(*) FROM chunk_vec"), 4);
    assert_eq!(
        lib.db
            .query_row(
                "SELECT text FROM segments WHERE id = 'seg_upgrade'",
                [],
                |r| r.get::<_, String>(0)
            )
            .unwrap(),
        "**Kubernetes**"
    );
    lib.db.execute_batch("UPDATE segments SET text = '`Replacement`', text_norm = '`replacement`' WHERE id = 'seg_upgrade';
                          UPDATE items SET text = '`Replacement`' WHERE id = 'itm_upgrade';
                          DELETE FROM chunks WHERE id = 'chk_upgrade';").unwrap();
    assert!(lib.find(query("kubernetes")).items.is_empty());
    assert_eq!(ids(&lib.find(query("replacement")).calls), ["seg_upgrade"]);
    assert_eq!(ids(&lib.find(query("replacement")).items), ["itm_upgrade"]);
    assert_eq!(lib.count("SELECT count(*) FROM chunk_vec"), 3);
}
