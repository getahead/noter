//! FEATURE cpt-noter-feature-core-handoff: the ten handoff and repository commands over the
//! scripted runtime and scripted native ops (TL-13, TL-15), on paused time.

use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use noter_core::{
    Adapters, ClipboardText, Clock, Core, CoreDeps, EventEmitter, LaunchRequest, NativeOps,
    SaveKind, Scripted,
};
use noter_db::Insert;
use noter_protocol::ipc::{event_names, Caller, CommandCtx, CoreApi};
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
    /// The handoff views published so far, oldest first (taken).
    fn handoffs(&self) -> Vec<HandoffView> {
        let mut all = self.0.lock().unwrap();
        let (taken, kept): (Vec<_>, Vec<_>) = std::mem::take(&mut *all)
            .into_iter()
            .partition(|(e, p)| *e == event_names::ENTITY_CHANGED && p["type"] == "handoff");
        *all = kept;
        taken
            .into_iter()
            .map(|(_, p)| match serde_json::from_value(p).unwrap() {
                EntityChanged::Handoff { handoff } => handoff,
                _ => unreachable!(),
            })
            .collect()
    }
}

struct FixedClock;

impl Clock for FixedClock {
    fn now(&self) -> TimestampMs {
        TimestampMs(NOW)
    }
}

/// The Mac as the tests script it: the launch plan, which paths fail, and what was launched
/// and copied.
struct Ops {
    plan: Mutex<LaunchPlan>,
    fail: Mutex<Vec<(LaunchPath, ErrorCode)>>,
    launched: Mutex<Vec<(LaunchPath, LaunchRequest)>>,
    copied: Mutex<Vec<ClipboardText>>,
    clipboard_fails: Mutex<bool>,
}

impl Default for Ops {
    fn default() -> Self {
        Self {
            plan: Mutex::new(LaunchPlan {
                path: LaunchPath::ClaudeCliLink,
                needs_automation: false,
                automation_denied: false,
            }),
            fail: Mutex::default(),
            launched: Mutex::default(),
            copied: Mutex::default(),
            clipboard_fails: Mutex::new(false),
        }
    }
}

impl NativeOps for Ops {
    fn save_panel<'a>(
        &'a self,
        _: &'a str,
        _: SaveKind,
    ) -> noter_core::BoxFuture<'a, Option<std::path::PathBuf>> {
        Box::pin(async { None })
    }

    fn launch_plan(&self, target: HandoffTarget) -> LaunchPlan {
        let mut plan = self.plan.lock().unwrap().clone();
        // Codex has no link that carries the prompt (D-33): it opens in a terminal.
        if target == HandoffTarget::Codex && plan.path == LaunchPath::ClaudeCliLink {
            plan.path = LaunchPath::Terminal;
        }
        plan
    }

    fn launch<'a>(
        &'a self,
        path: LaunchPath,
        req: &'a LaunchRequest,
    ) -> noter_core::BoxFuture<'a, Result<(), ErrorCode>> {
        Box::pin(async move {
            if let Some((_, code)) = self.fail.lock().unwrap().iter().find(|(p, _)| *p == path) {
                return Err(*code);
            }
            self.launched.lock().unwrap().push((path, req.clone()));
            Ok(())
        })
    }

    fn clipboard_write<'a>(
        &'a self,
        text: &'a ClipboardText,
    ) -> noter_core::BoxFuture<'a, Result<(), String>> {
        Box::pin(async move {
            if *self.clipboard_fails.lock().unwrap() {
                return Err("pasteboard refused".into());
            }
            self.copied.lock().unwrap().push(text.clone());
            Ok(())
        })
    }
}

struct World {
    core: Arc<Core>,
    events: Arc<Events>,
    ops: Arc<Ops>,
    llm: Scripted,
    dir: tempfile::TempDir,
}

fn row(table: &'static str, values: &[(&'static str, Value)]) -> Insert {
    Insert {
        table,
        values: values.to_vec(),
    }
}

fn item(id: &str, kind: &str, review: &str, text: &str, owner: Option<&str>) -> Insert {
    row(
        "items",
        &[
            ("id", json!(id)),
            ("rev", json!(1)),
            ("call_id", json!("call_a")),
            ("kind", json!(kind)),
            ("text", json!(text)),
            ("lang", json!("en")),
            ("status", json!("open")),
            ("review_state", json!(review)),
            ("created_by", json!("llm")),
            ("is_engineering", json!(1)),
            ("linked_issue_key", json!("VSTOR-12")),
            ("owner_person_id", json!(owner)),
        ],
    )
}

