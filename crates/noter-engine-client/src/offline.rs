//! The offline pass and the embeddings as the supervisor sees them
//! (`docs/features/core/core-engine-offline.md`): a registry of requests keyed by call (archive)
//! or request id (vectors) with the states pending, running, complete, failed and abandoned;
//! container-relative path checks before anything is sent; and validation of what the engine
//! answers (a complete result file inside the container, 256 or 1024 finite values per vector,
//! the row count of the request) before a caller gets it. Pending requests are process-local:
//! the job record owns retries; abandoning one adds no engine command, it only drops the answer.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use noter_protocol::engine::{
    ArchiveResult, AsrBackend, EngineCommand, EngineErrorCode, EngineEvent, EngineSpan,
};
use noter_protocol::{AudioChannel, CallId, CoreError, ErrorCode};
use tokio::sync::oneshot;

use crate::{CommandError, EngineClient, EngineLauncher};

/// A WeSpeaker speaker embedding has this many values.
pub const SPEAKER_DIMS: usize = 256;
/// A bge-m3 text embedding has this many values.
pub const TEXT_DIMS: usize = 1024;

/// A request in the registry: the archive pass of a call, or an embedding request.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum OfflineKey {
    Call(CallId),
    Request(String),
}

// @cpt-state:cpt-noter-state-core-engine-offline-request:p1
/// An offline request's state. Complete, failed and abandoned requests leave the registry: the
/// caller holds the outcome.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OfflineState {
    Pending,
    Running,
    Complete,
    Failed,
    Abandoned,
}

/// Why an offline request did not complete.
#[derive(Debug, Clone, PartialEq)]
pub enum OfflineError {
    /// A path is not container-relative (absolute, `..`, empty), or no container is known.
    UnsafePath(String),
    /// The request is malformed (no spans, an empty span, a batch without a file, a live id twice).
    Invalid(String),
    /// The engine refused the request (`error`) or failed it (`offline_failed`).
    Engine {
        code: EngineErrorCode,
        message: String,
    },
    /// The engine's answer did not validate: a missing or incomplete file, a file out of the
    /// container, wrong dimensions, non-finite values or a wrong count.
    BadResult(String),
    /// The engine is not running, could not start, or exited before answering.
    Unavailable,
    /// A newer request for the same call replaced this one.
    Abandoned,
}

impl From<CommandError> for OfflineError {
    fn from(e: CommandError) -> Self {
        match e {
            CommandError::Unavailable => OfflineError::Unavailable,
            CommandError::Engine { code, message } => OfflineError::Engine { code, message },
        }
    }
}

impl From<OfflineError> for CoreError {
    fn from(e: OfflineError) -> Self {
        match e {
            OfflineError::Unavailable => CommandError::Unavailable.into(),
            OfflineError::Engine { code, message } => CommandError::Engine { code, message }.into(),
            other => CoreError::new(ErrorCode::Internal, format!("offline request: {other:?}")),
        }
    }
}

/// What the engine answered for a running request, before the caller validates it.
#[derive(Debug)]
pub(crate) enum Answer {
    /// `offline_done` or `speaker_embedding_done`: the path the engine wrote.
    Done(String),
    Embeddings {
        inline: Option<Vec<f32>>,
        out_path: Option<String>,
        count: u32,
    },
}

type Reply = oneshot::Sender<Result<Answer, OfflineError>>;

struct Entry {
    token: u64,
    cmd_id: Option<u64>,
    state: OfflineState,
    /// The archive's result path: a `done` naming another one is a stale pass's.
    result_path: Option<String>,
    /// Taken by the first answer; later ones are stale.
    reply: Option<Reply>,
}

/// The requests in flight, inside the supervisor's shared state.
#[derive(Default)]
pub(crate) struct Registry {
    entries: HashMap<OfflineKey, Entry>,
    tokens: u64,
}

