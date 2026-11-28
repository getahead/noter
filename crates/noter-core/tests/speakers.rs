//! FEATURE cpt-noter-feature-core-speakers-audio (slice 1): `transcript_rename_speaker`,
//! `transcript_name_speakers` and `transcript_fix_term` through the change log, with the
//! constraints file the archive pass reads.

#[path = "common/events.rs"]
mod common_events;
#[path = "common/test_support.rs"]
mod test_support;
use std::path::Path;
use std::sync::{Arc, Mutex};
use test_support::FixedClock;

use common_events::Events;
use noter_core::{Core, CoreDeps};
use noter_db::Insert;
use noter_protocol::error::ValidationRule;
use noter_protocol::ipc::{Caller, CommandCtx, CoreApi, Sink};
use noter_protocol::model::*;
use noter_protocol::*;
use serde_json::{json, Value};
#[path = "common/row.rs"]
mod common_row;
use common_row::row;

const NOW: i64 = 1_792_137_600_000;

fn open(dir: &Path) -> (Core, Arc<Events>) {
    let events = Arc::new(Events::default());
    let deps = CoreDeps::new(Arc::new(FixedClock::at(NOW)), events.clone());
    (Core::open(dir, deps).expect("core opens"), events)
}

fn ctx() -> CommandCtx {
    CommandCtx {
        caller: Caller::Window {
            label: WindowLabel::Main,
        },
    }
}

fn collecting<T: Send + 'static>() -> (Sink<T>, Arc<Mutex<Vec<T>>>) {
    let got = Arc::new(Mutex::new(Vec::new()));
    let sink = got.clone();
    (
        Sink::new(move |message| {
            sink.lock().unwrap().push(message);
            true
        }),
        got,
    )
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
            ("status", json!("recording")),
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
    seed_with_status(core, "recording");
}

