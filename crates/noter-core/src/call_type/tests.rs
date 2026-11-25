use super::*;
use crate::{CoreDeps, EventEmitter, SystemClock};
use noter_db::{Direction, Handle};
use noter_protocol::model::CallUpdateArgs;
use noter_protocol::{CallTypeId, ChangeId};
use std::sync::Arc;

fn transcript_matches(title: &str, lines: &[(&str, &str)]) -> Option<&'static str> {
    let c = Connection::open_in_memory().unwrap();
    c.execute_batch("CREATE TABLE segments(call_id TEXT, pass TEXT, t0_ms INTEGER, text TEXT)")
        .unwrap();
    for (i, (pass, line)) in lines.iter().enumerate() {
        c.execute(
            "INSERT INTO segments VALUES ('call', ?1, ?2, ?3)",
            (pass, i as i64, line),
        )
        .unwrap();
    }
    detect(&c, &CallId::new("call"), title).unwrap()
}

// cpt-noter-seq-core-call-end-outputs
#[test]
fn builtins_match_a_title_or_a_distinctive_spoken_agenda() {
    for (kind, title, first, second) in [
        (
            "one_on_one",
            "Weekly 1:1",
            "Let's discuss your career goals.",
            "How can I support you?",
        ),
        (
            "standup",
            "Команда · Дейли",
            "Вчера я закончил задачу.",
            "Сегодня я начинаю следующую. Блокеров нет.",
        ),
        (
            "planning",
            "Sprintplanung",
            "Unser Sprintziel",
            "Wie viele Storypunkte?",
        ),
        (
            "retro",
            "Sprint retrospective",
            "What went well?",
            "What could we improve?",
        ),
        (
            "cross_team",
            "Cross-team sync",
            "Between our teams",
            "Let's review team dependencies.",
        ),
        (
            "vendor",
            "Gespräch mit Lieferant",
            "We have your proposal.",
            "Let's discuss contract renewal.",
        ),
        (
            "interview",
            "Собеседование",
            "Расскажите о себе.",
            "Почему на эту должность?",
        ),
        (
            "incident",
            "Production war room",
            "Production is down.",
            "Roll back now.",
        ),
    ] {
        assert_eq!(transcript_matches(title, &[]), Some(kind), "{title}");
        assert_eq!(
            transcript_matches("Untitled call", &[("live", first), ("live", second)]),
            Some(kind),
            "{first}"
        );
    }
}

// cpt-noter-seq-core-call-end-outputs
#[test]
fn generic_weekly_updates_do_not_identify_an_agenda() {
    for (earlier, later) in [
        (
            "Yesterday we sent the customer the design.",
            "Today we need a decision.",
        ),
        (
            "Я вчера отправил дизайн.",
            "Я сегодня уточню оценки по эпикам.",
        ),
        (
            "We showed the epics to the customer.",
            "Their estimates include support.",
        ),
        (
            "Вчера мы обсуждали эпики и оценки.",
            "Сегодня мы разберём замечания.",
        ),
    ] {
        assert_eq!(
            transcript_matches("Weekly sync", &[("live", earlier), ("live", later)]),
            None,
            "{earlier}"
        );
    }
}

#[test]
fn titles_distinguish_hiring_interviews_and_daily_scrums_from_other_meetings() {
    for title in [
        "Customer interview",
        "User interview",
        "Research interview",
        "Daily ops review",
        "Jour fixe",
    ] {
        assert_eq!(transcript_matches(title, &[]), None, "{title}");
    }
    for (title, kind) in [
        ("Technical interview", "interview"),
        ("Интервью", "interview"),
        ("Стенд-ап", "standup"),
        ("Daily", "standup"),
        ("Планёрка спринта", "planning"),
        ("Teamübergreifender Jour fixe", "cross_team"),
        ("Vorfall", "incident"),
        ("Produktionsausfall", "incident"),
    ] {
        assert_eq!(transcript_matches(title, &[]), Some(kind), "{title}");
    }
}

