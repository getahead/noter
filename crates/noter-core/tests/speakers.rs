//! FEATURE cpt-noter-feature-core-speakers-audio (slice 1): `transcript_rename_speaker`,
//! `transcript_name_speakers` and `transcript_fix_term` through the change log, with the
//! constraints file the archive pass reads.

use std::path::Path;
use std::sync::{Arc, Mutex};

use noter_core::{Clock, Core, CoreDeps, EventEmitter};
use noter_db::Insert;
use noter_protocol::error::ValidationRule;
use noter_protocol::ipc::{Caller, CommandCtx, CoreApi};
use noter_protocol::model::*;
use noter_protocol::*;
use serde_json::{json, Value};

const NOW: i64 = 1_792_137_600_000;

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

fn row(table: &'static str, values: &[(&'static str, Value)]) -> Insert {
    Insert {
        table,
        values: values.to_vec(),
    }
}

fn call(id: &str) -> Insert {
    row(
        "calls",
        &[
            ("id", json!(id)),
            ("rev", json!(1)),
            ("started_at", json!(NOW - 3_600_000)),
            ("ended_at", json!(NOW - 3_000_000)),
            ("title", json!(format!("Call {id}"))),
            ("call_type", json!("planning")),
            ("status", json!("ready")),
            ("mode_used", json!("cloud_redacted")),
        ],
    )
}

fn speaker(id: &str, call_id: &str, label: &str, n: Option<u16>, channel: &str) -> Insert {
    row(
        "speakers",
        &[
            ("id", json!(id)),
            ("call_id", json!(call_id)),
            ("label", json!(label)),
            ("n", json!(n)),
            ("channel", json!(channel)),
            ("pass", json!("live")),
        ],
    )
}

fn segment(id: &str, call_id: &str, speaker: &str, t0: i64, text: &str) -> Insert {
    row(
        "segments",
        &[
            ("id", json!(id)),
            ("call_id", json!(call_id)),
            ("speaker_id", json!(speaker)),
            ("channel", json!("sys")),
            ("t0_ms", json!(t0)),
            ("t1_ms", json!(t0 + 900)),
            ("text", json!(text)),
            ("text_norm", json!(text.to_lowercase())),
            ("pass", json!("live")),
        ],
    )
}

/// `call_a`: Speaker 1 says three lines, Speaker 2 two; `call_b` has a speaker of its own.
fn seed(core: &Core) {
    core.store()
        .insert_batch(vec![
            call("call_a"),
            call("call_b"),
            speaker("spk_1", "call_a", "SPEAKER_00", Some(1), "sys"),
            speaker("spk_2", "call_a", "SPEAKER_01", Some(2), "sys"),
            speaker("spk_x", "call_b", "SPEAKER_00", Some(1), "sys"),
            segment("seg_1", "call_a", "spk_1", 0, "kubernets is down"),
            segment("seg_2", "call_a", "spk_1", 2_000, "I will fix it"),
            segment("seg_3", "call_a", "spk_2", 4_000, "ok"),
            segment("seg_4", "call_a", "spk_1", 6_000, "done"),
            segment("seg_x", "call_b", "spk_x", 0, "elsewhere"),
            segment("seg_u", "call_a", "spk_2", 8_000, "Привет kubernets 😀 ok"),
        ])
        .unwrap();
}

fn rename_args(speaker: &str, name: &str, scope: RenameScope) -> RenameSpeakerArgs {
    RenameSpeakerArgs {
        call_id: CallId::new("call_a"),
        speaker_id: SpeakerId::new(speaker),
        person: PersonRef::New {
            display_name: name.into(),
            email: None,
        },
        scope,
    }
}

/// Each line of the call with the name it shows (the name, else the engine label).
fn names_of(core: &Core, call_id: &str) -> Vec<(String, String)> {
    let call = call_id.to_string();
    core.store()
        .read(move |c| {
            let mut stmt = c.prepare(
                "SELECT s.id, COALESCE(p.name, p.label) FROM segments s
                 JOIN speakers p ON p.id = s.speaker_id WHERE s.call_id = ?1 ORDER BY s.t0_ms",
            )?;
            let rows = stmt.query_map([call], |r| Ok((r.get(0)?, r.get(1)?)))?;
            rows.collect::<Result<Vec<_>, _>>()
        })
        .unwrap()
}

fn speaker_count(core: &Core) -> i64 {
    core.store()
        .read(|c| c.query_row("SELECT count(*) FROM speakers", [], |r| r.get(0)))
        .unwrap()
}

fn constraints(dir: &Path) -> Value {
    let text = std::fs::read_to_string(dir.join("audio/call_a/constraints.json"))
        .expect("the constraints file is written");
    serde_json::from_str(&text).unwrap()
}

