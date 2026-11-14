use super::{
    call_access, typed, word_of, Rpc, Trusted, FORBIDDEN, INTERNAL, MAX_ITEMS, MAX_RECENT_CALLS,
    MISSING, PARAMS,
};
use crate::{speakers::speaker_name, to_json, Core};
use noter_db::rusqlite::types::Value as Sql;
use noter_db::rusqlite::{Connection, OptionalExtension};
use noter_protocol::mcp::*;
use noter_protocol::{CallId, LocalDate, PersonId};
use serde_json::Value;

#[cfg(test)]
static PERF_EVIDENCE_LOADS: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);

#[cfg(test)]
pub(super) fn reset_perf_evidence_loads() {
    PERF_EVIDENCE_LOADS.store(0, std::sync::atomic::Ordering::SeqCst);
}

#[cfg(test)]
pub(super) fn perf_evidence_loads() -> usize {
    PERF_EVIDENCE_LOADS.load(std::sync::atomic::Ordering::SeqCst)
}

/// An open item: not a decision, not finished, not rejected.
const OPEN: &str =
    "i.kind != 'decision' AND i.status IN ('open', 'carried') AND i.review_state != 'rejected'";

/// Returns a read tool's result before the MCP release gate.
impl Core {
    pub(super) fn read_tool(&self, t: &Trusted, method: &str, params: Value) -> Result<Value, Rpc> {
        let read = |f: &dyn Fn(&Connection) -> noter_db::rusqlite::Result<Result<Value, Rpc>>| {
            self.store.read(f).map_err(|_| INTERNAL)?
        };
        // @cpt-begin:cpt-noter-flow-core-mcp-read:p1:inst-read-entities
        match method {
            "get_transcript_span" => {
                let a: GetTranscriptSpanInput = typed(params)?;
                if a.t1_ms.0 <= a.t0_ms.0 {
                    return Err(PARAMS);
                }
                read(&|c| {
                    if let Err(e) = call_access(c, &a.call_id, t.cloud)? {
                        return Ok(Err(e));
                    }
                    let lines = crate::transcript::segments_of(
                        c,
                        &a.call_id,
                        Some((a.channel, a.t0_ms, a.t1_ms)),
                    )?
                    .into_iter()
                    .map(|s| SpanLine {
                        segment_id: s.id,
                        t0_ms: s.t0_ms,
                        speaker: speaker_name(&s.speaker.label),
                        lang: s.lang,
                        text: s.text,
                    })
                    .collect();
                    Ok(Ok(to_json(&GetTranscriptSpanOutput { lines })))
                })
            }
            "get_screen_context" => {
                let a: GetScreenContextInput = typed(params)?;
                // @cpt-begin:cpt-noter-flow-core-mcp-read:p1:inst-read-screen
                read(&|c| {
                    Ok(call_access(c, &a.call_id, t.cloud)?
                        .map(|()| to_json(&ScreenContextOutput { chips: vec![] })))
                })
                // @cpt-end:cpt-noter-flow-core-mcp-read:p1:inst-read-screen
            }
            "get_open_items" => {
                let a: GetOpenItemsInput = typed(params)?;
                let mut clause = String::from(OPEN);
                let mut args = vec![];
                if let Some(owner) = &a.owner {
                    clause.push_str(" AND i.owner_person_id = ?");
                    args.push(Sql::Text(owner.as_str().into()));
                }
                owners_in(&mut clause, &mut args, &a.people);
                read(&|c| {
                    let items = items_of(c, &clause, args.clone(), t.cloud, None)?;
                    Ok(Ok(to_json(&ItemsOutput { items })))
                })
            }
            "get_decisions" => {
                let a: GetDecisionsInput = typed(params)?;
                let mut clause =
                    String::from("i.kind = 'decision' AND i.review_state != 'rejected'");
                let mut args = vec![];
                if let Some(topic) = &a.topic_id {
                    clause.push_str(" AND i.topic_id = ?");
                    args.push(Sql::Text(topic.as_str().into()));
                }
                if let Some(since) = &a.since {
                    crate::library::day_number(since).ok_or(PARAMS)?;
                    clause.push_str(" AND date(c.started_at / 1000, 'unixepoch') >= ?");
                    args.push(Sql::Text(since.0.clone()));
                }
                owners_in(&mut clause, &mut args, &a.people);
                read(&|c| {
                    let items = items_of(c, &clause, args.clone(), t.cloud, a.query.as_deref())?;
                    Ok(Ok(to_json(&ItemsOutput { items })))
                })
            }
            "get_person" => {
                let a: GetPersonInput = typed(params)?;
                if a.person_id.is_none() && a.name.as_deref().map_or(true, |n| n.trim().is_empty())
                {
                    return Err(PARAMS);
                }
                read(&|c| person_of(c, &a, t.cloud))
            }
            _ => Err(FORBIDDEN),
        }
        // @cpt-end:cpt-noter-flow-core-mcp-read:p1:inst-read-entities
    }
}

