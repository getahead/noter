//! FEATURE cpt-noter-feature-core-retrieval-ask, slice 2: Ask threads, cited streamed answers,
//! Stop and delete, on the real store with the scripted runtime (TL-13) and the scripted engine.

use std::sync::{Arc, Mutex};
use std::time::Duration;

use noter_core::{Adapters, Clock, Core, CoreDeps, EventEmitter, Scripted, LAG_LIMIT};
use noter_db::{ChangeMeta, Insert};
use noter_engine_client::scripted::ScriptedEngine;
use noter_protocol::ipc::{Caller, CommandCtx, CoreApi, Sink};
use noter_protocol::model::*;
use noter_protocol::*;
use serde_json::{json, Value};

/// 2026-10-31T00:00:00Z.
const NOW: i64 = 1_793_404_800_000;
const DAY: i64 = 86_400_000;

struct FixedClock;

impl Clock for FixedClock {
    fn now(&self) -> TimestampMs {
        TimestampMs(NOW)
    }
}

struct NoEvents;

impl EventEmitter for NoEvents {
    fn emit(&self, _: &'static str, _: Value) {}
}

fn window(label: WindowLabel) -> CommandCtx {
    CommandCtx {
        caller: Caller::Window { label },
    }
}

fn main_window() -> CommandCtx {
    window(WindowLabel::Main)
}

fn ins(table: &'static str, values: Vec<(&'static str, Value)>) -> Insert {
    Insert { table, values }
}

fn call(id: &str, title: &str, privacy: &str) -> Insert {
    let started = NOW - 3 * DAY;
    ins(
        "calls",
        vec![
            ("id", json!(id)),
            ("rev", json!(1)),
            ("started_at", json!(started)),
            ("ended_at", json!(started + 3_600_000)),
            ("title", json!(title)),
            ("call_type", json!("planning")),
            ("status", json!("ready")),
            ("mode_used", json!("cloud")),
            ("privacy_class", json!(privacy)),
        ],
    )
}

fn speaker(call: &str, person: &str) -> Insert {
    ins(
        "speakers",
        vec![
            ("id", json!(format!("{call}_spk"))),
            ("call_id", json!(call)),
            ("label", json!("spk_1")),
            ("n", json!(1)),
            ("name", json!("Speaker")),
            ("channel", json!("sys")),
            ("pass", json!("archive")),
            ("person_id", json!(person)),
        ],
    )
}

fn segment(id: &str, call: &str, t0: i64, text: &str) -> Insert {
    ins(
        "segments",
        vec![
            ("id", json!(id)),
            ("call_id", json!(call)),
            ("speaker_id", json!(format!("{call}_spk"))),
            ("channel", json!("sys")),
            ("t0_ms", json!(t0)),
            ("t1_ms", json!(t0 + 4_000)),
            ("text", json!(text)),
            ("text_norm", json!(text.to_lowercase())),
            ("lang", json!("en")),
            ("pass", json!("archive")),
        ],
    )
}

struct World {
    core: Arc<Core>,
    llm: Scripted,
    _dir: tempfile::TempDir,
}

/// One normal call about WebSockets and one sensitive call about their budget; `script` is
/// the scripted runtime's (empty: the built-in answer cites the first evidence).
async fn world(script: &str) -> World {
    let dir = tempfile::tempdir().unwrap();
    let llm = Scripted::parse(script).unwrap();
    let deps = CoreDeps::new(Arc::new(FixedClock), Arc::new(NoEvents))
        .with_llm(Adapters::scripted(&llm))
        .with_engine(Arc::new(ScriptedEngine::new().with_container(dir.path())));
    let core = Arc::new(Core::open(dir.path(), deps).unwrap());
    core.start_first_run();
    core.store()
        .insert_batch(vec![
            call("call_ws", "Backend sync", "normal"),
            call("call_hr", "HR one on one", "sensitive"),
            speaker("call_ws", "per_you"),
            speaker("call_hr", "per_you"),
            segment("seg_ws", "call_ws", 1_000, "We decided to use WebSockets."),
            segment(
                "seg_poll",
                "call_ws",
                6_000,
                "Polling stays for the admin page.",
            ),
            segment(
                "seg_hr",
                "call_hr",
                2_000,
                "The WebSockets budget is confidential.",
            ),
        ])
        .unwrap();
    World {
        core,
        llm,
        _dir: dir,
    }
}

