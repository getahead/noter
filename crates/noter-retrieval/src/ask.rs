//! Ask threads and turns (`ask_threads`, `ask_turns`) and the citation check of an answer
//! (`cpt-noter-algo-core-retrieval-ask-citations`). noter-core runs the turn: its stream, the
//! router and the deadline. Change rows name what changed, never the question or the answer.

use std::collections::HashMap;

use noter_db::rusqlite::{params, Connection, OptionalExtension, Transaction};
use noter_db::{ChangeMeta, Logged, Store};
use noter_protocol::error::ValidationRule;
use noter_protocol::model::*;
use noter_protocol::skills::AskAnswerOutput;
use noter_protocol::*;

use crate::retrieve::{invalid, Evidence, Hit, Privacy, Query, Scope};

type Db<T> = noter_db::rusqlite::Result<T>;

/// The answer when no cited evidence remains: never a guess from model knowledge.
pub const NOT_FOUND_MD: &str = "I could not find this in your calls.";

/// Evidence an answer may draw on: the top hits across sections (`Retrieved::ranked`).
pub const ASK_HITS: usize = 30;

fn internal(e: impl std::fmt::Display) -> CoreError {
    CoreError::new(ErrorCode::Internal, e.to_string())
}

fn not_found(what: &str) -> CoreError {
    CoreError::new(ErrorCode::NotFound, format!("no such {what}"))
}

/// The retrieval request of a question: its scope as filters, the top hits per section.
pub fn ask_query(question: &str, scope: &AskScope, privacy: Privacy) -> Query {
    Query {
        text: question.to_owned(),
        filter: CallFilter {
            people: scope.people.clone(),
            call_types: scope.call_types.clone(),
            from: scope.from.clone(),
            to: scope.to.clone(),
            ..CallFilter::default()
        },
        scope: Scope {
            call_id: scope.call_id.clone(),
            topic_id: scope.topic_id.clone(),
            include_documents: scope.include_documents,
        },
        privacy,
        wanted: ASK_HITS,
        vector: None,
    }
}

// @cpt-begin:cpt-noter-flow-core-retrieval-ask-answer:p1:inst-ask-validate
/// A non-empty question, and a scope whose call, topic and people exist (dates are checked by
/// `prepare`); an unknown thread is `not_found`.
pub fn check_start(c: &Connection, args: &AskStartArgs) -> Result<(), CoreError> {
    if args.question.trim().is_empty() {
        return Err(invalid("question", ValidationRule::Required));
    }
    let exists = |sql: &str, id: &str| -> Result<bool, CoreError> {
        c.query_row(sql, [id], |_| Ok(()))
            .optional()
            .map(|r| r.is_some())
            .map_err(internal)
    };
    if let Some(thread) = &args.thread_id {
        if !exists("SELECT 1 FROM ask_threads WHERE id = ?1", thread.as_str())? {
            return Err(not_found("Ask thread"));
        }
    }
    let scope = &args.scope;
    if let Some(call) = &scope.call_id {
        if !exists("SELECT 1 FROM calls WHERE id = ?1", call.as_str())? {
            return Err(not_found("call"));
        }
    }
    if let Some(topic) = &scope.topic_id {
        if !exists("SELECT 1 FROM topics WHERE id = ?1", topic.as_str())? {
            return Err(not_found("topic"));
        }
    }
    for person in &scope.people {
        // Presets name people by their speaker rows, which have no foreign key to `people`.
        let sql = "SELECT 1 FROM people WHERE id = ?1
                   UNION ALL SELECT 1 FROM speakers WHERE person_id = ?1 LIMIT 1";
        if !exists(sql, person.as_str())? {
            return Err(not_found("person"));
        }
    }
    Ok(())
}
// @cpt-end:cpt-noter-flow-core-retrieval-ask-answer:p1:inst-ask-validate

