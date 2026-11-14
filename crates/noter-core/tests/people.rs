//! FEATURE cpt-noter-feature-core-people (slice 1): `people_list`, `person_get`, `person_create`,
//! `person_update`, `people_merge` and `person_delete` over the people tables.

mod common;
use common::{call, count, exec, item, part, person, row, speaker, text};
use std::path::Path;
use std::sync::{Arc, Mutex};

use noter_core::{Clock, Core, CoreDeps, EventEmitter};
use noter_db::Insert;
use noter_protocol::error::ValidationRule;
use noter_protocol::ipc::{event_names, Caller, CommandCtx, CoreApi};
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

impl Events {
    fn named(&self, name: &str) -> Vec<Value> {
        let mut all = self.0.lock().unwrap();
        let (taken, kept): (Vec<_>, Vec<_>) = std::mem::take(&mut *all)
            .into_iter()
            .partition(|(e, _)| *e == name);
        *all = kept;
        taken.into_iter().map(|(_, p)| p).collect()
    }
}

struct FixedClock;

impl Clock for FixedClock {
    fn now(&self) -> TimestampMs {
        TimestampMs(NOW)
    }
}

fn open(dir: &Path) -> (Core, Arc<Events>) {
    let events = Arc::new(Events::default());
    let deps = CoreDeps::new(Arc::new(FixedClock), events.clone());
    (Core::open(dir, deps).expect("core opens"), events)
}

fn ctx() -> CommandCtx {
    CommandCtx {
        caller: Caller::Window {
            label: WindowLabel::Main,
        },
    }
}

fn alias(id: &str, person: &str, alias: &str, norm: &str) -> Insert {
    row(
        "person_aliases",
        &[
            ("id", json!(id)),
            ("person_id", json!(person)),
            ("alias", json!(alias)),
            ("alias_norm", json!(norm)),
        ],
    )
}

fn segment(id: &str, call_id: &str, speaker: &str, t0: i64) -> Insert {
    row(
        "segments",
        &[
            ("id", json!(id)),
            ("call_id", json!(call_id)),
            ("speaker_id", json!(speaker)),
            ("channel", json!("sys")),
            ("t0_ms", json!(t0)),
            ("t1_ms", json!(t0 + 4_000)),
            ("text", json!("hello there")),
            ("text_norm", json!("hello there")),
            ("pass", json!("live")),
        ],
    )
}

fn profile(id: &str, person: &str) -> Insert {
    row(
        "voice_profiles",
        &[
            ("id", json!(id)),
            ("person_id", json!(person)),
            ("embedding", json!("blob")),
            ("sample_count", json!(3)),
            ("last_used_at", json!(NOW)),
        ],
    )
}

/// Anna and Dmitri (alias "Дима") share call_a; Dmitri also sits in call_b with an unnamed voice.
fn world(core: &Core) {
    core.store()
        .insert_batch(vec![
            call("call_a", NOW - DAY),
            call("call_b", NOW - 2 * DAY),
            person("per_anna", "Anna Koval"),
            person("per_dima", "Dmitri Orlov"),
            alias("pal_1", "per_dima", "Дима", "дима"),
            part("call_a", "per_anna"),
            part("call_a", "per_dima"),
            part("call_b", "per_dima"),
            speaker("spk_anna", "call_a", "Anna Koval", Some("per_anna"), None),
            speaker("spk_dima", "call_a", "Dmitri Orlov", Some("per_dima"), None),
            speaker(
                "spk_dima_b",
                "call_b",
                "Dmitri Orlov",
                Some("per_dima"),
                None,
            ),
            speaker("spk_x", "call_b", "spk_x", None, Some(2)),
            segment("seg_1", "call_a", "spk_dima", 1_000),
            segment("seg_2", "call_b", "spk_x", 1_000),
            item("itm_dima", "call_a", "action_item", Some("per_dima")),
            item("itm_anna", "call_a", "action_item", Some("per_anna")),
            item("itm_you", "call_a", "action_item", Some("per_you")),
            item("itm_q", "call_a", "open_question", None),
            profile("vp_dima", "per_dima"),
        ])
        .unwrap();
}

