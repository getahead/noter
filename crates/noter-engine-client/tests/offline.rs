//! The supervisor side of the offline pass and the embeddings (`core-engine-offline.md`): the
//! request registry and its states, container-relative path checks, result-file and vector
//! validation, engine exit, abandoned requests and late completions, on the scripted engine.

use std::path::{Path, PathBuf};
use std::time::Duration;

use noter_engine_client::scripted::{Behaviour, Script, ScriptedEngine};
use noter_engine_client::{
    Config, EngineClient, EngineSession, OfflineError, OfflineKey, OfflineState,
};
use noter_protocol::engine::{
    ArchiveResult, AsrBackend, EngineCommand, EngineErrorCode, EngineEvent, EngineSpan,
    StartSession,
};
use noter_protocol::{AudioChannel, CallId, OffsetMs};

const EMPTY: &str = r#"{"call_id":"call_1","backend":"whisper_large_v3","segments":[]}"#;

fn call() -> CallId {
    CallId::new("call_1")
}

fn engine(dir: &Path) -> ScriptedEngine {
    ScriptedEngine::new().with_container(dir)
}

fn client(engine: &ScriptedEngine) -> EngineClient<ScriptedEngine> {
    EngineClient::new(engine.clone(), Config::default())
}

fn scripted(dir: &Path, script: &str) -> ScriptedEngine {
    engine(dir).with_script(Script::parse(script).unwrap())
}

async fn ms(n: u64) {
    tokio::time::sleep(Duration::from_millis(n)).await;
}

fn write(dir: &Path, rel: &str, content: impl AsRef<[u8]>) {
    let path = dir.join(rel);
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, content).unwrap();
}

fn write_f32(dir: &Path, rel: &str, values: &[f32]) {
    let bytes: Vec<u8> = values.iter().flat_map(|v| v.to_le_bytes()).collect();
    write(dir, rel, bytes);
}

async fn pass(
    c: &EngineClient<ScriptedEngine>,
    result_path: &str,
) -> Result<PathBuf, OfflineError> {
    c.offline_pass(
        call(),
        "audio/call_1".into(),
        result_path.into(),
        Some("audio/call_1/constraints.json".into()),
        AsrBackend::WhisperLargeV3,
    )
    .await
}

fn span(t0: u32, t1: u32) -> EngineSpan {
    EngineSpan {
        t0_ms: OffsetMs(t0),
        t1_ms: OffsetMs(t1),
    }
}

async fn speaker(
    c: &EngineClient<ScriptedEngine>,
    id: &str,
    out: &str,
) -> Result<Vec<f32>, OfflineError> {
    c.speaker_embedding(
        id.into(),
        call(),
        AudioChannel::Sys,
        vec![span(1_000, 4_000)],
        out.into(),
    )
    .await
}

fn texts(n: usize) -> Vec<String> {
    (0..n).map(|i| format!("chunk {i}")).collect()
}

fn offline_cmds(engine: &ScriptedEngine) -> usize {
    engine
        .commands()
        .iter()
        .filter(|c| {
            matches!(
                c,
                EngineCommand::OfflinePass { .. }
                    | EngineCommand::SpeakerEmbedding { .. }
                    | EngineCommand::EmbedTexts { .. }
            )
        })
        .count()
}

/// The call's archive pass in the registry.
fn key() -> OfflineKey {
    OfflineKey::Call(call())
}

fn request(id: &str) -> OfflineKey {
    OfflineKey::Request(id.into())
}

fn spawn<T: Send + 'static>(
    f: impl std::future::Future<Output = T> + Send + 'static,
) -> tokio::task::JoinHandle<T> {
    tokio::spawn(f)
}

// --- the archive pass ---------------------------------------------------------------------------