impl Registry {
    /// A new pending request. A newer archive pass of the same call supersedes the running one
    /// (its caller gets `Abandoned`); a live request id cannot be used twice.
    fn register(
        &mut self,
        key: &OfflineKey,
        result_path: Option<String>,
    ) -> Result<(u64, oneshot::Receiver<Result<Answer, OfflineError>>), OfflineError> {
        if matches!(key, OfflineKey::Request(_)) && self.entries.contains_key(key) {
            return Err(OfflineError::Invalid(format!("{key:?} is already running")));
        }
        self.tokens += 1;
        let (tx, rx) = oneshot::channel();
        // @cpt-begin:cpt-noter-state-core-engine-offline-request:p1:inst-st-abandoned
        // Replacing the entry drops the superseded caller's reply: it sees `Abandoned`.
        self.entries.insert(
            key.clone(),
            Entry {
                token: self.tokens,
                cmd_id: None,
                state: OfflineState::Pending,
                result_path,
                reply: Some(tx),
            },
        );
        // @cpt-end:cpt-noter-state-core-engine-offline-request:p1:inst-st-abandoned
        Ok((self.tokens, rx))
    }

    fn sent(&mut self, key: &OfflineKey, token: u64, cmd_id: u64) {
        if let Some(e) = self.entries.get_mut(key).filter(|e| e.token == token) {
            e.cmd_id = Some(cmd_id);
        }
    }

    /// Removes the request `token` once its caller is done with it (or gone).
    fn finish(&mut self, key: &OfflineKey, token: u64) {
        if self.entries.get(key).is_some_and(|e| e.token == token) {
            self.entries.remove(key);
        }
    }

    pub(crate) fn state(&self, key: &OfflineKey) -> Option<OfflineState> {
        self.entries.get(key).map(|e| e.state)
    }

    // @cpt-begin:cpt-noter-state-core-engine-offline-request:p1:inst-st-running
    pub(crate) fn acked(&mut self, cmd_id: u64) {
        if let Some(e) = self
            .entries
            .values_mut()
            .find(|e| e.cmd_id == Some(cmd_id) && e.state == OfflineState::Pending)
        {
            e.state = OfflineState::Running;
        }
    }
    // @cpt-end:cpt-noter-state-core-engine-offline-request:p1:inst-st-running

    /// Sends the answer of a running request to its caller; anything else is stale and dropped.
    fn answer(&mut self, key: &OfflineKey, result: Result<Answer, OfflineError>) {
        if let Some(reply) = self
            .entries
            .get_mut(key)
            .filter(|e| e.state == OfflineState::Running)
            .and_then(|e| e.reply.take())
        {
            let _ = reply.send(result);
        }
    }

    // @cpt-begin:cpt-noter-flow-core-engine-offline-archive:p1:inst-archive-correlate
    /// Correlates an engine event with the request it answers.
    pub(crate) fn on_event(&mut self, event: &EngineEvent) {
        match event {
            EngineEvent::OfflineDone {
                call_id,
                result_path,
            } => {
                let key = OfflineKey::Call(call_id.clone());
                // A superseded or abandoned pass of the same call names its own result file.
                if self.entries.get(&key).and_then(|e| e.result_path.as_ref()) == Some(result_path)
                {
                    self.answer(&key, Ok(Answer::Done(result_path.clone())));
                }
            }
            // shortcut: `offline_failed` names no result file, so a superseded pass's failure
            // also fails the newer pass of the call; the job retries it. Add the path if it matters.
            // @cpt-begin:cpt-noter-state-core-engine-offline-request:p1:inst-st-failed
            EngineEvent::OfflineFailed { call_id, code } => {
                let failed = Err(OfflineError::Engine {
                    code: *code,
                    message: "offline_failed".into(),
                });
                self.answer(&OfflineKey::Call(call_id.clone()), failed);
            }
            EngineEvent::Error {
                cmd_id: Some(id),
                code,
                message,
            } => {
                let key = self
                    .entries
                    .iter()
                    .find(|(_, e)| e.cmd_id == Some(*id))
                    .map(|(k, _)| k.clone());
                if let Some(key) = key {
                    let failed = Err(OfflineError::Engine {
                        code: *code,
                        message: message.clone(),
                    });
                    self.answer(&key, failed);
                }
            }
            // @cpt-end:cpt-noter-state-core-engine-offline-request:p1:inst-st-failed
            EngineEvent::SpeakerEmbeddingDone {
                request_id,
                out_path,
            } => self.answer(
                &OfflineKey::Request(request_id.clone()),
                Ok(Answer::Done(out_path.clone())),
            ),
            EngineEvent::Embeddings {
                request_id,
                inline,
                out_path,
                count,
            } => self.answer(
                &OfflineKey::Request(request_id.clone()),
                Ok(Answer::Embeddings {
                    inline: inline.clone(),
                    out_path: out_path.clone(),
                    count: *count,
                }),
            ),
            _ => {}
        }
    }
    // @cpt-end:cpt-noter-flow-core-engine-offline-archive:p1:inst-archive-correlate

