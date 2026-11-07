//! Ask in the composition root (FEATURE `cpt-noter-feature-core-retrieval-ask`, slice 2): a
//! turn's handle before any message, its worker (retrieve, the `ask-answer` skill through the
//! router and gate, the citation check, the stream), Stop, the thread reads and delete. The
//! storage and the citation check are `noter-retrieval`'s.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use noter_db::ChangeMeta;
use noter_llm::{
    Cancel, Failure, LlmRuntime, Packet, PacketContext, PacketItem, Privacy, RunRequest, Skill,
    SourceClass, TaskKind,
};
use noter_protocol::ipc::{CommandCtx, Sink};
use noter_protocol::model::settings::AuditWhat;
use noter_protocol::model::*;
use noter_protocol::skills::AskAnswerOutput;
use noter_protocol::*;
use noter_retrieval::{Checked, Ending, Hit, NewTurn};

use crate::{lock, Core, StreamHub, StreamMsg};

/// The whole turn, retrieval to the stored answer (DESIGN-core: Ask's task timeout).
pub(crate) const DEADLINE: Duration = Duration::from_secs(60);
const SKILL_VERSION: &str = "1.0.0";
/// Earlier turns a follow-up carries as context.
const PRIOR_TURNS: usize = 5;

impl StreamMsg for AskMsg {
    fn set_seq(&mut self, seq: Seq) {
        self.seq = seq;
    }
    fn ended(reason: StreamEndReason) -> Option<Self> {
        Some(AskMsg {
            seq: Seq(0),
            event: AskEvent::Ended { reason },
        })
    }
}

/// The turn lifecycle (`cpt-noter-state-core-retrieval-ask-turn`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TurnState {
    Accepted,
    Retrieving,
    Answering,
    Done,
    Failed,
    Cancelled,
}

impl TurnState {
    // @cpt-state:cpt-noter-state-core-retrieval-ask-turn:p1
    fn can(self, next: TurnState) -> bool {
        use TurnState::*;
        match (self, next) {
            // @cpt-begin:cpt-noter-state-core-retrieval-ask-turn:p1:inst-turn-retrieve
            (Accepted, Retrieving) => true,
            // @cpt-end:cpt-noter-state-core-retrieval-ask-turn:p1:inst-turn-retrieve
            // @cpt-begin:cpt-noter-state-core-retrieval-ask-turn:p1:inst-turn-answer
            (Retrieving, Answering) => true,
            // @cpt-end:cpt-noter-state-core-retrieval-ask-turn:p1:inst-turn-answer
            // @cpt-begin:cpt-noter-state-core-retrieval-ask-turn:p1:inst-turn-done
            (Answering, Done) => true,
            // @cpt-end:cpt-noter-state-core-retrieval-ask-turn:p1:inst-turn-done
            // @cpt-begin:cpt-noter-state-core-retrieval-ask-turn:p1:inst-turn-failed
            (Retrieving | Answering, Failed) => true,
            // @cpt-end:cpt-noter-state-core-retrieval-ask-turn:p1:inst-turn-failed
            // @cpt-begin:cpt-noter-state-core-retrieval-ask-turn:p1:inst-turn-cancelled
            (Accepted | Retrieving | Answering, Cancelled) => true,
            // @cpt-end:cpt-noter-state-core-retrieval-ask-turn:p1:inst-turn-cancelled
            _ => false,
        }
    }
}

/// A turn that has not ended: whoever removes it sends its one terminal message.
struct Active {
    thread: AskThreadId,
    state: TurnState,
    cancel: Cancel,
    /// The answer text streamed so far, kept when the turn is stopped.
    partial: String,
}

/// The running turns, by turn id.
#[derive(Default)]
pub(crate) struct Turns(Mutex<HashMap<String, Active>>);

/// Why a worker ended without an answer.
enum Ended {
    Failed(CoreError),
    /// Stopped, deleted or nobody watches: the turn ended elsewhere, or nobody listens.
    Cancelled,
}

impl From<CoreError> for Ended {
    fn from(e: CoreError) -> Self {
        Ended::Failed(e)
    }
}

/// What the worker knows of the turn it runs.
struct Job {
    thread: AskThreadId,
    turn: AskTurnId,
    question: String,
    scope: AskScope,
    asked_at: TimestampMs,
}