type Messages = Arc<Mutex<Vec<AskEvent>>>;

fn sink() -> (Sink<AskMsg>, Messages) {
    let got: Messages = Arc::default();
    let seen = got.clone();
    let sink = Sink::new(move |m: AskMsg| {
        seen.lock().unwrap().push(m.event);
        true
    });
    (sink, got)
}

fn kinds(got: &Messages) -> Vec<&'static str> {
    got.lock()
        .unwrap()
        .iter()
        .map(|e| match e {
            AskEvent::Started { .. } => "started",
            AskEvent::Delta { .. } => "delta",
            AskEvent::Citation { .. } => "citation",
            AskEvent::Done { .. } => "done",
            AskEvent::Failed { .. } => "failed",
            AskEvent::Ended { .. } => "ended",
        })
        .collect()
}

fn terminal(got: &Messages) -> AskEvent {
    got.lock().unwrap().last().cloned().unwrap()
}

impl World {
    async fn ask(&self, thread: Option<&AskThreadId>, question: &str) -> (AskHandle, Messages) {
        let (sink, got) = sink();
        let args = AskStartArgs {
            thread_id: thread.cloned(),
            question: question.into(),
            scope: AskScope::default(),
        };
        let handle = self
            .core
            .ask_start(&main_window(), args, sink)
            .await
            .unwrap();
        (handle, got)
    }

