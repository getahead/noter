//! FEATURE cpt-noter-feature-core-settings: typed sections with one revision, ignored apps
//! and the glossary, each change logged and broadcast whole.

use std::path::Path;
use std::sync::{Arc, Mutex};

use noter_core::{Clock, Core, CoreDeps, EventEmitter};
use noter_db::rusqlite::Connection;
use noter_protocol::error::ValidationRule;
use noter_protocol::ipc::{dispatch_json, event_names, Caller, CommandCtx, CoreApi};
use noter_protocol::model::*;
use noter_protocol::*;
use serde_json::{json, Value};

#[derive(Default)]
struct Events(Mutex<Vec<(&'static str, Value)>>);

impl EventEmitter for Events {
    fn emit(&self, event: &'static str, payload: Value) {
        self.0.lock().unwrap().push((event, payload));
    }
}

impl Events {
    fn take(&self) -> Vec<(&'static str, Value)> {
        std::mem::take(&mut self.0.lock().unwrap())
    }
}

struct FixedClock;

impl Clock for FixedClock {
    fn now(&self) -> TimestampMs {
        TimestampMs(1_790_000_000_000)
    }
}

fn open(dir: &Path) -> (Core, Arc<Events>) {
    let events = Arc::new(Events::default());
    let deps = CoreDeps::new(Arc::new(FixedClock), events.clone());
    (Core::open(dir, deps).expect("core opens"), events)
}

fn from(label: WindowLabel) -> CommandCtx {
    CommandCtx {
        caller: Caller::Window { label },
    }
}

fn settings_window() -> CommandCtx {
    from(WindowLabel::Settings)
}

fn update(rev: u32, section: SettingsSection) -> SettingsUpdateArgs {
    SettingsUpdateArgs {
        rev: Rev(rev),
        section,
    }
}

type ChangeRow = (
    String,
    String,
    Option<String>,
    Option<String>,
    Option<String>,
);

fn changes(dir: &Path) -> Vec<ChangeRow> {
    let c = Connection::open(dir.join("noter.db")).unwrap();
    let mut s = c
        .prepare("SELECT actor, entity_type, field, before, after FROM changes ORDER BY rowid")
        .unwrap();
    let rows = s
        .query_map([], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?))
        })
        .unwrap();
    rows.map(Result::unwrap).collect()
}

#[tokio::test]
async fn a_fresh_install_answers_every_section_at_its_default() {
    let dir = tempfile::tempdir().unwrap();
    let (core, _) = open(dir.path());
    let s = core
        .settings_get(&from(WindowLabel::Main), NoArgs {})
        .await
        .unwrap();
    assert_eq!((s.version, s.rev), (StateVersion(1), Rev(1)));
    assert_eq!(s, noter_core::default_settings());
    assert_eq!(s.privacy.mode, PrivacyMode::CloudRedacted);
    assert_eq!(s.audio.retention, AudioRetention::Days30);
    let backends = (s.audio.live_backend, s.audio.offline_backend);
    assert_eq!(
        backends,
        (
            TranscriptionBackend::WhisperTurboNoterLoop,
            TranscriptionBackend::WhisperLargeV3
        )
    );
    assert!(
        s.general.launch_at_login && s.general.offer_to_record && s.general.ignored_apps.is_empty()
    );
    assert_eq!(s.general.summary_language, SummaryLanguage::En);
    let card = s.copilot.card_keys;
    assert!(
        card.enabled && card.modifiers.control && card.modifiers.option && card.modifiers.command
    );
    assert!(!s.copilot.dismiss_with_keys);
    assert_eq!(
        (
            s.maintenance.window_start.as_str(),
            s.maintenance.window_end.as_str()
        ),
        ("02:00", "05:00")
    );
    assert_eq!(
        (
            s.performance.near_pct,
            s.performance.over_pct,
            s.performance.retention_days
        ),
        (90, 105, 365)
    );
    assert_eq!(
        (s.updates.channel, s.updates.install_automatically),
        (UpdateChannel::Stable, true)
    );
}