/// A turn to record: in a new thread (titled with the question) or a follow-up.
#[derive(Debug, Clone)]
pub struct NewTurn {
    pub thread_id: AskThreadId,
    pub new_thread: bool,
    pub turn_id: AskTurnId,
    pub question: String,
    pub scope: AskScope,
    pub now: TimestampMs,
}

fn logged(entity_type: &'static str, id: &str, field: &str) -> Logged {
    Logged {
        entity_type,
        entity_id: id.to_owned(),
        field: Some(field.to_owned()),
        before: None,
        after: None,
        delta: None,
    }
}

// @cpt-begin:cpt-noter-flow-core-retrieval-ask-answer:p1:inst-ask-create
/// Records the thread (new, or its scope and time moved on) and the turn, with change rows.
pub fn begin_turn(store: &Store, meta: ChangeMeta, t: NewTurn) -> Result<(), CoreError> {
    let scope = serde_json::to_string(&t.scope).map_err(internal)?;
    store
        .write_with(meta, move |tx| {
            let thread = t.thread_id.as_str();
            if t.new_thread {
                tx.execute(
                    "INSERT INTO ask_threads (id, title, scope, updated_at) VALUES (?1, ?2, ?3, ?4)",
                    params![thread, t.question.trim(), scope, t.now.0],
                )
                .map_err(internal)?;
            } else {
                touch(tx, thread, Some(&scope), t.now)?;
            }
            tx.execute(
                "INSERT INTO ask_turns (id, thread_id, question, asked_at) VALUES (?1, ?2, ?3, ?4)",
                params![t.turn_id.as_str(), thread, t.question, t.now.0],
            )
            .map_err(internal)?;
            let field = if t.new_thread { "created" } else { "turns" };
            let rows = vec![
                logged("ask_thread", thread, field),
                logged("ask_turn", t.turn_id.as_str(), "question"),
            ];
            Ok(((), rows))
        })
        .map(drop)
}
// @cpt-end:cpt-noter-flow-core-retrieval-ask-answer:p1:inst-ask-create

/// Moves a thread's time (and scope); a deleted thread is `not_found`, so late output cannot
/// recreate it.
fn touch(
    tx: &Transaction<'_>,
    thread: &str,
    scope: Option<&str>,
    now: TimestampMs,
) -> Result<(), CoreError> {
    let n = tx
        .execute(
            "UPDATE ask_threads SET updated_at = ?2, scope = coalesce(?3, scope) WHERE id = ?1",
            params![thread, now.0, scope],
        )
        .map_err(internal)?;
    if n == 0 {
        return Err(not_found("Ask thread"));
    }
    Ok(())
}

/// How a turn ended: answered (`found` set), or stopped with its partial text.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Ending {
    Answered,
    Stopped,
}

// @cpt-begin:cpt-noter-flow-core-retrieval-ask-answer:p1:inst-ask-finish
/// Stores the answer, its citations, runtime and run id, and moves the thread's time. A turn
/// whose thread was deleted is `not_found` and nothing is written.
pub fn finish_turn(
    store: &Store,
    meta: ChangeMeta,
    thread: &AskThreadId,
    answer: &AskAnswer,
    llm_run_id: Option<&LlmRunId>,
    ending: Ending,
    now: TimestampMs,
) -> Result<(), CoreError> {
    let citations = serde_json::to_string(&answer.citations).map_err(internal)?;
    let runtime = serde_json::to_value(answer.runtime)
        .ok()
        .and_then(|v| v.as_str().map(String::from));
    let found = (ending == Ending::Answered).then_some(answer.found);
    let thread = thread.as_str().to_owned();
    let turn = answer.turn_id.as_str().to_owned();
    let md = answer.answer_md.clone();
    let run = llm_run_id.map(|r| r.as_str().to_owned());
    let flags = (
        answer.sensitive_sources_skipped,
        answer.keyword_only,
        answer.only_weak_evidence,
    );
    store
        .write_with(meta, move |tx| {
            let n = tx
                .execute(
                    "UPDATE ask_turns SET answer_md = ?2, citations = ?3, found = ?4, runtime = ?5,
                         llm_run_id = ?6, sensitive_skipped = ?7, keyword_only = ?8, only_weak = ?9
                     WHERE id = ?1 AND thread_id = ?10",
                    params![
                        turn, md, citations, found, runtime, run, flags.0, flags.1, flags.2, thread
                    ],
                )
                .map_err(internal)?;
            if n == 0 {
                return Err(not_found("Ask turn"));
            }
            touch(tx, &thread, None, now)?;
            let field = match ending {
                Ending::Answered => "answer",
                Ending::Stopped => "stopped",
            };
            Ok(((), vec![logged("ask_turn", &turn, field)]))
        })
        .map(drop)
}
// @cpt-end:cpt-noter-flow-core-retrieval-ask-answer:p1:inst-ask-finish

