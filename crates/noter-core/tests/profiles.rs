//! FEATURE cpt-noter-feature-core-people (slice 2): voice profiles with encrypted centroids,
//! speaker matching at archive install, and carry-forward.

use std::path::Path;
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::{Arc, Mutex};

use noter_core::testing;
use noter_core::{Clock, Core, CoreDeps, EventEmitter, MemorySecrets};
use noter_db::Insert;
use noter_protocol::error::ValidationRule;
use noter_protocol::ipc::{Caller, CommandCtx, CoreApi};
use noter_protocol::model::*;
use noter_protocol::*;
use serde_json::{json, Value};

const NOW: i64 = 1_792_137_600_000;
const DAY: i64 = 86_400_000;

#[derive(Default)]
struct Events(Mutex<Vec<(&'static str, Value)>>);

impl EventEmitter for Events {
    fn emit(&self, event: &'static str, payload: Value) {
        self.0.lock().unwrap().push((event, payload));
    }
}

struct Moving(AtomicI64);

impl Clock for Moving {
    fn now(&self) -> TimestampMs {
        TimestampMs(self.0.load(Ordering::SeqCst))
    }
}

struct Rig {
    core: Core,
    clock: Arc<Moving>,
    secrets: Arc<MemorySecrets>,
}

fn open(dir: &Path) -> Rig {
    let clock = Arc::new(Moving(AtomicI64::new(NOW)));
    let secrets = Arc::new(MemorySecrets::default());
    let deps =
        CoreDeps::new(clock.clone(), Arc::new(Events::default())).with_secrets(secrets.clone());
    Rig {
        core: Core::open(dir, deps).expect("core opens"),
        clock,
        secrets,
    }
}

fn ctx() -> CommandCtx {
    CommandCtx {
        caller: Caller::Window {
            label: WindowLabel::Main,
        },
    }
}

/// Plain SQL beside the core, for state the commands cannot reach (triggers, raw reads).
fn exec(dir: &Path, sql: &str) -> noter_db::rusqlite::Result<()> {
    noter_db::rusqlite::Connection::open(dir.join("noter.db"))
        .unwrap()
        .execute_batch(sql)
}

fn count(dir: &Path, sql: &str) -> i64 {
    noter_db::rusqlite::Connection::open(dir.join("noter.db"))
        .unwrap()
        .query_row(sql, [], |r| r.get(0))
        .unwrap()
}

fn text(dir: &Path, sql: &str) -> Option<String> {
    noter_db::rusqlite::Connection::open(dir.join("noter.db"))
        .unwrap()
        .query_row(sql, [], |r| r.get(0))
        .unwrap()
}

fn row(table: &'static str, values: &[(&'static str, Value)]) -> Insert {
    Insert {
        table,
        values: values.to_vec(),
    }
}

fn call(id: &str, started: i64) -> Insert {
    row(
        "calls",
        &[
            ("id", json!(id)),
            ("rev", json!(1)),
            ("started_at", json!(started)),
            ("ended_at", json!(started + 600_000)),
            ("title", json!(format!("Call {id}"))),
            ("call_type", json!("planning")),
            ("status", json!("ready")),
            ("mode_used", json!("cloud_redacted")),
        ],
    )
}

fn person(id: &str, name: &str) -> Insert {
    row(
        "people",
        &[
            ("id", json!(id)),
            ("rev", json!(1)),
            ("display_name", json!(name)),
            ("short_name", json!(name)),
        ],
    )
}

fn part(call_id: &str, person: &str) -> Insert {
    row(
        "call_participants",
        &[
            ("id", json!(format!("cpp_{call_id}_{person}"))),
            ("call_id", json!(call_id)),
            ("person_id", json!(person)),
        ],
    )
}

fn speaker(id: &str, call_id: &str, label: &str, person: Option<&str>, n: Option<i64>) -> Insert {
    row(
        "speakers",
        &[
            ("id", json!(id)),
            ("call_id", json!(call_id)),
            ("label", json!(label)),
            ("n", json!(n)),
            ("channel", json!("sys")),
            ("person_id", json!(person)),
            ("named_by", json!(person.map(|_| "you"))),
            ("pass", json!("live")),
        ],
    )
}

