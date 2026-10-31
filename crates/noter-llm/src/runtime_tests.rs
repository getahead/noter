//! The router, the egress gate and the request machine on the scripted runtime (TL-13).

use std::sync::{Arc, Mutex};
use std::time::Duration;

use noter_db::{rusqlite, Store};
use noter_protocol::model::settings::AuditWhat;
use noter_protocol::{
    CallId, ErrorCode, ErrorDetail, PrivacyMode, RuntimeChoice, RuntimeUnavailableReason,
    TimestampMs,
};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tokio::sync::watch;

use crate::adapters::scripted::{built_in, Scripted};
use crate::gate::{Adapters, Gate, Release};
use crate::route::{route, timeout, Route};
use crate::runtime::{tests_support, RequestState};
use crate::validate::validate;
use crate::{
    Availability, Budget, Failure, Llm, LlmRuntime, Packet, PacketItem, Privacy, RunRequest, Skill,
    SourceClass, TaskKind, TaskSettings,
};

const NORMAL_TEXT: &str =
    "Ann Lee said: mail ann@example.com or call +1 415 555 0100; key sk-abcdefghijklmnopqrstuvwx. Ann Lee agreed.";
const SENSITIVE_TEXT: &str = "SENSITIVE-SOURCE-TEXT";
const AUDIO_TEXT: &str = "AUDIO-BYTES";
const MODEL_TEXT: &str = "MODEL-ONLY-TEXT";

struct Fixture {
    _dir: tempfile::TempDir,
    path: std::path::PathBuf,
    store: Arc<Store>,
    scripted: Scripted,
    llm: Llm,
    logs: Arc<Mutex<Vec<Value>>>,
    switched: Arc<Mutex<Vec<CallId>>>,
    privacy: watch::Sender<Privacy>,
}

fn cloud() -> Privacy {
    Privacy {
        mode: PrivacyMode::CloudAllowed,
        sensitive: false,
        offline: false,
    }
}

fn fixture(script: Option<&str>) -> Fixture {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("noter.db");
    let store = Arc::new(Store::open(&path, &[noter_db::MIGRATIONS]).unwrap());
    let scripted = match script {
        Some(s) => Scripted::parse(s).unwrap(),
        None => Scripted::new(),
    };
    let logs = Arc::new(Mutex::new(Vec::new()));
    let switched = Arc::new(Mutex::new(Vec::new()));
    let (l, s) = (logs.clone(), switched.clone());
    let llm = Llm::new(store.clone(), Adapters::scripted(&scripted), || {
        TimestampMs(1_792_000_000_000)
    })
    .on_log(move |v| l.lock().unwrap().push(v.clone()))
    .on_switch_to_local(move |call| s.lock().unwrap().push(call.clone()));
    let (privacy, _) = watch::channel(cloud());
    Fixture {
        _dir: dir,
        path,
        store,
        scripted,
        llm,
        logs,
        switched,
        privacy,
    }
}

fn packet() -> Packet {
    let item = |id: &str, source, text: &str| PacketItem {
        id: id.into(),
        source,
        text: text.into(),
    };
    Packet {
        what: AuditWhat::FullTranscript,
        items: vec![
            item("seg_1", SourceClass::Normal, NORMAL_TEXT),
            item("seg_2", SourceClass::Sensitive, SENSITIVE_TEXT),
            item("seg_3", SourceClass::Audio, AUDIO_TEXT),
            item(
                "chk_1",
                SourceClass::Normal,
                "Second mention: ann@example.com",
            ),
        ],
        people: vec!["Ann Lee".into()],
    }
}

impl Fixture {
    fn request(&self, skill: Skill, task: TaskKind) -> RunRequest {
        let mut req = RunRequest::new(skill, "1.0.0", packet(), task, self.privacy.subscribe());
        req.settings.configured = Some(RuntimeChoice::ClaudeApiKey);
        req.call_id = Some(CallId::new("call_1"));
        req
    }

    fn post_call(&self) -> RunRequest {
        self.request(Skill::PostCall, TaskKind::PostCall)
    }