#[test]
fn uncertain_evidence_abstains_and_the_current_transcript_is_used() {
    let incident = ("live", "Welcome to the incident bridge.");
    let retro = ("archive", "Let's begin our retrospective.");
    assert_eq!(transcript_matches("Weekly sync", &[]), None);
    assert_eq!(transcript_matches("Release 1.1", &[]), None);
    assert_eq!(
        transcript_matches(
            "Untitled",
            &[
                ("live", "Let's break these epics down."),
                ("live", "What are the effort estimates?")
            ]
        ),
        Some("planning")
    );
    assert_eq!(
        transcript_matches("Metropolitan team", &[("live", "What went well?")]),
        None
    );
    assert_eq!(transcript_matches("Retro and planning", &[incident]), None);
    assert_eq!(
        transcript_matches("Untitled", &[incident, ("live", retro.1)]),
        None
    );
    assert_eq!(
        transcript_matches("Untitled", &[incident, retro]),
        Some("retro")
    );
    assert_eq!(
        transcript_matches("Vendor review", &[incident]),
        Some("vendor")
    );
}

struct Quiet;
impl EventEmitter for Quiet {
    fn emit(&self, _: &'static str, _: serde_json::Value) {}
}

fn seed(core: &Core, id: &str, title: &str) {
    core.store()
        .insert_batch(vec![Insert {
            table: "calls",
            values: vec![
                ("id", json!(id)),
                ("rev", json!(1)),
                ("title", json!(title)),
                ("call_type", json!("unclassified")),
                ("started_at", json!(0)),
                ("ended_at", json!(100)),
                ("status", json!("ready")),
                ("mode_used", json!("cloud")),
            ],
        }])
        .unwrap();
}

// cpt-noter-seq-core-call-end-outputs
#[test]
fn backfill_runs_once_and_respects_manual_choices_and_undo() {
    let dir = tempfile::tempdir().unwrap();
    let open = || {
        Core::open(
            dir.path(),
            CoreDeps::new(Arc::new(SystemClock), Arc::new(Quiet)),
        )
        .unwrap()
    };
    let core = open();
    for id in ["legacy", "manual", "reverted", "reverted_with_title"] {
        seed(&core, id, "Sprint retrospective");
    }
    // A legacy process-name fallback (“Daily”) is not a meeting label. An actual
    // matched event of that name is.
    for (id, event) in [("process", None), ("calendar", Some("event"))] {
        seed(&core, id, "Daily");
        core.write_call(
            &crate::util::main_window_ctx(),
            &CallId::new(id),
            "Captured metadata",
            false,
            vec![
                ("platform", json!("Daily")),
                ("calendar_event_id", json!(event)),
            ],
        )
        .unwrap();
    }
    for id in ["manual", "reverted", "reverted_with_title"] {
        let change = core
            .update_call(
                &crate::util::main_window_ctx(),
                CallUpdateArgs {
                    call_id: CallId::new(id),
                    rev: Rev(1),
                    title: (id == "reverted_with_title").then(|| "My retro".into()),
                    call_type: Some(CallTypeId("planning".into())),
                },
            )
            .unwrap();
        if id != "manual" {
            assert_eq!(
                core.store()
                    .reverse(Direction::Undo, Handle::Change(change.change_id), 100)
                    .unwrap()
                    .done,
                1
            );
        }
    }
    core.backfill_call_types().unwrap();
    let kind = |core: &Core, id| core.call_row(id).unwrap().unwrap().call_type.0;
    assert_eq!(kind(&core, "legacy"), "retro");
    assert_eq!(kind(&core, "process"), "unclassified");
    assert_eq!(kind(&core, "calendar"), "standup");
    assert_eq!(kind(&core, "manual"), "planning");
    assert_eq!(kind(&core, "reverted"), "unclassified");
    assert_eq!(kind(&core, "reverted_with_title"), "unclassified");
    let change = core.store().read(|c| c.query_row(
        "SELECT id FROM changes WHERE entity_id = 'legacy' AND actor LIKE 'job:%' AND field = 'call_type' AND undoable = 1",
        [], |r| r.get::<_, String>(0),
    )).unwrap();
    assert_eq!(
        core.store()
            .reverse(Direction::Undo, Handle::Change(ChangeId::new(change)), 101)
            .unwrap()
            .done,
        1
    );
    core.classify_stopped_call(&CallId::new("legacy")).unwrap();
    assert_eq!(kind(&core, "legacy"), "unclassified");
    drop(core);
    let reopened = open();
    seed(&reopened, "later", "Interview");
    reopened.backfill_call_types().unwrap();
    assert_eq!(kind(&reopened, "later"), "unclassified");
}