fn item(id: &str, call_id: &str, kind: &str, owner: Option<&str>) -> Insert {
    row(
        "items",
        &[
            ("id", json!(id)),
            ("rev", json!(1)),
            ("call_id", json!(call_id)),
            ("kind", json!(kind)),
            ("text", json!(format!("Text of {id}"))),
            ("lang", json!("en")),
            ("status", json!("open")),
            ("review_state", json!("accepted")),
            ("created_by", json!("llm")),
            ("is_engineering", json!(0)),
            ("owner_person_id", json!(owner)),
        ],
    )
}

fn archive(id: &str, call_id: &str, person: Option<&str>, n: i64) -> Insert {
    row(
        "speakers",
        &[
            ("id", json!(id)),
            ("call_id", json!(call_id)),
            ("label", json!(id)),
            ("n", json!(n)),
            ("channel", json!("sys")),
            ("person_id", json!(person)),
            ("named_by", json!(person.map(|_| "you"))),
            ("pass", json!("archive")),
        ],
    )
}

fn set_centroid(dir: &Path, core: &Core, speaker: &str, vector: &[f32]) {
    let blob = testing::seal_centroid(core, vector).unwrap();
    noter_db::rusqlite::Connection::open(dir.join("noter.db"))
        .unwrap()
        .execute(
            "UPDATE speakers SET centroid = ?1 WHERE id = ?2",
            (blob, speaker),
        )
        .unwrap();
}

/// A unit-ish 256-d vector: a hot dimension plus a tilt toward the next one.
fn voice(hot: usize, tilt: f32) -> Vec<f32> {
    let mut v = vec![0.0; 256];
    v[hot] = 1.0;
    v[hot + 1] = tilt;
    v
}

fn args(person: &str, from: Option<&str>) -> VoiceProfileArgs {
    VoiceProfileArgs {
        person_id: PersonId::new(person),
        from_speaker: from.map(SpeakerId::new),
    }
}

async fn enable(core: &Core, person: &str, seed: &str) -> VoiceProfileView {
    core.voice_profile_create(&ctx(), args(person, Some(seed)))
        .await
        .unwrap()
}

async fn named(_core: &Core, speaker: &str, dir: &Path) -> (Option<String>, Option<String>) {
    (
        text(
            dir,
            &format!("SELECT person_id FROM speakers WHERE id = '{speaker}'"),
        ),
        text(
            dir,
            &format!("SELECT named_by FROM speakers WHERE id = '{speaker}'"),
        ),
    )
}

/// Anna and Boris each have a named voice in an old call; call_new has two unnamed voices.
fn world(dir: &Path, core: &Core, anna: &[f32], boris: &[f32], new_a: &[f32], new_b: &[f32]) {
    core.store()
        .insert_batch(vec![
            call("call_old", NOW - 10 * DAY),
            call("call_new", NOW - DAY),
            person("per_anna", "Anna Koval"),
            person("per_boris", "Boris Ivanov"),
            archive("old_anna", "call_old", Some("per_anna"), 1),
            archive("old_boris", "call_old", Some("per_boris"), 2),
            archive("new_a", "call_new", None, 1),
            archive("new_b", "call_new", None, 2),
        ])
        .unwrap();
    for (id, v) in [
        ("old_anna", anna),
        ("old_boris", boris),
        ("new_a", new_a),
        ("new_b", new_b),
    ] {
        set_centroid(dir, core, id, v);
    }
}

#[tokio::test]
async fn a_locked_keychain_refuses_and_nothing_is_stored() {
    let dir = tempfile::tempdir().unwrap();
    let rig = open(dir.path());
    rig.core
        .store()
        .insert_batch(vec![person("per_anna", "Anna Koval"), call("c", NOW), {
            let mut s = speaker("old", "c", "old", Some("per_anna"), None);
            s.values.push(("pass", json!("archive")));
            s
        }])
        .unwrap();
    rig.secrets.set_locked(true);
    let err = rig
        .core
        .voice_profile_create(&ctx(), args("per_anna", Some("old")))
        .await
        .unwrap_err();
    assert_eq!(err.code, ErrorCode::KeychainLocked);
    assert_eq!(count(dir.path(), "SELECT count(*) FROM voice_profiles"), 0);
    assert_eq!(
        count(
            dir.path(),
            "SELECT voice_profile_optin FROM people WHERE id = 'per_anna'"
        ),
        0
    );
}

