//! FEATURE cpt-noter-feature-core-retrieval-ask, slice 3: the post-call pipeline attaches its
//! items to topics (the scripted runtime writes them, the scripted engine embeds them), and the
//! topic commands read, rename, merge, undo and keep topics separate through the core.

use std::sync::{Arc, Mutex};
use std::time::Duration;

use noter_core::{Adapters, Clock, Core, CoreDeps, EventEmitter, Scripted};
use noter_db::Insert;
use noter_engine_client::scripted::ScriptedEngine;
use noter_jobs::{Request, Trigger};
use noter_protocol::ipc::{Caller, CommandCtx, CoreApi};
use noter_protocol::model::*;
use noter_protocol::*;
use serde_json::{json, Value};

const NOW: i64 = 1_790_000_000_000;
const HOUR: i64 = 3_600_000;

struct FixedClock;

impl Clock for FixedClock {
    fn now(&self) -> TimestampMs {
        TimestampMs(NOW)
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
    /// The topic ids `entity:changed` carried since the last call (whole rows or removals).
    fn topics(&self) -> Vec<String> {
        let mut all = self.0.lock().unwrap();
        let ids = all
            .iter()
            .filter(|(e, _)| *e == "entity:changed")
            .filter_map(|(_, p)| match p["type"].as_str() {
                Some("topic") => p["topic"]["id"].as_str().map(String::from),
                Some("removed") if p["kind"] == "topic" => p["id"].as_str().map(String::from),
                _ => None,
            })
            .collect();
        all.clear();
        ids
    }
}

fn main_window() -> CommandCtx {
    CommandCtx {
        caller: Caller::Window {
            label: WindowLabel::Main,
        },
    }
}

/// A started core on `dir` whose router answers the built-in scripted outputs and whose engine
/// embeds with the scripted engine.
async fn open(dir: &std::path::Path) -> (Arc<Core>, Arc<Events>) {
    let events = Arc::new(Events::default());
    let deps = CoreDeps::new(Arc::new(FixedClock), events.clone())
        .with_llm(Adapters::scripted(&Scripted::new()))
        .with_engine(Arc::new(ScriptedEngine::new().with_container(dir)));
    let core = Arc::new(Core::open(dir, deps).unwrap());
    core.start_first_run();
    tokio::time::sleep(Duration::from_millis(10)).await;
    (core, events)
}

fn ins(table: &'static str, values: Vec<(&'static str, Value)>) -> Insert {
    Insert { table, values }
}

/// A stopped planning call, still `processing`, then its post-call run to the end.
async fn written_call(core: &Core, id: &str, started: i64) {
    let mut rows = vec![
        ins(
            "calls",
            vec![
                ("id", json!(id)),
                ("rev", json!(1)),
                ("started_at", json!(started)),
                ("ended_at", json!(started + HOUR)),
                ("title", json!("Planning")),
                ("call_type", json!("planning")),
                ("status", json!("processing")),
                ("mode_used", json!("cloud")),
            ],
        ),
        ins(
            "speakers",
            vec![
                ("id", json!(format!("{id}_spk"))),
                ("call_id", json!(id)),
                ("label", json!("spk_1")),
                ("n", json!(1)),
                ("channel", json!("sys")),
                ("pass", json!("live")),
            ],
        ),
    ];
    for n in 0..3 {
        rows.push(ins(
            "segments",
            vec![
                ("id", json!(format!("{id}_seg_{n}"))),
                ("call_id", json!(id)),
                ("speaker_id", json!(format!("{id}_spk"))),
                ("channel", json!("sys")),
                ("t0_ms", json!(n * 10_000)),
                ("t1_ms", json!(n * 10_000 + 5_000)),
                ("text", json!(format!("We agree on step {n}."))),
                ("text_norm", json!(format!("we agree on step {n}."))),
                ("lang", json!("en")),
                ("pass", json!("live")),
            ],
        ));
    }
    core.store().insert_batch(rows).unwrap();
    let req = Request::for_call(JobKind::PostCall, Trigger::AfterCall, &CallId::new(id));
    core.scheduler().trigger(req).unwrap().expect("queued");
    tokio::time::sleep(Duration::from_secs(5)).await;
}

async fn topics(core: &Core) -> Vec<TopicRow> {
    core.topics_list(&main_window(), NoArgs {})
        .await
        .unwrap()
        .topics
}

fn named<'a>(list: &'a [TopicRow], name: &str) -> &'a TopicRow {
    list.iter()
        .find(|t| t.name == name)
        .unwrap_or_else(|| panic!("no topic {name:?} in {list:?}"))
}

async fn thread(core: &Core, id: &TopicId) -> Result<TopicThread, CoreError> {
    core.topic_get(
        &main_window(),
        TopicIdArgs {
            topic_id: id.clone(),
        },
    )
    .await
}

fn count(core: &Core, sql: &'static str) -> i64 {
    core.store()
        .read(move |c| c.query_row(sql, [], |r| r.get(0)))
        .unwrap()
}