    async fn settle(&self) {
        for _ in 0..20 {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    }

    async fn thread(&self, id: &AskThreadId) -> Result<AskThread, CoreError> {
        let args = AskThreadArgs {
            thread_id: id.clone(),
        };
        self.core.ask_thread_get(&main_window(), args).await
    }

    async fn set_search_runtime(&self, search_answers: RuntimeChoice) {
        let settings = window(WindowLabel::Settings);
        let rev = self
            .core
            .settings_get(&settings, NoArgs {})
            .await
            .unwrap()
            .rev;
        let mut runtimes = noter_core::default_settings().runtimes;
        runtimes.search_answers = search_answers;
        let args = SettingsUpdateArgs {
            rev,
            section: SettingsSection::Runtimes(runtimes),
        };
        self.core.settings_update(&settings, args).await.unwrap();
    }

    fn packets(&self) -> Vec<String> {
        let received = self.llm.received();
        received
            .iter()
            .map(|r| String::from_utf8_lossy(&r.bytes).into_owned())
            .collect()
    }
}

#[tokio::test(start_paused = true)]
async fn the_handle_comes_first_then_started_deltas_citations_and_done() {
    let w = world("").await;
    let (handle, got) = w.ask(None, "What did we decide about websockets?").await;
    assert!(
        got.lock().unwrap().is_empty(),
        "no Channel message before the handle"
    );
    w.settle().await;
    assert_eq!(kinds(&got), ["started", "delta", "citation", "done"]);
    let AskEvent::Done { answer } = terminal(&got) else {
        panic!("not done")
    };
    assert!(answer.found);
    assert_eq!(answer.turn_id, handle.turn_id);
    assert_eq!(answer.answer_md, "Scripted answer [1].");
    assert_eq!(answer.citations.len(), 1);
    let cited = &answer.citations[0];
    assert_eq!(cited.n, 1);
    assert_eq!(cited.quote, "We decided to use WebSockets.");
    assert_eq!(cited.speaker.as_ref().map(|s| s.is_you), Some(true));
    // Cloud by default: the sensitive call was skipped and never sent.
    assert!(!answer.answered_locally);
    assert_eq!(answer.sensitive_sources_skipped, 1);
    let packets = w.packets();
    assert_eq!(packets.len(), 1);
    assert!(!packets[0].contains("confidential"));
    assert!(packets[0].contains("What did we decide about websockets?"));

    // Stored: the thread reopens with the same answer.
    let thread = w.thread(&handle.thread_id).await.unwrap();
    assert_eq!(thread.title, "What did we decide about websockets?");
    assert_eq!(thread.turns, std::slice::from_ref(&answer));
    let list = w
        .core
        .ask_threads_list(&main_window(), NoArgs {})
        .await
        .unwrap();
    assert_eq!(list.threads.len(), 1);
    assert_eq!(list.threads[0].turns, 1);
    let run: Option<String> = w
        .core
        .store()
        .read(|c| c.query_row("SELECT llm_run_id FROM ask_turns", [], |r| r.get(0)))
        .unwrap();
    assert!(run.is_some_and(|r| r.starts_with("llm_")));

    // A follow-up carries the earlier turn as context.
    let (next, got) = w.ask(Some(&handle.thread_id), "And polling?").await;
    w.settle().await;
    assert_eq!(next.thread_id, handle.thread_id);
    assert!(matches!(terminal(&got), AskEvent::Done { .. }));
    assert!(w.packets()[1].contains("Earlier answer: Scripted answer [1]."));
    assert_eq!(w.thread(&handle.thread_id).await.unwrap().turns.len(), 2);
}

// The refinements: the router registers the run with the tool host for noter-mcp's read tools.
#[tokio::test(start_paused = true)]
async fn the_answer_run_may_use_the_read_tools() {
    let w = world("").await;
    let (_handle, got) = w.ask(None, "What did we decide about websockets?").await;
    w.settle().await;
    assert!(matches!(terminal(&got), AskEvent::Done { .. }));
    let received = w.llm.received();
    assert_eq!(
        received[0].tools,
        [
            "get_transcript_span",
            "get_person",
            "get_decisions",
            "get_open_items"
        ]
    );
}

#[tokio::test(start_paused = true)]
async fn start_rejects_before_any_stream() {
    let w = world("").await;
    let (sink, got) = sink();
    let args = AskStartArgs {
        thread_id: Some(AskThreadId::new("ask_unknown")),
        question: "Q".into(),
        scope: AskScope::default(),
    };
    let e = w.core.ask_start(&main_window(), args, sink).await;
    assert_eq!(e.unwrap_err().code, ErrorCode::NotFound);
    let (sink, _) = self::sink();
    let blank = AskStartArgs {
        thread_id: None,
        question: " ".into(),
        scope: AskScope::default(),
    };
    let e = w.core.ask_start(&main_window(), blank, sink).await;
    assert_eq!(e.unwrap_err().code, ErrorCode::InvalidInput);
    w.settle().await;
    assert!(got.lock().unwrap().is_empty());
    let none = AskThreadArgs {
        thread_id: AskThreadId::new("ask_unknown"),
    };
    let e = w.core.ask_thread_get(&main_window(), none.clone()).await;
    assert_eq!(e.unwrap_err().code, ErrorCode::NotFound);
    let e = w.core.ask_thread_delete(&main_window(), none).await;
    assert_eq!(e.unwrap_err().code, ErrorCode::NotFound);
    let turn = AskTurnArgs {
        turn_id: AskTurnId::new("turn_unknown"),
    };
    let e = w.core.ask_stop(&main_window(), turn).await;
    assert_eq!(e.unwrap_err().code, ErrorCode::NotFound);
}

const UNKNOWN: &str = r#"{"on": "ask-answer", "output": {"answer_md": "Made up [1].", "citations": [{"n": 1, "segment_ids": ["seg_made_up"], "chunk_ids": [], "quote": "q"}], "found": true}}"#;

#[tokio::test(start_paused = true)]
async fn an_unknown_citation_is_retried_then_not_found() {
    let w = world(&[UNKNOWN, UNKNOWN, UNKNOWN].join("\n")).await;
    let (_, got) = w.ask(None, "websockets").await;
    w.settle().await;
    let AskEvent::Done { answer } = terminal(&got) else {
        panic!("not done: {:?}", kinds(&got))
    };
    assert!(!answer.found);
    assert!(answer.citations.is_empty());
    assert_eq!(answer.answer_md, noter_retrieval::NOT_FOUND_MD);
    assert_eq!(
        w.llm.received().len(),
        3,
        "first try, repair retry, fallback"
    );
}

// cpt-noter-algo-core-llm-gate-egress: inst-egress-recheck, through the real Ask caller.
#[tokio::test(start_paused = true)]
async fn privacy_changed_during_an_ask_blocks_the_cloud_repair_packet() {
    let mut invalid: Value = serde_json::from_str(UNKNOWN).unwrap();
    invalid["after_ms"] = json!(10_000);
    let w = world(&invalid.to_string()).await;
    let (_, got) = w.ask(None, "websockets").await;
    tokio::time::sleep(Duration::from_secs(1)).await;
    assert_eq!(w.llm.received().len(), 1);
    assert_ne!(w.llm.received()[0].runtime, RuntimeChoice::Local);
    let ctx = window(WindowLabel::Settings);
    let mut settings = w.core.settings_get(&ctx, NoArgs {}).await.unwrap();
    settings.privacy.mode = PrivacyMode::LocalOnly;
    w.core
        .settings_update(
            &ctx,
            SettingsUpdateArgs {
                rev: settings.rev,
                section: SettingsSection::Privacy(settings.privacy),
            },
        )
        .await
        .unwrap();
    tokio::time::sleep(Duration::from_secs(10)).await;
    w.settle().await;
    let received = w.llm.received();
    assert!(received.len() > 1, "the invalid answer needs a repair");
    assert!(
        received[1..]
            .iter()
            .all(|r| r.runtime == RuntimeChoice::Local),
        "every repair or fallback after the privacy commit stays local"
    );
    assert!(matches!(terminal(&got), AskEvent::Done { .. }));
}

// cpt-noter-algo-core-llm-gate-egress: a call in prior thread context is still protected.
#[tokio::test(start_paused = true)]
async fn sensitivity_changed_during_a_followup_applies_to_prior_thread_context() {
    let w = world("").await;
    w.core
        .capture_set_sensitive(
            &main_window(),
            SensitiveArgs {
                call_id: CallId::new("call_hr"),
                sensitive: false,
            },
        )
        .await
        .unwrap();
    let (first, _) = w.ask(None, "budget").await;
    w.settle().await;
    assert_eq!(w.llm.received().len(), 1);
    let mut invalid: Value = serde_json::from_str(UNKNOWN).unwrap();
    invalid["after_ms"] = json!(10_000);
    w.llm.answer_next(invalid).unwrap();
    let (_, got) = w.ask(Some(&first.thread_id), "polling").await;
    tokio::time::sleep(Duration::from_secs(1)).await;
    assert_eq!(w.llm.received().len(), 2);
    w.core
        .capture_set_sensitive(
            &main_window(),
            SensitiveArgs {
                call_id: CallId::new("call_hr"),
                sensitive: true,
            },
        )
        .await
        .unwrap();
    tokio::time::sleep(Duration::from_secs(10)).await;
    w.settle().await;
    let received = w.llm.received();
    assert!(received.len() > 2);
    assert!(received[2..]
        .iter()
        .all(|r| r.runtime == RuntimeChoice::Local));
    assert!(matches!(terminal(&got), AskEvent::Done { .. }));
}

#[tokio::test(start_paused = true)]
async fn nothing_to_cite_is_not_found_without_a_model_run() {
    let w = world("").await;
    let (_, got) = w.ask(None, "kubernetes").await;
    w.settle().await;
    assert_eq!(kinds(&got), ["started", "delta", "done"]);
    let AskEvent::Done { answer } = terminal(&got) else {
        panic!("not done")
    };
    assert!(!answer.found);
    assert!(w.llm.received().is_empty());
}

#[tokio::test(start_paused = true)]
async fn a_runtime_failure_fails_the_turn() {
    let w = world(r#"{"on": "ask-answer", "fail": "rate_limited"}"#).await;
    let (_, got) = w.ask(None, "websockets").await;
    w.settle().await;
    assert_eq!(kinds(&got), ["started", "failed"]);
}

#[tokio::test(start_paused = true)]
async fn the_deadline_fails_the_turn_once() {
    let slow = r#"{"on": "ask-answer", "after_ms": 300000}"#;
    let w = world(slow).await;
    let (handle, got) = w.ask(None, "websockets").await;
    tokio::time::sleep(Duration::from_secs(59)).await;
    assert_eq!(kinds(&got), ["started"]);
    tokio::time::sleep(Duration::from_secs(5)).await;
    let AskEvent::Failed { error } = terminal(&got) else {
        panic!("not failed: {:?}", kinds(&got))
    };
    assert_eq!(error.code, ErrorCode::RuntimeUnavailable);
    tokio::time::sleep(Duration::from_secs(600)).await;
    assert_eq!(kinds(&got), ["started", "failed"]);
    let thread = w.thread(&handle.thread_id).await.unwrap();
    assert!(!thread.turns[0].found);
}

const SLOW: &str = r#"{"on": "ask-answer", "after_ms": 10000}"#;

#[tokio::test(start_paused = true)]
async fn stop_ends_the_turn_with_answer_stopped_and_nothing_after() {
    let w = world(SLOW).await;
    let (handle, got) = w.ask(None, "websockets").await;
    tokio::time::sleep(Duration::from_secs(1)).await;
    assert_eq!(kinds(&got), ["started"]);
    let turn = AskTurnArgs {
        turn_id: handle.turn_id.clone(),
    };
    w.core.ask_stop(&main_window(), turn.clone()).await.unwrap();
    let AskEvent::Failed { error } = terminal(&got) else {
        panic!("not failed")
    };
    assert_eq!(error.code, ErrorCode::AnswerStopped);
    tokio::time::sleep(Duration::from_secs(30)).await;
    assert_eq!(kinds(&got), ["started", "failed"], "no second terminal");
    // Stopped again: nothing left to stop.
    w.core.ask_stop(&main_window(), turn).await.unwrap();
    let thread = w.thread(&handle.thread_id).await.unwrap();
    assert_eq!(thread.turns.len(), 1);
    assert!(!thread.turns[0].found);
    let stored: (Option<String>, Option<bool>) = w
        .core
        .store()
        .read(|c| {
            c.query_row("SELECT answer_md, found FROM ask_turns", [], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
        })
        .unwrap();
    assert_eq!(stored, (Some(String::new()), None), "kept as stopped");
}

#[tokio::test(start_paused = true)]
async fn deleting_a_thread_cancels_its_turn_and_drops_the_late_answer() {
    let w = world(SLOW).await;
    let (handle, got) = w.ask(None, "websockets").await;
    tokio::time::sleep(Duration::from_secs(1)).await;
    let args = AskThreadArgs {
        thread_id: handle.thread_id.clone(),
    };
    w.core
        .ask_thread_delete(&main_window(), args)
        .await
        .unwrap();
    tokio::time::sleep(Duration::from_secs(30)).await;
    assert_eq!(kinds(&got), ["started", "failed"]);
    let e = w.thread(&handle.thread_id).await.unwrap_err();
    assert_eq!(e.code, ErrorCode::NotFound);
    let rows: i64 = w
        .core
        .store()
        .read(|c| {
            c.query_row(
                "SELECT (SELECT count(*) FROM ask_threads) + (SELECT count(*) FROM ask_turns)",
                [],
                |r| r.get(0),
            )
        })
        .unwrap();
    assert_eq!(rows, 0, "the late answer recreated nothing");
}

#[tokio::test(start_paused = true)]
async fn a_lagging_subscriber_ends_lagged_and_the_answer_is_still_stored() {
    let lines = "We decided [1].\n".repeat(LAG_LIMIT as usize + 50);
    let output = json!({
        "on": "ask-answer",
        "output": {
            "answer_md": lines,
            "citations": [{"n": 1, "segment_ids": ["seg_ws"], "chunk_ids": [], "quote": "q"}],
            "found": true
        }
    });
    let w = world(&output.to_string()).await;
    let (handle, got) = w.ask(None, "websockets").await;
    w.settle().await;
    let AskEvent::Ended { reason } = terminal(&got) else {
        panic!("not ended")
    };
    assert_eq!(reason, StreamEndReason::Lagged);
    assert_eq!(got.lock().unwrap().len(), LAG_LIMIT as usize + 1);
    let thread = w.thread(&handle.thread_id).await.unwrap();
    assert!(
        thread.turns[0].found,
        "reopening the thread shows the answer"
    );
}

#[tokio::test(start_paused = true)]
async fn an_old_citation_of_a_deleted_call_is_marked_deleted() {
    let w = world("").await;
    let (handle, _) = w.ask(None, "websockets decided").await;
    w.settle().await;
    let meta = ChangeMeta {
        actor: Actor::You,
        summary: "test".into(),
        reason: "test".into(),
        evidence_ids: vec![],
        batch_id: None,
        undoable: false,
        surface: None,
    };
    w.core
        .store()
        .delete("call", "calls", vec!["call_ws".into()], meta)
        .unwrap();
    let thread = w.thread(&handle.thread_id).await.unwrap();
    assert!(thread.turns[0].citations[0].deleted);
}

const HR: &str = r#"{"on": "ask-answer", "output": {"answer_md": "It is confidential [1].", "citations": [{"n": 1, "segment_ids": ["seg_hr"], "chunk_ids": [], "quote": "q"}], "found": true}}"#;

#[tokio::test(start_paused = true)]
async fn a_sensitive_call_is_cited_only_by_a_local_answer() {
    // Cloud: the sensitive line is never retrieved, so citing it fails validation.
    let w = world(&[HR, HR, HR].join("\n")).await;
    let (_, got) = w.ask(None, "websockets budget").await;
    w.settle().await;
    let AskEvent::Done { answer } = terminal(&got) else {
        panic!("not done")
    };
    assert!(!answer.found);
    assert!(w.packets().iter().all(|p| !p.contains("confidential")));

    // Local: the same question may cite it.
    let w = world(HR).await;
    w.set_search_runtime(RuntimeChoice::Local).await;
    let (_, got) = w.ask(None, "websockets budget").await;
    w.settle().await;
    let AskEvent::Done { answer } = terminal(&got) else {
        panic!("not done: {:?}", kinds(&got))
    };
    assert!(answer.found);
    assert!(answer.answered_locally);
    assert_eq!(answer.runtime, RuntimeChoice::Local);
    assert_eq!(answer.sensitive_sources_skipped, 0);
    assert_eq!(
        answer.citations[0].quote,
        "The WebSockets budget is confidential."
    );
}

/// A normal and a sensitive knowledge source, one indexed chunk each, as a sync writes them.
fn documents(w: &World) {
    let mut rows = vec![];
    for (source, privacy, chunk, text) in [
        (
            "src_ops",
            "normal",
            "dch_ops",
            "WebSockets ship behind a flag.",
        ),
        (
            "src_hr",
            "sensitive",
            "dch_hr",
            "WebSockets budget sits in the HR plan.",
        ),
    ] {
        rows.push(ins(
            "sources",
            vec![
                ("id", json!(source)),
                ("rev", json!(1)),
                ("kind", json!("folder")),
                ("mode", json!("indexed")),
                ("name", json!(source)),
                ("location", json!("/notes")),
                ("privacy_class", json!(privacy)),
                ("scope", json!(r#"{"type":"all_calls"}"#)),
                ("status", json!(r#"{"type":"ready"}"#)),
            ],
        ));
        let doc = format!("doc_{source}");
        rows.push(ins(
            "documents",
            vec![
                ("id", json!(doc)),
                ("source_id", json!(source)),
                ("uri", json!(format!("{source}.md"))),
                ("title", json!("Rollout")),
                ("mime", json!("text/markdown")),
                ("content_hash", json!(source)),
                ("indexed_at", json!(NOW)),
            ],
        ));
        let body = format!("Rollout\n\n{text}");
        rows.push(ins(
            "doc_chunks",
            vec![
                ("id", json!(chunk)),
                ("document_id", json!(doc)),
                ("heading_path", json!("[]")),
                ("text", json!(body)),
                ("text_norm", json!(body.to_lowercase())),
                ("token_count", json!(12)),
            ],
        ));
    }
    w.core.store().insert_batch(rows).unwrap();
}

const DOC_OPS: &str = r#"{"on": "ask-answer", "output": {"answer_md": "Behind a flag [1].", "citations": [{"n": 1, "segment_ids": [], "chunk_ids": ["dch_ops"], "quote": "q"}], "found": true}}"#;
const DOC_HR: &str = r#"{"on": "ask-answer", "output": {"answer_md": "In the HR plan [1].", "citations": [{"n": 1, "segment_ids": [], "chunk_ids": ["dch_hr"], "quote": "q"}], "found": true}}"#;

impl World {
    async fn ask_documents(&self, question: &str, include_documents: bool) -> AskAnswer {
        let (sink, got) = sink();
        let args = AskStartArgs {
            thread_id: None,
            question: question.into(),
            scope: AskScope {
                include_documents,
                ..AskScope::default()
            },
        };
        self.core
            .ask_start(&main_window(), args, sink)
            .await
            .unwrap();
        self.settle().await;
        let AskEvent::Done { answer } = terminal(&got) else {
            panic!("not done: {:?}", kinds(&got))
        };
        answer
    }
}

#[tokio::test(start_paused = true)]
async fn documents_are_evidence_when_the_scope_includes_them_and_sensitive_ones_only_locally() {
    // A calls-only scope never sends a document.
    let w = world("").await;
    documents(&w);
    w.ask_documents("websockets flag", false).await;
    assert!(w.packets().iter().all(|p| !p.contains("behind a flag")));

    // Cloud: the normal source is cited; the sensitive one is skipped and counted.
    let w = world(DOC_OPS).await;
    documents(&w);
    let answer = w.ask_documents("websockets", true).await;
    assert!(answer.found, "{answer:?}");
    assert!(matches!(
        answer.citations[0].provenance,
        Provenance::Document { .. }
    ));
    assert!(w.packets()[0].contains("behind a flag"));
    assert!(w.packets().iter().all(|p| !p.contains("HR plan")));
    // The sensitive call's line and the sensitive source's chunk.
    assert_eq!(answer.sensitive_sources_skipped, 2);
    let w = world(&[DOC_HR, DOC_HR, DOC_HR].join("\n")).await;
    documents(&w);
    assert!(!w.ask_documents("websockets budget", true).await.found);

    // Local: the sensitive source may be cited.
    let w = world(DOC_HR).await;
    documents(&w);
    w.set_search_runtime(RuntimeChoice::Local).await;
    let answer = w.ask_documents("websockets budget", true).await;
    assert!(answer.found, "{answer:?}");
    assert_eq!(answer.sensitive_sources_skipped, 0);
}

#[tokio::test(start_paused = true)]
async fn an_unwatched_turn_is_cancelled_before_the_runtime_runs() {
    let w = world("").await;
    let (handle, _) = w.ask(None, "websockets").await;
    let unsubscribe = UnsubscribeArgs {
        subscription_id: handle.subscription_id.clone(),
    };
    w.core
        .stream_unsubscribe(&main_window(), unsubscribe)
        .await
        .unwrap();
    w.settle().await;
    assert!(w.llm.received().is_empty());
    let thread = w.thread(&handle.thread_id).await.unwrap();
    assert!(!thread.turns[0].found);
}

#[tokio::test(start_paused = true)]
async fn a_follow_up_carries_only_the_last_five_turns() {
    let w = world("").await;
    let (first, _) = w.ask(None, "websockets 0").await;
    w.settle().await;
    for n in 1..7 {
        w.ask(Some(&first.thread_id), &format!("websockets {n}"))
            .await;
        w.settle().await;
    }
    let last = w.packets().pop().unwrap();
    assert_eq!(last.matches("Earlier question:").count(), 5);
    assert!(!last.contains("Earlier question: websockets 0"));
    assert!(last.contains("Earlier question: websockets 5"));
}