#[tokio::test]
async fn create_encrypts_every_centroid_and_returns_only_counts() {
    let dir = tempfile::tempdir().unwrap();
    let Rig { core, .. } = open(dir.path());
    let v = voice(3, 0.2);
    world(
        dir.path(),
        &core,
        &v,
        &voice(40, 0.1),
        &voice(3, 0.2),
        &voice(90, 0.0),
    );
    let view = enable(&core, "per_anna", "old_anna").await;
    assert!(view.enabled);
    assert_eq!(view.centroids, 1);
    assert_eq!(view.opted_in_at, Some(TimestampMs(NOW)));
    let blob: Vec<u8> = noter_db::rusqlite::Connection::open(dir.path().join("noter.db"))
        .unwrap()
        .query_row("SELECT embedding FROM voice_profiles", [], |r| r.get(0))
        .unwrap();
    let plain: Vec<u8> = v.iter().flat_map(|x| x.to_le_bytes()).collect();
    assert_ne!(blob, plain);
    assert!(!blob.windows(plain.len()).any(|w| w == plain));
    let serialized_blob = serde_json::to_string(&blob).unwrap();
    let db = noter_db::rusqlite::Connection::open(dir.path().join("noter.db")).unwrap();
    let mut stmt = db
        .prepare("SELECT before, after, delta FROM changes")
        .unwrap();
    let rows = stmt
        .query_map([], |r| {
            Ok([
                r.get::<_, noter_db::rusqlite::types::Value>(0)?,
                r.get::<_, noter_db::rusqlite::types::Value>(1)?,
                r.get::<_, noter_db::rusqlite::types::Value>(2)?,
            ])
        })
        .unwrap();
    for row in rows {
        for value in row.unwrap() {
            let bytes = match value {
                noter_db::rusqlite::types::Value::Text(text) => text.into_bytes(),
                noter_db::rusqlite::types::Value::Blob(bytes) => bytes,
                _ => continue,
            };
            assert!(
                !bytes
                    .windows(serialized_blob.len())
                    .any(|window| window == serialized_blob.as_bytes()),
                "stored biometric blob in change log"
            );
        }
    }
    // Nothing biometric reaches the change log under another field name.
    assert_eq!(
        count(
            dir.path(),
            "SELECT count(*) FROM changes WHERE after LIKE '%embedding%' OR after LIKE '%centroid%'"
        ),
        0
    );
    let json = serde_json::to_string(
        &core
            .people_list(&ctx(), PeopleListArgs { query: None })
            .await
            .unwrap(),
    )
    .unwrap();
    assert!(!json.contains("embedding") && !json.contains("centroid"));
}

#[tokio::test]
async fn create_checks_the_person_and_the_seed() {
    let dir = tempfile::tempdir().unwrap();
    let Rig { core, .. } = open(dir.path());
    world(
        dir.path(),
        &core,
        &voice(3, 0.2),
        &voice(40, 0.1),
        &voice(3, 0.2),
        &voice(90, 0.0),
    );
    let missing = core
        .voice_profile_create(&ctx(), args("per_nobody", None))
        .await;
    assert_eq!(missing.unwrap_err().code, ErrorCode::NotFound);
    let ghost = core
        .voice_profile_create(&ctx(), args("per_anna", Some("spk_ghost")))
        .await;
    assert_eq!(ghost.unwrap_err().code, ErrorCode::NotFound);
    let theirs = core
        .voice_profile_create(&ctx(), args("per_anna", Some("old_boris")))
        .await
        .unwrap_err();
    assert_eq!(theirs.code, ErrorCode::InvalidInput);
    assert!(matches!(
        theirs.detail,
        Some(ErrorDetail::Validation {
            rule: ValidationRule::OutOfRange,
            ..
        })
    ));
    // Without a seed the person's own named archive voices are used.
    let view = core
        .voice_profile_create(&ctx(), args("per_anna", None))
        .await
        .unwrap();
    assert_eq!(view.centroids, 1);
}