// @cpt-begin:cpt-noter-flow-core-retrieval-ask-threads:p1:inst-thread-delete
/// Deletes a thread and its turns together, one tombstone each; `false` when it was not stored.
pub fn delete_thread(store: &Store, meta: ChangeMeta, id: &AskThreadId) -> Result<bool, CoreError> {
    let id = id.as_str().to_owned();
    let deleted = store.write_with(meta, move |tx| {
        let turns: Vec<String> = tx
            .prepare("SELECT id FROM ask_turns WHERE thread_id = ?1")
            .and_then(|mut st| st.query_map([&id], |r| r.get(0))?.collect())
            .map_err(internal)?;
        tx.execute("DELETE FROM ask_turns WHERE thread_id = ?1", [&id])
            .map_err(internal)?;
        let n = tx
            .execute("DELETE FROM ask_threads WHERE id = ?1", [&id])
            .map_err(internal)?;
        if n == 0 {
            return Err(not_found("Ask thread"));
        }
        let mut rows = vec![logged("ask_thread", &id, "deleted")];
        rows.extend(turns.iter().map(|t| logged("ask_turn", t, "deleted")));
        Ok(((), rows))
    });
    match deleted {
        Ok(_) => Ok(true),
        Err(e) if e.code == ErrorCode::NotFound => Ok(false),
        Err(e) => Err(e),
    }
}
// @cpt-end:cpt-noter-flow-core-retrieval-ask-threads:p1:inst-thread-delete

// @cpt-begin:cpt-noter-flow-core-retrieval-ask-threads:p1:inst-thread-list
/// Recent threads, newest first.
pub fn threads(c: &Connection) -> Db<AskThreadList> {
    let threads = c
        .prepare(
            "SELECT t.id, t.title, count(u.id), t.updated_at FROM ask_threads t
             LEFT JOIN ask_turns u ON u.thread_id = t.id
             GROUP BY t.id ORDER BY t.updated_at DESC, t.id DESC",
        )?
        .query_map([], |r| {
            Ok(AskThreadRow {
                id: AskThreadId::new(r.get::<_, String>(0)?),
                title: r.get(1)?,
                turns: r.get(2)?,
                updated_at: TimestampMs(r.get(3)?),
            })
        })?
        .collect::<Db<_>>()?;
    Ok(AskThreadList { threads })
}
// @cpt-end:cpt-noter-flow-core-retrieval-ask-threads:p1:inst-thread-list

// @cpt-begin:cpt-noter-flow-core-retrieval-ask-threads:p1:inst-thread-get
/// A thread with its scope and turns in order; every citation's source is looked up again and
/// marked `deleted` when it is gone.
pub fn thread(c: &Connection, id: &AskThreadId) -> Result<AskThread, CoreError> {
    let head = c
        .query_row(
            "SELECT title, scope FROM ask_threads WHERE id = ?1",
            [id.as_str()],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)),
        )
        .optional()
        .map_err(internal)?;
    let Some((title, scope)) = head else {
        return Err(not_found("Ask thread"));
    };
    let turns = turns(c, id.as_str()).map_err(internal)?;
    // @cpt-begin:cpt-noter-flow-core-retrieval-ask-threads:p1:inst-thread-return
    Ok(AskThread {
        id: id.clone(),
        title,
        scope: serde_json::from_str(&scope).unwrap_or_default(),
        turns,
    })
    // @cpt-end:cpt-noter-flow-core-retrieval-ask-threads:p1:inst-thread-return
}
// @cpt-end:cpt-noter-flow-core-retrieval-ask-threads:p1:inst-thread-get