// @cpt-dod:cpt-noter-dod-core-engine-offline-tests:p1
#[tokio::test(start_paused = true)]
async fn an_archive_pass_returns_the_complete_result_file_after_its_progress() {
    let dir = tempfile::tempdir().unwrap();
    let engine = engine(dir.path());
    let c = client(&engine);
    let mut events = c.events();
    let path = pass(&c, "audio/call_1/offline.json").await.unwrap();
    assert_eq!(path, dir.path().join("audio/call_1/offline.json"));
    let result: ArchiveResult = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    assert_eq!(result.call_id, call());
    // Progress reaches subscribers before the result.
    let mut got = vec![];
    while let Ok(line) = events.try_recv() {
        got.push(line.event);
    }
    let at = |f: fn(&EngineEvent) -> bool| got.iter().position(f).unwrap();
    assert!(
        at(|e| matches!(e, EngineEvent::OfflineProgress { .. }))
            < at(|e| matches!(e, EngineEvent::OfflineDone { .. }))
    );
    assert_eq!(
        c.offline_state(&key()),
        None,
        "a complete request leaves the registry"
    );
    assert!(matches!(
        &engine.commands()[..],
        [
            EngineCommand::SetDetection { .. },
            EngineCommand::OfflinePass {
                constraints_path: Some(_),
                ..
            }
        ]
    ));
}

#[tokio::test(start_paused = true)]
async fn unsafe_paths_are_refused_before_the_engine_hears_of_them() {
    let dir = tempfile::tempdir().unwrap();
    let engine = engine(dir.path());
    let c = client(&engine);
    for bad in [
        "",
        "/etc/passwd",
        "../outside.json",
        "audio/../../x.json",
        "audio/./x",
        "a\0b",
    ] {
        let r = pass(&c, bad).await;
        assert!(matches!(r, Err(OfflineError::UnsafePath(_))), "{bad:?}");
        let r = speaker(&c, "r", bad).await;
        assert!(matches!(r, Err(OfflineError::UnsafePath(_))), "{bad:?}");
        let r = c.embed_texts("t".into(), texts(2), Some(bad.into())).await;
        assert!(matches!(r, Err(OfflineError::UnsafePath(_))), "{bad:?}");
    }
    let backend = AsrBackend::WhisperLargeV3;
    let r = c
        .offline_pass(
            call(),
            "/audio/call_1".into(),
            "audio/r.json".into(),
            None,
            backend,
        )
        .await;
    assert!(matches!(r, Err(OfflineError::UnsafePath(_))));
    let constraints = Some("../c.json".into());
    let r = c
        .offline_pass(
            call(),
            "audio/call_1".into(),
            "audio/r.json".into(),
            constraints,
            backend,
        )
        .await;
    assert!(matches!(r, Err(OfflineError::UnsafePath(_))));
    assert_eq!(offline_cmds(&engine), 0);
}

#[tokio::test(start_paused = true)]
async fn without_a_container_nothing_is_sent() {
    let engine = ScriptedEngine::new();
    let c = client(&engine);
    let r = pass(&c, "audio/call_1/r.json").await;
    assert!(matches!(r, Err(OfflineError::UnsafePath(_))));
    assert_eq!(offline_cmds(&engine), 0);
}

#[tokio::test(start_paused = true)]
async fn an_engine_refusal_fails_the_pending_request() {
    let dir = tempfile::tempdir().unwrap();
    let engine = engine(dir.path()).with_default(Behaviour {
        reject: true,
        ..Behaviour::default()
    });
    let c = client(&engine);
    let r = pass(&c, "audio/call_1/r.json").await;
    assert!(
        matches!(
            r,
            Err(OfflineError::Engine {
                code: EngineErrorCode::BadCommand,
                ..
            })
        ),
        "{r:?}"
    );
    assert_eq!(c.offline_state(&key()), None);
    let r = speaker(&c, "req_1", "engine-io/s.f32").await;
    assert!(matches!(r, Err(OfflineError::Engine { .. })));
}

#[tokio::test(start_paused = true)]
async fn offline_failed_rejects_the_running_pass() {
    let dir = tempfile::tempdir().unwrap();
    let engine = scripted(
        dir.path(),
        r#"{"on": "offline_pass", "after_ms": 10, "event": {"type": "offline_progress", "call_id": "call_1", "progress": 0.25}}
{"on": "offline_pass", "after_ms": 20, "event": {"type": "offline_failed", "call_id": "call_1", "code": "model_missing"}}"#,
    );
    let c = client(&engine);
    let r = pass(&c, "audio/call_1/r.json").await;
    assert!(
        matches!(
            r,
            Err(OfflineError::Engine {
                code: EngineErrorCode::ModelMissing,
                ..
            })
        ),
        "{r:?}"
    );
    assert_eq!(c.offline_state(&key()), None);
}