async fn list(core: &Core, query: Option<&str>) -> PeopleList {
    core.people_list(
        &ctx(),
        PeopleListArgs {
            query: query.map(String::from),
        },
    )
    .await
    .unwrap()
}

async fn get(core: &Core, id: &str) -> Result<PersonPage, CoreError> {
    core.person_get(
        &ctx(),
        PersonIdArgs {
            person_id: PersonId::new(id),
        },
    )
    .await
}

async fn merge(core: &Core, source: &str, target: &str) -> Result<PersonMutation, CoreError> {
    core.people_merge(
        &ctx(),
        PeopleMergeArgs {
            source: PersonId::new(source),
            target: PersonId::new(target),
        },
    )
    .await
}

async fn update(
    core: &Core,
    id: &str,
    rev: u32,
    patch: PersonPatch,
) -> Result<PersonMutation, CoreError> {
    core.person_update(
        &ctx(),
        PersonUpdateArgs {
            person_id: PersonId::new(id),
            rev: Rev(rev),
            patch,
        },
    )
    .await
}

async fn delete(core: &Core, id: &str) -> Result<DeleteResult, CoreError> {
    core.person_delete(
        &ctx(),
        PersonIdArgs {
            person_id: PersonId::new(id),
        },
    )
    .await
}

fn create_args(name: &str) -> PersonCreateArgs {
    PersonCreateArgs {
        display_name: name.into(),
        email: None,
        role: None,
        org: None,
    }
}

async fn undo(core: &Core, change_id: ChangeId) -> UndoResult {
    core.change_undo(
        &ctx(),
        UndoArgs {
            target: UndoTarget::Change { change_id },
        },
    )
    .await
    .unwrap()
}

async fn item_of(core: &Core, id: &str) -> ItemView {
    core.item_get(
        &ctx(),
        ItemIdArgs {
            item_id: ItemId::new(id),
        },
    )
    .await
    .unwrap()
    .item
}

#[tokio::test]
async fn the_migration_seeds_exactly_one_you() {
    let dir = tempfile::tempdir().unwrap();
    let (core, _) = open(dir.path());
    let people = list(&core, None).await.people;
    assert_eq!(people.len(), 1);
    assert!(people[0].is_you && people[0].id.as_str() == "per_you");
    assert_eq!(people[0].display_name, "You");
    let second = exec(
        dir.path(),
        "INSERT INTO people (id, rev, display_name, short_name, is_you) VALUES ('per_two', 1, 'B', 'B', 1)",
    );
    assert!(
        second.is_err(),
        "a second You is refused by the unique index"
    );
}

#[tokio::test]
async fn list_finds_people_by_name_and_alias_without_changing_display_text() {
    let dir = tempfile::tempdir().unwrap();
    let (core, _) = open(dir.path());
    world(&core);
    let all = list(&core, None).await;
    assert_eq!(all.people.len(), 3);
    let by_alias = list(&core, Some("дима")).await.people;
    assert_eq!(by_alias.len(), 1);
    assert_eq!(by_alias[0].display_name, "Dmitri Orlov");
    assert_eq!(by_alias[0].aliases, vec!["Дима".to_string()]);
    assert_eq!(
        list(&core, Some("ДИМА")).await.people.len(),
        1,
        "case does not matter"
    );
    let by_name = list(&core, Some("  koval ")).await.people;
    assert_eq!(by_name[0].id.as_str(), "per_anna");
    assert!(list(&core, Some("nobody")).await.people.is_empty());
    let dima = all
        .people
        .iter()
        .find(|p| p.id.as_str() == "per_dima")
        .unwrap();
    assert_eq!(dima.last_call_at, Some(TimestampMs(NOW - DAY)));
    assert_eq!(dima.open_items, 1);
    assert!(
        !dima.voice_profile,
        "the flag is the opt-in, not a stored row"
    );
}