/// One call with Anna's words, an engineering item with evidence and a decision.
fn world(script: &str) -> World {
    let dir = tempfile::tempdir().unwrap();
    let events = Arc::new(Events::default());
    let ops = Arc::new(Ops::default());
    let llm = Scripted::parse(script).unwrap();
    let deps = CoreDeps::new(Arc::new(FixedClock), events.clone())
        .with_llm(Adapters::scripted(&llm))
        .with_native_ops(ops.clone());
    let core = Arc::new(Core::open(dir.path(), deps).unwrap());
    core.start_first_run();
    core.store()
        .insert_batch(vec![
            row(
                "calls",
                &[
                    ("id", json!("call_a")),
                    ("rev", json!(1)),
                    ("started_at", json!(NOW - 3_600_000)),
                    ("ended_at", json!(NOW - 3_000_000)),
                    ("title", json!("Drawer sync")),
                    ("call_type", json!("planning")),
                    ("status", json!("ready")),
                    ("mode_used", json!("cloud_redacted")),
                ],
            ),
            row(
                "speakers",
                &[
                    ("id", json!("spk_anna")),
                    ("call_id", json!("call_a")),
                    ("label", json!("Anna Koval")),
                    ("channel", json!("sys")),
                    ("person_id", json!("per_anna")),
                    ("pass", json!("live")),
                ],
            ),
            row(
                "segments",
                &[
                    ("id", json!("seg_1")),
                    ("call_id", json!("call_a")),
                    ("speaker_id", json!("spk_anna")),
                    ("channel", json!("sys")),
                    ("t0_ms", json!(64_000)),
                    ("t1_ms", json!(70_000)),
                    ("text", json!("Focus must go back to the list")),
                    ("text_norm", json!("focus must go back to the list")),
                    ("pass", json!("live")),
                ],
            ),
            item(
                "itm_eng",
                "action_item",
                "suggested",
                "Fix the drawer focus",
                None,
            ),
            item("itm_dec", "decision", "accepted", "Keep the old API", None),
            item(
                "itm_anna",
                "action_item",
                "accepted",
                "Anna checks Safari",
                Some("per_anna"),
            ),
            row(
                "item_spans",
                &[
                    ("item_id", json!("itm_eng")),
                    ("call_id", json!("call_a")),
                    ("t0_ms", json!(65_000)),
                    ("t1_ms", json!(69_000)),
                ],
            ),
        ])
        .unwrap();
    World {
        core,
        events,
        ops,
        llm,
        dir,
    }
}

fn ctx() -> CommandCtx {
    CommandCtx {
        caller: Caller::Window {
            label: WindowLabel::Main,
        },
    }
}

fn id(item: &str) -> ItemIdArgs {
    ItemIdArgs {
        item_id: ItemId::new(item),
    }
}

impl World {
    async fn get(&self, item: &str) -> Result<HandoffView, CoreError> {
        self.core.handoff_get(&ctx(), id(item)).await
    }

    async fn generate(&self, item: &str, regenerate: bool) -> HandoffView {
        self.core
            .handoff_generate(
                &ctx(),
                HandoffGenerateArgs {
                    item_id: ItemId::new(item),
                    regenerate,
                },
            )
            .await
            .unwrap()
    }