#[tokio::test(start_paused = true)]
async fn a_done_without_a_complete_result_file_fails() {
    let dir = tempfile::tempdir().unwrap();
    let d = dir.path();
    let engine = scripted(
        d,
        r#"{"on": "offline_pass", "after_ms": 10, "event": {"type": "offline_done", "call_id": "call_1", "result_path": "audio/call_1/r.json"}}"#,
    );
    let c = client(&engine);
    let bad = |r: Result<PathBuf, OfflineError>| matches!(r, Err(OfflineError::BadResult(_)));
    // Missing.
    assert!(bad(pass(&c, "audio/call_1/r.json").await));
    // Cut off half-way (an incomplete write).
    write(
        d,
        "audio/call_1/r.json",
        r#"{"call_id":"call_1","backend":"whisper_la"#,
    );
    assert!(bad(pass(&c, "audio/call_1/r.json").await));
    // Another call's result.
    write(d, "audio/call_1/r.json", EMPTY.replace("call_1", "call_2"));
    assert!(bad(pass(&c, "audio/call_1/r.json").await));
    // Word timings that point out of the container.
    let mut result = noter_protocol::fixtures::engine_lines::archive_results().remove(0);
    result.segments[0].words_path = Some("../words.json".into());
    write(
        d,
        "audio/call_1/r.json",
        serde_json::to_vec(&result).unwrap(),
    );
    assert!(bad(pass(&c, "audio/call_1/r.json").await));
    // Word timings referenced but not written.
    let result = noter_protocol::fixtures::engine_lines::archive_results().remove(0);
    write(
        d,
        "audio/call_1/r.json",
        serde_json::to_vec(&result).unwrap(),
    );
    assert!(bad(pass(&c, "audio/call_1/r.json").await));
    // Everything in place.
    for s in &result.segments {
        write(d, s.words_path.as_deref().unwrap(), "[]");
    }
    assert!(pass(&c, "audio/call_1/r.json").await.is_ok());
}

#[cfg(unix)]
#[tokio::test(start_paused = true)]
async fn a_result_behind_a_symlink_out_of_the_container_fails() {
    let dir = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    write(outside.path(), "r.json", EMPTY);
    std::fs::create_dir_all(dir.path().join("audio")).unwrap();
    std::os::unix::fs::symlink(outside.path(), dir.path().join("audio/call_1")).unwrap();
    let engine = scripted(
        dir.path(),
        r#"{"on": "offline_pass", "after_ms": 10, "event": {"type": "offline_done", "call_id": "call_1", "result_path": "audio/call_1/r.json"}}"#,
    );
    let r = pass(&client(&engine), "audio/call_1/r.json").await;
    assert!(matches!(r, Err(OfflineError::BadResult(_))), "{r:?}");
}

#[tokio::test(start_paused = true)]
async fn a_scripted_done_naming_an_absolute_file_installs_that_fixture_for_the_asked_call() {
    let dir = tempfile::tempdir().unwrap();
    let fixtures = tempfile::tempdir().unwrap();
    // A result recorded for another call, without word timings.
    let mut recorded = noter_protocol::fixtures::engine_lines::archive_results().remove(0);
    recorded.call_id = CallId::new("call_recorded");
    for s in &mut recorded.segments {
        s.call_id = recorded.call_id.clone();
        s.words_path = None;
    }
    let fixture = fixtures.path().join("archive.json");
    std::fs::write(&fixture, serde_json::to_vec(&recorded).unwrap()).unwrap();
    let step = serde_json::json!({"on": "offline_pass", "after_ms": 10, "event": {
        "type": "offline_done", "call_id": "call_recorded", "result_path": fixture}});
    let engine = scripted(dir.path(), &step.to_string());
    // The core names a fresh result file per pass; the fixture lands there, for this call.
    let c = client(&engine);
    let within = |f| tokio::time::timeout(Duration::from_secs(60), f);
    let path = within(pass(&c, "audio/call_1/archive-01.json"))
        .await
        .expect("answered")
        .unwrap();
    assert_eq!(path, dir.path().join("audio/call_1/archive-01.json"));
    let got: ArchiveResult = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    assert_eq!(got.call_id, call());
    assert!(got.segments.iter().all(|s| s.call_id == call()));
    assert_eq!(got.segments.len(), recorded.segments.len());
    // A fixture that cannot be read fails the pass instead of leaving it waiting.
    std::fs::remove_file(&fixture).unwrap();
    let r = within(pass(&c, "audio/call_1/archive-02.json"))
        .await
        .expect("answered");
    assert!(matches!(r, Err(OfflineError::Engine { .. })), "{r:?}");
}