#[tokio::test]
async fn a_voice_above_the_threshold_is_named_and_one_below_is_not() {
    let dir = tempfile::tempdir().unwrap();
    let Rig { core, .. } = open(dir.path());
    // new_a is Anna's voice; new_b is far from both.
    world(
        dir.path(),
        &core,
        &voice(3, 0.2),
        &voice(40, 0.1),
        &voice(3, 0.25),
        &voice(90, 0.0),
    );
    enable(&core, "per_anna", "old_anna").await;
    assert_eq!(
        testing::match_profiles(&core, &CallId::new("call_new")).unwrap(),
        1
    );
    let (who, by) = named(&core, "new_a", dir.path()).await;
    assert_eq!(who.as_deref(), Some("per_anna"));
    assert_eq!(by.as_deref(), Some("voice_profile"));
    assert_eq!(named(&core, "new_b", dir.path()).await.0, None);
}

#[tokio::test]
async fn a_close_runner_up_leaves_the_voice_unnamed_unless_an_attendee_narrows_it() {
    let dir = tempfile::tempdir().unwrap();
    let Rig { core, .. } = open(dir.path());
    // Anna and Boris sound alike: the new voice sits between them.
    world(
        dir.path(),
        &core,
        &voice(3, 0.5),
        &voice(3, 0.6),
        &voice(3, 0.55),
        &voice(90, 0.0),
    );
    enable(&core, "per_anna", "old_anna").await;
    enable(&core, "per_boris", "old_boris").await;
    let call = CallId::new("call_new");
    assert_eq!(testing::match_profiles(&core, &call).unwrap(), 0);
    assert_eq!(named(&core, "new_a", dir.path()).await.0, None);
    // The calendar named only Boris as an attendee: the others are not asked.
    core.store()
        .insert_batch(vec![part("call_new", "per_boris")])
        .unwrap();
    assert_eq!(testing::match_profiles(&core, &call).unwrap(), 1);
    assert_eq!(
        named(&core, "new_a", dir.path()).await.0.as_deref(),
        Some("per_boris")
    );
}

#[tokio::test]
async fn a_profile_unused_for_ninety_days_stops_matching_until_refreshed() {
    let dir = tempfile::tempdir().unwrap();
    let Rig { core, clock, .. } = open(dir.path());
    world(
        dir.path(),
        &core,
        &voice(3, 0.2),
        &voice(40, 0.1),
        &voice(3, 0.2),
        &voice(90, 0.0),
    );
    enable(&core, "per_anna", "old_anna").await;
    clock.0.store(NOW + 91 * DAY, Ordering::SeqCst);
    let page = core
        .person_get(
            &ctx(),
            PersonIdArgs {
                person_id: PersonId::new("per_anna"),
            },
        )
        .await
        .unwrap();
    let _ = page;
    assert_eq!(
        testing::match_profiles(&core, &CallId::new("call_new")).unwrap(),
        0
    );
    let refreshed = enable(&core, "per_anna", "old_anna").await;
    assert!(refreshed.enabled);
    assert_eq!(
        testing::match_profiles(&core, &CallId::new("call_new")).unwrap(),
        1
    );
}

#[tokio::test]
async fn deleting_a_profile_removes_centroids_keeps_names_and_wins_over_a_match() {
    let dir = tempfile::tempdir().unwrap();
    let Rig { core, .. } = open(dir.path());
    world(
        dir.path(),
        &core,
        &voice(3, 0.2),
        &voice(40, 0.1),
        &voice(3, 0.2),
        &voice(90, 0.0),
    );
    enable(&core, "per_anna", "old_anna").await;
    let view = core
        .voice_profile_delete(
            &ctx(),
            PersonIdArgs {
                person_id: PersonId::new("per_anna"),
            },
        )
        .await
        .unwrap();
    assert!(!view.enabled);
    assert_eq!(view.centroids, 0);
    assert_eq!(count(dir.path(), "SELECT count(*) FROM voice_profiles"), 0);
    // The speaker named earlier keeps the name; a match after the deletion names no one.
    assert_eq!(
        named(&core, "old_anna", dir.path()).await.0.as_deref(),
        Some("per_anna")
    );
    assert_eq!(
        testing::match_profiles(&core, &CallId::new("call_new")).unwrap(),
        0
    );
    assert_eq!(named(&core, "new_a", dir.path()).await.0, None);
}