fn turns(c: &Connection, thread: &str) -> Db<Vec<AskAnswer>> {
    let rows = c
        .prepare(
            "SELECT id, question, answer_md, citations, found, runtime, sensitive_skipped,
                    keyword_only, only_weak, asked_at
             FROM ask_turns WHERE thread_id = ?1 ORDER BY asked_at, rowid",
        )?
        .query_map([thread], |r| {
            let runtime: Option<String> = r.get(5)?;
            let runtime = runtime
                .and_then(|r| serde_json::from_value(serde_json::Value::String(r)).ok())
                .unwrap_or(RuntimeChoice::Local);
            let citations: String = r.get(3)?;
            Ok(AskAnswer {
                turn_id: AskTurnId::new(r.get::<_, String>(0)?),
                question: r.get(1)?,
                answer_md: r.get::<_, Option<String>>(2)?.unwrap_or_default(),
                citations: serde_json::from_str(&citations).unwrap_or_default(),
                found: r.get::<_, Option<bool>>(4)?.unwrap_or(false),
                answered_locally: runtime == RuntimeChoice::Local,
                runtime,
                sensitive_sources_skipped: r.get(6)?,
                keyword_only: r.get(7)?,
                only_weak_evidence: r.get(8)?,
                asked_at: TimestampMs(r.get(9)?),
            })
        })?
        .collect::<Db<Vec<_>>>()?;
    rows.into_iter()
        .map(|mut turn| {
            for citation in &mut turn.citations {
                citation.deleted = source_gone(c, &citation.provenance)?;
            }
            Ok(turn)
        })
        .collect()
}

/// Whether the call or document a citation names is gone.
fn source_gone(c: &Connection, provenance: &Provenance) -> Db<bool> {
    let (sql, id) = match provenance {
        Provenance::PastCall { call, .. } => {
            ("SELECT 1 FROM calls WHERE id = ?1", call.id.as_str())
        }
        Provenance::Document { document_id, .. } => (
            "SELECT 1 FROM documents WHERE id = ?1",
            document_id.as_str(),
        ),
        _ => return Ok(false),
    };
    Ok(c.query_row(sql, [id], |_| Ok(())).optional()?.is_none())
}

/// A prior turn of the thread, as context for a follow-up.
#[derive(Debug, Clone, PartialEq)]
pub struct Prior {
    pub turn_id: AskTurnId,
    pub question: String,
    pub answer_md: String,
    /// Answered on the Mac or citing a sensitive call: never part of a cloud packet.
    pub sensitive: bool,
    /// Calls whose sensitivity must still be checked while a follow-up is running.
    pub calls: Vec<CallId>,
}

/// The answered turns of a thread before `turn`, oldest first.
pub fn prior_turns(c: &Connection, thread: &AskThreadId, turn: &AskTurnId) -> Db<Vec<Prior>> {
    let mut out = vec![];
    for t in turns(c, thread.as_str())?
        .into_iter()
        .take_while(|t| &t.turn_id != turn)
        .filter(|t| t.found)
    {
        let mut sensitive = t.answered_locally;
        let mut calls = vec![];
        for citation in &t.citations {
            if let Provenance::PastCall { call, .. } = &citation.provenance {
                sensitive |= call_sensitive(c, call.id.as_str())?.unwrap_or(true);
                calls.push(call.id.clone());
            } else if let Provenance::Document { document_id, .. } = &citation.provenance {
                sensitive |= document_sensitive(c, document_id.as_str())?.unwrap_or(true);
            }
        }
        out.push(Prior {
            turn_id: t.turn_id,
            question: t.question,
            answer_md: t.answer_md,
            sensitive,
            calls,
        });
    }
    Ok(out)
}