/// Progress only: the pass runs until the test answers it.
const RUNS: &str = r#"{"on": "offline_pass", "after_ms": 10, "event": {"type": "offline_progress", "call_id": "call_1", "progress": 0.5}}"#;

#[tokio::test(start_paused = true)]
async fn the_states_follow_the_engine_running_then_gone() {
    let dir = tempfile::tempdir().unwrap();
    let engine = scripted(dir.path(), RUNS);
    let c = client(&engine);
    c.ensure_ready().await.unwrap();
    let task = spawn({
        let c = c.clone();
        async move { pass(&c, "audio/call_1/r.json").await }
    });
    ms(5).await;
    assert_eq!(c.offline_state(&key()), Some(OfflineState::Running));
    // A done for another call, or before any request, changes nothing.
    assert!(engine.inject(EngineEvent::OfflineDone {
        call_id: CallId::new("call_2"),
        result_path: "audio/call_2/r.json".into(),
    }));
    ms(5).await;
    assert_eq!(c.offline_state(&key()), Some(OfflineState::Running));
    write(dir.path(), "audio/call_1/r.json", EMPTY);
    assert!(engine.inject(EngineEvent::OfflineDone {
        call_id: call(),
        result_path: "audio/call_1/r.json".into(),
    }));
    assert!(task.await.unwrap().is_ok());
    assert_eq!(c.offline_state(&key()), None);
}

#[tokio::test(start_paused = true)]
async fn engine_exit_rejects_every_pending_request_and_capture_restarts_first() {
    let dir = tempfile::tempdir().unwrap();
    let engine = scripted(
        dir.path(),
        &format!(
            r#"{{"on": "start_session", "after_ms": 300, "event": {{"type": "session_started", "call_id": "call_9", "mic_device": "mic", "output_device": "out"}}}}
{RUNS}
{{"on": "speaker_embedding", "after_ms": 10, "event": {{"type": "silence", "call_id": "call_9", "since_ms": 0}}}}"#
        ),
    );
    let c = client(&engine);
    c.start_session(StartSession {
        call_id: CallId::new("call_9"),
        session_dir: "audio/call_9".into(),
        store_audio: true,
        mic_device_uid: None,
        exclude_bundle_ids: vec![],
        languages: vec![],
        backend: AsrBackend::WhisperTurbo,
        glossary: vec![],
        speaker_priors: vec![],
        enrolled_embeddings_path: None,
        resume_from_ms: None,
    })
    .await
    .unwrap();
    ms(301).await;
    assert_eq!(c.session(), EngineSession::Capturing);
    let archive = spawn({
        let c = c.clone();
        async move { pass(&c, "audio/call_1/r.json").await }
    });
    let vector = spawn({
        let c = c.clone();
        async move { speaker(&c, "req_1", "engine-io/s.f32").await }
    });
    ms(20).await;
    assert_eq!(c.offline_state(&key()), Some(OfflineState::Running));
    assert_eq!(
        c.offline_state(&request("req_1")),
        Some(OfflineState::Running)
    );
    let before = engine.commands().len();
    engine.kill_current();
    assert_eq!(archive.await.unwrap(), Err(OfflineError::Unavailable));
    assert_eq!(vector.await.unwrap(), Err(OfflineError::Unavailable));
    // Capture-first: the session comes back; retrying the archive is the scheduler's job.
    ms(2_000).await;
    assert_eq!(c.session(), EngineSession::Capturing);
    let after = &engine.commands()[before..];
    assert!(after
        .iter()
        .any(|c| matches!(c, EngineCommand::StartSession(s) if s.resume_from_ms.is_some())));
    assert!(!after
        .iter()
        .any(|c| matches!(c, EngineCommand::OfflinePass { .. })));
}