#[tokio::test]
async fn the_unnamed_queue_lists_speaker_rows_without_a_person() {
    let dir = tempfile::tempdir().unwrap();
    let (core, _) = open(dir.path());
    world(&core);
    let unnamed = list(&core, None).await.unnamed;
    assert_eq!(unnamed.len(), 1);
    let u = &unnamed[0];
    assert_eq!(
        (u.speaker_id.as_str(), u.n, u.segment_count),
        ("spk_x", 2, 1)
    );
    assert_eq!(u.call.id.as_str(), "call_b");
    assert!(u.sample.is_some(), "audio remains");
    assert!(u.suggestion.is_none());
    exec(
        dir.path(),
        "UPDATE calls SET audio_deleted = 1 WHERE id = 'call_b'",
    )
    .unwrap();
    assert!(list(&core, None).await.unnamed[0].sample.is_none());
}

#[tokio::test]
async fn a_person_page_joins_calls_work_and_questions() {
    let dir = tempfile::tempdir().unwrap();
    let (core, _) = open(dir.path());
    world(&core);
    let page = get(&core, "per_dima").await.unwrap();
    let calls: Vec<_> = page.calls.iter().map(|c| c.id.as_str()).collect();
    assert_eq!(calls, vec!["call_a", "call_b"], "newest first");
    let owns: Vec<_> = page.owns_open.iter().map(|i| i.id.as_str()).collect();
    assert_eq!(owns, vec!["itm_dima"]);
    let owed: Vec<_> = page.you_owe.iter().map(|i| i.id.as_str()).collect();
    assert_eq!(
        owed,
        vec!["itm_you"],
        "what they asked of you: yours, from their calls"
    );
    assert_eq!(page.open_questions.len(), 1);
    assert!(page.topics.is_empty());
    assert!(page.talk_share.is_none());
    assert_eq!(page.person.display_name, "Dmitri Orlov");
}

#[tokio::test]
async fn an_unknown_person_is_not_found_and_a_new_one_has_empty_sections() {
    let dir = tempfile::tempdir().unwrap();
    let (core, _) = open(dir.path());
    world(&core);
    assert_eq!(
        get(&core, "per_missing").await.unwrap_err().code,
        ErrorCode::NotFound
    );
    let made = core
        .person_create(&ctx(), create_args("Nina Park"))
        .await
        .unwrap();
    let page = get(&core, made.person.id.as_str()).await.unwrap();
    assert!(page.calls.is_empty() && page.owns_open.is_empty() && page.you_owe.is_empty());
    assert!(page.open_questions.is_empty() && page.topics.is_empty() && page.talk_share.is_none());
}