    fn count(&self, sql: &'static str) -> i64 {
        self.store
            .read(move |c| c.query_row(sql, [], |r| r.get(0)))
            .unwrap()
    }

    fn row(&self, sql: &'static str) -> Value {
        use rusqlite::types::ValueRef;
        self.store
            .read(move |c| {
                let mut stmt = c.prepare(sql)?;
                let names: Vec<String> =
                    stmt.column_names().into_iter().map(String::from).collect();
                stmt.query_row([], |r| {
                    let mut out = serde_json::Map::new();
                    for (i, n) in names.iter().enumerate() {
                        let v = match r.get_ref(i)? {
                            ValueRef::Integer(i) => i.into(),
                            ValueRef::Real(f) => json!(f),
                            ValueRef::Text(t) => String::from_utf8_lossy(t).into_owned().into(),
                            ValueRef::Null | ValueRef::Blob(_) => Value::Null,
                        };
                        out.insert(n.clone(), v);
                    }
                    Ok(Value::Object(out))
                })
            })
            .unwrap()
    }

    fn states(&self) -> Vec<String> {
        self.logs
            .lock()
            .unwrap()
            .iter()
            .filter(|l| l["event"] == "state")
            .map(|l| l["state"].as_str().unwrap().to_owned())
            .collect()
    }

    fn log_text(&self) -> String {
        serde_json::to_string(&*self.logs.lock().unwrap()).unwrap()
    }
}