fn call_sensitive(c: &Connection, call: &str) -> Db<Option<bool>> {
    c.query_row(
        "SELECT privacy_class = 'sensitive' FROM calls WHERE id = ?1",
        [call],
        |r| r.get(0),
    )
    .optional()
}

fn document_sensitive(c: &Connection, document: &str) -> Db<Option<bool>> {
    c.query_row(
        "SELECT s.privacy_class = 'sensitive' FROM documents d JOIN sources s ON s.id = d.source_id WHERE d.id = ?1",
        [document],
        |r| r.get(0),
    )
    .optional()
}

/// Whether a hit's call or source is sensitive now; `None` when its evidence is gone.
pub fn sensitive(c: &Connection, hit: &Hit) -> Db<Option<bool>> {
    let (sql, id) = match &hit.evidence {
        Evidence::Segment(id) => (
            "SELECT c.privacy_class = 'sensitive' FROM segments s JOIN calls c ON c.id = s.call_id
             WHERE s.id = ?1",
            id.as_str(),
        ),
        Evidence::Chunk(id) => (
            "SELECT c.privacy_class = 'sensitive' FROM chunks k JOIN calls c ON c.id = k.call_id
             WHERE k.id = ?1",
            id.as_str(),
        ),
        Evidence::Item(id) => (
            "SELECT c.privacy_class = 'sensitive' FROM items i JOIN calls c ON c.id = i.call_id
             WHERE i.id = ?1",
            id.as_str(),
        ),
        Evidence::Document { chunk_id, .. } => (
            "SELECT s.privacy_class = 'sensitive' FROM doc_chunks k
             JOIN documents d ON d.id = k.document_id JOIN sources s ON s.id = d.source_id
             WHERE k.id = ?1",
            chunk_id.as_str(),
        ),
    };
    c.query_row(sql, [id], |r| r.get(0)).optional()
}

/// The id a packet item and a citation use for a hit.
pub fn evidence_id(hit: &Hit) -> &str {
    match &hit.evidence {
        Evidence::Segment(id) => id.as_str(),
        Evidence::Chunk(id) | Evidence::Document { chunk_id: id, .. } => id.as_str(),
        Evidence::Item(id) => id.as_str(),
    }
}

/// An answer after the citation check.
#[derive(Debug, Clone, PartialEq)]
pub struct Checked {
    pub answer_md: String,
    pub citations: Vec<Citation>,
    pub found: bool,
}

/// The `[n]` references of Markdown: byte range and number, in order.
fn references(md: &str) -> Vec<(usize, usize, u16)> {
    let mut out = vec![];
    let bytes = md.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'[' {
            let digits = bytes[i + 1..]
                .iter()
                .take_while(|b| b.is_ascii_digit())
                .count();
            let end = i + 1 + digits;
            if (1..=4).contains(&digits) && bytes.get(end) == Some(&b']') {
                if let Ok(n) = md[i + 1..end].parse() {
                    out.push((i, end + 1, n));
                }
                i = end + 1;
                continue;
            }
        }
        i += 1;
    }
    out
}