#[tokio::test]
async fn talk_share_comes_only_from_recorded_talk_time_and_only_when_metrics_are_on() {
    let dir = tempfile::tempdir().unwrap();
    let (core, _) = open(dir.path());
    world(&core);
    exec(
        dir.path(),
        "UPDATE call_participants SET talk_time_ms = 30000 WHERE call_id = 'call_a' AND person_id = 'per_dima';
         UPDATE call_participants SET talk_time_ms = 10000 WHERE call_id = 'call_a' AND person_id = 'per_anna';",
    )
    .unwrap();
    assert!(
        get(&core, "per_dima").await.unwrap().talk_share.is_none(),
        "metrics are off"
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
    let share = get(&core, "per_dima").await.unwrap().talk_share.unwrap();
    assert!(
        (share - 0.75).abs() < 1e-6,
        "call_b has no talk time and is not computed: {share}"
    );
    assert!(get(&core, "per_anna").await.unwrap().talk_share.unwrap() < 0.3);
}

#[tokio::test]
async fn create_validates_derives_a_short_name_and_logs_a_change() {
    let dir = tempfile::tempdir().unwrap();
    let (core, events) = open(dir.path());
    let err = core
        .person_create(&ctx(), create_args("   "))
        .await
        .unwrap_err();
    assert_eq!(err.code, ErrorCode::InvalidInput);
    assert!(matches!(
        err.detail,
        Some(ErrorDetail::Validation {
            rule: ValidationRule::Required,
            ..
        })
    ));
    let made = core
        .person_create(
            &ctx(),
            PersonCreateArgs {
                display_name: " Anna Maria Koval ".into(),
                email: Some("a@example.com".into()),
                role: Some("PM".into()),
                org: None,
            },
        )
        .await
        .unwrap();
    let p = &made.person;
    assert!(p.id.as_str().starts_with("per_") && p.rev == Rev(1));
    assert_eq!(
        (
            p.display_name.as_str(),
            p.short_name.as_str(),
            p.initials.as_str()
        ),
        ("Anna Maria Koval", "Anna K.", "AM")
    );
    assert_eq!(
        (p.email.as_deref(), p.role.as_deref()),
        (Some("a@example.com"), Some("PM"))
    );
    assert!(!p.is_you && !p.voice_profile);
    assert_eq!(count(dir.path(), "SELECT count(*) FROM voice_profiles"), 0);
    let logged = format!(
        "SELECT count(*) FROM changes WHERE id = '{}' AND entity_type = 'person'",
        made.change_id.as_str()
    );
    assert_eq!(count(dir.path(), &logged), 1);
    assert_eq!(events.named(event_names::ENTITY_CHANGED).len(), 1);
}

#[tokio::test]
async fn update_guards_the_rev_and_applies_only_present_fields() {
    let dir = tempfile::tempdir().unwrap();
    let (core, events) = open(dir.path());
    world(&core);
    let patch = PersonPatch {
        role: Some("Tech lead".into()),
        aliases: Some(vec![
            "  Dima ".into(),
            "dima".into(),
            "Дима".into(),
            "".into(),
        ]),
        ..PersonPatch::default()
    };
    let done = update(&core, "per_dima", 1, patch.clone()).await.unwrap();
    assert_eq!(done.person.rev, Rev(2));
    assert_eq!(done.person.role.as_deref(), Some("Tech lead"));
    assert_eq!(
        done.person.display_name, "Dmitri Orlov",
        "absent fields stay"
    );
    let mut aliases = done.person.aliases.clone();
    aliases.sort();
    assert_eq!(aliases, vec!["Dima".to_string(), "Дима".to_string()]);
    assert_eq!(events.named(event_names::ENTITY_CHANGED).len(), 1);
    let stale = update(&core, "per_dima", 1, patch).await.unwrap_err();
    assert_eq!(stale.code, ErrorCode::Conflict);
    assert_eq!(
        stale.detail,
        Some(ErrorDetail::Conflict {
            current_rev: Rev(2)
        })
    );
    let blank = PersonPatch {
        display_name: Some("  ".into()),
        ..PersonPatch::default()
    };
    assert_eq!(
        update(&core, "per_dima", 2, blank).await.unwrap_err().code,
        ErrorCode::InvalidInput
    );
    let missing = update(&core, "per_nobody", 1, PersonPatch::default())
        .await
        .unwrap_err();
    assert_eq!(missing.code, ErrorCode::NotFound);
}

#[tokio::test]
async fn update_recomputes_legacy_alias_norm_before_matching_alias_rows() {
    let dir = tempfile::tempdir().unwrap();
    let (core, _) = open(dir.path());
    world(&core);
    exec(
        dir.path(),
        "UPDATE person_aliases SET alias = 'Ｆｉｌｅ', alias_norm = 'ｆｉｌｅ' WHERE id = 'pal_1'",
    )
    .unwrap();

    update(
        &core,
        "per_dima",
        1,
        PersonPatch {
            aliases: Some(vec!["File".into()]),
            ..PersonPatch::default()
        },
    )
    .await
    .unwrap();

    assert_eq!(
        text(
            dir.path(),
            "SELECT id FROM person_aliases WHERE person_id = 'per_dima'"
        ),
        Some("pal_1".into())
    );
    assert_eq!(
        text(
            dir.path(),
            "SELECT alias_norm FROM person_aliases WHERE id = 'pal_1'"
        ),
        Some("file".into())
    );
}

#[tokio::test]
async fn merge_moves_every_reference_and_undo_restores_links_and_revs() {
    let dir = tempfile::tempdir().unwrap();
    let (core, events) = open(dir.path());
    world(&core);
    // Anna was on call_b too, so that call is on both people and must not repeat.
    core.store()
        .insert_batch(vec![part("call_b", "per_anna")])
        .unwrap();
    let d = dir.path();
    let merged = merge(&core, "per_dima", "per_anna").await.unwrap();
    assert_eq!(merged.person.id.as_str(), "per_anna");
    assert_eq!(merged.person.rev, Rev(2));
    assert!(merged.person.aliases.contains(&"Дима".to_string()));
    assert!(
        merged.person.aliases.contains(&"Dmitri Orlov".to_string()),
        "the source name stays as an alias"
    );
    assert_eq!(
        count(d, "SELECT count(*) FROM people WHERE id = 'per_dima'"),
        0
    );
    assert_eq!(
        count(
            d,
            "SELECT count(*) FROM speakers WHERE person_id = 'per_dima'"
        ),
        0
    );
    assert_eq!(
        count(
            d,
            "SELECT count(*) FROM speakers WHERE person_id = 'per_anna'"
        ),
        3
    );
    assert_eq!(
        count(
            d,
            "SELECT count(*) FROM call_participants WHERE person_id = 'per_anna'"
        ),
        2
    );
    assert_eq!(
        text(d, "SELECT owner_person_id FROM items WHERE id = 'itm_dima'").as_deref(),
        Some("per_anna")
    );
    assert_eq!(
        text(
            d,
            "SELECT person_id FROM voice_profiles WHERE id = 'vp_dima'"
        )
        .as_deref(),
        Some("per_anna")
    );
    assert!(!events.named(event_names::ENTITY_CHANGED).is_empty());
    // One undoable batch: the change id the merge returned undoes all of it.
    let undone = undo(&core, merged.change_id.clone()).await;
    assert_eq!(undone.skipped_edited_later, 0);
    assert_eq!(
        text(d, "SELECT display_name FROM people WHERE id = 'per_dima'").as_deref(),
        Some("Dmitri Orlov")
    );
    assert_eq!(count(d, "SELECT rev FROM people WHERE id = 'per_anna'"), 1);
    assert_eq!(count(d, "SELECT rev FROM people WHERE id = 'per_dima'"), 1);
    assert_eq!(
        count(
            d,
            "SELECT count(*) FROM speakers WHERE person_id = 'per_dima'"
        ),
        2
    );
    assert_eq!(
        count(
            d,
            "SELECT count(*) FROM call_participants WHERE person_id = 'per_dima'"
        ),
        2
    );
    assert_eq!(
        count(
            d,
            "SELECT count(*) FROM call_participants WHERE person_id = 'per_anna'"
        ),
        2
    );
    assert_eq!(
        count(
            d,
            "SELECT count(*) FROM person_aliases WHERE person_id = 'per_anna'"
        ),
        0
    );
    assert_eq!(
        count(
            d,
            "SELECT count(*) FROM person_aliases WHERE person_id = 'per_dima'"
        ),
        1
    );
    assert_eq!(
        text(d, "SELECT owner_person_id FROM items WHERE id = 'itm_dima'").as_deref(),
        Some("per_dima")
    );
    assert_eq!(
        text(
            d,
            "SELECT person_id FROM voice_profiles WHERE id = 'vp_dima'"
        )
        .as_deref(),
        Some("per_dima")
    );
}

#[tokio::test]
async fn merge_refuses_self_you_as_source_and_unknown_people() {
    let dir = tempfile::tempdir().unwrap();
    let (core, _) = open(dir.path());
    world(&core);
    let code = |r: Result<PersonMutation, CoreError>| r.unwrap_err().code;
    assert_eq!(
        code(merge(&core, "per_anna", "per_anna").await),
        ErrorCode::InvalidInput
    );
    assert_eq!(
        code(merge(&core, "per_you", "per_anna").await),
        ErrorCode::InvalidInput
    );
    assert_eq!(
        code(merge(&core, "per_anna", "per_gone").await),
        ErrorCode::NotFound
    );
    assert_eq!(
        code(merge(&core, "per_gone", "per_anna").await),
        ErrorCode::NotFound
    );
    // Merging into You keeps the single You and takes the source's work.
    let into_you = merge(&core, "per_anna", "per_you").await.unwrap();
    assert!(into_you.person.is_you);
    assert_eq!(
        count(dir.path(), "SELECT count(*) FROM people WHERE is_you = 1"),
        1
    );
    assert_eq!(
        text(
            dir.path(),
            "SELECT owner_person_id FROM items WHERE id = 'itm_anna'"
        )
        .as_deref(),
        Some("per_you")
    );
}

#[tokio::test]
async fn a_failed_merge_transaction_moves_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let (core, events) = open(dir.path());
    world(&core);
    exec(
        dir.path(),
        "CREATE TRIGGER no_delete BEFORE DELETE ON people BEGIN SELECT RAISE(ABORT, 'forced'); END",
    )
    .unwrap();
    events.named(event_names::ENTITY_CHANGED);
    let d = dir.path();
    let err = merge(&core, "per_dima", "per_anna").await.unwrap_err();
    assert_eq!(err.code, ErrorCode::Internal);
    assert_eq!(
        count(
            d,
            "SELECT count(*) FROM speakers WHERE person_id = 'per_dima'"
        ),
        2
    );
    assert_eq!(
        count(
            d,
            "SELECT count(*) FROM person_aliases WHERE person_id = 'per_anna'"
        ),
        0
    );
    assert_eq!(count(d, "SELECT rev FROM people WHERE id = 'per_anna'"), 1);
    assert_eq!(
        count(
            d,
            "SELECT count(*) FROM changes WHERE entity_type IN ('person', 'speaker')"
        ),
        0
    );
    assert!(
        events.named(event_names::ENTITY_CHANGED).is_empty(),
        "nothing is published"
    );
}