/// The runtime and privacy a turn runs under, read when it starts.
struct Route {
    /// The runtime the answer is expected on (the router may still fall back to local).
    runtime: RuntimeChoice,
    privacy: Privacy,
    pseudonyms: bool,
    /// The run stays on the Mac: sensitive calls may be retrieved and cited.
    local: bool,
}

impl Core {
    fn ask_hub(&self) -> Arc<StreamHub<AskMsg>> {
        self.ask_hub.get_or_init(|| self.stream_hub(None)).clone()
    }

    // @cpt-flow:cpt-noter-flow-core-retrieval-ask-answer:p1
    /// `ask_start`: checked, recorded and subscribed, then answered by a worker; the handle
    /// returns before any Channel message.
    pub(crate) fn start_ask(
        &self,
        ctx: &CommandCtx,
        args: AskStartArgs,
        channel: Sink<AskMsg>,
    ) -> Result<AskHandle, CoreError> {
        // @cpt-begin:cpt-noter-flow-core-retrieval-ask-answer:p1:inst-ask-request
        self.ready()?;
        let core = self
            .this()
            .ok_or_else(|| CoreError::new(ErrorCode::NotReady, "the core is not started"))?;
        // @cpt-end:cpt-noter-flow-core-retrieval-ask-answer:p1:inst-ask-request
        self.store()
            .read(|c| Ok(noter_retrieval::check_start(c, &args)))??;
        let privacy = noter_retrieval::Privacy::Cloud;
        noter_retrieval::prepare(noter_retrieval::ask_query(
            &args.question,
            &args.scope,
            privacy,
        ))?;
        let new_thread = args.thread_id.is_none();
        let thread = args
            .thread_id
            .clone()
            .unwrap_or_else(|| AskThreadId::new(format!("ask_{}", new_id())));
        let turn = AskTurnId::new(format!("turn_{}", new_id()));
        let asked_at = self.deps.clock.now();
        let mut meta = self.change_meta(ctx, "Asked a question".into(), "ask_start");
        meta.undoable = false;
        noter_retrieval::begin_turn(
            self.store(),
            meta,
            NewTurn {
                thread_id: thread.clone(),
                new_thread,
                turn_id: turn.clone(),
                question: args.question.clone(),
                scope: args.scope.clone(),
                now: asked_at,
            },
        )?;
        // @cpt-begin:cpt-noter-flow-core-retrieval-ask-answer:p1:inst-ask-handle
        let cancel = Cancel::default();
        let active = Active {
            thread: thread.clone(),
            state: TurnState::Accepted,
            cancel: cancel.clone(),
            partial: String::new(),
        };
        lock(&self.ask.0).insert(turn.as_str().to_owned(), active);
        let hub = self.ask_hub();
        let sub = match self.subscribe(&hub, turn.as_str(), ctx, channel, || Ok(())) {
            Ok(sub) => sub,
            Err(e) => {
                lock(&self.ask.0).remove(turn.as_str());
                return Err(e);
            }
        };
        let job = Job {
            thread: thread.clone(),
            turn: turn.clone(),
            question: args.question,
            scope: args.scope,
            asked_at,
        };
        self.spawn(async move { core.answer_turn(job, cancel).await });
        Ok(AskHandle {
            thread_id: thread,
            turn_id: turn,
            subscription_id: sub.subscription_id,
        })
        // @cpt-end:cpt-noter-flow-core-retrieval-ask-answer:p1:inst-ask-handle
    }

    /// The worker: the turn within its deadline, then its terminal message.
    async fn answer_turn(self: Arc<Self>, job: Job, cancel: Cancel) {
        let outcome = tokio::time::timeout(DEADLINE, self.run_turn(&job, cancel.clone())).await;
        // @cpt-begin:cpt-noter-flow-core-retrieval-ask-answer:p1:inst-ask-failure
        let error = match outcome {
            Ok(Ok(())) | Ok(Err(Ended::Cancelled)) => return,
            Ok(Err(Ended::Failed(e))) => e,
            Err(_) => {
                // Dropping the turn's future dropped the runtime's: its output can reach nothing.
                cancel.cancel();
                CoreError::new(
                    ErrorCode::RuntimeUnavailable,
                    "the answer took longer than 60 seconds",
                )
            }
        };
        self.settle(&job.turn, TurnState::Failed, AskEvent::Failed { error });
        // @cpt-end:cpt-noter-flow-core-retrieval-ask-answer:p1:inst-ask-failure
    }