#[tokio::test]
async fn an_update_replaces_one_section_bumps_rev_and_goes_out_whole() {
    let dir = tempfile::tempdir().unwrap();
    let (core, events) = open(dir.path());
    let mut privacy = noter_core::default_settings().privacy;
    privacy.mode = PrivacyMode::LocalOnly;
    let s = core
        .settings_update(
            &settings_window(),
            update(1, SettingsSection::Privacy(privacy)),
        )
        .await
        .unwrap();
    assert_eq!(
        (s.rev, s.version, s.privacy.mode),
        (Rev(2), StateVersion(2), PrivacyMode::LocalOnly)
    );
    assert_eq!(
        events.take(),
        [(
            event_names::SETTINGS_CHANGED,
            serde_json::to_value(&s).unwrap()
        )]
    );
    assert_eq!(
        core.settings_get(&settings_window(), NoArgs {})
            .await
            .unwrap(),
        s
    );

    let logged = changes(dir.path());
    assert_eq!(logged.len(), 1);
    let (actor, entity, field, before, after) = logged[0].clone();
    assert_eq!(
        (actor.as_str(), entity.as_str(), field.as_deref()),
        ("you", "setting", Some("privacy"))
    );
    let before: Value = serde_json::from_str(&before.unwrap()).unwrap();
    let after: Value = serde_json::from_str(&after.unwrap()).unwrap();
    assert_eq!(
        (before["mode"].clone(), after["mode"].clone()),
        (json!("cloud_redacted"), json!("local_only"))
    );

    // Kept across a restart, with its rev.
    core.shutdown().await;
    drop(core);
    let (again, _) = open(dir.path());
    let reloaded = again
        .settings_get(&settings_window(), NoArgs {})
        .await
        .unwrap();
    assert_eq!(
        (reloaded.rev, reloaded.privacy.mode),
        (Rev(2), PrivacyMode::LocalOnly)
    );
}

#[tokio::test]
async fn a_stale_rev_is_a_conflict_and_nothing_is_lost() {
    let dir = tempfile::tempdir().unwrap();
    let (core, events) = open(dir.path());
    let mut general = noter_core::default_settings().general;
    general.launch_at_login = false;
    core.settings_update(
        &settings_window(),
        update(1, SettingsSection::General(general)),
    )
    .await
    .unwrap();
    events.take();
    let mut audio = noter_core::default_settings().audio;
    audio.retention = AudioRetention::Days7;
    let first_run = from(WindowLabel::FirstRun);
    let err = core
        .settings_update(&first_run, update(1, SettingsSection::Audio(audio)))
        .await
        .unwrap_err();
    assert_eq!(err.code, ErrorCode::Conflict);
    assert_eq!(
        err.detail,
        Some(ErrorDetail::Conflict {
            current_rev: Rev(2)
        })
    );
    assert!(events.take().is_empty());
    let s = core
        .settings_get(&settings_window(), NoArgs {})
        .await
        .unwrap();
    assert_eq!(
        (s.rev, s.general.launch_at_login, s.audio.retention),
        (Rev(2), false, AudioRetention::Days30)
    );
    assert_eq!(changes(dir.path()).len(), 1);
}

#[tokio::test]
async fn only_the_settings_and_first_run_windows_write() {
    let dir = tempfile::tempdir().unwrap();
    let (core, _) = open(dir.path());
    let section = SettingsSection::Privacy(noter_core::default_settings().privacy);
    let args = serde_json::to_value(update(1, section)).unwrap();
    let err = dispatch_json(
        &core,
        &from(WindowLabel::Main),
        "settings_update",
        args,
        None,
    )
    .await
    .unwrap_err();
    assert_eq!(err.code, ErrorCode::WindowNotAllowed);
}

fn rule(err: CoreError) -> (ErrorCode, Option<(String, ValidationRule)>) {
    let detail = match err.detail {
        Some(ErrorDetail::Validation { field, rule }) => Some((field, rule)),
        _ => None,
    };
    (err.code, detail)
}

#[tokio::test]
async fn values_out_of_range_are_invalid_input_naming_the_field() {
    let dir = tempfile::tempdir().unwrap();
    let (core, _) = open(dir.path());
    let w = settings_window();
    let mut copilot = noter_core::default_settings().copilot;
    copilot.card_keys.modifiers = Modifiers {
        control: false,
        option: false,
        command: false,
    };
    let err = core
        .settings_update(&w, update(1, SettingsSection::Copilot(copilot)))
        .await
        .unwrap_err();
    let no_modifier = Some(("card_keys.modifiers".into(), ValidationRule::NoModifier));
    assert_eq!(rule(err), (ErrorCode::InvalidInput, no_modifier));
    let mut copilot = noter_core::default_settings().copilot;
    copilot.default_cap_usd = -1.0;
    let err = core
        .settings_update(&w, update(1, SettingsSection::Copilot(copilot)))
        .await
        .unwrap_err();
    assert_eq!(
        rule(err),
        (
            ErrorCode::InvalidInput,
            Some(("default_cap_usd".into(), ValidationRule::OutOfRange))
        )
    );
    let mut performance = noter_core::default_settings().performance;
    performance.over_pct = 80;
    let err = core
        .settings_update(&w, update(1, SettingsSection::Performance(performance)))
        .await
        .unwrap_err();
    assert_eq!(
        rule(err),
        (
            ErrorCode::InvalidInput,
            Some(("over_pct".into(), ValidationRule::OutOfRange))
        )
    );
    let mut maintenance = noter_core::default_settings().maintenance;
    maintenance.window_end = "25:99".into();
    let err = core
        .settings_update(&w, update(1, SettingsSection::Maintenance(maintenance)))
        .await
        .unwrap_err();
    assert_eq!(
        rule(err),
        (
            ErrorCode::InvalidInput,
            Some(("window_end".into(), ValidationRule::InvalidFormat))
        )
    );
    assert!(changes(dir.path()).is_empty());
}