#[tokio::test(start_paused = true)]
async fn an_abandoned_pass_never_resolves_a_late_completion() {
    let dir = tempfile::tempdir().unwrap();
    let engine = scripted(dir.path(), RUNS);
    let c = client(&engine);
    c.ensure_ready().await.unwrap();
    let old = spawn({
        let c = c.clone();
        async move { pass(&c, "audio/call_1/old.json").await }
    });
    ms(5).await;
    assert_eq!(c.offline_state(&key()), Some(OfflineState::Running));
    // The caller cancels (the scheduler pauses the job).
    old.abort();
    assert!(old.await.unwrap_err().is_cancelled());
    assert_eq!(c.offline_state(&key()), None);
    // A new pass for the same call: the old pass's late completion must not resolve it.
    let new = spawn({
        let c = c.clone();
        async move { pass(&c, "audio/call_1/new.json").await }
    });
    ms(5).await;
    write(dir.path(), "audio/call_1/old.json", EMPTY);
    write(dir.path(), "audio/call_1/new.json", EMPTY);
    engine.inject(EngineEvent::OfflineDone {
        call_id: call(),
        result_path: "audio/call_1/old.json".into(),
    });
    ms(5).await;
    assert!(!new.is_finished());
    assert_eq!(c.offline_state(&key()), Some(OfflineState::Running));
    engine.inject(EngineEvent::OfflineDone {
        call_id: call(),
        result_path: "audio/call_1/new.json".into(),
    });
    let path = new.await.unwrap().unwrap();
    assert_eq!(path, dir.path().join("audio/call_1/new.json"));
}

#[tokio::test(start_paused = true)]
async fn a_new_pass_for_the_same_call_supersedes_the_running_one() {
    let dir = tempfile::tempdir().unwrap();
    let engine = scripted(dir.path(), RUNS);
    let c = client(&engine);
    c.ensure_ready().await.unwrap();
    let old = spawn({
        let c = c.clone();
        async move { pass(&c, "audio/call_1/old.json").await }
    });
    ms(5).await;
    let _new = spawn({
        let c = c.clone();
        async move { pass(&c, "audio/call_1/new.json").await }
    });
    assert_eq!(old.await.unwrap(), Err(OfflineError::Abandoned));
    ms(5).await;
    assert_eq!(c.offline_state(&key()), Some(OfflineState::Running));
}

/// The engine acknowledges an embedding and answers nothing else until the test does.
const TEXTS_RUN: &str = r#"{"on": "embed_texts", "after_ms": 10, "event": {"type": "silence", "call_id": "call_1", "since_ms": 0}}"#;

#[tokio::test(start_paused = true)]
async fn a_correlated_error_after_the_ack_fails_the_running_request() {
    let dir = tempfile::tempdir().unwrap();
    let engine = scripted(dir.path(), TEXTS_RUN);
    let c = client(&engine);
    c.ensure_ready().await.unwrap();
    let task = spawn({
        let c = c.clone();
        async move { c.embed_texts("req_1".into(), texts(1), None).await }
    });
    ms(5).await;
    assert_eq!(
        c.offline_state(&request("req_1")),
        Some(OfflineState::Running)
    );
    let id = engine.last_command_id().unwrap();
    engine.inject(EngineEvent::Error {
        cmd_id: Some(id),
        code: EngineErrorCode::ModelLoadFailed,
        message: "bge-m3".into(),
    });
    let r = task.await.unwrap();
    assert!(
        matches!(
            r,
            Err(OfflineError::Engine {
                code: EngineErrorCode::ModelLoadFailed,
                ..
            })
        ),
        "{r:?}"
    );
    assert_eq!(c.offline_state(&request("req_1")), None);
}

// --- embeddings ---------------------------------------------------------------------------------

#[tokio::test(start_paused = true)]
async fn a_speaker_embedding_returns_256_finite_values_and_releases_its_file() {
    let dir = tempfile::tempdir().unwrap();
    let c = client(&engine(dir.path()));
    let v = speaker(&c, "req_1", "engine-io/s.f32").await.unwrap();
    assert_eq!(v.len(), 256);
    assert!(v.iter().all(|x| x.is_finite()));
    assert!(
        !dir.path().join("engine-io/s.f32").exists(),
        "scratch file released"
    );
    assert_eq!(c.offline_state(&request("req_1")), None);
}