    async fn run_turn(&self, job: &Job, cancel: Cancel) -> Result<(), Ended> {
        self.enter(&job.turn, TurnState::Retrieving)?;
        // @cpt-begin:cpt-noter-flow-core-retrieval-ask-answer:p1:inst-ask-context
        let route = self.ask_route();
        let privacy = if route.local {
            noter_retrieval::Privacy::Local
        } else {
            noter_retrieval::Privacy::Cloud
        };
        let query = noter_retrieval::ask_query(&job.question, &job.scope, privacy);
        let request = noter_retrieval::prepare(query)?;
        let (vector, mode) = self.query_vector(request.text()).await;
        let request = request.with_vector(vector);
        let found = self
            .store()
            .read(|c| noter_retrieval::retrieve(c, &request, &noter_retrieval::NoDocuments))?;
        let hits: Vec<Hit> = (found.ranked(noter_retrieval::ASK_HITS).into_iter())
            .cloned()
            .collect();
        // @cpt-end:cpt-noter-flow-core-retrieval-ask-answer:p1:inst-ask-context
        if !self.ask_hub().watched(job.turn.as_str()) {
            self.settle(&job.turn, TurnState::Cancelled, None);
            return Err(Ended::Cancelled);
        }
        self.enter(&job.turn, TurnState::Answering)?;
        let effective = self.app().privacy.effective;
        let started = AskEvent::Started {
            runtime: route.runtime,
            mode: effective,
        };
        self.emit(&job.turn, started)?;
        let (out, run) = if hits.is_empty() {
            // Nothing permitted to cite: no model run, never an answer from model knowledge.
            (None, None)
        } else {
            let packet = self.ask_packet(job, &hits)?;
            let (_privacy, rx) = tokio::sync::watch::channel(route.privacy);
            let mut req =
                RunRequest::new(Skill::AskAnswer, SKILL_VERSION, packet, TaskKind::Ask, rx);
            req.cancel = cancel;
            req.settings.configured = Some(route.runtime);
            req.settings.pseudonyms = route.pseudonyms;
            match self.llm().run_once(req).await {
                Ok(done) => {
                    let out: AskAnswerOutput = serde_json::from_value(done.output)
                        .map_err(|_| CoreError::new(ErrorCode::OutputInvalid, "ask-answer"))?;
                    (Some(out), Some(done.provenance))
                }
                // Citations still unknown after the router's repair retry: not found.
                Err(Failure::Invalid {
                    reason: "citations",
                }) => (None, None),
                Err(Failure::Cancelled) => return Err(Ended::Cancelled),
                Err(other) => return Err(Ended::Failed(failure(other))),
            }
        };
        // @cpt-begin:cpt-noter-flow-core-retrieval-ask-answer:p1:inst-ask-validate-answer
        let runtime = run.as_ref().map_or(route.runtime, |p| p.runtime);
        let cite_privacy = if runtime == RuntimeChoice::Local {
            noter_retrieval::Privacy::Local
        } else {
            noter_retrieval::Privacy::Cloud
        };
        let refs: Vec<&Hit> = hits.iter().collect();
        let checked = match &out {
            Some(out) => self.store().read(|c| {
                noter_retrieval::check_answer(c, out, &refs, cite_privacy, &segment_speaker)
            })?,
            None => Checked {
                answer_md: noter_retrieval::NOT_FOUND_MD.into(),
                citations: vec![],
                found: false,
            },
        };
        // @cpt-begin:cpt-noter-algo-core-retrieval-ask-citations:p1:inst-cite-flags
        let strengths: Vec<MatchStrength> = if checked.citations.is_empty() {
            hits.iter().map(Hit::strength).collect()
        } else {
            checked.citations.iter().map(|c| c.strength).collect()
        };
        let answer = AskAnswer {
            turn_id: job.turn.clone(),
            question: job.question.clone(),
            answer_md: checked.answer_md,
            citations: checked.citations,
            found: checked.found,
            runtime,
            answered_locally: runtime == RuntimeChoice::Local,
            sensitive_sources_skipped: found.sensitive_skipped,
            keyword_only: !matches!(mode, SearchMode::Hybrid),
            only_weak_evidence: noter_retrieval::only_weak(strengths),
            asked_at: job.asked_at,
        };
        // @cpt-end:cpt-noter-algo-core-retrieval-ask-citations:p1:inst-cite-flags
        for line in answer.answer_md.split_inclusive('\n') {
            self.emit(&job.turn, AskEvent::Delta { text: line.into() })?;
        }
        for citation in &answer.citations {
            let citation = citation.clone();
            self.emit(&job.turn, AskEvent::Citation { citation })?;
        }
        // @cpt-end:cpt-noter-flow-core-retrieval-ask-answer:p1:inst-ask-validate-answer
        // @cpt-begin:cpt-noter-flow-core-retrieval-ask-answer:p1:inst-ask-finish
        if !lock(&self.ask.0).contains_key(job.turn.as_str()) {
            return Err(Ended::Cancelled);
        }
        let meta = run
            .as_ref()
            .map_or_else(ask_meta, |p| model_meta(&p.llm_run_id, p.runtime, &p.model));
        let stored = noter_retrieval::finish_turn(
            self.store(),
            meta,
            &job.thread,
            &answer,
            run.as_ref().map(|p| &p.llm_run_id),
            Ending::Answered,
            self.deps.clock.now(),
        );
        match stored {
            Ok(()) => {}
            // The thread was deleted meanwhile: its late answer is dropped.
            Err(e) if e.code == ErrorCode::NotFound => {
                self.settle(&job.turn, TurnState::Cancelled, None);
                return Err(Ended::Cancelled);
            }
            Err(e) => return Err(Ended::Failed(e)),
        }
        self.settle(&job.turn, TurnState::Done, AskEvent::Done { answer });
        Ok(())
        // @cpt-end:cpt-noter-flow-core-retrieval-ask-answer:p1:inst-ask-finish
    }