#[tokio::test]
async fn delete_unnames_everywhere_and_keeps_the_words() {
    let dir = tempfile::tempdir().unwrap();
    let (core, events) = open(dir.path());
    world(&core);
    let d = dir.path();
    let result = delete(&core, "per_dima").await.unwrap();
    assert_eq!(result.deleted, 1);
    assert_eq!(
        count(d, "SELECT count(*) FROM people WHERE id = 'per_dima'"),
        0
    );
    for table in ["voice_profiles", "person_aliases", "call_participants"] {
        let sql = format!("SELECT count(*) FROM {table} WHERE person_id = 'per_dima'");
        assert_eq!(count(d, &sql), 0, "{table}");
    }
    assert_eq!(
        count(
            d,
            "SELECT count(*) FROM speakers WHERE person_id = 'per_dima'"
        ),
        0
    );
    assert_eq!(
        count(
            d,
            "SELECT count(*) FROM speakers WHERE id = 'spk_dima' AND name IS NULL AND named_by IS NULL"
        ),
        1
    );
    assert_eq!(
        count(
            d,
            "SELECT count(*) FROM items WHERE id = 'itm_dima' AND owner_person_id IS NULL"
        ),
        1
    );
    assert_eq!(
        count(d, "SELECT count(*) FROM segments WHERE id = 'seg_1'"),
        1,
        "words stay"
    );
    let change = count(
        d,
        "SELECT count(*) FROM changes WHERE entity_type = 'person' AND entity_id = 'per_dima'
           AND undoable = 0 AND before IS NULL AND after IS NULL AND delta IS NULL",
    );
    assert_eq!(
        change, 1,
        "one non-undoable change without personal content"
    );
    let sent = events.named(event_names::ENTITY_CHANGED);
    assert!(
        sent.iter()
            .any(|e| e["type"] == "removed" && e["id"] == "per_dima"),
        "{sent:?}"
    );
    assert_eq!(
        get(&core, "per_dima").await.unwrap_err().code,
        ErrorCode::NotFound
    );
}