fn seed_with_status(core: &Core, status: &str) {
    let mut first_call = call("call_a");
    first_call
        .values
        .iter_mut()
        .find(|(col, _)| *col == "status")
        .unwrap()
        .1 = json!(status);
    core.store()
        .insert_batch(vec![
            first_call,
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
    let (sink, updates) = collecting();
    core.transcript_subscribe(
        &ctx(),
        TranscriptSubscribeArgs {
            call_id: CallId::new("call_a"),
        },
        sink,
    )
    .await
    .unwrap();

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
    {
        let updates = updates.lock().unwrap();
        assert!(updates.iter().any(|message| matches!(
            &message.event,
            TranscriptEvent::SegmentsUpdated { segments }
                if segments.iter().any(|segment| segment.call_id.as_str() == "call_a" && segment.id.as_str() == "seg_1")
        )));
        assert!(updates.iter().any(|message| matches!(
            &message.event,
            TranscriptEvent::SpeakersUpdated { speakers, .. }
                if speakers.iter().any(|speaker| speaker.id.as_str() == "spk_1")
        )));
    }
    let changes = events.named("entity:changed");
    assert!(changes.iter().any(|change| {
        change["type"] == "speakers"
            && change["call_id"] == "call_a"
            && change["speakers"]
                .as_array()
                .is_some_and(|rows| rows.iter().any(|row| row["id"] == "spk_1"))
    }));
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

fn text_of(core: &Core, id: &str) -> (String, String, String) {
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
async fn a_term_fix_keeps_nfkc_search_shadow_for_ligatures() {
    let dir = tempfile::tempdir().unwrap();
    let (core, _) = open(dir.path());
    seed(&core);
    core.store()
        .insert_batch(vec![segment(
            "seg_nfkc",
            "call_a",
            "spk_1",
            10_000,
            "ﬁle kubernets",
        )])
        .unwrap();

    core.transcript_fix_term(&ctx(), fix("seg_nfkc", 4, 13, "Kubernetes", false))
        .await
        .unwrap();

    assert_eq!(text_of(&core, "seg_nfkc").1, "file kubernetes");
}

#[tokio::test]
async fn a_term_fix_keeps_the_original_updates_the_search_text_and_teaches_the_glossary() {
    let dir = tempfile::tempdir().unwrap();
    let (core, events) = open(dir.path());
    seed(&core);
    let (sink, updates) = collecting();
    core.transcript_subscribe(
        &ctx(),
        TranscriptSubscribeArgs {
            call_id: CallId::new("call_a"),
        },
        sink,
    )
    .await
    .unwrap();

    let done = core
        .transcript_fix_term(&ctx(), fix("seg_1", 0, 9, "ﬁle Ｗｅｂ Ёлка Straße", true))
        .await
        .unwrap();

    assert_eq!(done.segment.text, "ﬁle Ｗｅｂ Ёлка Straße is down");
    assert_eq!(
        done.segment.corrections,
        [TermCorrection {
            range: TextRange { start: 0, end: 19 },
            original: "kubernets".into()
        }]
    );
    assert!(!done.proposal_queued);
    let term = done.glossary_term_id.clone().expect("taught");
    let list = core.glossary_list(&ctx(), NoArgs {}).await.unwrap();
    assert!(list
        .terms
        .iter()
        .any(|t| t.id == term && t.term == "ﬁle Ｗｅｂ Ёлка Straße"));
    assert_eq!(text_of(&core, "seg_1").1, "file web елка strasse is down");
    let found = core
        .search(
            &ctx(),
            SearchArgs {
                query: "file web елка strasse".into(),
                filter: CallFilter::default(),
                limit: Some(10),
            },
        )
        .await
        .unwrap();
    assert!(
        found.calls.iter().any(|hit| matches!(
            &hit.target,
            HitTarget::Segment { span } if span.call_id.as_str() == "call_a"
        )),
        "normalized keyword query finds corrected segment"
    );
    assert_eq!(
        text_of(&core, "seg_x").0,
        "elsewhere",
        "earlier calls are not rewritten"
    );
    assert!(
        std::fs::read_to_string(dir.path().join("audio/call_a/transcript.jsonl"))
            .unwrap()
            .contains("ﬁle Ｗｅｂ Ёлка Straße is down")
    );
    {
        let updates = updates.lock().unwrap();
        assert!(updates.iter().any(|message| matches!(
            &message.event,
            TranscriptEvent::SegmentsUpdated { segments }
                if segments.iter().any(|segment| segment.id.as_str() == "seg_1" && segment.text == "ﬁle Ｗｅｂ Ёлка Straße is down")
        )));
        assert!(updates.iter().any(|message| matches!(
            &message.event,
            TranscriptEvent::SpeakersUpdated { speakers, .. }
                if speakers.iter().any(|speaker| speaker.id.as_str() == "spk_1")
        )));
    }
    let changes = events.named("entity:changed");
    assert!(changes.iter().any(|change| {
        change["type"] == "speakers"
            && change["call_id"] == "call_a"
            && change["speakers"]
                .as_array()
                .is_some_and(|rows| rows.iter().any(|row| row["id"] == "spk_1"))
    }));

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
async fn an_overlapping_term_fix_replaces_the_previous_correction() {
    let dir = tempfile::tempdir().unwrap();
    let (core, _) = open(dir.path());
    seed(&core);
    core.transcript_fix_term(&ctx(), fix("seg_1", 0, 9, "Kubernetes", false))
        .await
        .unwrap();

    let overlapping = core
        .transcript_fix_term(&ctx(), fix("seg_1", 0, 10, "Kube", false))
        .await
        .unwrap();

    assert_eq!(overlapping.segment.text, "Kube is down");
    assert_eq!(
        overlapping.segment.corrections,
        [TermCorrection {
            range: TextRange { start: 0, end: 4 },
            original: "Kubernetes".into(),
        }]
    );
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

#[tokio::test]
async fn naming_nobody_changes_nothing_and_cannot_be_undone() {
    let dir = tempfile::tempdir().unwrap();
    let (core, _) = open(dir.path());
    seed(&core);
    let done = core
        .transcript_name_speakers(
            &ctx(),
            NameSpeakersArgs {
                call_id: CallId::new("call_a"),
                assignments: vec![],
            },
        )
        .await
        .unwrap();
    assert!(done.speakers.iter().all(|s| named(s).is_none()));
    let undone = core
        .change_undo(
            &ctx(),
            UndoArgs {
                target: UndoTarget::Change {
                    change_id: done.change_id,
                },
            },
        )
        .await;
    assert_eq!(undone.unwrap_err().code, ErrorCode::NotUndoable);
}

#[tokio::test]
async fn a_line_moved_after_a_whole_call_naming_drops_the_must_links_that_touch_it() {
    let dir = tempfile::tempdir().unwrap();
    let (core, _) = open(dir.path());
    seed(&core);
    core.transcript_rename_speaker(&ctx(), rename_args("spk_1", "Dana", RenameScope::WholeCall))
        .await
        .unwrap();
    let one = RenameScope::OneSegment {
        segment_id: SegmentId::new("seg_2"),
    };
    core.transcript_rename_speaker(&ctx(), rename_args("spk_2", "Omar", RenameScope::WholeCall))
        .await
        .unwrap();
    core.transcript_rename_speaker(&ctx(), rename_args("spk_1", "Omar", one))
        .await
        .unwrap();

    let file = constraints(dir.path());
    assert!(file["must_link"]
        .as_array()
        .unwrap()
        .iter()
        .all(|l| l["a"]["t0_ms"] != 2_000 && l["b"]["t0_ms"] != 2_000));
    assert_eq!(file["cannot_link"].as_array().unwrap().len(), 1);
}

// cpt-noter-seq-call-page-name-speakers — #1097: the participant a naming adds is undone with it: one batch, as History's Undo reverts it
#[tokio::test]
async fn undoing_a_naming_removes_the_participant_it_added() {
    let dir = tempfile::tempdir().unwrap();
    let (core, events) = open(dir.path());
    seed(&core);
    let participants = |core: &Core| -> Vec<String> {
        core.store()
            .read(|c| {
                let mut q = c.prepare(
                    "SELECT p.display_name FROM call_participants cp JOIN people p ON p.id = cp.person_id
                     WHERE cp.call_id = 'call_a' ORDER BY 1",
                )?;
                let names = q.query_map([], |r| r.get(0))?.collect();
                names
            })
            .unwrap()
    };
    // Dana exists before the naming (QA named an existing person), so undo can't delete her
    let dana = core
        .person_create(
            &ctx(),
            PersonCreateArgs {
                display_name: "Dana".into(),
                email: None,
                role: None,
                org: None,
            },
        )
        .await
        .unwrap();
    let mut args = rename_args("spk_1", "Dana", RenameScope::WholeCall);
    args.person = PersonRef::Existing {
        person_id: dana.person.id.clone(),
    };
    let done = core.transcript_rename_speaker(&ctx(), args).await.unwrap();
    assert!(participants(&core).contains(&"Dana".to_string()));
    let batch: String = core
        .store()
        .read(|c| {
            c.query_row(
                "SELECT batch_id FROM changes WHERE id = ?1",
                [done.change_id.as_str()],
                |r| r.get(0),
            )
        })
        .unwrap();
    // the call page reads the call row: the undo sends it again without Dana (issue 1097)
    events.named("entity:changed");
    let call_names = |events: &Events| -> Vec<Vec<String>> {
        events
            .named("entity:changed")
            .iter()
            .filter(|c| c["type"] == "call" && c["call"]["id"] == "call_a")
            .map(|c| {
                c["call"]["participants"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|p| p["display_name"].as_str().unwrap().to_string())
                    .collect()
            })
            .collect()
    };
    core.change_undo(
        &ctx(),
        UndoArgs {
            target: UndoTarget::Batch {
                batch_id: BatchId::new(batch),
            },
        },
    )
    .await
    .unwrap();
    assert!(
        !participants(&core).contains(&"Dana".to_string()),
        "{:?}",
        participants(&core)
    );
    let sent = call_names(&events);
    assert!(
        sent.last()
            .is_some_and(|n| !n.contains(&"Dana".to_string())),
        "{sent:?}"
    );
}

#[tokio::test]
async fn splitting_a_stored_line_keeps_the_citation_and_undo_restores_the_index() {
    let dir = tempfile::tempdir().unwrap();
    let deps = CoreDeps {
        engine: Arc::new(
            noter_engine_client::scripted::ScriptedEngine::new().with_container(dir.path()),
        ),
        ..CoreDeps::new(Arc::new(FixedClock::at(NOW)), Arc::new(Events::default()))
    };
    let core = Core::open(dir.path(), deps).unwrap();
    seed_with_status(&core, "ready");
    core.store()
        .insert_batch(vec![
            row(
                "summaries",
                &[
                    ("id", json!("sum_split")),
                    ("rev", json!(1)),
                    ("call_id", json!("call_a")),
                    ("kind", json!("summary")),
                    ("current_version_id", json!("ver_split")),
                ],
            ),
            row(
                "summary_versions",
                &[
                    ("id", json!("ver_split")),
                    ("summary_id", json!("sum_split")),
                    ("n", json!(1)),
                    ("kind", json!("generated")),
                    ("body_md", json!("Unchanged summary.")),
                    ("lang", json!("en")),
                    ("from_pass", json!("live")),
                    ("created_at", json!(NOW)),
                ],
            ),
        ])
        .unwrap();
    let args = SplitSegmentArgs {
        call_id: CallId::new("call_a"),
        segment_id: SegmentId::new("seg_u"),
        at: 20,
        speaker: SplitSpeaker::New,
        expected_text: Some("Привет kubernets 😀 ok".into()),
    };
    assert_eq!(
        core.transcript_split_segment(
            &ctx(),
            SplitSegmentArgs {
                at: 18,
                ..args.clone()
            }
        )
        .await
        .unwrap_err()
        .code,
        ErrorCode::InvalidInput
    );
    let done = core
        .transcript_split_segment(&ctx(), args.clone())
        .await
        .unwrap();
    let [first, second] = &done.segments;
    assert_eq!(first.id, args.segment_id);
    assert_eq!(first.text, "Привет kubernets 😀");
    assert_eq!(first.speaker.speaker_id.as_str(), "spk_2");
    assert_eq!(second.text, "ok");
    assert_ne!(second.id, first.id);
    assert_eq!(first.t1_ms, second.t0_ms);
    assert_eq!(second.speaker.label, SpeakerLabel::Unnamed { n: 3 });
    assert_eq!(
        constraints(dir.path())["cannot_link"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert_eq!(text_of(&core, second.id.as_str()).1, "ok");
    let indexed: i64 = core
        .store()
        .read(|c| {
            c.query_row(
                "SELECT count(*) FROM segments_fts JOIN segments s ON s.rowid = segments_fts.rowid
             WHERE segments_fts MATCH ?1 AND s.id = ?2",
                [r#"" ok""#, second.id.as_str()],
                |r| r.get(0),
            )
        })
        .unwrap();
    assert_eq!(indexed, 1);
    let snapshot =
        std::fs::read_to_string(dir.path().join("audio/call_a/transcript.jsonl")).unwrap();
    assert!(snapshot.lines().any(|row| row.contains(second.id.as_str())));
    let output = || {
        core.store().read(|c| c.query_row(
        "SELECT names_updated, body_md FROM summaries s JOIN summary_versions v ON v.id = s.current_version_id
         WHERE s.id = 'sum_split'", [], |r| Ok((r.get::<_, bool>(0)?, r.get::<_, String>(1)?)),
    )).unwrap()
    };
    assert_eq!(output(), (true, "Unchanged summary.".into()));
    let indexed_chunk = || {
        core.store()
            .read(|c| {
                c.query_row(
                    "SELECT c.text, length(v.embedding) FROM chunks c
                     LEFT JOIN chunk_vec v ON c.id = v.chunk_id WHERE c.call_id = 'call_a'",
                    [],
                    |r| Ok((r.get::<_, String>(0)?, r.get::<_, Option<i64>>(1)?)),
                )
            })
            .unwrap()
    };
    let (chunk, embedding_bytes) = indexed_chunk();
    assert!(chunk.contains("Speaker 3: ok"));
    assert_eq!(embedding_bytes, Some(4096));
    assert_eq!(
        core.transcript_split_segment(&ctx(), args)
            .await
            .unwrap_err()
            .code,
        ErrorCode::Conflict
    );
    undo(&core, &done.change_id).await;
    assert_eq!(output(), (false, "Unchanged summary.".into()));
    let snapshot =
        std::fs::read_to_string(dir.path().join("audio/call_a/transcript.jsonl")).unwrap();
    assert!(!snapshot.lines().any(|row| row.contains(second.id.as_str())));
    assert_eq!(
        text_of(&core, first.id.as_str()).0,
        "Привет kubernets 😀 ok"
    );
    assert_eq!(speaker_count(&core), 3);
    assert!(constraints(dir.path())["cannot_link"]
        .as_array()
        .unwrap()
        .is_empty());
    let (chunk, embedding_bytes) = indexed_chunk();
    assert!(chunk.contains("Speaker 2: Привет kubernets 😀 ok"));
    assert_eq!(embedding_bytes, Some(4096));
}

#[tokio::test]
async fn splitting_uses_word_times_and_keeps_the_corrected_text_and_speaker_choices() {
    let dir = tempfile::tempdir().unwrap();
    let (core, _) = open(dir.path());
    seed_with_status(&core, "ready");
    let call = CallId::new("call_a");
    let id = SegmentId::new("seg_timed");
    let mut line = segment(
        id.as_str(),
        call.as_str(),
        "spk_1",
        10_000,
        "first second third fourth",
    );
    line.values.extend([
        ("words_path", json!("audio/call_a/words/line.json")),
        (
            "corrections",
            json!(r#"[{"range":{"start":0,"end":12},"original":"misheard phrase"}]"#),
        ),
    ]);
    let words = [
        ("first", 10_040),
        ("second", 10_320),
        ("third", 10_620),
        ("fourth", 10_700),
    ]
    .map(|(text, t0)| json!({"t0_ms": t0, "t1_ms": t0 + 50, "text": text, "p": 0.98}));
    let folder = dir.path().join("audio/call_a/words");
    std::fs::create_dir_all(&folder).unwrap();
    std::fs::write(
        folder.join("line.json"),
        serde_json::to_vec(&words).unwrap(),
    )
    .unwrap();
    core.store()
        .insert_batch(vec![
            line,
            speaker("mic", call.as_str(), "you", None, "mic"),
        ])
        .unwrap();
    let (sink, _) = collecting();
    let snapshot = core
        .transcript_subscribe(
            &ctx(),
            TranscriptSubscribeArgs {
                call_id: call.clone(),
            },
            sink,
        )
        .await
        .unwrap();
    assert_eq!(snapshot.split_times[&id][&6], OffsetMs(10_320));

    let base = SplitSegmentArgs {
        call_id: call.clone(),
        segment_id: id,
        at: 6,
        speaker: SplitSpeaker::Existing {
            speaker_id: SpeakerId::new("spk_2"),
        },
        expected_text: None,
    };
    for wrong in ["mic", "spk_x"] {
        let bad = core
            .transcript_split_segment(
                &ctx(),
                SplitSegmentArgs {
                    speaker: SplitSpeaker::Existing {
                        speaker_id: SpeakerId::new(wrong),
                    },
                    ..base.clone()
                },
            )
            .await
            .unwrap_err();
        assert_eq!(bad.code, ErrorCode::InvalidInput);
    }
    let done = core.transcript_split_segment(&ctx(), base).await.unwrap();
    let [first, second] = done.segments;
    assert_eq!(second.speaker.speaker_id.as_str(), "spk_2");
    assert_eq!(second.t0_ms, OffsetMs(10_320));
    assert_eq!(first.corrections[0].range, TextRange { start: 0, end: 5 });
    assert_eq!(second.corrections[0].range, TextRange { start: 0, end: 6 });

    let assignment = SplitSegmentArgs {
        call_id: call,
        segment_id: second.id,
        at: 6 + 1,
        speaker: SplitSpeaker::Person {
            person: PersonRef::New {
                display_name: "Dana Lee".into(),
                email: None,
            },
        },
        expected_text: Some(second.text),
    };
    let assigned = core
        .transcript_split_segment(&ctx(), assignment.clone())
        .await
        .unwrap();
    assert_eq!(assigned.segments[1].t0_ms, OffsetMs(10_620));
    let SpeakerLabel::Person { person } = &assigned.segments[1].speaker.label else {
        panic!("second part has no person")
    };
    assert_eq!(person.display_name, "Dana Lee");
    let participants: i64 = core
        .store()
        .read(|c| {
            c.query_row(
                "SELECT count(*) FROM call_participants WHERE person_id = ?1",
                [person.id.as_str()],
                |r| r.get(0),
            )
        })
        .unwrap();
    assert_eq!(participants, 1);

    let prior = core
        .change_undo(
            &ctx(),
            UndoArgs {
                target: UndoTarget::Change {
                    change_id: done.change_id.clone(),
                },
            },
        )
        .await;
    assert_eq!(prior.unwrap_err().code, ErrorCode::Conflict);
    undo(&core, &assigned.change_id).await;
    assert_eq!(
        text_of(&core, assignment.segment_id.as_str()).0,
        "second third fourth"
    );
    undo(&core, &done.change_id).await;
    let result = core
        .change_redo(
            &ctx(),
            RedoArgs {
                target: UndoTarget::Change {
                    change_id: done.change_id,
                },
            },
        )
        .await
        .unwrap();
    assert!(result.undone > 0);
    assert_eq!(
        text_of(&core, assignment.segment_id.as_str()).0,
        "second third fourth"
    );
}

#[tokio::test]
async fn splitting_is_post_call_only() {
    let dir = tempfile::tempdir().unwrap();
    let (core, _) = open(dir.path());
    seed(&core);
    let args = SplitSegmentArgs {
        call_id: CallId::new("call_a"),
        segment_id: SegmentId::new("seg_1"),
        at: 10,
        speaker: SplitSpeaker::New,
        expected_text: None,
    };
    assert_eq!(
        core.transcript_split_segment(&ctx(), args)
            .await
            .unwrap_err()
            .code,
        ErrorCode::InvalidInput
    );
    assert_eq!(text_of(&core, "seg_1").0, "kubernets is down");
}