    /// The search-answers runtime and the privacy that applies now.
    fn ask_route(&self) -> Route {
        let offline = !self.app().environment.online;
        let settings = lock(&self.settings);
        let mode = settings.privacy.mode;
        let configured = settings.runtimes.search_answers;
        let local = offline || mode == PrivacyMode::LocalOnly || configured == RuntimeChoice::Local;
        Route {
            runtime: if local {
                RuntimeChoice::Local
            } else {
                configured
            },
            privacy: Privacy {
                mode,
                sensitive: false,
                offline,
            },
            pseudonyms: settings.privacy.pseudonymise_names,
            local,
        }
    }

    /// The evidence, the thread's earlier turns and the question. Sensitive evidence and turns
    /// are marked so: the gate never lets them reach a cloud runtime.
    fn ask_packet(&self, job: &Job, hits: &[Hit]) -> Result<Packet, CoreError> {
        let class = |sensitive: bool| {
            if sensitive {
                SourceClass::Sensitive
            } else {
                SourceClass::Normal
            }
        };
        let mut items = vec![];
        let mut people = vec![];
        for hit in hits {
            let (sensitive, speaker) = self.store().read(|c| {
                let sensitive = noter_retrieval::sensitive(c, hit)?.unwrap_or(true);
                let speaker = match &hit.evidence {
                    noter_retrieval::Evidence::Segment(id) => segment_speaker(c, id)?,
                    _ => None,
                };
                Ok((sensitive, speaker))
            })?;
            people.extend(speaker.map(|s| s.display_name));
            items.push(PacketItem {
                id: noter_retrieval::evidence_id(hit).to_owned(),
                source: class(sensitive),
                text: format!("{}: {}", hit.title, hit.text),
            });
        }
        // Refinements through noter-mcp come with core-mcp (TL-36): the packet is all it gets.
        let prior = self
            .store()
            .read(|c| noter_retrieval::prior_turns(c, &job.thread, &job.turn))?;
        // shortcut: the last 5 turns only, so a long thread stays within the deadline and the
        // model's context; a summary of older turns is for when threads grow long.
        let recent = prior.len().saturating_sub(PRIOR_TURNS);
        items.extend(prior.into_iter().skip(recent).map(|p| PacketItem {
            id: p.turn_id.as_str().to_owned(),
            source: class(p.sensitive),
            text: format!(
                "Earlier question: {}\nEarlier answer: {}",
                p.question, p.answer_md
            ),
        }));
        items.push(PacketItem {
            id: "question".into(),
            source: SourceClass::Normal,
            text: job.question.clone(),
        });
        people.sort();
        people.dedup();
        Ok(Packet {
            what: AuditWhat::SearchQuestion,
            items,
            people,
            context: PacketContext::default(),
        })
    }