#[tokio::test]
async fn delete_refuses_you_and_unknown_people() {
    let dir = tempfile::tempdir().unwrap();
    let (core, _) = open(dir.path());
    world(&core);
    assert_eq!(
        delete(&core, "per_you").await.unwrap_err().code,
        ErrorCode::InvalidInput
    );
    assert_eq!(
        delete(&core, "per_gone").await.unwrap_err().code,
        ErrorCode::NotFound
    );
}

#[tokio::test]
async fn naming_a_speaker_with_a_new_person_creates_the_person_in_the_same_batch() {
    let dir = tempfile::tempdir().unwrap();
    let (core, _) = open(dir.path());
    world(&core);
    let named = core
        .transcript_rename_speaker(
            &ctx(),
            RenameSpeakerArgs {
                call_id: CallId::new("call_b"),
                speaker_id: SpeakerId::new("spk_x"),
                person: PersonRef::New {
                    display_name: "Nina Park".into(),
                    email: None,
                },
                scope: RenameScope::WholeCall,
            },
        )
        .await
        .unwrap();
    let found = list(&core, Some("park")).await.people;
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].short_name, "Nina P.");
    assert_eq!(
        count(dir.path(), "SELECT count(*) FROM voice_profiles"),
        1,
        "naming makes no profile"
    );
    undo(&core, named.change_id).await;
    assert!(
        list(&core, Some("park")).await.people.is_empty(),
        "undo removes the person it made"
    );
}