// @cpt-algo:cpt-noter-algo-core-retrieval-ask-citations:p1
/// Keeps the citations whose evidence this run was given and is still there and permitted,
/// built from the stored evidence, numbered as the Markdown references them. `speaker` finds
/// the chip of a segment's speaker. No valid citation left: the not-found answer.
pub fn check_answer(
    c: &Connection,
    out: &AskAnswerOutput,
    evidence: &[&Hit],
    privacy: Privacy,
    speaker: &dyn Fn(&Connection, &SegmentId) -> Db<Option<PersonChip>>,
) -> Db<Checked> {
    let by_id: HashMap<&str, &Hit> = evidence.iter().map(|h| (evidence_id(h), *h)).collect();
    let mut valid: HashMap<u16, Citation> = HashMap::new();
    for cited in out.citations.iter().filter(|_| out.found) {
        // @cpt-begin:cpt-noter-algo-core-retrieval-ask-citations:p1:inst-cite-resolve
        // The router already refused ids outside the packet (with its repair retry); what is
        // left resolves against this run's evidence only.
        let ids = cited.segment_ids.iter().map(SegmentId::as_str);
        let ids = ids.chain(cited.chunk_ids.iter().map(ChunkId::as_str));
        let hits: Vec<&Hit> = ids.filter_map(|id| by_id.get(id).copied()).collect();
        // @cpt-end:cpt-noter-algo-core-retrieval-ask-citations:p1:inst-cite-resolve
        // @cpt-begin:cpt-noter-algo-core-retrieval-ask-citations:p1:inst-cite-build
        let mut built = None;
        for hit in hits {
            let permitted = match sensitive(c, hit)? {
                None => false,
                Some(sensitive) => !(sensitive && privacy == Privacy::Cloud),
            };
            if !permitted {
                continue;
            }
            let speaker = match &hit.evidence {
                Evidence::Segment(id) => speaker(c, id)?,
                _ => None,
            };
            built = Some(Citation {
                n: cited.n,
                provenance: hit.provenance.clone(),
                quote: hit.text.clone(),
                speaker,
                strength: hit.strength(),
                deleted: false,
            });
            break;
        }
        // @cpt-end:cpt-noter-algo-core-retrieval-ask-citations:p1:inst-cite-build
        if let Some(citation) = built {
            valid.entry(cited.n).or_insert(citation);
        }
    }
    // @cpt-begin:cpt-noter-algo-core-retrieval-ask-citations:p1:inst-cite-map
    // Pseudonyms were mapped back by the gate (`map_back`) before the output reached us; here
    // the kept citations are numbered 1… in the order the text first references them, and the
    // text's references follow (a reference to a dropped citation goes).
    let refs = references(&out.answer_md);
    let mut renumber: HashMap<u16, u16> = HashMap::new();
    let mut citations = vec![];
    for &(_, _, n) in &refs {
        if renumber.contains_key(&n) {
            continue;
        }
        if let Some(mut citation) = valid.remove(&n) {
            citation.n = citations.len() as u16 + 1;
            renumber.insert(n, citation.n);
            citations.push(citation);
        }
    }
    let mut answer_md = String::with_capacity(out.answer_md.len());
    let mut at = 0;
    for (start, end, n) in refs {
        answer_md.push_str(&out.answer_md[at..start]);
        if let Some(new) = renumber.get(&n) {
            answer_md.push_str(&format!("[{new}]"));
        }
        at = end;
    }
    answer_md.push_str(&out.answer_md[at..]);
    // @cpt-end:cpt-noter-algo-core-retrieval-ask-citations:p1:inst-cite-map
    // @cpt-begin:cpt-noter-algo-core-retrieval-ask-citations:p1:inst-cite-not-found
    if citations.is_empty() {
        return Ok(Checked {
            answer_md: NOT_FOUND_MD.into(),
            citations,
            found: false,
        });
    }
    // @cpt-end:cpt-noter-algo-core-retrieval-ask-citations:p1:inst-cite-not-found
    // @cpt-begin:cpt-noter-algo-core-retrieval-ask-citations:p1:inst-cite-return
    // The router refused raw HTML in `answer_md` before it got here.
    Ok(Checked {
        answer_md,
        citations,
        found: true,
    })
    // @cpt-end:cpt-noter-algo-core-retrieval-ask-citations:p1:inst-cite-return
}

/// Whether there is evidence and all of it is weak.
pub fn only_weak(strengths: impl IntoIterator<Item = MatchStrength>) -> bool {
    let mut any = false;
    for s in strengths {
        if s != MatchStrength::Weak {
            return false;
        }
        any = true;
    }
    any
}