#[tokio::test(start_paused = true)]
async fn speaker_spans_are_checked_before_sending() {
    let dir = tempfile::tempdir().unwrap();
    let engine = engine(dir.path());
    let c = client(&engine);
    for spans in [vec![], vec![span(2_000, 2_000)], vec![span(3_000, 1_000)]] {
        let r = c
            .speaker_embedding(
                "r".into(),
                call(),
                AudioChannel::Sys,
                spans,
                "engine-io/s.f32".into(),
            )
            .await;
        assert!(matches!(r, Err(OfflineError::Invalid(_))), "{r:?}");
    }
    assert_eq!(offline_cmds(&engine), 0);
}

async fn speaker_with(values: &[f32], reported: &str) -> Result<Vec<f32>, OfflineError> {
    let dir = tempfile::tempdir().unwrap();
    write_f32(dir.path(), "engine-io/s.f32", values);
    let engine = scripted(
        dir.path(),
        &format!(
            r#"{{"on": "speaker_embedding", "after_ms": 10, "event": {{"type": "speaker_embedding_done", "request_id": "req_1", "out_path": "{reported}"}}}}"#
        ),
    );
    speaker(&client(&engine), "req_1", "engine-io/s.f32").await
}

#[tokio::test(start_paused = true)]
async fn malformed_speaker_vectors_fail() {
    let bad = |r: Result<Vec<f32>, OfflineError>| matches!(r, Err(OfflineError::BadResult(_)));
    assert!(speaker_with(&[0.5; 256], "engine-io/s.f32").await.is_ok());
    assert!(bad(speaker_with(&[0.5; 255], "engine-io/s.f32").await));
    let mut nan = vec![0.5; 256];
    nan[7] = f32::NAN;
    assert!(bad(speaker_with(&nan, "engine-io/s.f32").await));
    let mut inf = vec![0.5; 256];
    inf[0] = f32::INFINITY;
    assert!(bad(speaker_with(&inf, "engine-io/s.f32").await));
    assert!(bad(speaker_with(&[0.5; 256], "engine-io/other.f32").await));
}

#[tokio::test(start_paused = true)]
async fn one_query_comes_back_inline_with_1024_values() {
    let dir = tempfile::tempdir().unwrap();
    let c = client(&engine(dir.path()));
    let rows = c.embed_texts("req_1".into(), texts(1), None).await.unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].len(), 1024);
    assert!(rows[0].iter().all(|x| x.is_finite()));
}

#[tokio::test(start_paused = true)]
async fn a_batch_comes_back_by_file_in_input_order_and_an_empty_one_has_zero_rows() {
    let dir = tempfile::tempdir().unwrap();
    let c = client(&engine(dir.path()));
    let batch = c
        .embed_texts("req_1".into(), texts(3), Some("engine-io/b.f32".into()))
        .await
        .unwrap();
    assert_eq!(batch.len(), 3);
    assert!(
        !dir.path().join("engine-io/b.f32").exists(),
        "scratch file released"
    );
    for (i, row) in batch.iter().enumerate() {
        let one = c
            .embed_texts(format!("q{i}"), vec![format!("chunk {i}")], None)
            .await
            .unwrap();
        assert_eq!(&one[0], row, "row {i} is text {i}");
    }
    assert_ne!(batch[0], batch[1]);
    let empty = c
        .embed_texts("req_2".into(), vec![], Some("engine-io/e.f32".into()))
        .await
        .unwrap();
    assert!(empty.is_empty());
    // A batch (an empty one too) needs a file.
    let r = c.embed_texts("req_3".into(), texts(2), None).await;
    assert!(matches!(r, Err(OfflineError::Invalid(_))));
    let r = c.embed_texts("req_4".into(), vec![], None).await;
    assert!(matches!(r, Err(OfflineError::Invalid(_))));
}

#[tokio::test(start_paused = true)]
async fn a_duplicate_live_request_id_is_refused() {
    let dir = tempfile::tempdir().unwrap();
    let engine = scripted(dir.path(), TEXTS_RUN);
    let c = client(&engine);
    c.ensure_ready().await.unwrap();
    let _first = spawn({
        let c = c.clone();
        async move { c.embed_texts("req_1".into(), texts(1), None).await }
    });
    ms(5).await;
    let r = c.embed_texts("req_1".into(), texts(1), None).await;
    assert!(matches!(r, Err(OfflineError::Invalid(_))));
    assert_eq!(
        c.offline_state(&request("req_1")),
        Some(OfflineState::Running)
    );
}