async fn undo(core: &Core, change_id: &ChangeId) {
    let result = core
        .change_undo(
            &ctx(),
            UndoArgs {
                target: UndoTarget::Change {
                    change_id: change_id.clone(),
                },
            },
        )
        .await
        .unwrap();
    assert!(result.undone > 0);
}

fn named(view: &SpeakerView) -> Option<&str> {
    match &view.label {
        SpeakerLabel::Person { person } => Some(&person.display_name),
        _ => None,
    }
}

#[tokio::test]
async fn naming_a_speaker_for_the_call_renames_every_line_and_undo_restores_them() {
    let dir = tempfile::tempdir().unwrap();
    let (core, events) = open(dir.path());
    seed(&core);

    let done = core
        .transcript_rename_speaker(&ctx(), rename_args("spk_1", "Dana", RenameScope::WholeCall))
        .await
        .unwrap();

    let dana = done
        .speakers
        .iter()
        .find(|s| s.id.as_str() == "spk_1")
        .unwrap();
    assert_eq!(named(dana), Some("Dana"));
    assert_eq!(dana.named_by, Some(NamedBy::You));
    let other = done
        .speakers
        .iter()
        .find(|s| s.id.as_str() == "spk_2")
        .unwrap();
    assert!(matches!(other.label, SpeakerLabel::Unnamed { n: 2 }));
    let lines = names_of(&core, "call_a");
    assert_eq!(
        lines
            .iter()
            .filter(|(_, n)| n == "Dana")
            .map(|(id, _)| id.as_str())
            .collect::<Vec<_>>(),
        ["seg_1", "seg_2", "seg_4"]
    );
    assert_eq!(
        names_of(&core, "call_b")[0].1,
        "SPEAKER_00",
        "another call is untouched"
    );
    assert!(!events.named("entity:changed").is_empty());
    let file = std::fs::read_to_string(dir.path().join("audio/call_a/transcript.jsonl")).unwrap();
    assert!(file.contains("Dana"));

    undo(&core, &done.change_id).await;
    assert!(names_of(&core, "call_a")
        .iter()
        .all(|(_, n)| n.starts_with("SPEAKER_")));
}

#[tokio::test]
async fn naming_one_line_leaves_the_other_lines_alone_and_undo_removes_the_split() {
    let dir = tempfile::tempdir().unwrap();
    let (core, _) = open(dir.path());
    seed(&core);
    let before = speaker_count(&core);

    let done = core
        .transcript_rename_speaker(
            &ctx(),
            rename_args(
                "spk_1",
                "Dana",
                RenameScope::OneSegment {
                    segment_id: SegmentId::new("seg_2"),
                },
            ),
        )
        .await
        .unwrap();

    let lines = names_of(&core, "call_a");
    let by_id = |id: &str| lines.iter().find(|(s, _)| s == id).unwrap().1.clone();
    assert_eq!(by_id("seg_2"), "Dana");
    assert_eq!(
        (by_id("seg_1").as_str(), by_id("seg_4").as_str()),
        ("SPEAKER_00", "SPEAKER_00")
    );
    assert_eq!(speaker_count(&core), before + 1);
    assert_eq!(
        done.speakers
            .iter()
            .filter(|s| named(s) == Some("Dana"))
            .count(),
        1
    );

    // The archive pass must not merge the line back into the cluster it left.
    let file = constraints(dir.path());
    let cannot = file["cannot_link"].as_array().unwrap();
    assert_eq!(cannot.len(), 1);
    let spans: Vec<i64> = [&cannot[0]["a"], &cannot[0]["b"]]
        .iter()
        .map(|s| s["t0_ms"].as_i64().unwrap())
        .collect();
    assert!(
        spans.contains(&2_000),
        "the renamed line is one side: {spans:?}"
    );

    undo(&core, &done.change_id).await;
    assert!(names_of(&core, "call_a")
        .iter()
        .all(|(_, n)| n.starts_with("SPEAKER_")));
    assert_eq!(speaker_count(&core), before);
    assert!(constraints(dir.path())["cannot_link"]
        .as_array()
        .unwrap()
        .is_empty());
}