    /// Lets the scripted runtime answer (paused time moves on its own while idle).
    async fn settle(&self) {
        for _ in 0..50 {
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    }

    async fn ready(&self, item: &str) -> HandoffView {
        self.generate(item, false).await;
        self.settle().await;
        let view = self.get(item).await.unwrap();
        assert_eq!(view.state, PromptState::Ready);
        view
    }

    async fn map_repo(&self, key: &str) -> RepoList {
        let repo = self.dir.path().join("repo");
        std::fs::create_dir_all(&repo).unwrap();
        self.core
            .repo_upsert(
                &ctx(),
                RepoUpsertArgs {
                    id: None,
                    key: key.into(),
                    local_path: Some(repo.to_string_lossy().into_owned()),
                    default_tool: HandoffTarget::ClaudeCode,
                },
            )
            .await
            .unwrap()
    }

    fn item_row(&self, item: &str) -> (String, String, Option<String>, Option<i64>) {
        let item = item.to_string();
        self.core
            .store()
            .read(move |c| {
                c.query_row(
                    "SELECT status, review_state, handoff_target, handed_off_at FROM items WHERE id = ?1",
                    [item],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
                )
            })
            .unwrap()
    }

    fn reasons(&self, item: &str) -> Vec<String> {
        let item = item.to_string();
        self.core
            .store()
            .read(move |c| {
                c.prepare(
                    "SELECT reason FROM changes WHERE entity_type = 'item' AND entity_id = ?1 ORDER BY rowid",
                )?
                .query_map([item], |r| r.get(0))?
                .collect()
            })
            .unwrap()
    }
}

const SLOW: &str = r#"{"on": "handoff", "after_ms": 1000, "output": {"goal": "Fix the drawer focus", "context": "Anna said focus must go back to the list.", "constraints": ["Keep the old API"], "acceptance": ["Focus returns to the list"], "links": ["VSTOR-12", "https://made.up/x"], "repo": null, "guardrails": "Touch only the drawer."}}"#;

#[tokio::test(start_paused = true)]
async fn generate_answers_generating_then_ready_through_entity_changed_and_caches() {
    let w = world(SLOW);
    let view = w.get("itm_eng").await.unwrap();
    assert_eq!(view.state, PromptState::NotGenerated);
    assert_eq!((view.prompt_md.as_deref(), view.rev), (None, None));
    assert_eq!(view.launch.path, LaunchPath::ClaudeCliLink);
    assert_eq!(view.target, HandoffTarget::ClaudeCode);
    assert_eq!(view.default_action, HandoffAction::Open);
    assert_eq!(view.unmapped_key.as_deref(), Some("VSTOR"));

    let started = w.generate("itm_eng", false).await;
    assert_eq!(started.state, PromptState::Generating);
    // A second request joins the running one.
    assert_eq!(
        w.generate("itm_eng", false).await.state,
        PromptState::Generating
    );
    w.settle().await;

    let published = w.events.handoffs();
    let ready = published.last().unwrap();
    assert_eq!(ready.state, PromptState::Ready);
    let md = ready.prompt_md.as_deref().unwrap();
    assert!(md.starts_with("# Fix the drawer focus"));
    assert!(md.contains("- VSTOR-12"));
    assert!(
        !md.contains("made.up"),
        "a link the packet did not carry is dropped"
    );
    assert!(md
        .trim_end()
        .ends_with("Ask before touching anything outside this scope."));
    assert_eq!(ready.generated_md.as_deref(), Some(md));
    assert!(!ready.edited);
    assert_eq!(ready.versions.len(), 1);
    assert_eq!(ready.versions[0].kind, VersionKind::Generated);
    assert_eq!(ready.rev, Some(Rev(1)));

    // The packet held the evidence words with speaker and time, the decision and the link.
    let received = w.llm.received();
    assert_eq!(received.len(), 1);
    assert_eq!(received[0].skill, "handoff");
    let packet = String::from_utf8_lossy(&received[0].bytes);
    for part in [
        "Focus must go back to the list",
        "1:04",
        "Keep the old API",
        "VSTOR-12",
    ] {
        assert!(packet.contains(part), "{part:?} not in {packet}");
    }

    // Cached: no second model call without `regenerate`.
    assert_eq!(w.generate("itm_eng", false).await.state, PromptState::Ready);
    w.settle().await;
    assert_eq!(w.llm.received().len(), 1);
}

#[tokio::test(start_paused = true)]
async fn cancel_restores_the_previous_state_and_writes_nothing() {
    let w = world(SLOW);
    w.generate("itm_eng", false).await;
    let cancelled = w.core.handoff_cancel(&ctx(), id("itm_eng")).await.unwrap();
    assert_eq!(cancelled.state, PromptState::NotGenerated);
    w.settle().await;
    let view = w.get("itm_eng").await.unwrap();
    assert_eq!(view.state, PromptState::NotGenerated);
    assert!(view.versions.is_empty());
    assert!(w
        .events
        .handoffs()
        .iter()
        .all(|v| v.state != PromptState::Ready));

    // From ready: a forced regeneration cancelled leaves the ready prompt.
    let ready = w.ready("itm_eng").await;
    w.generate("itm_eng", true).await;
    let back = w.core.handoff_cancel(&ctx(), id("itm_eng")).await.unwrap();
    assert_eq!(back.state, PromptState::Ready);
    assert_eq!(back.prompt_md, ready.prompt_md);
    w.settle().await;
    assert_eq!(w.get("itm_eng").await.unwrap().versions.len(), 1);
}

#[tokio::test(start_paused = true)]
async fn edits_need_the_current_rev_and_survive_regeneration() {
    let w = world("");
    let ready = w.ready("itm_eng").await;
    let generated = ready.prompt_md.clone().unwrap();
    let edit = |rev, md: &str| HandoffEditArgs {
        item_id: ItemId::new("itm_eng"),
        rev: Rev(rev),
        prompt_md: md.into(),
    };
    let empty = w
        .core
        .handoff_edit(&ctx(), edit(1, "  "))
        .await
        .unwrap_err();
    assert_eq!(empty.code, ErrorCode::InvalidInput);
    let stale = w
        .core
        .handoff_edit(&ctx(), edit(7, "# Mine"))
        .await
        .unwrap_err();
    assert_eq!(stale.code, ErrorCode::Conflict);
    assert_eq!(
        stale.detail,
        Some(ErrorDetail::Conflict {
            current_rev: Rev(1)
        })
    );

    let edited = w
        .core
        .handoff_edit(&ctx(), edit(1, "# Mine\n"))
        .await
        .unwrap();
    assert!(edited.edited);
    assert_eq!(edited.prompt_md.as_deref(), Some("# Mine\n"));
    assert_eq!(edited.generated_md.as_deref(), Some(generated.as_str()));
    assert_eq!(edited.rev, Some(Rev(2)));
    assert_eq!(edited.versions[1].kind, VersionKind::UserEdit);
    // The item's own text is never rewritten.
    let item = w.core.item_get(&ctx(), id("itm_eng")).await.unwrap();
    assert_eq!(item.item.text, "Fix the drawer focus");

    // A forced regeneration keeps the edit as the prompt and offers the new one beside it.
    w.generate("itm_eng", true).await;
    w.settle().await;
    let after = w.get("itm_eng").await.unwrap();
    assert_eq!(after.state, PromptState::Ready);
    assert_eq!(after.versions.len(), 3);
    assert_eq!(after.prompt_md.as_deref(), Some("# Mine\n"));
    assert!(after.edited);
    assert_eq!(after.versions[2].kind, VersionKind::Generated);
    assert_eq!(w.llm.received().len(), 2);
}

#[tokio::test(start_paused = true)]
async fn a_failed_generation_keeps_earlier_versions_and_try_again_works() {
    let w = world(r#"{"on": "handoff", "fail": "rate_limited"}"#);
    w.generate("itm_eng", false).await;
    w.settle().await;
    let failed = w.get("itm_eng").await.unwrap();
    assert!(matches!(failed.state, PromptState::Failed { .. }));
    assert!(failed.versions.is_empty());
    // Try Again: the script is spent, the built-in output answers.
    let ready = w.ready("itm_eng").await;
    assert_eq!(ready.versions.len(), 1);
}

#[tokio::test(start_paused = true)]
async fn a_deleted_item_is_not_found_and_its_late_result_is_dropped() {
    let w = world(SLOW);
    assert_eq!(
        w.get("itm_nope").await.unwrap_err().code,
        ErrorCode::NotFound
    );
    // Only an engineering item has a handoff (as the fake answers).
    noter_db::rusqlite::Connection::open(w.dir.path().join("noter.db"))
        .unwrap()
        .execute(
            "UPDATE items SET is_engineering = 0 WHERE id = 'itm_dec'",
            [],
        )
        .unwrap();
    assert_eq!(
        w.get("itm_dec").await.unwrap_err().detail,
        Some(ErrorDetail::Validation {
            field: "item_id".into(),
            rule: noter_protocol::error::ValidationRule::InvalidFormat
        })
    );
    w.generate("itm_eng", false).await;
    noter_db::rusqlite::Connection::open(w.dir.path().join("noter.db"))
        .unwrap()
        .execute("DELETE FROM items WHERE id = 'itm_eng'", [])
        .unwrap();
    w.settle().await;
    let n: i64 = w
        .core
        .store()
        .read(|c| c.query_row("SELECT COUNT(*) FROM prompt_versions", [], |r| r.get(0)))
        .unwrap();
    assert_eq!(n, 0);
    assert_eq!(
        w.get("itm_eng").await.unwrap_err().code,
        ErrorCode::NotFound
    );
}

#[tokio::test(start_paused = true)]
async fn set_target_recomputes_the_launch_line_without_generating() {
    let w = world("");
    let view = w
        .core
        .handoff_set_target(
            &ctx(),
            HandoffTargetArgs {
                item_id: ItemId::new("itm_eng"),
                target: HandoffTarget::Codex,
            },
        )
        .await
        .unwrap();
    assert_eq!(view.target, HandoffTarget::Codex);
    assert_eq!(view.launch.path, LaunchPath::Terminal);
    assert_eq!(view.state, PromptState::NotGenerated);
    assert_eq!(w.get("itm_eng").await.unwrap().target, HandoffTarget::Codex);
    w.settle().await;
    assert!(w.llm.received().is_empty());
}

#[tokio::test(start_paused = true)]
async fn repositories_are_listed_added_and_removed_and_resolve_the_item() {
    let w = world("");
    assert!(w
        .core
        .repos_list(&ctx(), NoArgs {})
        .await
        .unwrap()
        .mappings
        .is_empty());
    let list = w.map_repo("VSTOR").await;
    assert_eq!(list.mappings.len(), 1);
    assert!(list.mappings[0].path_exists);
    let view = w.get("itm_eng").await.unwrap();
    assert_eq!(view.repo.as_ref().unwrap().key, "VSTOR");
    assert_eq!(view.unmapped_key, None);
    // No folder given and the panel cancelled: nothing changes.
    let cancelled = w
        .core
        .repo_upsert(
            &ctx(),
            RepoUpsertArgs {
                id: None,
                key: "UI".into(),
                local_path: None,
                default_tool: HandoffTarget::Codex,
            },
        )
        .await
        .unwrap_err();
    assert_eq!(cancelled.code, ErrorCode::Cancelled);
    let removed = w
        .core
        .repo_remove(
            &ctx(),
            RepoIdArgs {
                id: list.mappings[0].id.clone(),
            },
        )
        .await
        .unwrap();
    assert!(removed.mappings.is_empty());
    assert_eq!(
        w.get("itm_eng").await.unwrap().unmapped_key.as_deref(),
        Some("VSTOR")
    );
}

#[tokio::test(start_paused = true)]
async fn open_writes_the_prompt_file_launches_and_hands_the_item_off() {
    let w = world("");
    // Nothing to open yet; then no mapping.
    let err = w
        .core
        .handoff_open(&ctx(), id("itm_eng"))
        .await
        .unwrap_err();
    assert_eq!(err.code, ErrorCode::PromptNotReady);
    let ready = w.ready("itm_eng").await;
    let err = w
        .core
        .handoff_open(&ctx(), id("itm_eng"))
        .await
        .unwrap_err();
    assert_eq!(err.code, ErrorCode::RepoNotMapped);
    w.map_repo("VSTOR").await;

    let opened = w.core.handoff_open(&ctx(), id("itm_eng")).await.unwrap();
    assert_eq!(opened.path_used, LaunchPath::ClaudeCliLink);
    let file = w.dir.path().join("handoffs").join("itm_eng.md");
    assert_eq!(Path::new(&opened.prompt_file), file);
    assert_eq!(
        std::fs::read_to_string(&file).unwrap(),
        ready.prompt_md.unwrap()
    );
    let launched = w.ops.launched.lock().unwrap().clone();
    assert_eq!(launched.len(), 1);
    let (path, req) = &launched[0];
    assert_eq!(*path, LaunchPath::ClaudeCliLink);
    assert_eq!(req.prompt_file, file);
    assert_eq!(req.cwd, w.dir.path().join("repo"));
    assert_eq!(req.target, HandoffTarget::ClaudeCode);

    // The item is handed off and accepted, owner unchanged, not done.
    assert_eq!(opened.item.status, ItemStatus::HandedOff);
    assert_eq!(opened.item.review, ReviewState::Accepted);
    let summary = opened.item.handoff.as_ref().unwrap();
    assert_eq!(summary.target, HandoffTarget::ClaudeCode);
    assert_eq!(summary.at, TimestampMs(NOW));
    let (status, review, target, at) = w.item_row("itm_eng");
    assert_eq!(
        (status.as_str(), review.as_str()),
        ("handed_off", "accepted")
    );
    assert_eq!((target.as_deref(), at), (Some("claude_code"), Some(NOW)));
    // The change records the prompt version used and that it was not edited (Handoff metric).
    let version = ready.versions[0].id.as_str();
    assert_eq!(
        w.reasons("itm_eng").last().unwrap(),
        &format!("handoff_open: {version} unedited")
    );
    // The drawer hears the new state too.
    let last = w.events.handoffs().pop().unwrap();
    assert_eq!(last.last.unwrap().target, HandoffTarget::ClaudeCode);
}

#[tokio::test(start_paused = true)]
async fn a_failed_launch_claims_nothing_and_the_link_falls_back_to_the_terminal() {
    let w = world("");
    w.ready("itm_eng").await;
    w.map_repo("VSTOR").await;
    // The link does not open: iTerm is denied, Terminal opens.
    w.ops.fail.lock().unwrap().extend([
        (LaunchPath::ClaudeCliLink, ErrorCode::NoLinkHandler),
        (LaunchPath::Iterm, ErrorCode::AutomationDenied),
    ]);
    let opened = w.core.handoff_open(&ctx(), id("itm_eng")).await.unwrap();
    assert_eq!(opened.path_used, LaunchPath::Terminal);

    // Automation denied for the planned terminal: the typed error, the item untouched.
    let w = world("");
    w.ready("itm_eng").await;
    w.map_repo("VSTOR").await;
    *w.ops.plan.lock().unwrap() = LaunchPlan {
        path: LaunchPath::Terminal,
        needs_automation: false,
        automation_denied: true,
    };
    let err = w
        .core
        .handoff_open(&ctx(), id("itm_eng"))
        .await
        .unwrap_err();
    assert_eq!(err.code, ErrorCode::AutomationDenied);
    assert_eq!(w.item_row("itm_eng").0, "open");
    assert!(w.reasons("itm_eng").is_empty());
    assert!(w.ops.launched.lock().unwrap().is_empty());

    // The mapped folder is gone.
    std::fs::remove_dir_all(w.dir.path().join("repo")).unwrap();
    let err = w
        .core
        .handoff_open(&ctx(), id("itm_eng"))
        .await
        .unwrap_err();
    assert_eq!(err.code, ErrorCode::RepoPathMissing);
}

#[tokio::test(start_paused = true)]
async fn copy_puts_the_markdown_on_the_clipboard_and_records_the_edited_version() {
    let w = world("");
    let view = w.get("itm_anna").await.unwrap();
    assert_eq!(view.default_action, HandoffAction::CopyPrompt);
    w.ready("itm_anna").await;
    let edited = w
        .core
        .handoff_edit(
            &ctx(),
            HandoffEditArgs {
                item_id: ItemId::new("itm_anna"),
                rev: Rev(1),
                prompt_md: "# Anna's prompt — «edited»\n".into(),
            },
        )
        .await
        .unwrap();

    // The clipboard refuses: nothing counts as used.
    *w.ops.clipboard_fails.lock().unwrap() = true;
    assert!(w.core.handoff_copy(&ctx(), id("itm_anna")).await.is_err());
    assert_eq!(w.item_row("itm_anna").0, "open");
    *w.ops.clipboard_fails.lock().unwrap() = false;

    // Copy works without a repository mapping.
    let copied = w.core.handoff_copy(&ctx(), id("itm_anna")).await.unwrap();
    assert_eq!(
        copied.chars,
        "# Anna's prompt — «edited»\n".chars().count() as u32
    );
    assert_eq!(copied.item.status, ItemStatus::HandedOff);
    assert_eq!(copied.item.owner.as_ref().unwrap().id.as_str(), "per_anna");
    let clip = w.ops.copied.lock().unwrap().clone();
    assert_eq!(clip.len(), 1);
    assert_eq!(clip[0].plain, "# Anna's prompt — «edited»\n");
    assert_eq!(clip[0].markdown.as_deref(), Some(clip[0].plain.as_str()));
    let version = edited.versions[1].id.as_str();
    assert_eq!(
        w.reasons("itm_anna").last().unwrap(),
        &format!("handoff_copy: {version} edited")
    );
}