    /// Moves a running turn on; `Cancelled` when it ended meanwhile.
    fn enter(&self, turn: &AskTurnId, next: TurnState) -> Result<(), Ended> {
        let mut turns = lock(&self.ask.0);
        let active = turns.get_mut(turn.as_str()).ok_or(Ended::Cancelled)?;
        debug_assert!(
            active.state.can(next),
            "turn {:?} cannot become {next:?}",
            active.state
        );
        active.state = next;
        Ok(())
    }

    /// Sends a message of a running turn; `Cancelled` when it ended meanwhile (its late output
    /// goes nowhere).
    fn emit(&self, turn: &AskTurnId, event: AskEvent) -> Result<(), Ended> {
        let mut turns = lock(&self.ask.0);
        let active = turns.get_mut(turn.as_str()).ok_or(Ended::Cancelled)?;
        if let AskEvent::Delta { text } = &event {
            active.partial.push_str(text);
        }
        let msg = AskMsg { seq: Seq(0), event };
        self.ask_hub().publish(turn.as_str(), msg);
        Ok(())
    }

    /// Ends a running turn: its one terminal message (if any), then its runtime and
    /// subscription are released. `None` when it had already ended.
    fn settle(
        &self,
        turn: &AskTurnId,
        state: TurnState,
        terminal: impl Into<Option<AskEvent>>,
    ) -> Option<Active> {
        let mut turns = lock(&self.ask.0);
        let mut active = turns.remove(turn.as_str())?;
        debug_assert!(
            active.state.can(state),
            "turn {:?} cannot become {state:?}",
            active.state
        );
        active.state = state;
        active.cancel.cancel();
        let hub = self.ask_hub();
        if let Some(event) = terminal.into() {
            hub.publish(turn.as_str(), AskMsg { seq: Seq(0), event });
        }
        hub.close(turn.as_str());
        Some(active)
    }

    // @cpt-flow:cpt-noter-flow-core-retrieval-ask-threads:p1
    /// `ask_stop`: the turn and its runtime are cancelled, its partial answer kept as stopped.
    pub(crate) fn stop_ask(&self, args: AskTurnArgs) -> Result<Ack, CoreError> {
        // @cpt-begin:cpt-noter-flow-core-retrieval-ask-threads:p1:inst-thread-stop
        let stopped = AskEvent::Failed {
            error: CoreError::new(ErrorCode::AnswerStopped, "the answer was stopped"),
        };
        let Some(active) = self.settle(&args.turn_id, TurnState::Cancelled, stopped) else {
            let turn = args.turn_id.as_str().to_owned();
            let known = self.store().read(move |c| {
                c.query_row(
                    "SELECT count(*) FROM ask_turns WHERE id = ?1",
                    [&turn],
                    |r| r.get::<_, i64>(0),
                )
            })?;
            // A turn that already ended has nothing left to stop.
            return if known > 0 {
                Ok(Ack {})
            } else {
                Err(CoreError::new(ErrorCode::NotFound, "no such Ask turn"))
            };
        };
        let route = self.ask_route();
        let partial = AskAnswer {
            turn_id: args.turn_id,
            question: String::new(),
            answer_md: active.partial,
            citations: vec![],
            found: false,
            runtime: route.runtime,
            answered_locally: route.local,
            sensitive_sources_skipped: 0,
            keyword_only: false,
            only_weak_evidence: false,
            asked_at: self.deps.clock.now(),
        };
        let now = self.deps.clock.now();
        let kept = noter_retrieval::finish_turn(
            self.store(),
            ask_meta(),
            &active.thread,
            &partial,
            None,
            Ending::Stopped,
            now,
        );
        match kept {
            Ok(()) => Ok(Ack {}),
            Err(e) if e.code == ErrorCode::NotFound => Ok(Ack {}),
            Err(e) => Err(e),
        }
        // @cpt-end:cpt-noter-flow-core-retrieval-ask-threads:p1:inst-thread-stop
    }