#[tokio::test]
async fn the_constraints_file_carries_the_names_and_the_whole_call_must_links() {
    let dir = tempfile::tempdir().unwrap();
    let (core, _) = open(dir.path());
    seed(&core);
    core.transcript_rename_speaker(&ctx(), rename_args("spk_1", "Dana", RenameScope::WholeCall))
        .await
        .unwrap();

    let file = constraints(dir.path());
    assert_eq!(file["speaker_names"], json!({ "SPEAKER_00": "Dana" }));
    let must: Vec<(i64, i64)> = file["must_link"]
        .as_array()
        .unwrap()
        .iter()
        .map(|l| {
            (
                l["a"]["t0_ms"].as_i64().unwrap(),
                l["b"]["t0_ms"].as_i64().unwrap(),
            )
        })
        .collect();
    assert_eq!(must, [(0, 2_000), (2_000, 6_000)]);
    for key in ["languages", "glossary", "speaker_priors", "cannot_link"] {
        assert!(file[key].is_array(), "{key} is always present");
    }
}

#[tokio::test]
async fn batch_naming_skips_null_assignments_and_reuses_an_existing_person() {
    let dir = tempfile::tempdir().unwrap();
    let (core, _) = open(dir.path());
    seed(&core);
    let first = core
        .transcript_rename_speaker(&ctx(), rename_args("spk_1", "Dana", RenameScope::WholeCall))
        .await
        .unwrap();
    let person = match &first.speakers[0].label {
        SpeakerLabel::Person { person } => person.id.clone(),
        other => panic!("not named: {other:?}"),
    };
    let assign = |speaker: &str, person: Option<PersonRef>| SpeakerAssignment {
        speaker_id: SpeakerId::new(speaker),
        person,
    };

    let done = core
        .transcript_name_speakers(
            &ctx(),
            NameSpeakersArgs {
                call_id: CallId::new("call_a"),
                assignments: vec![
                    assign("spk_1", None),
                    assign("spk_2", Some(PersonRef::Existing { person_id: person })),
                ],
            },
        )
        .await
        .unwrap();

    assert!(
        done.speakers.iter().all(|s| named(s) == Some("Dana")),
        "{:?}",
        done.speakers
    );
    undo(&core, &done.change_id).await;
    let lines = names_of(&core, "call_a");
    assert_eq!(
        lines.iter().filter(|(_, n)| n == "Dana").count(),
        3,
        "only spk_1 stays named"
    );
}

#[tokio::test]
async fn naming_validates_the_call_the_speaker_and_the_line() {
    let dir = tempfile::tempdir().unwrap();
    let (core, _) = open(dir.path());
    seed(&core);
    let code = |r: Result<SpeakerMutation, CoreError>| r.unwrap_err().code;
    let one = |id: &str| RenameScope::OneSegment {
        segment_id: SegmentId::new(id),
    };

    let mut args = rename_args("spk_1", "Dana", RenameScope::WholeCall);
    args.call_id = CallId::new("nope");
    assert_eq!(
        code(core.transcript_rename_speaker(&ctx(), args).await),
        ErrorCode::NotFound
    );
    let args = rename_args("spk_missing", "Dana", RenameScope::WholeCall);
    assert_eq!(
        code(core.transcript_rename_speaker(&ctx(), args).await),
        ErrorCode::NotFound
    );
    let args = rename_args("spk_x", "Dana", RenameScope::WholeCall);
    assert_eq!(
        code(core.transcript_rename_speaker(&ctx(), args).await),
        ErrorCode::InvalidInput
    );
    let args = rename_args("spk_1", "Dana", one("seg_x"));
    assert_eq!(
        code(core.transcript_rename_speaker(&ctx(), args).await),
        ErrorCode::InvalidInput
    );
    let args = rename_args("spk_1", "Dana", one("seg_missing"));
    assert_eq!(
        code(core.transcript_rename_speaker(&ctx(), args).await),
        ErrorCode::NotFound
    );
    let args = rename_args("spk_1", "Dana", one("seg_3"));
    assert_eq!(
        code(core.transcript_rename_speaker(&ctx(), args).await),
        ErrorCode::InvalidInput,
        "a line of another speaker"
    );
    let args = rename_args("spk_1", "  ", RenameScope::WholeCall);
    let e = core
        .transcript_rename_speaker(&ctx(), args)
        .await
        .unwrap_err();
    assert_eq!(e.code, ErrorCode::InvalidInput);
    assert!(matches!(
        e.detail,
        Some(ErrorDetail::Validation {
            rule: ValidationRule::Required,
            ..
        })
    ));
    let args = RenameSpeakerArgs {
        person: PersonRef::Existing {
            person_id: PersonId::new("per_nobody"),
        },
        ..rename_args("spk_1", "x", RenameScope::WholeCall)
    };
    assert_eq!(
        code(core.transcript_rename_speaker(&ctx(), args).await),
        ErrorCode::NotFound
    );
}