fn owners_in(clause: &mut String, args: &mut Vec<Sql>, people: &[PersonId]) {
    if people.is_empty() {
        return;
    }
    let marks = crate::util::marks(people.len());
    clause.push_str(&format!(" AND i.owner_person_id IN ({marks})"));
    args.extend(people.iter().map(|p| Sql::Text(p.as_str().into())));
}

/// The newest matching items of `clause` (over `i` and `c`), without a cloud run's sensitive
/// calls, with the segments their spans cover as evidence.
fn items_of(
    c: &Connection,
    clause: &str,
    args: Vec<Sql>,
    cloud: bool,
    text_query: Option<&str>,
) -> noter_db::rusqlite::Result<Vec<McpItem>> {
    let clause = if cloud {
        format!("{clause} AND c.privacy_class = 'normal'")
    } else {
        clause.to_owned()
    };
    let mut items = vec![];
    for v in crate::items::items_where_newest(c, &clause, args, text_query, MAX_ITEMS)? {
        let mut evidence = vec![];
        for span in &v.spans {
            #[cfg(test)]
            if span.call_id.as_str() == "c_perf" {
                PERF_EVIDENCE_LOADS.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            }
            let lines = crate::transcript::segments_of(
                c,
                &span.call_id,
                Some((span.channel, span.t0_ms, span.t1_ms)),
            )?;
            for s in lines {
                if !evidence.contains(&s.id) {
                    evidence.push(s.id);
                }
            }
        }
        let item = McpItem {
            item_id: v.id,
            kind: word_of(&v.kind),
            text: v.text,
            owner: v.owner.map(|o| o.display_name),
            due: v.due,
            status: word_of(&v.status),
            call_id: v.call.id,
            call_date: LocalDate(crate::history::date_of(v.call.started_at.0)),
            evidence_segment_ids: evidence,
        };
        items.push(item);
    }
    Ok(items)
}

/// `a.person_id`, or the person whose display name or alias is `a.name` (case, spacing and ё
/// folded). A cloud run only finds people who took part in a call it may read, and sees only
/// those calls.
fn person_of(
    c: &Connection,
    a: &GetPersonInput,
    cloud: bool,
) -> noter_db::rusqlite::Result<Result<Value, Rpc>> {
    let person: Option<(String, String, Option<String>)> = match (&a.person_id, &a.name) {
        (Some(id), _) => c
            .query_row(
                "SELECT id, display_name, role FROM people WHERE id = ?1",
                [id.as_str()],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .optional()?,
        (None, Some(name)) => crate::people::by_name(c, name, None)?
            .map(|id| {
                c.query_row(
                    "SELECT id, display_name, role FROM people WHERE id = ?1",
                    [id],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
                )
            })
            .transpose()?,
        (None, None) => None,
    };
    let Some((id, display_name, role)) = person else {
        return Ok(Err(MISSING));
    };
    let sensitive = if cloud {
        "AND c.privacy_class = 'normal'"
    } else {
        ""
    };
    let recent_calls: Vec<CallId> = c
        .prepare(&format!(
            "SELECT c.id FROM calls c WHERE c.id IN
               (SELECT call_id FROM call_participants WHERE person_id = ?1
                UNION SELECT call_id FROM speakers WHERE person_id = ?1) {sensitive}
             ORDER BY c.started_at DESC LIMIT {MAX_RECENT_CALLS}"
        ))?
        .query_map([&id], |r| Ok(CallId::new(r.get::<_, String>(0)?)))?
        .collect::<Result<_, _>>()?;
    if cloud && recent_calls.is_empty() {
        return Ok(Err(MISSING));
    }
    // A cloud run is told who the person is by their pseudonym only: an alias is another name
    // for the same person and would reach the model under no pseudonym at all.
    let aliases = if cloud {
        vec![]
    } else {
        c.prepare("SELECT alias FROM person_aliases WHERE person_id = ?1 ORDER BY rowid")?
            .query_map([&id], |r| r.get(0))?
            .collect::<Result<_, _>>()?
    };
    let open_items = items_of(
        c,
        &format!("i.owner_person_id = ? AND {OPEN}"),
        vec![Sql::Text(id.clone())],
        cloud,
        None,
    )?;
    Ok(Ok(to_json(&GetPersonOutput {
        person_id: PersonId::new(id),
        display_name,
        role,
        aliases,
        recent_calls,
        open_items,
    })))
}