    /// `ask_threads_list`.
    pub(crate) fn ask_threads(&self) -> Result<AskThreadList, CoreError> {
        self.ready()?;
        self.store().read(noter_retrieval::threads)
    }

    /// `ask_thread_get`.
    pub(crate) fn ask_thread(&self, args: AskThreadArgs) -> Result<AskThread, CoreError> {
        self.ready()?;
        self.store()
            .read(|c| Ok(noter_retrieval::thread(c, &args.thread_id)))?
    }

    /// `ask_thread_delete`: its running turns are cancelled first, then the thread and its turns
    /// go together; a late answer finds nothing to write.
    pub(crate) fn delete_ask_thread(
        &self,
        ctx: &CommandCtx,
        args: AskThreadArgs,
    ) -> Result<Ack, CoreError> {
        self.ready()?;
        // @cpt-begin:cpt-noter-flow-core-retrieval-ask-threads:p1:inst-thread-delete
        let running: Vec<String> = lock(&self.ask.0)
            .iter()
            .filter(|(_, a)| a.thread == args.thread_id)
            .map(|(turn, _)| turn.clone())
            .collect();
        for turn in running {
            let cancelled = AskEvent::Failed {
                error: CoreError::new(ErrorCode::Cancelled, "the thread was deleted"),
            };
            self.settle(&AskTurnId::new(turn), TurnState::Cancelled, cancelled);
        }
        let mut meta = self.change_meta(ctx, "Deleted an Ask thread".into(), "ask_thread_delete");
        meta.undoable = false;
        if !noter_retrieval::delete_thread(self.store(), meta, &args.thread_id)? {
            return Err(CoreError::new(ErrorCode::NotFound, "no such Ask thread"));
        }
        // @cpt-end:cpt-noter-flow-core-retrieval-ask-threads:p1:inst-thread-delete
        // @cpt-begin:cpt-noter-flow-core-retrieval-ask-threads:p1:inst-thread-deleted
        Ok(Ack {})
        // @cpt-end:cpt-noter-flow-core-retrieval-ask-threads:p1:inst-thread-deleted
    }

    /// Shutdown: running turns stop with their runtimes; the hub ends their streams.
    pub(crate) fn cancel_asks(&self) {
        for (_, active) in lock(&self.ask.0).drain() {
            active.cancel.cancel();
        }
    }
}

fn new_id() -> String {
    ulid::Ulid::generate().to_string().to_lowercase()
}

/// A named segment speaker's chip, from the person row.
fn segment_speaker(
    c: &noter_db::rusqlite::Connection,
    segment: &SegmentId,
) -> noter_db::rusqlite::Result<Option<PersonChip>> {
    use noter_db::rusqlite::OptionalExtension;
    let person: Option<Option<String>> = c
        .query_row(
            "SELECT sp.person_id FROM segments s JOIN speakers sp ON sp.id = s.speaker_id
             WHERE s.id = ?1",
            [segment.as_str()],
            |r| r.get(0),
        )
        .optional()?;
    match person.flatten() {
        Some(person) => crate::people::chip_of(c, &person),
        None => Ok(None),
    }
}

/// A turn ended by the user (stopped), or answered without a model run.
fn ask_meta() -> ChangeMeta {
    ChangeMeta {
        actor: Actor::You,
        summary: "Ask answered".into(),
        reason: "ask_start".into(),
        evidence_ids: vec![],
        batch_id: None,
        undoable: false,
        surface: None,
    }
}

/// The change rows of a stored answer name the run that wrote it.
fn model_meta(run: &LlmRunId, runtime: RuntimeChoice, model: &str) -> ChangeMeta {
    ChangeMeta {
        actor: Actor::Model {
            llm_run_id: run.clone(),
            runtime,
            model: model.into(),
        },
        ..ask_meta()
    }
}

/// The router's failure as the turn's typed error.
fn failure(f: Failure) -> CoreError {
    let code = crate::postcall::code_of(&f).unwrap_or(ErrorCode::Cancelled);
    match f {
        Failure::Unavailable(e) | Failure::Storage(e) => e,
        _ => CoreError::new(code, "the answer could not be written"),
    }
}