fn fix(segment: &str, start: u32, end: u32, to: &str, teach: bool) -> FixTermArgs {
    FixTermArgs {
        call_id: CallId::new("call_a"),
        segment_id: SegmentId::new(segment),
        range: TextRange { start, end },
        replacement: to.into(),
        add_to_glossary: teach,
    }
}

fn text_of(core: &Core, id: &'static str) -> (String, String, String) {
    core.store()
        .read(move |c| {
            c.query_row(
                "SELECT text, text_norm, corrections FROM segments WHERE id = ?1",
                [id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
        })
        .unwrap()
}

#[tokio::test]
async fn a_term_fix_keeps_the_original_updates_the_search_text_and_teaches_the_glossary() {
    let dir = tempfile::tempdir().unwrap();
    let (core, events) = open(dir.path());
    seed(&core);

    let done = core
        .transcript_fix_term(&ctx(), fix("seg_1", 0, 9, "Kubernetes", true))
        .await
        .unwrap();

    assert_eq!(done.segment.text, "Kubernetes is down");
    assert_eq!(
        done.segment.corrections,
        [TermCorrection {
            range: TextRange { start: 0, end: 10 },
            original: "kubernets".into()
        }]
    );
    assert!(!done.proposal_queued);
    let term = done.glossary_term_id.clone().expect("taught");
    let list = core.glossary_list(&ctx(), NoArgs {}).await.unwrap();
    assert!(list
        .terms
        .iter()
        .any(|t| t.id == term && t.term == "Kubernetes"));
    assert_eq!(text_of(&core, "seg_1").1, "kubernetes is down");
    assert_eq!(
        text_of(&core, "seg_x").0,
        "elsewhere",
        "earlier calls are not rewritten"
    );
    assert!(
        std::fs::read_to_string(dir.path().join("audio/call_a/transcript.jsonl"))
            .unwrap()
            .contains("Kubernetes is down")
    );
    assert!(!events.named("entity:changed").is_empty());

    undo(&core, &done.change_id).await;
    assert_eq!(text_of(&core, "seg_1").0, "kubernets is down");
    assert_eq!(text_of(&core, "seg_1").2, "[]");
    assert!(core
        .glossary_list(&ctx(), NoArgs {})
        .await
        .unwrap()
        .terms
        .is_empty());
}

#[tokio::test]
async fn a_term_fix_without_teaching_leaves_the_glossary_alone_and_counts_utf16_units() {
    let dir = tempfile::tempdir().unwrap();
    let (core, _) = open(dir.path());
    seed(&core);
    // "Привет kubernets 😀 ok": the emoji is two UTF-16 units, so "ok" is at 20..22.
    let done = core
        .transcript_fix_term(&ctx(), fix("seg_u", 7, 16, "Kubernetes", false))
        .await
        .unwrap();
    assert_eq!(done.segment.text, "Привет Kubernetes 😀 ok");
    assert!(done.glossary_term_id.is_none());
    assert!(core
        .glossary_list(&ctx(), NoArgs {})
        .await
        .unwrap()
        .terms
        .is_empty());

    // The first fix grew the text by one unit: "ok" now sits at 21..23 and both fixes stay.
    let again = core
        .transcript_fix_term(&ctx(), fix("seg_u", 21, 23, "OK", false))
        .await
        .unwrap();
    assert_eq!(again.segment.text, "Привет Kubernetes 😀 OK");
    assert_eq!(again.segment.corrections.len(), 2);
}

#[tokio::test]
async fn a_term_fix_refuses_bad_ranges_and_foreign_segments() {
    let dir = tempfile::tempdir().unwrap();
    let (core, _) = open(dir.path());
    seed(&core);
    let code = |r: Result<FixTermResult, CoreError>| r.unwrap_err().code;

    // Inside the emoji's surrogate pair, past the end, empty, reversed.
    for (s, e) in [(18, 19), (0, 99), (3, 3), (5, 2)] {
        let r = core
            .transcript_fix_term(&ctx(), fix("seg_u", s, e, "x", false))
            .await;
        assert_eq!(code(r), ErrorCode::InvalidInput, "{s}..{e}");
    }
    let r = core
        .transcript_fix_term(&ctx(), fix("seg_missing", 0, 1, "x", false))
        .await;
    assert_eq!(code(r), ErrorCode::NotFound);
    let r = core
        .transcript_fix_term(&ctx(), fix("seg_x", 0, 1, "x", false))
        .await;
    assert_eq!(code(r), ErrorCode::InvalidInput);
    let r = core
        .transcript_fix_term(&ctx(), fix("seg_1", 0, 9, "  ", false))
        .await;
    assert_eq!(code(r), ErrorCode::InvalidInput);
    assert_eq!(text_of(&core, "seg_u").0, "Привет kubernets 😀 ok");
}