#[tokio::test]
async fn the_core_owns_the_audio_deletion_count() {
    let dir = tempfile::tempdir().unwrap();
    let (core, _) = open(dir.path());
    let mut audio = noter_core::default_settings().audio;
    audio.retention_next_run_deletes = 99;
    audio.retention = AudioRetention::Days90;
    let s = core
        .settings_update(&settings_window(), update(1, SettingsSection::Audio(audio)))
        .await
        .unwrap();
    assert_eq!(
        (s.audio.retention, s.audio.retention_next_run_deletes),
        (AudioRetention::Days90, 0)
    );
}

#[tokio::test]
async fn other_features_hear_about_a_changed_section() {
    let dir = tempfile::tempdir().unwrap();
    let (core, _) = open(dir.path());
    let heard = Arc::new(Mutex::new(vec![]));
    let sink = heard.clone();
    core.on_settings_changed(move |section| sink.lock().unwrap().push(section.clone()));
    let mut general = noter_core::default_settings().general;
    general.offer_to_record = false;
    let section = SettingsSection::General(general);
    core.settings_update(&settings_window(), update(1, section.clone()))
        .await
        .unwrap();
    assert_eq!(*heard.lock().unwrap(), [section]);
}

#[tokio::test]
async fn an_ignored_app_can_be_offered_again() {
    let dir = tempfile::tempdir().unwrap();
    let (core, events) = open(dir.path());
    let w = settings_window();
    let spotify = AppIdArgs {
        bundle_id: "com.spotify.client".into(),
    };
    assert_eq!(
        core.settings_unignore_app(&w, spotify.clone())
            .await
            .unwrap_err()
            .code,
        ErrorCode::NotFound
    );
    let mut general = noter_core::default_settings().general;
    general.ignored_apps = vec![IgnoredApp {
        bundle_id: spotify.bundle_id.clone(),
        app_name: "Spotify".into(),
    }];
    core.settings_update(&w, update(1, SettingsSection::General(general)))
        .await
        .unwrap();
    events.take();
    let s = core.settings_unignore_app(&w, spotify).await.unwrap();
    assert!(s.general.ignored_apps.is_empty());
    assert_eq!((s.rev, s.version), (Rev(3), StateVersion(3)));
    assert_eq!(
        events.take(),
        [(
            event_names::SETTINGS_CHANGED,
            serde_json::to_value(&s).unwrap()
        )]
    );
}

#[tokio::test]
async fn older_or_broken_stored_sections_load_as_the_current_shape() {
    let dir = tempfile::tempdir().unwrap();
    let (core, _) = open(dir.path());
    core.shutdown().await;
    drop(core);
    let c = Connection::open(dir.path().join("noter.db")).unwrap();
    c.execute_batch(
        r#"INSERT INTO settings (key, value) VALUES ('privacy', '{"mode":"local_only","retired_field":1}');
           INSERT INTO settings (key, value) VALUES ('today', 'not json');
           INSERT INTO settings (key, value) VALUES ('rev', '4');"#,
    )
    .unwrap();
    drop(c);
    let (core, _) = open(dir.path());
    let s = core
        .settings_get(&settings_window(), NoArgs {})
        .await
        .unwrap();
    let defaults = noter_core::default_settings();
    assert_eq!(s.rev, Rev(4));
    assert_eq!(s.privacy.mode, PrivacyMode::LocalOnly);
    assert_eq!(
        s.privacy.pseudonymise_names, defaults.privacy.pseudonymise_names,
        "a missing field takes its default"
    );
    assert_eq!(
        s.today, defaults.today,
        "an unreadable section falls back to its defaults"
    );
}