#[tokio::test]
async fn an_item_owner_chip_reads_the_person_row_and_you_own_by_you() {
    let dir = tempfile::tempdir().unwrap();
    let (core, _) = open(dir.path());
    world(&core);
    exec(
        dir.path(),
        "UPDATE people SET display_name = 'Dmitri Orlov-Smith', short_name = 'Dmitri O.' WHERE id = 'per_dima'",
    )
    .unwrap();
    let theirs = item_of(&core, "itm_dima").await;
    assert_eq!(theirs.owner.unwrap().display_name, "Dmitri Orlov-Smith");
    assert_eq!(theirs.owed, Owed::ToYou);
    let mine = item_of(&core, "itm_you").await;
    assert!(mine.owner.unwrap().is_you);
    assert_eq!(mine.owed, Owed::ByYou);
}

#[tokio::test]
async fn a_person_page_lists_topics_of_their_calls_once_retrieval_has_made_the_table() {
    let dir = tempfile::tempdir().unwrap();
    let (core, _) = open(dir.path());
    world(&core);
    exec(
        dir.path(),
        // `topics` comes from noter-retrieval's migration.
        "INSERT INTO topics VALUES ('top_drawer', 1, 'Drawer redesign', NULL, 1, 5);
         UPDATE items SET topic_id = 'top_drawer' WHERE id IN ('itm_dima', 'itm_q');",
    )
    .unwrap();
    let topics = get(&core, "per_dima").await.unwrap().topics;
    assert_eq!(topics.len(), 1);
    assert_eq!(topics[0].name, "Drawer redesign");
    assert_eq!((topics[0].calls, topics[0].open_items), (1, 2));
    assert_eq!(topics[0].last_seen, TimestampMs(5));
}

#[tokio::test]
async fn a_rename_reaches_the_speakers_of_a_call_without_rewriting_text() {
    let dir = tempfile::tempdir().unwrap();
    let (core, _) = open(dir.path());
    world(&core);
    exec(
        dir.path(),
        "UPDATE people SET short_name = 'Dmitri O.' WHERE id = 'per_dima'",
    )
    .unwrap();
    let patch = PersonPatch {
        display_name: Some("Dmitri Smith".into()),
        ..PersonPatch::default()
    };
    let renamed = update(&core, "per_dima", 1, patch).await.unwrap();
    assert_eq!(
        renamed.person.short_name, "Dmitri S.",
        "a derived short name follows"
    );
    let detail = core
        .call_get(
            &ctx(),
            CallIdArgs {
                call_id: CallId::new("call_a"),
            },
        )
        .await
        .unwrap();
    let names: Vec<String> = detail
        .speakers
        .iter()
        .filter_map(|s| match &s.label {
            SpeakerLabel::Person { person } => Some(person.display_name.clone()),
            _ => None,
        })
        .collect();
    assert!(names.contains(&"Dmitri Smith".to_string()), "{names:?}");
    assert_eq!(
        text(dir.path(), "SELECT text FROM segments WHERE id = 'seg_1'").as_deref(),
        Some("hello there")
    );
}
