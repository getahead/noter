//! FEATURE cpt-noter-feature-core-items-today (slice 3): `share_copy` and `calls_export` over the
//! native clipboard and folder panel.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use noter_core::{ClipboardText, Core, CoreDeps, NativeOps, SaveKind, SystemClock};
use noter_db::Insert;
use noter_protocol::ipc::{Caller, CommandCtx, CoreApi};
use noter_protocol::model::*;
use noter_protocol::*;
use serde_json::{json, Value};
#[path = "common/row.rs"]
mod common_row;
use common_row::row;

/// The clipboard and the folder panel, scripted: the panel answers `answer` (None = cancelled).
struct Native {
    answer: Option<PathBuf>,
    clipboard: Mutex<Vec<ClipboardText>>,
    folder_asked: Mutex<Vec<SaveKind>>,
    suggested: Mutex<Vec<String>>,
    clipboard_fails: bool,
}

impl NativeOps for Native {
    fn save_panel<'a>(
        &'a self,
        name: &'a str,
        kind: SaveKind,
    ) -> noter_core::BoxFuture<'a, Option<PathBuf>> {
        self.folder_asked.lock().unwrap().push(kind);
        self.suggested.lock().unwrap().push(name.to_owned());
        Box::pin(async move { self.answer.clone() })
    }

    fn clipboard_write<'a>(
        &'a self,
        text: &'a ClipboardText,
    ) -> noter_core::BoxFuture<'a, Result<(), String>> {
        Box::pin(async move {
            if self.clipboard_fails {
                return Err("pasteboard busy".into());
            }
            self.clipboard.lock().unwrap().push(text.clone());
            Ok(())
        })
    }
}

struct Noop;