    // @cpt-begin:cpt-noter-state-core-engine-offline-request:p1:inst-st-failed
    /// The engine exited: every request in flight fails now rather than waiting forever.
    pub(crate) fn fail_all(&mut self) {
        for (_, mut e) in self.entries.drain() {
            if let Some(reply) = e.reply.take() {
                let _ = reply.send(Err(OfflineError::Unavailable));
            }
        }
    }
    // @cpt-end:cpt-noter-state-core-engine-offline-request:p1:inst-st-failed
}

/// Removes its request from the registry when the caller finishes or drops the future.
struct Guard<'a, L: EngineLauncher> {
    client: &'a EngineClient<L>,
    key: OfflineKey,
    token: u64,
}

impl<L: EngineLauncher> Drop for Guard<'_, L> {
    fn drop(&mut self) {
        // @cpt-begin:cpt-noter-state-core-engine-offline-request:p1:inst-st-abandoned
        // Also the abandon path: a dropped future leaves nothing a late completion could resolve.
        self.client.shared().offline.finish(&self.key, self.token);
        // @cpt-end:cpt-noter-state-core-engine-offline-request:p1:inst-st-abandoned
    }
}

/// A container-relative path: no root, no empty, `.` or `..` segment, no NUL.
fn relative(rel: &str) -> Result<&str, OfflineError> {
    let safe = !rel.contains('\0')
        && rel
            .split('/')
            .all(|s| !s.is_empty() && s != "." && s != "..");
    if safe {
        Ok(rel)
    } else {
        Err(OfflineError::UnsafePath(format!("{rel:?}")))
    }
}

/// Reads a file the engine wrote, after checking it really is inside the container.
fn read_inside(root: &Path, rel: &str) -> Result<Vec<u8>, OfflineError> {
    let bad = |why: &str| OfflineError::BadResult(format!("{rel}: {why}"));
    let path = root.join(relative(rel).map_err(|_| bad("not container-relative"))?);
    let real = path.canonicalize().map_err(|_| bad("missing"))?;
    let root = root.canonicalize().map_err(|_| bad("no container"))?;
    if !real.starts_with(&root) {
        return Err(bad("outside the container"));
    }
    std::fs::read(&real).map_err(|_| bad("unreadable"))
}

/// Little-endian float32 values, all finite.
fn floats(rel: &str, bytes: &[u8]) -> Result<Vec<f32>, OfflineError> {
    let values: Vec<f32> = bytes
        .chunks_exact(4)
        .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]]))
        .collect();
    if bytes.len() % 4 != 0 || !values.iter().all(|v| v.is_finite()) {
        return Err(OfflineError::BadResult(format!(
            "{rel}: not finite float32 values"
        )));
    }
    Ok(values)
}

/// Checks a vector's length and values, inline or read from a file.
fn vector(what: &str, values: Vec<f32>, dims: usize) -> Result<Vec<f32>, OfflineError> {
    if values.len() != dims || !values.iter().all(|v| v.is_finite()) {
        return Err(OfflineError::BadResult(format!(
            "{what}: not {dims} finite values"
        )));
    }
    Ok(values)
}

impl<L: EngineLauncher> EngineClient<L> {
    /// The state of a request in flight; `None` once it completed, failed or was abandoned.
    pub fn offline_state(&self, key: &OfflineKey) -> Option<OfflineState> {
        self.shared().offline.state(key)
    }

    fn container(&self) -> Result<PathBuf, OfflineError> {
        self.inner
            .launcher
            .container()
            .ok_or_else(|| OfflineError::UnsafePath("no App Group container".into()))
    }