fn term(text: &str) -> GlossaryUpsertArgs {
    GlossaryUpsertArgs {
        id: None,
        rev: None,
        term: text.into(),
        variants_latin: vec!["vee-stor".into()],
        variants_cyrillic: vec!["встор".into()],
        spoken_forms: vec!["v stor".into()],
        lang: Some(Lang::En),
        always_apply: false,
    }
}

#[tokio::test]
async fn glossary_terms_are_added_edited_with_rev_and_removed() {
    let dir = tempfile::tempdir().unwrap();
    let (core, _) = open(dir.path());
    let w = settings_window();
    assert!(core
        .glossary_list(&w, NoArgs {})
        .await
        .unwrap()
        .terms
        .is_empty());
    let heard = Arc::new(Mutex::new(0));
    let sink = heard.clone();
    core.on_glossary_changed(move |_| *sink.lock().unwrap() += 1);

    let list = core.glossary_upsert(&w, term("VSTOR")).await.unwrap();
    let added = list.terms[0].clone();
    assert!(added.id.as_str().starts_with("gls_"));
    assert_eq!(
        (added.rev, added.term.as_str(), added.lang.clone()),
        (Rev(1), "VSTOR", Some(Lang::En))
    );
    assert_eq!(added.variants_cyrillic, ["встор"]);
    assert_eq!(added.added_from, None);

    let mut edit = term("VSTOR storage");
    edit.id = Some(added.id.clone());
    edit.rev = Some(Rev(1));
    edit.always_apply = true;
    let list = core
        .glossary_upsert(&from(WindowLabel::Main), edit.clone())
        .await
        .unwrap();
    assert_eq!(
        (list.terms[0].rev, list.terms[0].always_apply),
        (Rev(2), true)
    );
    let stale = core.glossary_upsert(&w, edit).await.unwrap_err();
    assert_eq!(
        stale.detail,
        Some(ErrorDetail::Conflict {
            current_rev: Rev(2)
        })
    );

    let list = core
        .glossary_remove(
            &w,
            GlossaryIdArgs {
                id: added.id.clone(),
            },
        )
        .await
        .unwrap();
    assert!(list.terms.is_empty());
    let gone = core
        .glossary_remove(&w, GlossaryIdArgs { id: added.id })
        .await
        .unwrap_err();
    assert_eq!(gone.code, ErrorCode::NotFound);
    assert_eq!(*heard.lock().unwrap(), 3);
}

#[tokio::test]
async fn glossary_input_is_checked() {
    let dir = tempfile::tempdir().unwrap();
    let (core, _) = open(dir.path());
    let w = settings_window();
    let err = core.glossary_upsert(&w, term("  ")).await.unwrap_err();
    assert_eq!(
        rule(err),
        (
            ErrorCode::InvalidInput,
            Some(("term".into(), ValidationRule::Required))
        )
    );
    core.glossary_upsert(&w, term("VSTOR")).await.unwrap();
    let err = core.glossary_upsert(&w, term("vstor")).await.unwrap_err();
    assert_eq!(
        rule(err),
        (
            ErrorCode::InvalidInput,
            Some(("term".into(), ValidationRule::Duplicate))
        )
    );
    let mut ghost = term("Ghost");
    ghost.id = Some(GlossaryTermId::new("gls_missing"));
    assert_eq!(
        core.glossary_upsert(&w, ghost).await.unwrap_err().code,
        ErrorCode::NotFound
    );
    // Kept across a restart.
    core.shutdown().await;
    drop(core);
    let (again, _) = open(dir.path());
    let terms = again.glossary_list(&w, NoArgs {}).await.unwrap().terms;
    assert_eq!(
        (terms.len(), terms[0].spoken_forms.clone()),
        (1, vec!["v stor".to_string()])
    );
}

/// D5: every write entry point of this feature leaves exactly one change row per write.
#[tokio::test]
async fn every_settings_write_leaves_one_change_row() {
    let dir = tempfile::tempdir().unwrap();
    let (core, _) = open(dir.path());
    let w = settings_window();
    let mut general = noter_core::default_settings().general;
    general.ignored_apps = vec![IgnoredApp {
        bundle_id: "us.zoom.xos".into(),
        app_name: "Zoom".into(),
    }];
    core.settings_update(&w, update(1, SettingsSection::General(general)))
        .await
        .unwrap();
    assert_eq!(changes(dir.path()).len(), 1);
    core.settings_unignore_app(
        &w,
        AppIdArgs {
            bundle_id: "us.zoom.xos".into(),
        },
    )
    .await
    .unwrap();
    assert_eq!(changes(dir.path()).len(), 2);
    let id = core.glossary_upsert(&w, term("VSTOR")).await.unwrap().terms[0]
        .id
        .clone();
    assert_eq!(changes(dir.path()).len(), 3);
    core.glossary_remove(&w, GlossaryIdArgs { id })
        .await
        .unwrap();
    let all = changes(dir.path());
    assert_eq!(all.len(), 4);
    let entities: Vec<&str> = all.iter().map(|c| c.1.as_str()).collect();
    assert_eq!(entities, ["setting", "setting", "glossary", "glossary"]);
}