fn sha256(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

fn text(bytes: &[u8]) -> String {
    String::from_utf8(bytes.to_vec()).unwrap()
}

// ── the run flow and the egress gate ─────────────────────────────

#[tokio::test(start_paused = true)]
async fn a_cloud_run_commits_its_audit_row_before_the_adapter_gets_the_exact_bytes() {
    let f = fixture(None);
    let done = f.llm.run_once(f.post_call()).await.unwrap();
    assert_eq!(done.provenance.runtime, RuntimeChoice::ClaudeApiKey);
    assert_eq!(done.provenance.adapter, "scripted");
    let received = f.scripted.received();
    assert_eq!(received.len(), 1);
    let sent = &received[0].bytes;
    let audit = f.row("SELECT * FROM audit_log");
    assert_eq!(audit["kind"], "run");
    assert_eq!(audit["what"], "full_transcript");
    assert_eq!(audit["destination"], "api.anthropic.com");
    assert_eq!(audit["runtime_choice"], "claude_api_key");
    assert_eq!(audit["call_id"], "call_1");
    assert_eq!(audit["llm_run_id"], done.provenance.llm_run_id.as_str());
    assert_eq!(audit["bytes_out"], sent.len() as i64);
    assert_eq!(audit["payload_hash"], sha256(sent));
    assert_eq!(audit["ts"], 1_792_000_000_000_i64);
    assert_eq!(done.provenance.audit_ids.len(), 1);
    assert_eq!(audit["id"], done.provenance.audit_ids[0].as_str());
    // Sensitive sources and all audio never leave; ordinary text does (cloud allowed).
    let sent = text(sent);
    assert!(!sent.contains(SENSITIVE_TEXT) && !sent.contains(AUDIO_TEXT));
    assert!(sent.contains("ann@example.com"));
    assert!(audit["redaction_map_id"].is_null());
}

#[tokio::test(start_paused = true)]
async fn an_audit_write_failure_keeps_the_packet_from_the_adapter() {
    let f = fixture(None);
    rusqlite::Connection::open(&f.path)
        .unwrap()
        .execute_batch(
            "CREATE TRIGGER audit_down BEFORE INSERT ON audit_log BEGIN SELECT RAISE(ABORT, 'disk'); END;",
        )
        .unwrap();
    let failed = f.llm.run_once(f.post_call()).await.unwrap_err();
    assert!(matches!(failed, Failure::Storage(_)), "{failed:?}");
    assert!(f.scripted.received().is_empty());
    assert_eq!(f.count("SELECT count(*) FROM audit_log"), 0);
    assert_eq!(f.states().last().map(String::as_str), Some("failed"));
}

#[tokio::test(start_paused = true)]
async fn sensitive_local_only_and_offline_runs_make_no_cloud_request() {
    let sensitive = Privacy {
        sensitive: true,
        ..cloud()
    };
    let local_only = Privacy {
        mode: PrivacyMode::LocalOnly,
        ..cloud()
    };
    let offline = Privacy {
        offline: true,
        ..cloud()
    };
    for privacy in [sensitive, local_only, offline] {
        let f = fixture(None);
        f.privacy.send_replace(privacy);
        let done = f.llm.run_once(f.post_call()).await.unwrap();
        assert_eq!(done.provenance.runtime, RuntimeChoice::Local);
        let received = f.scripted.received();
        assert!(received.iter().all(|r| r.runtime == RuntimeChoice::Local));
        assert_eq!(f.count("SELECT count(*) FROM audit_log"), 0, "{privacy:?}");
        assert!(done.provenance.audit_ids.is_empty());
    }
}

#[tokio::test(start_paused = true)]
async fn the_gate_rechecks_privacy_at_release_and_refuses_cloud() {
    let f = fixture(None);
    let gate = Gate::new(
        Adapters::scripted(&f.scripted),
        f.store.clone(),
        Arc::new(|| TimestampMs(5)),
    );
    let run = tests_support::allocate(&f.store);
    let release = Release {
        llm_run_id: &run,
        call_id: None,
        map_id: "rmap_1",
        pseudonyms: false,
        skill: Skill::PostCall,
        repair: None,
    };
    let local_only = Privacy {
        mode: PrivacyMode::LocalOnly,
        ..cloud()
    };
    let sensitive = Privacy {
        sensitive: true,
        ..cloud()
    };
    for now in [local_only, sensitive] {
        let refused = gate
            .release(&release, &packet(), RuntimeChoice::ClaudeApiKey, now)
            .unwrap_err();
        let Failure::Unavailable(e) = refused else {
            panic!("{refused:?}")
        };
        assert_eq!(e.code, ErrorCode::RuntimeUnavailable);
    }
    // Local passes through unchanged and claims no audit row.
    let local = gate
        .release(&release, &packet(), RuntimeChoice::Local, cloud())
        .unwrap();
    assert!(local.audit_id().is_none());
    assert!(text(local.bytes()).contains(SENSITIVE_TEXT));
    assert_eq!(f.count("SELECT count(*) FROM audit_log"), 0);
}

#[tokio::test(start_paused = true)]
async fn redaction_and_pseudonyms_are_consistent_and_names_come_back_inside_the_core() {
    let script = r#"{"on": "role-review", "output": {"agent": "pm", "review_md": "Person 1 owns it; mail [EMAIL_1].", "evidence_segment_ids": ["seg_1"]}}"#;
    let f = fixture(Some(script));
    f.privacy.send_replace(Privacy {
        mode: PrivacyMode::CloudRedacted,
        ..cloud()
    });
    let mut req = f.request(Skill::RoleReview, TaskKind::PostCall);
    req.settings.pseudonyms = true;
    let done = f.llm.run_once(req).await.unwrap();
    let sent = text(&f.scripted.received()[0].bytes);
    assert!(!sent.contains("ann@example.com") && !sent.contains("Ann Lee"));
    assert!(!sent.contains("415 555") && !sent.contains("sk-abcdefghijklmnop"));
    assert_eq!(sent.matches("[EMAIL_1]").count(), 2, "{sent}");
    assert_eq!(sent.matches("Person 1").count(), 2, "{sent}");
    assert!(
        sent.contains("[PHONE_1]") && sent.contains("[SECRET_1]"),
        "{sent}"
    );
    // Only pseudonyms map back; redacted PII stays a placeholder.
    assert_eq!(done.output["review_md"], "Ann Lee owns it; mail [EMAIL_1].");
    let audit = f.row("SELECT redaction_map_id FROM audit_log");
    let map_id = audit["redaction_map_id"].as_str().unwrap();
    assert!(map_id.starts_with("rmap_"));
    assert!(!f.log_text().contains("Ann Lee"));
}

// ── validation, the repair retry and the simpler fallback ────────

#[tokio::test(start_paused = true)]
async fn an_invalid_output_is_repaired_once_through_the_gate() {
    let script = r#"{"on": "role-review", "output": {"agent": "pm", "review_md": "x", "evidence_segment_ids": ["seg_999"]}}"#;
    let f = fixture(Some(script));
    let done = f
        .llm
        .run_once(f.request(Skill::RoleReview, TaskKind::PostCall))
        .await
        .unwrap();
    assert!(done.provenance.retried && !done.provenance.fallback);
    let received = f.scripted.received();
    assert_eq!(received.len(), 2);
    assert!(text(&received[1].bytes).contains("repair"));
    assert_eq!(f.count("SELECT count(*) FROM audit_log"), 2);
    assert_eq!(done.provenance.audit_ids.len(), 2);
    let run = f.row("SELECT schema_ok, retried FROM llm_runs");
    assert_eq!(run, json!({"schema_ok": 1, "retried": 1}));
    let once = ["preparing", "gated", "running", "validating"];
    let expected: Vec<&str> = [&once[..], &once[..], &["succeeded"]].concat();
    assert_eq!(f.states(), expected);
}

#[tokio::test(start_paused = true)]
async fn a_second_invalid_output_falls_back_to_the_simpler_skill_locally() {
    let bad = r#"{"on": "post-call", "output": {"lang": "en"}}"#;
    let f = fixture(Some(&format!("{bad}\n{bad}")));
    let mut req = f.post_call();
    req.fallback = Some(Skill::RoleReview);
    let done = f.llm.run_once(req).await.unwrap();
    assert!(done.provenance.retried && done.provenance.fallback);
    assert_eq!(done.provenance.skill, Skill::RoleReview);
    assert_eq!(done.provenance.runtime, RuntimeChoice::Local);
    let received = f.scripted.received();
    assert_eq!(received.len(), 3);
    assert_eq!(received[2].runtime, RuntimeChoice::Local);
    assert_eq!(received[2].skill, "role-review");
}

#[tokio::test(start_paused = true)]
async fn an_output_that_fails_the_fallback_too_is_a_typed_failure() {
    let html = r#"{"on": "role-review", "output": {"agent": "pm", "review_md": "<script>x</script>", "evidence_segment_ids": ["seg_1"]}}"#;
    let f = fixture(Some(&[html, html, html].join("\n")));
    let failed = f
        .llm
        .run_once(f.request(Skill::RoleReview, TaskKind::PostCall))
        .await
        .unwrap_err();
    assert!(
        matches!(failed, Failure::Invalid { reason: "html" }),
        "{failed:?}"
    );
    assert_eq!(f.scripted.received().len(), 3);
    let run = f.row("SELECT schema_ok, retried FROM llm_runs");
    assert_eq!(run, json!({"schema_ok": 0, "retried": 1}));
    assert_eq!(f.states().last().map(String::as_str), Some("failed"));
}

#[test]
fn validation_checks_schema_html_and_citations() {
    let ids = ["seg_1".to_owned(), "chk_1".to_owned()];
    let review =
        |md: &str, ids: Value| json!({"agent": "pm", "review_md": md, "evidence_segment_ids": ids});
    assert!(validate(Skill::RoleReview, &review("fine", json!(["seg_1"])), &ids).is_ok());
    let reason = |v: &Value| validate(Skill::RoleReview, v, &ids).unwrap_err().reason;
    assert_eq!(reason(&json!({"agent": "pm"})), "schema");
    assert_eq!(reason(&review("<b>x</b>", json!(["seg_1"]))), "html");
    assert_eq!(reason(&review("x", json!(["seg_9"]))), "citations");
    assert_eq!(reason(&review("x", json!([]))), "citations");
    // An answer cites through its citations; "not found" needs none.
    let answer = json!({"answer_md": "No.", "citations": [], "found": false});
    assert!(validate(Skill::AskAnswer, &answer, &ids).is_ok());
    let cited = json!({"answer_md": "Yes [1].", "found": true,
        "citations": [{"n": 1, "segment_ids": [], "chunk_ids": ["chk_1"], "quote": "q"}]});
    assert!(validate(Skill::AskAnswer, &cited, &ids).is_ok());
    // The repair explanation never carries the model's text.
    let bad = validate(Skill::RoleReview, &review(MODEL_TEXT, json!(5)), &ids).unwrap_err();
    assert!(!bad.explain.contains(MODEL_TEXT), "{}", bad.explain);
}

#[test]
fn every_built_in_scripted_output_passes_validation() {
    let ids = vec!["seg_1".to_owned()];
    for skill in Skill::ALL {
        let out = built_in(skill, &ids);
        validate(skill, &out, &ids).unwrap_or_else(|e| panic!("{skill:?}: {}", e.explain));
        assert_eq!(skill.schema()["type"], "object");
    }
}

// ── routing ──────────────────────────────────────────────────────

fn all_available() -> Vec<Availability> {
    Scripted::new().availability_all()
}

fn choose(
    task: TaskKind,
    configured: Option<RuntimeChoice>,
    available: &[Availability],
    privacy: Privacy,
) -> Result<RuntimeChoice, Failure> {
    let settings = TaskSettings {
        configured,
        ..TaskSettings::default()
    };
    route(&Route {
        task: &task,
        settings: &settings,
        available,
        privacy,
        switched_to_local: false,
        budget: &Budget::default(),
        spent_usd: 0.0,
        prefer_local: false,
    })
    .map(|c| c.runtime)
}

fn without(available: &[Availability], runtimes: &[RuntimeChoice]) -> Vec<Availability> {
    let mut out = available.to_vec();
    for a in out.iter_mut().filter(|a| runtimes.contains(&a.runtime)) {
        a.unavailable = Some(RuntimeUnavailableReason::NoKey);
    }
    out
}

#[test]
fn routing_follows_privacy_then_the_fallback_order() {
    use RuntimeChoice::*;
    let all = all_available();
    let post = || TaskKind::PostCall;
    assert_eq!(
        choose(post(), Some(CodexApiKey), &all, cloud()).unwrap(),
        CodexApiKey
    );
    assert_eq!(choose(post(), None, &all, cloud()).unwrap(), ClaudeApiKey);
    let no_claude = without(&all, &[ClaudeApiKey, ClaudeAccount]);
    assert_eq!(
        choose(post(), Some(ClaudeApiKey), &no_claude, cloud()).unwrap(),
        CodexApiKey
    );
    let cloud_runtimes = [ClaudeApiKey, ClaudeAccount, CodexApiKey, ChatgptAccount];
    let only_local = without(&all, &cloud_runtimes);
    assert_eq!(
        choose(post(), Some(ClaudeApiKey), &only_local, cloud()).unwrap(),
        Local
    );
    let sensitive = Privacy {
        sensitive: true,
        ..cloud()
    };
    assert_eq!(
        choose(post(), Some(ClaudeApiKey), &all, sensitive).unwrap(),
        Local
    );
    let handoff = |target| TaskKind::Handoff { target };
    assert_eq!(
        choose(handoff(CodexApiKey), None, &all, cloud()).unwrap(),
        CodexApiKey
    );
    let no_codex = without(&all, &[CodexApiKey]);
    assert_eq!(
        choose(handoff(CodexApiKey), None, &no_codex, cloud()).unwrap(),
        Local
    );
}

#[test]
fn routing_never_relaxes_privacy_and_names_the_reason() {
    use RuntimeChoice::*;
    let every = [
        ClaudeApiKey,
        ClaudeAccount,
        CodexApiKey,
        ChatgptAccount,
        Local,
    ];
    let none = without(&all_available(), &every);
    let failed = choose(TaskKind::PostCall, Some(ClaudeApiKey), &none, cloud()).unwrap_err();
    let Failure::Unavailable(e) = failed else {
        panic!("{failed:?}")
    };
    assert_eq!(e.code, ErrorCode::RuntimeUnavailable);
    assert!(matches!(
        e.detail,
        Some(ErrorDetail::Runtime {
            runtime: ClaudeApiKey,
            reason: RuntimeUnavailableReason::NoKey,
            ..
        })
    ));
    // Sensitive with the local model down: unavailable, never a cloud run.
    let no_local = without(&all_available(), &[Local]);
    let sensitive = Privacy {
        sensitive: true,
        ..cloud()
    };
    let failed = choose(TaskKind::PostCall, Some(ClaudeApiKey), &no_local, sensitive).unwrap_err();
    let Failure::Unavailable(e) = failed else {
        panic!("{failed:?}")
    };
    assert!(matches!(
        e.detail,
        Some(ErrorDetail::Runtime {
            reason: RuntimeUnavailableReason::SensitiveCallNeedsLocal,
            ..
        })
    ));
}

#[test]
fn an_unknown_cli_major_is_refused() {
    let mut available = all_available();
    for a in available
        .iter_mut()
        .filter(|a| a.runtime != RuntimeChoice::Local)
    {
        a.version = Some("9.0.1".into());
    }
    let failed = choose(
        TaskKind::PostCall,
        Some(RuntimeChoice::ClaudeApiKey),
        &available,
        cloud(),
    )
    .unwrap_err();
    let Failure::Unavailable(e) = failed else {
        panic!("{failed:?}")
    };
    assert_eq!(e.code, ErrorCode::CliVersionUnsupported);
    assert!(
        matches!(e.detail, Some(ErrorDetail::CliVersion { ref found, .. }) if found == "9.0.1")
    );
}

#[test]
fn timeouts_follow_the_task() {
    assert_eq!(timeout(&TaskKind::PostCall), Duration::from_secs(600));
    assert_eq!(timeout(&TaskKind::Ask), Duration::from_secs(60));
    assert_eq!(timeout(&TaskKind::Live), Duration::from_secs(8));
}

// ── failures, budget, timeout and cancellation ───────────────────

#[tokio::test(start_paused = true)]
async fn two_consecutive_runtime_failures_switch_the_call_to_local() {
    let fail = r#"{"on": "post-call", "fail": "rate_limited"}"#;
    let f = fixture(Some(&format!("{fail}\n{fail}")));
    for _ in 0..2 {
        let failed = f.llm.run_once(f.post_call()).await.unwrap_err();
        assert!(matches!(failed, Failure::Runtime { ref code } if code == "rate_limited"));
    }
    assert_eq!(*f.switched.lock().unwrap(), [CallId::new("call_1")]);
    let done = f.llm.run_once(f.post_call()).await.unwrap();
    assert_eq!(done.provenance.runtime, RuntimeChoice::Local);
    // Another call is not affected.
    let mut other = f.post_call();
    other.call_id = Some(CallId::new("call_2"));
    let done = f.llm.run_once(other).await.unwrap();
    assert_eq!(done.provenance.runtime, RuntimeChoice::ClaudeApiKey);
}

#[tokio::test(start_paused = true)]
async fn a_spent_budget_stops_cloud_runs_and_retries() {
    let f = fixture(None);
    let mut req = f.post_call();
    req.budget = Budget {
        max_cost_usd: Some(0.0),
    };
    assert!(matches!(f.llm.run_once(req).await, Err(Failure::Budget)));
    assert!(f.scripted.received().is_empty());

    let bad = r#"{"on": "role-review", "cost_usd": 0.5, "output": {"agent": "pm", "review_md": "x", "evidence_segment_ids": []}}"#;
    let f = fixture(Some(bad));
    let mut req = f.request(Skill::RoleReview, TaskKind::PostCall);
    req.budget = Budget {
        max_cost_usd: Some(0.4),
    };
    assert!(matches!(f.llm.run_once(req).await, Err(Failure::Budget)));
    assert_eq!(f.scripted.received().len(), 1);
}

#[tokio::test(start_paused = true)]
async fn a_slow_runtime_times_out_by_task() {
    let f = fixture(Some(
        r#"{"on": "council-tick", "after_ms": 9000, "output": {"cards": []}}"#,
    ));
    let failed = f
        .llm
        .run_once(f.request(Skill::CouncilTick, TaskKind::Live))
        .await
        .unwrap_err();
    assert!(matches!(failed, Failure::Timeout), "{failed:?}");
    assert_eq!(f.states(), ["preparing", "gated", "running", "failed"]);
    let run = f.row("SELECT schema_ok, duration_ms FROM llm_runs");
    assert_eq!(run, json!({"schema_ok": 0, "duration_ms": 8000}));
}

#[tokio::test(start_paused = true)]
async fn cancellation_ends_the_request_and_drops_late_output() {
    let f = fixture(Some(r#"{"on": "post-call", "after_ms": 5000}"#));
    let req = f.post_call();
    let cancel = req.cancel.clone();
    let llm = f.llm.clone();
    let run = tokio::spawn(async move { llm.run_once(req).await });
    tokio::time::sleep(Duration::from_millis(1000)).await;
    cancel.cancel();
    assert!(matches!(run.await.unwrap(), Err(Failure::Cancelled)));
    tokio::time::sleep(Duration::from_secs(10)).await;
    assert_eq!(f.states(), ["preparing", "gated", "running", "cancelled"]);
    let run = f.row("SELECT schema_ok FROM llm_runs");
    assert_eq!(run, json!({"schema_ok": 0}));

    // Cancelled before it started: nothing is sent.
    let f = fixture(None);
    let req = f.post_call();
    req.cancel.cancel();
    assert!(matches!(f.llm.run_once(req).await, Err(Failure::Cancelled)));
    assert!(f.scripted.received().is_empty());
}

#[tokio::test(start_paused = true)]
async fn the_run_row_records_usage_timing_and_cost_only_for_api_keys() {
    let f = fixture(Some(r#"{"on": "post-call", "after_ms": 1500}"#));
    let done = f.llm.run_once(f.post_call()).await.unwrap();
    let run = f.row("SELECT * FROM llm_runs");
    assert_eq!(run["id"], done.provenance.llm_run_id.as_str());
    assert_eq!(run["adapter"], "scripted");
    assert_eq!(run["runtime_choice"], "claude_api_key");
    assert_eq!(run["skill"], "post-call");
    assert_eq!(run["skill_version"], "1.0.0");
    assert_eq!(run["call_id"], "call_1");
    assert_eq!(run["duration_ms"], 1500);
    assert_eq!(run["first_token_ms"], 1500);
    assert_eq!(run["schema_ok"], 1);
    assert_eq!(run["retried"], 0);
    assert!(run["tokens_in"].as_i64().unwrap() > 0);
    assert!(run["cost_usd"].as_f64().is_some());
    assert_eq!(run["prompt_hash"].as_str().unwrap().len(), 64);
    assert_eq!(done.provenance.duration_ms, 1500);

    let f = fixture(None);
    let mut req = f.post_call();
    req.settings.configured = Some(RuntimeChoice::ClaudeAccount);
    f.llm.run_once(req).await.unwrap();
    assert!(f.row("SELECT cost_usd FROM llm_runs")["cost_usd"].is_null());
}

#[tokio::test(start_paused = true)]
async fn operational_logs_never_hold_packet_model_text_or_credentials() {
    let output = json!({"agent": "pm", "review_md": MODEL_TEXT, "evidence_segment_ids": ["seg_9"]});
    let script = json!({"on": "role-review", "output": output}).to_string();
    let f = fixture(Some(&script));
    f.llm.run_once(f.post_call()).await.unwrap();
    f.llm
        .run_once(f.request(Skill::RoleReview, TaskKind::PostCall))
        .await
        .unwrap();
    let logs = f.log_text();
    assert!(logs.contains("\"event\":\"run_end\""), "{logs}");
    for secret in [
        NORMAL_TEXT,
        SENSITIVE_TEXT,
        AUDIO_TEXT,
        MODEL_TEXT,
        "ann@example.com",
        "sk-abcdefghijklmnop",
        "Ann Lee",
    ] {
        assert!(!logs.contains(secret), "{secret} in {logs}");
    }
}

// ── the request state machine ────────────────────────────────────

#[test]
fn the_request_machine_allows_only_its_transitions() {
    use RequestState::*;
    let all = [
        Preparing, Gated, Running, Validating, Succeeded, Failed, Cancelled,
    ];
    let allowed = [
        (Preparing, Gated),
        (Gated, Running),
        (Running, Validating),
        (Validating, Preparing),
        (Validating, Succeeded),
        (Preparing, Failed),
        (Running, Failed),
        (Validating, Failed),
        (Preparing, Cancelled),
        (Running, Cancelled),
        (Validating, Cancelled),
    ];
    for from in all {
        for to in all {
            assert_eq!(
                from.can(to),
                allowed.contains(&(from, to)),
                "{from:?} -> {to:?}"
            );
        }
    }
}

// ── sessions ─────────────────────────────────────────────────────

#[tokio::test(start_paused = true)]
async fn a_warm_session_gates_every_turn_and_resets_after_15_ticks() {
    let f = fixture(None);
    let live = || f.request(Skill::CouncilTick, TaskKind::Live);
    let session = f.llm.open_session(&live()).await.unwrap();
    for _ in 0..16 {
        let done = f.llm.send_turn(&session, live()).await.unwrap();
        assert_eq!(done.provenance.runtime, RuntimeChoice::ClaudeApiKey);
    }
    assert_eq!(f.count("SELECT count(*) FROM audit_log"), 16);
    assert_eq!(
        f.scripted.closed_sessions().len(),
        1,
        "reset after 15 ticks"
    );
    let sessions: std::collections::BTreeSet<_> = f
        .scripted
        .received()
        .into_iter()
        .map(|r| r.session.unwrap())
        .collect();
    assert_eq!(sessions.len(), 2);

    // A privacy change closes the cloud session instead of carrying the turn forward.
    f.privacy.send_replace(Privacy {
        sensitive: true,
        ..cloud()
    });
    let refused = f.llm.send_turn(&session, live()).await.unwrap_err();
    assert!(matches!(refused, Failure::Unavailable(_)), "{refused:?}");
    assert_eq!(f.scripted.closed_sessions().len(), 2);
    assert!(matches!(
        f.llm.send_turn(&session, live()).await,
        Err(Failure::Unavailable(_))
    ));
}

#[tokio::test(start_paused = true)]
async fn resume_continues_a_recorded_session_and_close_releases_it() {
    let f = fixture(None);
    let done = f
        .llm
        .resume("cli-session-7", f.request(Skill::AskAnswer, TaskKind::Ask))
        .await
        .unwrap();
    assert_eq!(done.provenance.session_id.as_deref(), Some("cli-session-7"));
    assert_eq!(f.scripted.closed_sessions(), ["cli-session-7"]);
    let session = f
        .llm
        .open_session(&f.request(Skill::CouncilTick, TaskKind::Live))
        .await
        .unwrap();
    f.llm.close_session(&session);
    assert_eq!(f.scripted.closed_sessions().len(), 2);
    assert_eq!(f.llm.availability().len(), 5);
}

// ── one way out ──────────────────────────────────────────────────

#[test]
fn only_the_gate_hands_a_packet_to_an_adapter() {
    let src = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    let mut callers = Vec::new();
    for dir in [src.clone(), src.join("adapters")] {
        for entry in std::fs::read_dir(&dir).unwrap() {
            let path = entry.unwrap().path();
            let name = path.file_name().unwrap().to_string_lossy().into_owned();
            if name.ends_with(".rs") && name != "runtime_tests.rs" {
                let code = std::fs::read_to_string(&path).unwrap();
                if code.contains(".invoke(") {
                    callers.push(name);
                }
            }
        }
    }
    assert_eq!(callers, ["gate.rs"]);
}

#[test]
fn a_script_line_names_a_skill_and_at_most_one_answer() {
    assert!(Scripted::parse(r#"{"on": "post-call", "output": {}}"#).is_ok());
    assert!(Scripted::parse(r#"{"on": "post-call", "after_ms": 5}"#).is_ok());
    assert!(Scripted::parse(r#"{"on": "nope", "output": {}}"#).is_err());
    assert!(Scripted::parse(r#"{"on": "post-call", "output": {}, "fail": "x"}"#).is_err());
    assert!(Scripted::parse("not json").is_err());
    assert!(Scripted::parse("\n\n").is_ok());
}