async fn texts_with(
    event: &str,
    n: usize,
    out: Option<&str>,
    file: Option<&[f32]>,
) -> Result<Vec<Vec<f32>>, OfflineError> {
    let dir = tempfile::tempdir().unwrap();
    if let Some(values) = file {
        write_f32(dir.path(), "engine-io/b.f32", values);
    }
    let engine = scripted(
        dir.path(),
        &format!(r#"{{"on": "embed_texts", "after_ms": 10, "event": {event}}}"#),
    );
    client(&engine)
        .embed_texts("req_1".into(), texts(n), out.map(Into::into))
        .await
}

#[tokio::test(start_paused = true)]
async fn malformed_text_vectors_fail() {
    let bad = |r: Result<Vec<Vec<f32>>, OfflineError>| matches!(r, Err(OfflineError::BadResult(_)));
    let inline = |v: &str, count: u32| {
        format!(
            r#"{{"type": "embeddings", "request_id": "req_1", "inline": {v}, "out_path": null, "count": {count}}}"#
        )
    };
    let ok = format!("[{}]", vec!["0.5"; 1024].join(","));
    assert!(texts_with(&inline(&ok, 1), 1, None, None).await.is_ok());
    let short = format!("[{}]", vec!["0.5"; 1023].join(","));
    assert!(bad(texts_with(&inline(&short, 1), 1, None, None).await));
    assert!(bad(texts_with(&inline(&ok, 2), 1, None, None).await));
    assert!(bad(texts_with(&inline("null", 1), 1, None, None).await));
    let file = |count: u32| {
        format!(
            r#"{{"type": "embeddings", "request_id": "req_1", "inline": null, "out_path": "engine-io/b.f32", "count": {count}}}"#
        )
    };
    let out = Some("engine-io/b.f32");
    let rows = vec![0.25; 2 * 1024];
    let got = texts_with(&file(2), 2, out, Some(&rows)).await.unwrap();
    assert_eq!(got.len(), 2);
    // Count, file length and request size must agree; values must be finite; the file must exist.
    assert!(bad(texts_with(&file(3), 2, out, Some(&rows)).await));
    assert!(bad(texts_with(&file(2), 3, out, Some(&rows)).await));
    let mut nan = rows.clone();
    nan[2047] = f32::NAN;
    assert!(bad(texts_with(&file(2), 2, out, Some(&nan)).await));
    assert!(bad(texts_with(&file(2), 2, out, None).await));
    // A batch answered inline is not what was asked.
    assert!(bad(texts_with(&inline(&ok, 1), 1, out, None).await));
}

#[test]
fn offline_errors_become_typed_core_errors() {
    use noter_protocol::ErrorCode;
    let code = |e: OfflineError| noter_protocol::CoreError::from(e).code;
    assert_eq!(
        code(OfflineError::Unavailable),
        ErrorCode::EngineUnavailable
    );
    let engine = |code| OfflineError::Engine {
        code,
        message: String::new(),
    };
    assert_eq!(
        code(engine(EngineErrorCode::ModelMissing)),
        ErrorCode::ModelMissing
    );
    assert_eq!(code(engine(EngineErrorCode::DiskFull)), ErrorCode::DiskFull);
    assert_eq!(
        code(engine(EngineErrorCode::BadCommand)),
        ErrorCode::Internal
    );
    for e in [
        OfflineError::UnsafePath("x".into()),
        OfflineError::BadResult("x".into()),
        OfflineError::Invalid("x".into()),
        OfflineError::Abandoned,
    ] {
        assert_eq!(code(e), ErrorCode::Internal);
    }
}

#[tokio::test(start_paused = true)]
async fn shutdown_rejects_every_pending_request() {
    let dir = tempfile::tempdir().unwrap();
    let engine = scripted(dir.path(), RUNS);
    let c = client(&engine);
    c.ensure_ready().await.unwrap();
    let archive = spawn({
        let c = c.clone();
        async move { pass(&c, "audio/call_1/r.json").await }
    });
    ms(5).await;
    assert_eq!(c.offline_state(&key()), Some(OfflineState::Running));
    c.shutdown().await;
    assert_eq!(archive.await.unwrap(), Err(OfflineError::Unavailable));
    assert_eq!(c.offline_state(&key()), None);
}