    /// Registers the request, sends `cmd` and waits for the engine's answer; `check` validates it.
    /// Dropping the future abandons the request.
    async fn offline_request<T>(
        &self,
        key: OfflineKey,
        result_path: Option<String>,
        cmd: EngineCommand,
        check: impl FnOnce(Answer) -> Result<T, OfflineError>,
    ) -> Result<T, OfflineError> {
        let (token, answer) = self.shared().offline.register(&key, result_path)?;
        let _guard = Guard {
            client: self,
            key: key.clone(),
            token,
        };
        // @cpt-begin:cpt-noter-state-core-engine-offline-request:p1:inst-st-refused
        self.command_with(cmd, |s, id| s.offline.sent(&key, token, id))
            .await?;
        // @cpt-end:cpt-noter-state-core-engine-offline-request:p1:inst-st-refused
        let answer = answer.await.map_err(|_| OfflineError::Abandoned)??;
        // @cpt-begin:cpt-noter-state-core-engine-offline-request:p1:inst-st-complete
        check(answer)
        // @cpt-end:cpt-noter-state-core-engine-offline-request:p1:inst-st-complete
    }

    // @cpt-flow:cpt-noter-flow-core-engine-offline-archive:p1
    /// Runs the archive pass of a stopped call and returns its complete result file (an
    /// [`ArchiveResult`] whose word timings exist). The caller (the post-call scheduler) only
    /// asks outside live capture; the engine never writes the database.
    pub async fn offline_pass(
        &self,
        call_id: CallId,
        session_dir: String,
        result_path: String,
        constraints_path: Option<String>,
        backend: AsrBackend,
    ) -> Result<PathBuf, OfflineError> {
        // @cpt-begin:cpt-noter-flow-core-engine-offline-archive:p1:inst-archive-request
        let root = self.container()?;
        relative(&session_dir)?;
        relative(&result_path)?;
        if let Some(c) = &constraints_path {
            relative(c)?;
        }
        let cmd = EngineCommand::OfflinePass {
            call_id: call_id.clone(),
            session_dir,
            result_path: result_path.clone(),
            constraints_path,
            backend,
        };
        let key = OfflineKey::Call(call_id.clone());
        // @cpt-end:cpt-noter-flow-core-engine-offline-archive:p1:inst-archive-request
        self.offline_request(key, Some(result_path.clone()), cmd, |answer| {
            let Answer::Done(_) = answer else {
                return Err(OfflineError::BadResult("not an archive result".into()));
            };
            let bytes = read_inside(&root, &result_path)?;
            let result: ArchiveResult = serde_json::from_slice(&bytes)
                .map_err(|e| OfflineError::BadResult(format!("{result_path}: {e}")))?;
            if result.call_id != call_id || result.segments.iter().any(|s| s.call_id != call_id) {
                return Err(OfflineError::BadResult(format!(
                    "{result_path}: another call"
                )));
            }
            for words in result
                .segments
                .iter()
                .filter_map(|s| s.words_path.as_deref())
            {
                read_inside(&root, words)?;
            }
            // @cpt-begin:cpt-noter-flow-core-engine-offline-archive:p1:inst-archive-return
            Ok(root.join(&result_path))
            // @cpt-end:cpt-noter-flow-core-engine-offline-archive:p1:inst-archive-return
        })
        .await
    }

    // @cpt-flow:cpt-noter-flow-core-engine-offline-embeddings:p1
    /// The 256-value WeSpeaker embedding of a speaker's spans; the scratch file is removed.
    pub async fn speaker_embedding(
        &self,
        request_id: String,
        call_id: CallId,
        channel: AudioChannel,
        spans: Vec<EngineSpan>,
        out_path: String,
    ) -> Result<Vec<f32>, OfflineError> {
        // @cpt-begin:cpt-noter-flow-core-engine-offline-embeddings:p1:inst-embed-validate
        let root = self.container()?;
        relative(&out_path)?;
        if spans.is_empty() || spans.iter().any(|s| s.t0_ms >= s.t1_ms) {
            return Err(OfflineError::Invalid(
                "spans must be non-empty and t0 < t1".into(),
            ));
        }
        // @cpt-end:cpt-noter-flow-core-engine-offline-embeddings:p1:inst-embed-validate
        // @cpt-begin:cpt-noter-flow-core-engine-offline-embeddings:p1:inst-embed-request
        let key = OfflineKey::Request(request_id.clone());
        let cmd = EngineCommand::SpeakerEmbedding {
            request_id,
            call_id,
            channel,
            spans,
            out_path: out_path.clone(),
        };
        // @cpt-end:cpt-noter-flow-core-engine-offline-embeddings:p1:inst-embed-request
        self.offline_request(key, None, cmd, |answer| {
            // @cpt-begin:cpt-noter-flow-core-engine-offline-embeddings:p1:inst-embed-resolve
            let Answer::Done(path) = answer else {
                return Err(OfflineError::BadResult("not a speaker embedding".into()));
            };
            if path != out_path {
                return Err(OfflineError::BadResult(format!("{path}: not {out_path}")));
            }
            let read = read_inside(&root, &out_path);
            // @cpt-end:cpt-noter-flow-core-engine-offline-embeddings:p1:inst-embed-resolve
            // @cpt-begin:cpt-noter-flow-core-engine-offline-embeddings:p1:inst-embed-clean
            // The core encrypts what it keeps; the plain scratch file goes now.
            let _ = std::fs::remove_file(root.join(&out_path));
            // @cpt-end:cpt-noter-flow-core-engine-offline-embeddings:p1:inst-embed-clean
            // @cpt-begin:cpt-noter-flow-core-engine-offline-embeddings:p1:inst-embed-return
            vector(&out_path, floats(&out_path, &read?)?, SPEAKER_DIMS)
            // @cpt-end:cpt-noter-flow-core-engine-offline-embeddings:p1:inst-embed-return
        })
        .await
    }

