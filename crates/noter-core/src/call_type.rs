//! Local detection at call end and for recordings made before detection shipped.

use noter_db::rusqlite::{Connection, OptionalExtension};
use noter_db::{ChangeMeta, Insert, Mutation};
use noter_protocol::model::Actor;
use noter_protocol::{CallId, CoreError, ErrorCode, JobId, Rev};
use serde_json::json;

use crate::Core;

const BACKFILL: &str = "call_type_backfill_v1";
const REASON: &str = "automatic_call_type";

mod rules;
use rules::RULES;

/// A title can label the meeting directly. In ordinary conversation require a declaration
/// of purpose or two distinct parts of a characteristic agenda, possibly across speakers.
struct Rule {
    id: &'static str,
    titles: &'static [&'static str],
    declarations: &'static [&'static str],
    agenda: (&'static [&'static str], &'static [&'static str]),
}

// Fold case and punctuation, keeping word boundaries (including Cyrillic and German).
fn words(text: &str) -> String {
    let mut out = String::from(" ");
    for word in text
        .split(|c: char| !c.is_alphanumeric())
        .filter(|s| !s.is_empty())
    {
        out.push_str(&word.to_lowercase());
        out.push(' ');
    }
    out
}

fn mentions(words: &str, phrases: &[&str]) -> bool {
    phrases.iter().any(|phrase| {
        words.match_indices(phrase).any(|(start, matched)| {
            words[..start].ends_with(' ') && words[start + matched.len()..].starts_with(' ')
        })
    })
}

fn unique(mut matches: impl Iterator<Item = &'static Rule>) -> Option<&'static str> {
    let first = matches.next()?;
    matches.next().is_none().then_some(first.id)
}

fn detect(
    c: &Connection,
    id: &CallId,
    title: &str,
) -> noter_db::rusqlite::Result<Option<&'static str>> {
    // Keep a version such as “Release 1.1” distinct from a one-on-one.
    let title = words(
        &title
            .replace("1:1", "one on one")
            .replace("1-1", "one on one"),
    );
    // These shorthand labels identify a type on their own. In longer titles their
    // qualifiers matter ("daily scrum", "daily ops review", "customer interview").
    match title.trim() {
        "daily" => return Ok(Some("standup")),
        "interview" | "интервью" => return Ok(Some("interview")),
        _ => {}
    }
    let mut labels = RULES
        .iter()
        .filter(|rule| mentions(&title, rule.titles))
        .peekable();
    if labels.peek().is_some() {
        return Ok(unique(labels));
    }

    // Only confirmed lines are stored. Prefer the archived transcript when one exists.
    let mut stmt = c.prepare(
        "SELECT text FROM segments WHERE call_id = ?1 AND pass = CASE WHEN EXISTS
         (SELECT 1 FROM segments WHERE call_id = ?1 AND pass = 'archive') THEN 'archive' ELSE 'live' END
         ORDER BY t0_ms",
    )?;
    let mut rows = stmt.query([id.as_str()])?;
    let mut evidence = [(false, false); RULES.len()];
    while let Some(row) = rows.next()? {
        let text = words(row.get_ref(0)?.as_str()?);
        for (rule, (first, second)) in RULES.iter().zip(&mut evidence) {
            if mentions(&text, rule.declarations) {
                (*first, *second) = (true, true);
            } else {
                *first |= mentions(&text, rule.agenda.0);
                *second |= mentions(&text, rule.agenda.1);
            }
        }
    }
    Ok(unique(
        RULES
            .iter()
            .zip(evidence)
            .filter_map(|(rule, (a, b))| (a && b).then_some(rule)),
    ))
}

impl Core {
    // @cpt-seq:cpt-noter-seq-core-call-end-outputs:p1
    // @cpt-begin:cpt-noter-flow-core-postcall-write:p1:inst-write-classify
    pub(crate) fn classify_stopped_call(&self, id: &CallId) -> Result<(), CoreError> {
        self.assign_call_type(id, "Call type detection", |c, title| detect(c, id, title))
    }