#[tokio::test]
async fn carry_offers_open_items_for_the_calls_people_and_returns_them_at_stop() {
    let dir = tempfile::tempdir().unwrap();
    let Rig { core, .. } = open(dir.path());
    core.store()
        .insert_batch(vec![
            call("call_old", NOW - 3 * DAY),
            call("call_live", NOW),
            person("per_anna", "Anna Koval"),
            part("call_old", "per_anna"),
            part("call_live", "per_anna"),
            item("itm_open", "call_old", "action_item", Some("per_anna")),
            item("itm_closed", "call_old", "action_item", Some("per_anna")),
            item("itm_answered", "call_old", "open_question", None),
        ])
        .unwrap();
    let live = CallId::new("call_live");
    assert_eq!(testing::carry_start(&core, &live).unwrap(), 3);
    assert_eq!(
        text(dir.path(), "SELECT status FROM items WHERE id = 'itm_open'").as_deref(),
        Some("carried")
    );
    // Closed or answered meanwhile: stays that way at stop.
    exec(
        dir.path(),
        "UPDATE items SET status = 'done' WHERE id = 'itm_closed'",
    )
    .unwrap();
    exec(
        dir.path(),
        "UPDATE items SET status = 'answered_in_call' WHERE id = 'itm_answered'",
    )
    .unwrap();
    testing::carry_end(&core, &live).unwrap();
    for (id, want) in [
        ("itm_open", "open"),
        ("itm_closed", "done"),
        ("itm_answered", "answered_in_call"),
    ] {
        assert_eq!(
            text(
                dir.path(),
                &format!("SELECT status FROM items WHERE id = '{id}'")
            )
            .as_deref(),
            Some(want)
        );
    }
    assert_eq!(
        text(
            dir.path(),
            "SELECT call_id FROM items WHERE id = 'itm_open'"
        )
        .as_deref(),
        Some("call_old")
    );
}

#[tokio::test]
async fn unknown_people_carry_nothing_and_metrics_off_leaves_talk_time_alone() {
    let dir = tempfile::tempdir().unwrap();
    let Rig { core, .. } = open(dir.path());
    core.store()
        .insert_batch(vec![
            call("call_old", NOW - DAY),
            call("call_live", NOW),
            person("per_anna", "Anna Koval"),
            part("call_old", "per_anna"),
            part("call_live", "per_anna"),
            item("itm_open", "call_old", "action_item", Some("per_anna")),
        ])
        .unwrap();
    let live = CallId::new("call_live");
    exec(
        dir.path(),
        "DELETE FROM call_participants WHERE call_id = 'call_live'",
    )
    .unwrap();
    assert_eq!(testing::carry_start(&core, &live).unwrap(), 0);
    exec(dir.path(), "INSERT INTO call_participants (id, call_id, person_id) VALUES ('cpx', 'call_live', 'per_anna')").unwrap();
    // Behaviour metrics are off by default: no talk time is kept.
    exec(dir.path(), "INSERT INTO segments (id, call_id, speaker_id, channel, t0_ms, t1_ms, text, text_norm, pass) VALUES ('sg', 'call_live', 'sp_live', 'sys', 0, 5000, 'hi', 'hi', 'live')").ok();
    testing::carry_end(&core, &live).unwrap();
    assert_eq!(
        count(
            dir.path(),
            "SELECT count(*) FROM call_participants WHERE talk_time_ms IS NOT NULL"
        ),
        0
    );
    let settings = core.settings_get(&ctx(), NoArgs {}).await.unwrap();
    let mut privacy = settings.privacy.clone();
    privacy.behaviour_metrics = true;
    core.settings_update(
        &ctx(),
        SettingsUpdateArgs {
            rev: settings.rev,
            section: SettingsSection::Privacy(privacy),
        },
    )
    .await
    .unwrap();
    testing::carry_end(&core, &live).unwrap();
    assert_eq!(
        count(
            dir.path(),
            "SELECT count(*) FROM call_participants WHERE talk_time_ms IS NOT NULL"
        ),
        1
    );
}