#[tokio::test(start_paused = true)]
async fn post_call_items_join_topics_and_the_threads_group_them_by_call() {
    let dir = tempfile::tempdir().unwrap();
    let (core, events) = open(dir.path()).await;
    written_call(&core, "call_old", NOW - 48 * HOUR).await;
    written_call(&core, "call_new", NOW - 2 * HOUR).await;
    // The scripted items have no topic hint: each new topic is named from its item's text, and
    // the same text in the next call is the same vector, so it joins that topic.
    let list = topics(&core).await;
    assert_eq!(list.len(), 2, "{list:?}");
    let decided = named(&list, "Scripted decision");
    assert_eq!((decided.calls, decided.decisions), (2, 2));
    assert_eq!(decided.last_seen, TimestampMs(NOW - 2 * HOUR));
    assert_eq!(named(&list, "Scripted action item").calls, 2);
    assert!(!events.topics().is_empty());
    // Their items have vectors now, and their chips name the topic.
    assert_eq!(
        count(&core, "SELECT count(*) FROM item_vec"),
        count(&core, "SELECT count(*) FROM items")
    );
    let t = thread(&core, &decided.id).await.unwrap();
    let calls: Vec<&str> = t.groups.iter().map(|g| g.call.id.as_str()).collect();
    assert_eq!(calls, ["call_new", "call_old"]);
    let chip = t.groups[0].items[0].topic.clone().unwrap();
    assert_eq!(chip.name, "Scripted decision");
    assert_eq!(
        thread(&core, &TopicId::new("top_none"))
            .await
            .unwrap_err()
            .code,
        ErrorCode::NotFound
    );
}

#[tokio::test(start_paused = true)]
async fn rename_merge_undo_and_keep_separate_through_the_core() {
    let dir = tempfile::tempdir().unwrap();
    let (core, events) = open(dir.path()).await;
    written_call(&core, "call_old", NOW - 48 * HOUR).await;
    written_call(&core, "call_new", NOW - 2 * HOUR).await;
    let list = topics(&core).await;
    let decided = named(&list, "Scripted decision").clone();
    let acted = named(&list, "Scripted action item").clone();
    events.topics();

    // Rename: the name and its chips change together; a stale rev changes nothing.
    let rename = |rev: Rev, name: &str| TopicRenameArgs {
        topic_id: decided.id.clone(),
        rev,
        name: name.into(),
    };
    let blank = core
        .topic_rename(&main_window(), rename(decided.rev, " "))
        .await
        .unwrap_err();
    assert_eq!(blank.code, ErrorCode::InvalidInput);
    let renamed = core
        .topic_rename(&main_window(), rename(decided.rev, "Decisions"))
        .await
        .unwrap();
    assert_eq!(renamed.topic.name, "Decisions");
    assert_eq!(events.topics(), [decided.id.as_str()]);
    let stale = core
        .topic_rename(&main_window(), rename(decided.rev, "Again"))
        .await
        .unwrap_err();
    assert_eq!(stale.code, ErrorCode::Conflict);
    assert_eq!(
        stale.detail,
        Some(ErrorDetail::Conflict {
            current_rev: renamed.topic.rev
        })
    );
    assert!(events.topics().is_empty());
    let t = thread(&core, &decided.id).await.unwrap();
    assert_eq!(
        t.groups[0].items[0].topic.as_ref().unwrap().name,
        "Decisions"
    );

    // Merge: bad pairs fail before any write and publish nothing.
    let merge = |source: &TopicId, target: &TopicId| TopicMergeArgs {
        source: source.clone(),
        target: target.clone(),
    };
    let changes = count(&core, "SELECT count(*) FROM changes");
    let same = core
        .topics_merge(&main_window(), merge(&acted.id, &acted.id))
        .await
        .unwrap_err();
    assert_eq!(same.code, ErrorCode::InvalidInput);
    let missing = core
        .topics_merge(&main_window(), merge(&TopicId::new("top_none"), &acted.id))
        .await
        .unwrap_err();
    assert_eq!(missing.code, ErrorCode::NotFound);
    assert_eq!(count(&core, "SELECT count(*) FROM changes"), changes);
    assert!(events.topics().is_empty());
    let merged = core
        .topics_merge(&main_window(), merge(&acted.id, &decided.id))
        .await
        .unwrap();
    assert_eq!(merged.topic.aliases, ["Scripted action item"]);
    assert_eq!(merged.topic.calls, 2);
    assert_eq!(topics(&core).await.len(), 1);
    let mut published = events.topics();
    published.sort();
    let mut both = vec![decided.id.as_str(), acted.id.as_str()];
    both.sort();
    assert_eq!(published, both, "the target changed, the source removed");

    // Undo puts the source topic, its links and the target's aliases back.
    let undone = core
        .change_undo(
            &main_window(),
            UndoArgs {
                target: UndoTarget::Change {
                    change_id: merged.change_id.clone(),
                },
            },
        )
        .await
        .unwrap();
    assert_eq!(undone.skipped_edited_later, 0);
    let list = topics(&core).await;
    assert_eq!(list.len(), 2);
    assert!(named(&list, "Decisions").aliases.is_empty());
    assert_eq!(named(&list, "Scripted action item").calls, 2);
    let mut published = events.topics();
    published.sort();
    published.dedup();
    assert_eq!(published, both);
    assert_eq!(
        count(&core, "SELECT count(*) FROM topics WHERE centroid IS NULL"),
        0,
        "the undo refreshes the centroids it moved"
    );

    // Keep Separate survives a restart.
    let pair = |a: &TopicId, b: &TopicId| TopicPairArgs {
        a: a.clone(),
        b: b.clone(),
    };
    core.topics_keep_separate(&main_window(), pair(&decided.id, &acted.id))
        .await
        .unwrap();
    let self_pair = core
        .topics_keep_separate(&main_window(), pair(&decided.id, &decided.id))
        .await
        .unwrap_err();
    assert_eq!(self_pair.code, ErrorCode::InvalidInput);
    core.shutdown().await;
    drop(core);
    let (core, _events) = open(dir.path()).await;
    assert_eq!(
        count(
            &core,
            "SELECT count(*) FROM suppressions WHERE kind = 'topic_merge'"
        ),
        1
    );
    assert!(topics(&core)
        .await
        .iter()
        .all(|t| t.merge_suggestion.is_none()));
}
