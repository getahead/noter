//! FEATURE cpt-noter-feature-core-retrieval-ask, slice 1: `search` and `ask_scope_presets` on a
//! seeded store, and the index rebuild at start, with the scripted engine embedding locally.

use std::sync::Arc;
use std::time::Duration;

use noter_core::{Clock, Core, CoreDeps, EventEmitter};
use noter_db::Insert;
use noter_engine_client::scripted::{Behaviour, ScriptedEngine};
use noter_protocol::ipc::{Caller, CommandCtx, CoreApi};
use noter_protocol::model::*;
use noter_protocol::*;
use serde_json::{json, Value};

/// 2026-10-31T00:00:00Z.
const NOW: i64 = 1_793_404_800_000;
const DAY: i64 = 86_400_000;

struct FixedClock;

impl Clock for FixedClock {
    fn now(&self) -> TimestampMs {
        TimestampMs(NOW)
    }
}

struct NoEvents;

impl EventEmitter for NoEvents {
    fn emit(&self, _: &'static str, _: Value) {}
}

fn main_window() -> CommandCtx {
    CommandCtx {
        caller: Caller::Window {
            label: WindowLabel::Main,
        },
    }
}

/// A started core on `dir` with the scripted engine (its App Group container is `dir`).
async fn open(dir: &std::path::Path) -> Arc<Core> {
    let deps = CoreDeps::new(Arc::new(FixedClock), Arc::new(NoEvents))
        .with_engine(Arc::new(ScriptedEngine::new().with_container(dir)));
    let core = Arc::new(Core::open(dir, deps).unwrap());
    core.start_first_run();
    core
}

async fn wait_for_rebuild(core: &Core) {
    tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            if core.scheduler().runs().unwrap().iter().any(|run| {
                run.kind == JobKind::IndexRebuild && run.status == JobRunStatus::Succeeded
            }) {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("the index rebuild finishes");
}

fn ins(table: &'static str, values: Vec<(&'static str, Value)>) -> Insert {
    Insert { table, values }
}

fn call(id: &str, title: &str, privacy: &str, ago_days: i64) -> Insert {
    let started = NOW - ago_days * DAY;
    ins(
        "calls",
        vec![
            ("id", json!(id)),
            ("rev", json!(1)),
            ("started_at", json!(started)),
            ("ended_at", json!(started + 3_600_000)),
            ("title", json!(title)),
            ("call_type", json!("planning")),
            ("status", json!("ready")),
            ("mode_used", json!("cloud")),
            ("privacy_class", json!(privacy)),
        ],
    )
}

fn speaker(call: &str, person: &str, name: &str) -> Insert {
    ins(
        "speakers",
        vec![
            ("id", json!(format!("{call}_spk"))),
            ("call_id", json!(call)),
            ("label", json!("spk_1")),
            ("n", json!(1)),
            ("name", json!(name)),
            ("channel", json!("sys")),
            ("pass", json!("archive")),
            ("person_id", json!(person)),
        ],
    )
}

fn segment(id: &str, call: &str, t0: i64, text: &str, lang: &str) -> Insert {
    ins(
        "segments",
        vec![
            ("id", json!(id)),
            ("call_id", json!(call)),
            ("speaker_id", json!(format!("{call}_spk"))),
            ("channel", json!("sys")),
            ("t0_ms", json!(t0)),
            ("t1_ms", json!(t0 + 4_000)),
            ("text", json!(text)),
            ("text_norm", json!(text.to_lowercase().replace('ё', "е"))),
            ("lang", json!(lang)),
            ("pass", json!("archive")),
        ],
    )
}

fn seed(core: &Core) {
    core.store()
        .insert_batch(vec![
            call("call_ws", "Backend sync", "normal", 3),
            call("call_hr", "HR one on one", "sensitive", 2),
            speaker("call_ws", "per_anna", "Anna Lee"),
            speaker("call_hr", "per_hr", "Hanna Roth"),
            segment(
                "seg_en",
                "call_ws",
                1_000,
                "We decided to use WebSockets.",
                "en",
            ),
            segment(
                "seg_ru",
                "call_ws",
                6_000,
                "Решили оставить вебсокеты.",
                "ru",
            ),
            segment(
                "seg_hr",
                "call_hr",
                1_000,
                "The WebSockets bonus is private.",
                "en",
            ),
            ins(
                "items",
                vec![
                    ("id", json!("itm_ws")),
                    ("rev", json!(1)),
                    ("call_id", json!("call_ws")),
                    ("kind", json!("decision")),
                    ("text", json!("Use WebSockets")),
                    ("lang", json!("en")),
                    ("status", json!("open")),
                    ("review_state", json!("accepted")),
                    ("created_by", json!("llm")),
                    ("owner_person_id", json!("per_anna")),
                ],
            ),
        ])
        .unwrap();
}

fn search_args(query: &str, filter: CallFilter, limit: Option<u32>) -> SearchArgs {
    SearchArgs {
        query: query.into(),
        filter,
        limit,
    }
}

#[tokio::test]
async fn search_returns_sections_with_strong_keyword_hits_on_the_real_store() {
    let dir = tempfile::tempdir().unwrap();
    let core = open(dir.path()).await;
    seed(&core);
    let ctx = main_window();
    let all = || search_args("websockets", CallFilter::default(), None);
    let r = core.search(&ctx, all()).await.unwrap();
    // A fresh library has every vector it needs: hybrid, the query embedded by the engine.
    assert_eq!(r.mode, SearchMode::Hybrid);
    let mut calls: Vec<String> = r
        .calls
        .iter()
        .map(|h| match &h.target {
            HitTarget::Segment { span } => format!("{}@{}", span.call_id.0, span.t0_ms.0),
            other => panic!("{other:?}"),
        })
        .collect();
    calls.sort();
    assert_eq!(calls, ["call_hr@1000", "call_ws@1000"]);
    assert!(r.calls.iter().all(|h| h.strength == MatchStrength::Strong));
    assert_eq!(r.items.len(), 1);
    assert_eq!(r.items[0].title, "Use WebSockets");
    assert!(!r.only_weak);
    assert_eq!(r.explain.normalized_query, "websockets");
    assert_eq!(r.explain.keyword_hits, 3);
    // People narrow it to the calls Anna spoke in; the Russian line is found by its stem.
    let anna = CallFilter {
        people: vec![PersonId::new("per_anna")],
        ..CallFilter::default()
    };
    let r = core
        .search(&ctx, search_args("вебсокетами", anna, Some(5)))
        .await
        .unwrap();
    assert_eq!(r.calls.len(), 1);
    assert_eq!(r.calls[0].snippet, "Решили оставить вебсокеты.");
    assert_eq!(r.calls[0].lang, Some(Lang::Ru));
    assert_eq!(r.explain.filters_applied, 1);
    // Nothing found: empty sections.
    let none = core
        .search(&ctx, search_args("kafka", CallFilter::default(), None))
        .await
        .unwrap();
    assert!(none.calls.is_empty() && none.items.is_empty() && !none.only_weak);
    // Invalid limits and dates are refused before anything is read.
    for (limit, from) in [
        (Some(0), None),
        (Some(101), None),
        (None, Some("2026-13-01")),
    ] {
        let filter = CallFilter {
            from: from.map(|d: &str| LocalDate(d.into())),
            ..CallFilter::default()
        };
        let e = core
            .search(&ctx, search_args("x", filter, limit))
            .await
            .unwrap_err();
        assert_eq!(e.code, ErrorCode::InvalidInput);
    }
}

#[tokio::test]
async fn scope_presets_read_the_library() {
    let dir = tempfile::tempdir().unwrap();
    let core = open(dir.path()).await;
    seed(&core);
    let list = core
        .ask_scope_presets(&main_window(), NoArgs {})
        .await
        .unwrap();
    let ids: Vec<&str> = list.presets.iter().map(|p| p.id.as_str()).collect();
    assert_eq!(&ids[..3], ["all", "calls_only", "last_30_days"]);
    assert!(ids.contains(&"type:planning"), "{ids:?}");
    assert!(ids.contains(&"person:per_anna"));
    assert_eq!(ids.last(), Some(&"call:call_hr"));
    let month = list
        .presets
        .iter()
        .find(|p| p.id == "last_30_days")
        .unwrap();
    assert_eq!(month.scope.from, Some(LocalDate("2026-10-01".into())));
}

#[tokio::test]
async fn a_library_without_vectors_is_rebuilt_at_start() {
    let dir = tempfile::tempdir().unwrap();
    let core = open(dir.path()).await;
    seed(&core);
    core.shutdown().await;
    drop(core);
    // The item has no vector yet: the next start is keyword-only until the rebuild ends.
    let core = open(dir.path()).await;
    wait_for_rebuild(&core).await;
    let mode = core
        .search(
            &main_window(),
            search_args("websockets", CallFilter::default(), None),
        )
        .await
        .unwrap()
        .mode;
    assert_eq!(mode, SearchMode::Hybrid);
    let vectors: i64 = core
        .store()
        .read(|c| c.query_row("SELECT count(*) FROM item_vec", [], |r| r.get(0)))
        .unwrap();
    assert_eq!(vectors, 1);
    let run = core
        .scheduler()
        .runs()
        .unwrap()
        .into_iter()
        .find(|r| r.kind == JobKind::IndexRebuild)
        .expect("a rebuild run");
    assert_eq!(run.status, JobRunStatus::Succeeded);
}

#[tokio::test]
async fn a_failed_query_embedding_reports_keyword_only() {
    let dir = tempfile::tempdir().unwrap();
    let down = Behaviour {
        launch_fails: true,
        ..Behaviour::default()
    };
    let engine = ScriptedEngine::new()
        .with_container(dir.path())
        .with_default(down);
    let deps =
        CoreDeps::new(Arc::new(FixedClock), Arc::new(NoEvents)).with_engine(Arc::new(engine));
    let core = Arc::new(Core::open(dir.path(), deps).unwrap());
    core.start_first_run();
    seed(&core);
    let r = core
        .search(
            &main_window(),
            search_args("websockets", CallFilter::default(), None),
        )
        .await
        .unwrap();
    // The indexes are complete, but this request ran without its embedding.
    assert_eq!(
        r.mode,
        SearchMode::KeywordOnly {
            rebuild_progress: 1.0
        }
    );
    assert!(!r.calls.is_empty());
    assert_eq!(r.explain.semantic_hits, 0);
}