impl noter_core::EventEmitter for Noop {
    fn emit(&self, _: &'static str, _: Value) {}
}

fn open(dir: &Path, answer: Option<PathBuf>) -> (Core, Arc<Native>) {
    open_with(dir, answer, false)
}

fn open_with(dir: &Path, answer: Option<PathBuf>, clipboard_fails: bool) -> (Core, Arc<Native>) {
    let native = Arc::new(Native {
        answer,
        clipboard: Mutex::default(),
        folder_asked: Mutex::default(),
        suggested: Mutex::default(),
        clipboard_fails,
    });
    let deps = CoreDeps {
        native_ops: native.clone(),
        ..CoreDeps::new(Arc::new(SystemClock), Arc::new(Noop))
    };
    (Core::open(dir, deps).expect("core opens"), native)
}

fn ctx() -> CommandCtx {
    CommandCtx {
        caller: Caller::Window {
            label: WindowLabel::Main,
        },
    }
}

fn call(id: &str, privacy: &str, outputs: &str, audio_deleted: i64) -> Insert {
    row(
        "calls",
        &[
            ("id", json!(id)),
            ("rev", json!(1)),
            ("started_at", json!(1_792_000_000_000_i64)),
            ("ended_at", json!(1_792_000_600_000_i64)),
            ("title", json!(format!("Call {id}"))),
            ("call_type", json!("planning")),
            ("status", json!("ready")),
            ("outputs_status", json!(outputs)),
            ("privacy_class", json!(privacy)),
            ("audio_deleted", json!(audio_deleted)),
            ("mode_used", json!("cloud_redacted")),
        ],
    )
}

fn item(id: &str, call_id: &str, kind: &str, text: &str, review: &str) -> Insert {
    row(
        "items",
        &[
            ("id", json!(id)),
            ("rev", json!(1)),
            ("call_id", json!(call_id)),
            ("kind", json!(kind)),
            ("text", json!(text)),
            ("lang", json!("en")),
            ("status", json!("open")),
            ("review_state", json!(review)),
            ("created_by", json!("llm")),
            ("is_engineering", json!(0)),
        ],
    )
}

fn segment(id: &str, call_id: &str, t0: i64, t1: i64, text: &str) -> Insert {
    row(
        "segments",
        &[
            ("id", json!(id)),
            ("call_id", json!(call_id)),
            ("channel", json!("sys")),
            ("t0_ms", json!(t0)),
            ("t1_ms", json!(t1)),
            ("text", json!(text)),
            ("text_norm", json!(text.to_lowercase())),
            ("pass", json!("live")),
        ],
    )
}

/// A committed section: its row and the one generated version it points at.
fn section(call_id: &str, kind: &str, body: &str) -> Vec<Insert> {
    let (id, version) = (
        format!("sum_{call_id}_{kind}"),
        format!("ver_{call_id}_{kind}"),
    );
    vec![
        row(
            "summaries",
            &[
                ("id", json!(id)),
                ("rev", json!(1)),
                ("call_id", json!(call_id)),
                ("kind", json!(kind)),
                ("current_version_id", json!(version)),
            ],
        ),
        row(
            "summary_versions",
            &[
                ("id", json!(version)),
                ("summary_id", json!(id)),
                ("n", json!(1)),
                ("kind", json!("generated")),
                ("body_md", json!(body)),
                ("lang", json!("en")),
                ("from_pass", json!("live")),
                ("created_at", json!(1_792_000_700_000_i64)),
            ],
        ),
    ]
}

fn world(core: &Core) {
    core.store()
        .insert_batch(vec![
            call("call_a", "normal", "ready", 0),
            call("call_sens", "sensitive", "ready", 0),
            call("call_new", "normal", "writing", 0),
            call("call_gone", "normal", "ready", 1),
            item("itm_1", "call_a", "action_item", "Ship *it*", "accepted"),
            item("itm_2", "call_a", "decision", "Use Rust", "accepted"),
            item("itm_3", "call_a", "risk", "Rejected risk", "rejected"),
            item("itm_s", "call_sens", "decision", "Secret", "accepted"),
            item("itm_g", "call_gone", "decision", "Old", "accepted"),
            segment("seg_1", "call_a", 1_000, 4_500, "Hello there"),
            segment("seg_2", "call_a", 5_000, 7_000, "Ship it"),
        ])
        .unwrap();
    let mut rows: Vec<Insert> = ["call_a", "call_sens", "call_gone"]
        .into_iter()
        .flat_map(|c| ["decisions", "action_items", "risks"].map(|k| (c, k)))
        .flat_map(|(c, k)| section(c, k, &format!("- body of {k}")))
        .collect();
    rows.extend(section(
        "call_a",
        "summary",
        "We **agreed** to ship <script>x</script>.",
    ));
    core.store().insert_batch(rows).unwrap();
}

fn args(call_id: &str, format: ShareFormat) -> ShareCopyArgs {
    ShareCopyArgs {
        call_id: CallId::new(call_id),
        scope: ShareScope {
            sections: vec![],
            item_ids: vec![],
            include_unreviewed: false,
        },
        format,
    }
}

async fn export(
    core: &Core,
    ids: &[&str],
    include: (bool, bool, bool),
) -> Result<ExportResult, CoreError> {
    core.calls_export(
        &ctx(),
        ExportCallsArgs {
            call_ids: ids.iter().map(|i| CallId::new(*i)).collect(),
            include: ExportInclude {
                summary_and_items: include.0,
                transcript: include.1,
                audio: include.2,
            },
            scope: None,
        },
    )
    .await
}

fn names(dir: &Path) -> Vec<String> {
    let mut all: Vec<String> = std::fs::read_dir(dir)
        .map(|d| {
            d.flatten()
                .map(|e| e.file_name().to_string_lossy().into_owned())
                .collect()
        })
        .unwrap_or_default();
    all.sort();
    all
}

#[tokio::test]
// cpt-noter-algo-core-items-today-format: owners are data in clipboard and exported Markdown.
async fn markdown_copy_and_export_escape_owner_markup() {
    for (owner, escaped) in [
        (
            "[x](https://example.invalid)",
            r"\[x\](https://example.invalid)",
        ),
        (
            r#"<img src=x onerror="alert(1)">"#,
            r#"\<img src=x onerror="alert(1)"\>"#,
        ),
        (
            r"Anna \ `code` *bold* _name_",
            r"Anna \\ \`code\` \*bold\* \_name\_",
        ),
    ] {
        let dir = tempfile::tempdir().unwrap();
        let out = dir.path().join("out");
        let (core, native) = open(dir.path(), Some(out.clone()));
        world(&core);
        let mut owned = item(
            "itm_owned",
            "call_a",
            "action_item",
            "Owned task",
            "accepted",
        );
        owned.values.extend([
            ("owner_person_id", json!("per_owner")),
            ("due_date", json!("2026-10-16")),
        ]);
        core.store()
            .insert_batch(vec![
                row(
                    "people",
                    &[
                        ("id", json!("per_owner")),
                        ("rev", json!(1)),
                        ("display_name", json!(owner)),
                        ("short_name", json!(owner)),
                    ],
                ),
                owned,
            ])
            .unwrap();
        let expected = format!("Owned task — {escaped}, due 2026-10-16");
        for format in [ShareFormat::Markdown, ShareFormat::Slack, ShareFormat::Jira] {
            let result = core
                .share_copy(&ctx(), args("call_a", format))
                .await
                .unwrap();
            if format == ShareFormat::Markdown {
                assert!(result.text.contains(&expected), "{}", result.text);
            }
            let board = native.clipboard.lock().unwrap();
            let markdown = board.last().unwrap().markdown.as_ref().unwrap();
            assert!(markdown.contains(&expected), "{markdown}");
            assert!(!markdown.contains(owner), "{markdown}");
        }
        let result = export(&core, &["call_a"], (true, false, false))
            .await
            .unwrap();
        assert_eq!(result.files, 2); // call.json and summary.md
        let markdown = std::fs::read_to_string(out.join("summary.md")).unwrap();
        assert!(markdown.contains(&expected), "{markdown}");
        assert!(!markdown.contains(owner), "{markdown}");
    }
}

#[tokio::test]
async fn share_copy_puts_plain_markdown_and_html_on_the_clipboard() {
    let dir = tempfile::tempdir().unwrap();
    let (core, native) = open(dir.path(), None);
    world(&core);
    let r = core
        .share_copy(&ctx(), args("call_a", ShareFormat::Slack))
        .await
        .unwrap();
    assert_eq!(
        (r.sections, r.items, r.unreviewed_in_scope, r.sensitive),
        (3, 2, 0, false)
    );
    assert!(
        r.text.contains("*Action items*") && r.text.contains("Use Rust"),
        "{}",
        r.text
    );
    assert!(!r.text.contains("Rejected risk") && !r.text.contains("body of risks"));
    assert!(
        r.text.contains("*agreed*") && r.text.contains("&lt;script&gt;"),
        "{}",
        r.text
    );
    let board = native.clipboard.lock().unwrap();
    assert_eq!(board.len(), 1);
    assert_eq!(board[0].plain, r.text);
    assert!(board[0].markdown.as_ref().unwrap().contains("## Decisions"));
    assert!(board[0]
        .html
        .as_ref()
        .unwrap()
        .contains("<h2>Decisions</h2>"));
}

#[tokio::test]
async fn share_copy_of_one_section_copies_that_section_only() {
    let dir = tempfile::tempdir().unwrap();
    let (core, _) = open(dir.path(), None);
    world(&core);
    let mut one = args("call_a", ShareFormat::Markdown);
    one.scope.sections = vec![SectionKind::Summary];
    let r = core.share_copy(&ctx(), one).await.unwrap();
    assert_eq!((r.sections, r.items), (1, 0));
    assert!(
        r.text.contains("agreed") && !r.text.contains("Use Rust"),
        "{}",
        r.text
    );
}

#[tokio::test]
async fn share_copy_reports_a_sensitive_call_and_still_copies() {
    let dir = tempfile::tempdir().unwrap();
    let (core, native) = open(dir.path(), None);
    world(&core);
    let r = core
        .share_copy(&ctx(), args("call_sens", ShareFormat::Markdown))
        .await
        .unwrap();
    assert!(r.sensitive);
    assert_eq!(native.clipboard.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn share_copy_guards_unreviewed_items_and_leaves_the_clipboard_alone() {
    let dir = tempfile::tempdir().unwrap();
    let (core, native) = open(dir.path(), None);
    world(&core);
    core.store()
        .insert_batch(vec![item(
            "itm_x",
            "call_a",
            "decision",
            "Maybe",
            "suggested",
        )])
        .unwrap();
    let e = core
        .share_copy(&ctx(), args("call_a", ShareFormat::Markdown))
        .await
        .unwrap_err();
    assert_eq!(e.code, ErrorCode::UnreviewedInScope);
    assert!(native.clipboard.lock().unwrap().is_empty());
    let mut with = args("call_a", ShareFormat::Markdown);
    with.scope.include_unreviewed = true;
    let r = core.share_copy(&ctx(), with).await.unwrap();
    assert_eq!((r.items, r.unreviewed_in_scope), (3, 1));
    assert!(r.text.contains("Not reviewed"));
}

#[tokio::test]
async fn share_copy_of_a_call_still_being_written_is_outputs_not_ready() {
    let dir = tempfile::tempdir().unwrap();
    let (core, native) = open(dir.path(), None);
    world(&core);
    core.store()
        .insert_batch(vec![item(
            "itm_n", "call_new", "decision", "Early", "accepted",
        )])
        .unwrap();
    let e = core
        .share_copy(&ctx(), args("call_new", ShareFormat::Jira))
        .await
        .unwrap_err();
    assert_eq!(e.code, ErrorCode::OutputsNotReady);
    assert!(native.clipboard.lock().unwrap().is_empty());
}

#[tokio::test]
async fn share_copy_of_an_unknown_call_is_not_found_and_a_foreign_item_is_invalid() {
    let dir = tempfile::tempdir().unwrap();
    let (core, _) = open(dir.path(), None);
    world(&core);
    let e = core
        .share_copy(&ctx(), args("call_nope", ShareFormat::Jira))
        .await
        .unwrap_err();
    assert_eq!(e.code, ErrorCode::NotFound);
    let mut foreign = args("call_a", ShareFormat::Jira);
    foreign.scope.item_ids = vec![ItemId::new("itm_s")];
    let e = core.share_copy(&ctx(), foreign).await.unwrap_err();
    assert_eq!(e.code, ErrorCode::InvalidInput);
}

#[tokio::test]
async fn share_copy_fails_when_the_pasteboard_does() {
    let dir = tempfile::tempdir().unwrap();
    let (core, _) = open_with(dir.path(), None, true);
    world(&core);
    let e = core
        .share_copy(&ctx(), args("call_a", ShareFormat::Markdown))
        .await
        .unwrap_err();
    assert_eq!(e.code, ErrorCode::Internal);
}

#[tokio::test]
async fn export_cancelled_writes_nothing_and_asks_for_a_folder() {
    let dir = tempfile::tempdir().unwrap();
    let (core, native) = open(dir.path(), None);
    world(&core);
    let e = export(&core, &["call_a"], (true, true, false))
        .await
        .unwrap_err();
    assert_eq!(e.code, ErrorCode::Cancelled);
    assert_eq!(*native.folder_asked.lock().unwrap(), vec![SaveKind::Folder]);
}

// cpt-noter-seq-call-page-share-outputs (Other — Export to a folder) — #1146: PRD › Export and
// portability: a folder per call with call.json, summary.md, transcript.md, SRT and JSON, audio
#[tokio::test]
async fn export_of_one_call_writes_the_prd_folder_named_after_the_call() {
    let dir = tempfile::tempdir().unwrap();
    let out = dir.path().join("Call call_a 14 Oct");
    let (core, native) = open(dir.path(), Some(out.clone()));
    world(&core);
    let r = export(&core, &["call_a"], (true, true, false))
        .await
        .unwrap();
    // the save panel suggests the call's own folder: "<title> <day> <month>" (DESIGN 2467)
    assert_eq!(
        *native.suggested.lock().unwrap(),
        vec!["Call call_a 14 Oct"]
    );
    assert_eq!((r.path.as_str(), r.files), (out.to_str().unwrap(), 5));
    assert_eq!(
        names(&out),
        [
            "call.json",
            "summary.md",
            "transcript.json",
            "transcript.md",
            "transcript.srt"
        ]
    );
    let call: Value =
        serde_json::from_str(&std::fs::read_to_string(out.join("call.json")).unwrap()).unwrap();
    assert_eq!(call["call"]["id"], "call_a");
    assert_eq!(call["call"]["title"], "Call call_a");
    assert!(call["call"]["participants"].is_array(), "{call}");
    let items: Vec<&str> = call["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|i| i["text"].as_str().unwrap())
        .collect();
    assert!(
        items.contains(&"Use Rust") && !items.contains(&"Rejected risk"),
        "{items:?}"
    );
    let summary = std::fs::read_to_string(out.join("summary.md")).unwrap();
    assert!(
        summary.starts_with("# Call call\\_a\n") && summary.contains("Use Rust"),
        "{summary}"
    );
    let transcript = std::fs::read_to_string(out.join("transcript.md")).unwrap();
    assert!(transcript.starts_with("# Call call\\_a\n"), "{transcript}");
    assert!(
        transcript.contains("00:00:01") && transcript.contains("Hello there"),
        "{transcript}"
    );
    let srt = std::fs::read_to_string(out.join("transcript.srt")).unwrap();
    assert!(
        srt.contains("1\n00:00:01,000 --> 00:00:04,500\n") && srt.contains("Hello there"),
        "{srt}"
    );
    let json: Value =
        serde_json::from_str(&std::fs::read_to_string(out.join("transcript.json")).unwrap())
            .unwrap();
    assert_eq!(json.as_array().unwrap().len(), 2);
}

// #1146: call.json identifies the call in every export; its items follow Summary and items
#[tokio::test]
async fn a_transcript_only_export_still_has_call_json_without_items() {
    let dir = tempfile::tempdir().unwrap();
    let out = dir.path().join("out");
    let (core, _) = open(dir.path(), Some(out.clone()));
    world(&core);
    let r = export(&core, &["call_a"], (false, true, false))
        .await
        .unwrap();
    assert_eq!(r.files, 4);
    assert!(!names(&out).contains(&"summary.md".to_owned()));
    let call: Value =
        serde_json::from_str(&std::fs::read_to_string(out.join("call.json")).unwrap()).unwrap();
    assert_eq!(call["items"], json!([]));
}

// cpt-noter-seq-library-filter-calls (Happy path, steps 4–7) — #1146: several calls, a folder each
#[tokio::test]
async fn export_of_several_calls_writes_one_folder_per_call() {
    let dir = tempfile::tempdir().unwrap();
    let out = dir.path().join("Noter export");
    let (core, native) = open(dir.path(), Some(out.clone()));
    world(&core);
    let result = export(&core, &["call_a", "call_sens"], (false, true, false))
        .await
        .unwrap();
    assert_eq!(*native.suggested.lock().unwrap(), vec!["Noter export"]);
    assert_eq!(result.path, out.to_str().unwrap());
    assert_eq!(names(&out), ["Call call_a 14 Oct", "Call call_sens 14 Oct"]);
    assert_eq!(result.files, 8);
    assert!(names(&out.join("Call call_sens 14 Oct")).contains(&"call.json".to_owned()));
}

// #1146: two calls with the same title and day do not share a folder
#[tokio::test]
async fn calls_with_the_same_name_get_numbered_folders() {
    let dir = tempfile::tempdir().unwrap();
    let out = dir.path().join("out");
    let (core, _) = open(dir.path(), Some(out.clone()));
    world(&core);
    let titled = |id: &str| {
        let mut c = call(id, "normal", "ready", 0);
        for (k, v) in &mut c.values {
            if *k == "title" {
                *v = json!("Sync / QA: weekly");
            }
        }
        c
    };
    core.store()
        .insert_batch(vec![titled("call_x"), titled("call_y")])
        .unwrap();
    export(&core, &["call_x", "call_y"], (false, true, false))
        .await
        .unwrap();
    // a slash or colon cannot name a macOS folder in Finder
    assert_eq!(
        names(&out),
        ["Sync - QA- weekly 14 Oct", "Sync - QA- weekly 14 Oct 2"]
    );
}

#[tokio::test]
async fn export_scope_keeps_every_format_inside_the_selection() {
    let dir = tempfile::tempdir().unwrap();
    let out = dir.path().join("out");
    let (core, _) = open(dir.path(), Some(out.clone()));
    world(&core);
    let r = core
        .calls_export(
            &ctx(),
            ExportCallsArgs {
                call_ids: vec![CallId::new("call_a")],
                include: ExportInclude {
                    summary_and_items: true,
                    transcript: false,
                    audio: false,
                },
                scope: Some(ShareScope {
                    sections: vec![],
                    item_ids: vec![ItemId::new("itm_2")],
                    include_unreviewed: false,
                }),
            },
        )
        .await
        .unwrap();
    assert_eq!(r.files, 2);
    let text = std::fs::read_to_string(out.join("summary.md")).unwrap();
    assert!(
        text.contains("Use Rust") && !text.contains("Ship"),
        "{text}"
    );
    let call: Value =
        serde_json::from_str(&std::fs::read_to_string(out.join("call.json")).unwrap()).unwrap();
    assert_eq!(call["items"].as_array().unwrap().len(), 1, "{call}");
}

#[tokio::test]
async fn export_of_deleted_audio_is_audio_deleted_with_nothing_written() {
    let dir = tempfile::tempdir().unwrap();
    let out = dir.path().join("out");
    std::fs::create_dir_all(&out).unwrap();
    let (core, _) = open(dir.path(), Some(out.clone()));
    world(&core);
    let e = export(&core, &["call_gone"], (true, false, true))
        .await
        .unwrap_err();
    assert_eq!(e.code, ErrorCode::AudioDeleted);
    assert!(names(&out).is_empty());
}

#[tokio::test]
async fn export_copies_the_audio_files_that_are_kept() {
    let dir = tempfile::tempdir().unwrap();
    let out = dir.path().join("out");
    std::fs::create_dir_all(&out).unwrap();
    let (core, _) = open(dir.path(), Some(out.clone()));
    world(&core);
    let audio = dir.path().join("audio").join("call_a");
    std::fs::create_dir_all(&audio).unwrap();
    std::fs::write(audio.join("mic.m4a"), b"mic").unwrap();
    std::fs::write(audio.join("sys.m4a"), b"sys").unwrap();
    std::fs::write(audio.join("transcript.jsonl"), b"private").unwrap();
    let r = export(&core, &["call_a"], (false, false, true))
        .await
        .unwrap();
    assert_eq!(r.files, 3);
    // the audio as recorded, beside call.json; never the private transcript.jsonl
    assert_eq!(names(&out), ["call.json", "mic.m4a", "sys.m4a"]);
}

#[tokio::test]
async fn export_validates_the_calls_before_the_panel_opens() {
    let dir = tempfile::tempdir().unwrap();
    let (core, native) = open(dir.path(), Some(dir.path().join("out")));
    world(&core);
    let e = export(&core, &[], (true, false, false)).await.unwrap_err();
    assert_eq!(e.code, ErrorCode::InvalidInput);
    let e = export(&core, &["call_nope"], (true, false, false))
        .await
        .unwrap_err();
    assert_eq!(e.code, ErrorCode::NotFound);
    let e = export(&core, &["call_a"], (false, false, false))
        .await
        .unwrap_err();
    assert_eq!(e.code, ErrorCode::InvalidInput);
    assert!(native.folder_asked.lock().unwrap().is_empty());
}

// cpt-noter-seq-call-page-share-outputs — #1053
#[tokio::test]
async fn exported_markdown_opens_with_the_call_title_date_and_participants() {
    let dir = tempfile::tempdir().unwrap();
    let out = dir.path().join("out");
    let (core, _) = open(dir.path(), Some(out.clone()));
    world(&core);
    core.store()
        .insert_batch(vec![
            row(
                "people",
                &[
                    ("id", json!("per_dana")),
                    ("rev", json!(1)),
                    ("display_name", json!("Dana Ito")),
                    ("short_name", json!("Dana")),
                ],
            ),
            row(
                "call_guests",
                &[
                    ("id", json!("guest_1")),
                    ("call_id", json!("call_a")),
                    ("display_name", json!("Guest")),
                    ("email", json!("private@example.test")),
                ],
            ),
            row(
                "call_participants",
                &[
                    ("id", json!("cp_1")),
                    ("call_id", json!("call_a")),
                    ("person_id", json!("per_dana")),
                ],
            ),
        ])
        .unwrap();
    export(&core, &["call_a"], (true, false, false))
        .await
        .unwrap();
    let text = std::fs::read_to_string(out.join("summary.md")).unwrap();
    let metadata = std::fs::read_to_string(out.join("call.json")).unwrap();
    assert!(!metadata.contains("private@example.test"));
    assert!(metadata.contains("Guest"));
    assert!(!text.contains("private@example.test"));
    // a pasted export says which call it is (issue 1053)
    assert!(
        text.starts_with("# Call call\\_a\n\n2026-10-14 · Dana Ito · Guest (Invited)\n\n"),
        "{text}"
    );
}

// cpt-noter-seq-call-page-share-outputs — #1053
#[tokio::test]
async fn a_refused_export_leaves_no_folder_it_created() {
    let dir = tempfile::tempdir().unwrap();
    let out = dir.path().join("Noter export");
    let (core, native) = open(dir.path(), Some(out.clone()));
    world(&core);
    let e = export(&core, &["call_new"], (true, false, false))
        .await
        .unwrap_err();
    assert_eq!(e.code, ErrorCode::OutputsNotReady);
    assert!(!out.exists(), "issue 1053: an empty export folder was left");
    // refused before the panel: a panel that makes the folder it answers never opens (issue 1053)
    assert!(native.folder_asked.lock().unwrap().is_empty());
}

#[tokio::test]
async fn export_that_cannot_write_returns_an_error_and_no_count() {
    let dir = tempfile::tempdir().unwrap();
    // The panel answered a path that is a file, not a folder.
    let blocker = dir.path().join("blocker");
    std::fs::write(&blocker, b"x").unwrap();
    let (core, _) = open(dir.path(), Some(blocker));
    world(&core);
    let e = export(&core, &["call_a"], (true, false, false))
        .await
        .unwrap_err();
    assert_eq!(e.code, ErrorCode::Internal);
}