#[tokio::test]
async fn an_unreadable_settings_revision_stops_the_boot() {
    let dir = tempfile::tempdir().unwrap();
    let (core, _) = open(dir.path());
    core.shutdown().await;
    drop(core);
    let c = Connection::open(dir.path().join("noter.db")).unwrap();
    c.execute(
        "INSERT INTO settings (key, value) VALUES ('rev', 'not a number')",
        [],
    )
    .unwrap();
    drop(c);
    let deps = CoreDeps::new(Arc::new(FixedClock), Arc::new(Events::default()));
    let err = Core::open(dir.path(), deps).err().expect("boot fails");
    assert!(err.to_string().contains("stored settings"));
}

#[tokio::test]
async fn a_removed_term_logs_every_value_it_had() {
    let dir = tempfile::tempdir().unwrap();
    let (core, _) = open(dir.path());
    let w = settings_window();
    let id = core.glossary_upsert(&w, term("VSTOR")).await.unwrap().terms[0]
        .id
        .clone();
    core.glossary_remove(&w, GlossaryIdArgs { id })
        .await
        .unwrap();
    let c = Connection::open(dir.path().join("noter.db")).unwrap();
    let delta: Vec<u8> = c
        .query_row(
            "SELECT delta FROM changes WHERE reason = 'glossary_remove'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    let delta: Value = serde_json::from_slice(&delta).unwrap();
    let columns = [
        "id",
        "rev",
        "term",
        "variants_latin",
        "variants_cyrillic",
        "spoken_forms",
        "lang",
        "always_apply",
        "added_from",
    ];
    for column in columns {
        assert!(delta.get(column).is_some(), "{column} is not logged");
        assert_eq!(delta[column][1], Value::Null, "{column} after the delete");
    }
    assert_eq!(delta["term"][0], json!("VSTOR"));
    assert_eq!(delta["spoken_forms"][0], json!(r#"["v stor"]"#));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn the_same_new_term_from_two_windows_is_a_duplicate_not_an_error() {
    let dir = tempfile::tempdir().unwrap();
    let (core, _) = open(dir.path());
    let core = Arc::new(core);
    let tries: Vec<_> = (0..8)
        .map(|_| {
            let core = core.clone();
            tokio::spawn(async move {
                core.glossary_upsert(&settings_window(), term("VSTOR"))
                    .await
            })
        })
        .collect();
    for t in tries {
        if let Err(err) = t.await.unwrap() {
            assert_eq!(
                rule(err),
                (
                    ErrorCode::InvalidInput,
                    Some(("term".into(), ValidationRule::Duplicate))
                )
            );
        }
    }
    assert_eq!(
        core.glossary_list(&settings_window(), NoArgs {})
            .await
            .unwrap()
            .terms
            .len(),
        1
    );
}

#[tokio::test]
async fn a_native_surface_is_recorded_on_its_settings_change_rows() {
    let dir = tempfile::tempdir().unwrap();
    let (core, _) = open(dir.path());
    // The menu bar's privacy toggle writes as the user, through that surface.
    let menu_bar = CommandCtx {
        caller: Caller::Native {
            surface: noter_protocol::ipc::NativeSurface::MenuBar,
        },
    };
    let privacy = noter_core::default_settings().privacy;
    core.settings_update(&menu_bar, update(1, SettingsSection::Privacy(privacy)))
        .await
        .unwrap();
    core.glossary_upsert(&settings_window(), term("VSTOR"))
        .await
        .unwrap();
    let c = Connection::open(dir.path().join("noter.db")).unwrap();
    let mut s = c
        .prepare("SELECT actor, surface FROM changes ORDER BY rowid")
        .unwrap();
    let rows: Vec<(String, Option<String>)> = s
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
        .unwrap()
        .map(Result::unwrap)
        .collect();
    assert_eq!(
        rows,
        [
            ("you".to_string(), Some("menu_bar".to_string())),
            ("you".to_string(), None)
        ]
    );
}