    /// Apply the post-call model's suggestion under the same guard as local detection.
    pub(crate) fn suggest_call_type(&self, id: &CallId, kind: &str) -> Result<(), CoreError> {
        self.assign_call_type(id, "Post-call analysis", |_, _| Ok(Some(kind)))
    }

    fn assign_call_type<'k>(
        &self,
        id: &CallId,
        writer: &str,
        pick: impl Fn(&Connection, &str) -> noter_db::rusqlite::Result<Option<&'k str>>,
    ) -> Result<(), CoreError> {
        loop {
            let candidate = self.store().read(|c| {
                // Legacy captures sometimes used the capture process name as their title.
                // Capture creation also logged call_type in its initial multi-field delta.
                // Only an actual call_update (including one the user undid) is a choice.
                let header = c
                    .query_row(
                        "SELECT rev, CASE WHEN calendar_event_id IS NULL AND title = platform
                                          THEN '' ELSE title END
                         FROM calls
                         WHERE id = ?1 AND ended_at IS NOT NULL AND call_type = 'unclassified'
                           AND NOT EXISTS (
                             SELECT 1 FROM changes WHERE entity_type = 'call' AND entity_id = ?1
                               AND (reason = ?2 OR (
                                 actor = 'you' AND reason = 'call_update' AND
                                 (field = 'call_type' OR json_type(CAST(delta AS TEXT), '$.call_type') IS NOT NULL)
                               ))
                           )",
                        (id.as_str(), REASON),
                        |r| Ok((Rev(r.get(0)?), r.get::<_, String>(1)?)),
                    )
                    .optional()?;
                let Some((rev, title)) = header else {
                    return Ok(None);
                };
                Ok(pick(c, &title)?.map(|kind| (rev, kind)))
            })?;
            let Some((rev, kind)) = candidate else {
                return Ok(());
            };
            let update = Mutation {
                entity_type: "call",
                table: "calls",
                id: id.0.clone(),
                base_rev: Some(rev),
                bump_rev: true,
                values: vec![("call_type", json!(kind))],
            };
            let meta = ChangeMeta {
                actor: Actor::Job {
                    job_id: JobId::new("job_call_type"),
                    name: writer.into(),
                },
                summary: "Automatically detected call type".into(),
                reason: REASON.into(),
                evidence_ids: vec![],
                batch_id: None,
                undoable: true,
                surface: None,
            };
            match self.store().write(update, meta) {
                Err(e) if e.code == ErrorCode::Conflict => continue,
                result => {
                    result?;
                    self.publish_call_row(id);
                    return Ok(());
                }
            }
        }
    }

    pub(crate) fn backfill_call_types(&self) -> Result<(), CoreError> {
        let calls = self.store().read(|c| {
            if c.query_row(
                "SELECT EXISTS(SELECT 1 FROM settings WHERE key = ?1)",
                [BACKFILL],
                |r| r.get::<_, bool>(0),
            )? {
                return Ok(None);
            }
            let mut q = c.prepare(
                "SELECT id FROM calls WHERE ended_at IS NOT NULL AND call_type = 'unclassified'",
            )?;
            let rows = q.query_map([], |r| r.get::<_, String>(0).map(CallId::new))?;
            Ok(Some(rows.collect::<Result<Vec<_>, _>>()?))
        })?;
        let Some(calls) = calls else { return Ok(()) };
        for call in calls {
            self.classify_stopped_call(&call)?;
        }
        // Persist completion even when none matched. A crash before this point retries
        // on launch; the history guard preserves assignments and their Undo.
        self.store().insert_batch(vec![Insert {
            table: "settings",
            values: vec![("key", json!(BACKFILL)), ("value", json!("true"))],
        }])
    }
    // @cpt-end:cpt-noter-flow-core-postcall-write:p1:inst-write-classify
}

#[cfg(test)]
mod tests;