    /// bge-m3 embeddings of `texts`, one 1024-value row per text in input order: one query
    /// without `out_path` comes back inline; a batch (an empty one too) needs `out_path`.
    pub async fn embed_texts(
        &self,
        request_id: String,
        texts: Vec<String>,
        out_path: Option<String>,
    ) -> Result<Vec<Vec<f32>>, OfflineError> {
        // @cpt-begin:cpt-noter-flow-core-engine-offline-embeddings:p1:inst-embed-validate
        let root = self.container()?;
        match &out_path {
            Some(p) => {
                relative(p)?;
            }
            None if texts.len() != 1 => {
                return Err(OfflineError::Invalid("a batch needs out_path".into()));
            }
            None => {}
        }
        // @cpt-end:cpt-noter-flow-core-engine-offline-embeddings:p1:inst-embed-validate
        // @cpt-begin:cpt-noter-flow-core-engine-offline-embeddings:p1:inst-embed-request
        let rows = texts.len();
        let key = OfflineKey::Request(request_id.clone());
        let cmd = EngineCommand::EmbedTexts {
            request_id,
            texts,
            out_path: out_path.clone(),
        };
        // @cpt-end:cpt-noter-flow-core-engine-offline-embeddings:p1:inst-embed-request
        self.offline_request(key, None, cmd, |answer| {
            // @cpt-begin:cpt-noter-flow-core-engine-offline-embeddings:p1:inst-embed-resolve
            let Answer::Embeddings {
                inline,
                out_path: answered,
                count,
            } = answer
            else {
                return Err(OfflineError::BadResult("not text embeddings".into()));
            };
            if count as usize != rows || answered != out_path {
                return Err(OfflineError::BadResult(format!(
                    "{count} rows at {answered:?} for {rows} texts at {out_path:?}"
                )));
            }
            let Some(path) = out_path else {
                let v = inline.ok_or_else(|| OfflineError::BadResult("no inline vector".into()))?;
                return Ok(vec![vector("inline", v, TEXT_DIMS)?]);
            };
            if inline.is_some() {
                return Err(OfflineError::BadResult("a batch answered inline".into()));
            }
            let read = read_inside(&root, &path);
            // @cpt-end:cpt-noter-flow-core-engine-offline-embeddings:p1:inst-embed-resolve
            // @cpt-begin:cpt-noter-flow-core-engine-offline-embeddings:p1:inst-embed-clean
            let _ = std::fs::remove_file(root.join(&path));
            // @cpt-end:cpt-noter-flow-core-engine-offline-embeddings:p1:inst-embed-clean
            // @cpt-begin:cpt-noter-flow-core-engine-offline-embeddings:p1:inst-embed-return
            let values = floats(&path, &read?)?;
            if values.len() != rows * TEXT_DIMS {
                return Err(OfflineError::BadResult(format!("{path}: not {rows} rows")));
            }
            Ok(values.chunks(TEXT_DIMS).map(<[f32]>::to_vec).collect())
            // @cpt-end:cpt-noter-flow-core-engine-offline-embeddings:p1:inst-embed-return
        })
        .await
    }
}
