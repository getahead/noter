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

/// The clipboard and the folder panel, scripted: the panel answers `answer` (None = cancelled).
struct Native {
    answer: Option<PathBuf>,
    clipboard: Mutex<Vec<ClipboardText>>,
    folder_asked: Mutex<Vec<SaveKind>>,
    clipboard_fails: bool,
}

impl NativeOps for Native {
    fn save_panel<'a>(
        &'a self,
        _: &'a str,
        kind: SaveKind,
    ) -> noter_core::BoxFuture<'a, Option<PathBuf>> {
        self.folder_asked.lock().unwrap().push(kind);
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
        clipboard_fails,
    });
    let deps = CoreDeps::new(Arc::new(SystemClock), Arc::new(Noop)).with_native_ops(native.clone());
    (Core::open(dir, deps).expect("core opens"), native)
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
        (2, 2, 0, false)
    );
    assert!(
        r.text.contains("*Action items*") && r.text.contains("Use Rust"),
        "{}",
        r.text
    );
    assert!(!r.text.contains("Rejected risk"));
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

#[tokio::test]
async fn export_writes_one_file_per_kind_per_call_and_reports_the_count() {
    let dir = tempfile::tempdir().unwrap();
    let out = dir.path().join("out");
    std::fs::create_dir_all(&out).unwrap();
    let (core, _) = open(dir.path(), Some(out.clone()));
    world(&core);
    let r = export(&core, &["call_a"], (true, true, false))
        .await
        .unwrap();
    assert_eq!((r.path.as_str(), r.files), (out.to_str().unwrap(), 3));
    let files = names(&out);
    assert_eq!(files.len(), 3, "{files:?}");
    let md = files.iter().find(|f| f.ends_with(".md")).unwrap();
    let text = std::fs::read_to_string(out.join(md)).unwrap();
    assert!(
        text.contains("Use Rust") && !text.contains("Rejected risk"),
        "{text}"
    );
    let srt = files.iter().find(|f| f.ends_with(".srt")).unwrap();
    let srt = std::fs::read_to_string(out.join(srt)).unwrap();
    assert!(
        srt.contains("1\n00:00:01,000 --> 00:00:04,500\n") && srt.contains("Hello there"),
        "{srt}"
    );
    let json = files.iter().find(|f| f.ends_with(".json")).unwrap();
    let json: Value =
        serde_json::from_str(&std::fs::read_to_string(out.join(json)).unwrap()).unwrap();
    assert_eq!(json.as_array().unwrap().len(), 2);
}

#[tokio::test]
async fn export_scope_keeps_every_format_inside_the_selection() {
    let dir = tempfile::tempdir().unwrap();
    let out = dir.path().join("out");
    std::fs::create_dir_all(&out).unwrap();
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
    assert_eq!(r.files, 1);
    let text = std::fs::read_to_string(out.join(&names(&out)[0])).unwrap();
    assert!(
        text.contains("Use Rust") && !text.contains("Ship"),
        "{text}"
    );
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
    assert_eq!(r.files, 2);
    let files = names(&out);
    assert!(files.iter().all(|f| f.ends_with(".m4a")), "{files:?}");
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
