//! FEATURE cpt-noter-feature-core-people (slice 2): who took part in a call, and the carry-forward
//! of open items into a live call with the same people (TL-39, moved from 2.18).

use std::collections::BTreeSet;

use noter_db::rusqlite::types::Value as Sql;
use noter_db::rusqlite::{params, params_from_iter, Connection, OptionalExtension};
use noter_protocol::model::*;
use noter_protocol::*;
use serde_json::json;

use crate::people::{db, logged, new_id};
use crate::today::CARRY_CALLS;
use crate::{internal, lock, Core};

/// The people a call's calendar attendees are, by email first and then by name or alias.
fn attendee_people(
    c: &Connection,
    attendees: &[crate::CalendarAttendee],
) -> Result<Vec<String>, CoreError> {
    let mut found = BTreeSet::new();
    for attendee in attendees {
        if let Some(id) = crate::people::by_name(c, &attendee.name, attendee.email.as_deref())
            .map_err(internal)?
        {
            let is_attendee: bool = c
                .query_row("SELECT is_you = 0 FROM people WHERE id = ?1", [&id], |r| {
                    r.get(0)
                })
                .optional()
                .map_err(internal)?
                .unwrap_or(false);
            if is_attendee {
                found.insert(id);
            }
        }
    }
    Ok(found.into_iter().collect())
}

impl Core {
    /// Adds the people to the call's participation, each once; nothing is written when they
    /// all took part already.
    fn add_participants(&self, call: &CallId, people: Vec<String>) -> Result<(), CoreError> {
        if people.is_empty() {
            return Ok(());
        }
        let id = call.as_str().to_string();
        let mut meta = self.change_meta(
            &crate::util::main_window_ctx(),
            "Recorded who took part".into(),
            "call_participants",
        );
        meta.undoable = false;
        let done = self.store().write_with(meta, move |tx| {
            let mut log = Vec::new();
            for person in &people {
                let pid = new_id("cpp");
                let n = db(tx.execute(
                    "INSERT OR IGNORE INTO call_participants (id, call_id, person_id)
                     SELECT ?1, ?2, ?3 WHERE EXISTS (SELECT 1 FROM people WHERE id = ?3)",
                    params![pid, id, person],
                ))?;
                if n == 1 {
                    log.push(logged(
                        "call_participant",
                        &pid,
                        vec![
                            ("call_id", serde_json::Value::Null, json!(id)),
                            ("person_id", serde_json::Value::Null, json!(person)),
                        ],
                    ));
                }
            }
            if log.is_empty() {
                // Everyone took part already: abort so the writer records nothing.
                return Err(CoreError::new(ErrorCode::NotFound, "already recorded"));
            }
            Ok(((), log))
        });
        match done {
            Err(e) if e.code == ErrorCode::NotFound => Ok(()),
            other => other.map(|_| ()),
        }
    }

    /// The call's named speakers (not You) join its participation.
    pub(crate) fn sync_participants(&self, call: &CallId) -> Result<(), CoreError> {
        let id = call.as_str().to_string();
        let named: Vec<String> = crate::profiles::rd(self.store(), move |c| {
            c.prepare(
                "SELECT DISTINCT s.person_id FROM speakers s JOIN people p ON p.id = s.person_id
                 WHERE s.call_id = ?1 AND p.is_you = 0",
            )
            .and_then(|mut q| q.query_map([id], |r| r.get(0))?.collect())
            .map_err(internal)
        })?;
        self.add_participants(call, named)
    }

    /// The calendar event running at the call's start: its attendees who are known people.
    pub(crate) fn seed_participants(&self, call: &CallId) -> Result<(), CoreError> {
        let at = self.deps.clock.now();
        let attendees = self
            .deps
            .native
            .calendar_event_near(at)
            .and_then(|event| {
                let events = self
                    .deps
                    .native
                    .calendar_events(event.starts_at, event.ends_at)
                    .ok()?;
                events.into_iter().find(|e| e.event.id == event.id)
            })
            .map(|e| e.attendees)
            .unwrap_or_default();
        let people = crate::profiles::rd(self.store(), move |c| attendee_people(c, &attendees))?;
        self.add_participants(call, people)?;
        self.sync_participants(call)
    }

    /// Moves items between `open` and `carried`; `ids` is every item to move and `to` the status.
    fn set_status(
        &self,
        ids: Vec<(String, u32)>,
        from: &str,
        to: &str,
        reason: &str,
    ) -> Result<(), CoreError> {
        if ids.is_empty() {
            return Ok(());
        }
        let mut meta = self.change_meta(
            &crate::util::main_window_ctx(),
            "Moved open items".into(),
            reason,
        );
        meta.undoable = false;
        let (from, to) = (from.to_string(), to.to_string());
        let moved = ids.clone();
        let done = self.store().write_with(meta, move |tx| {
            let mut log = Vec::new();
            for (id, rev) in &moved {
                // Closed or answered since the read: the status is no longer `from`, leave it.
                let n = db(tx.execute(
                    "UPDATE items SET status = ?1, rev = rev + 1 WHERE id = ?2 AND status = ?3",
                    params![to, id, from],
                ))?;
                if n == 1 {
                    log.push(logged(
                        "item",
                        id,
                        vec![
                            ("status", json!(from), json!(to)),
                            ("rev", json!(rev), json!(rev + 1)),
                        ],
                    ));
                }
            }
            if log.is_empty() {
                return Err(CoreError::new(ErrorCode::NotFound, "nothing moved"));
            }
            Ok(((), log))
        });
        match done {
            Ok(_) => {}
            Err(e) if e.code == ErrorCode::NotFound => return Ok(()),
            Err(e) => return Err(e),
        }
        for (id, _) in &ids {
            if let Ok(Some(item)) = self.item_view(id) {
                self.emit_entity_changed(&EntityChanged::Item { item });
            }
        }
        Ok(())
    }

    fn carried_now(&self) -> Result<Vec<(String, u32)>, CoreError> {
        crate::profiles::rd(self.store(), |c| {
            c.prepare("SELECT id, rev FROM items WHERE status = 'carried'")
                .and_then(|mut q| q.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?.collect())
                .map_err(internal)
        })
    }

    // @cpt-flow:cpt-noter-flow-core-people-carry:p1
    /// The first segment of a live call: the open items of the last calls with the same people
    /// are offered and logged as carried. Only one call is live, so any item still carried is
    /// left over from a call a quit cut and returns to open first.
    pub(crate) fn carry_start(&self, call: &CallId) -> Result<usize, CoreError> {
        self.seed_participants(call)?;
        self.carry_end(call)?;
        // @cpt-begin:cpt-noter-flow-core-people-carry:p1:inst-carry-start
        let id = call.as_str().to_string();
        let items: Vec<(String, u32)> = crate::profiles::rd(self.store(), move |c| {
            let people: Vec<String> = c
                .prepare("SELECT person_id FROM call_participants WHERE call_id = ?1")
                .and_then(|mut q| q.query_map([&id], |r| r.get(0))?.collect())
                .map_err(internal)?;
            // Unknown attendees alone never reach here: participants are known people.
            if people.is_empty() {
                return Ok(vec![]);
            }
            let m = crate::util::marks(people.len());
            let mut args = vec![Sql::Text(id.clone()), Sql::Text(id.clone())];
            args.extend(people.iter().cloned().map(Sql::Text));
            args.extend(people.iter().cloned().map(Sql::Text));
            let calls: Vec<String> = c
                .prepare(&format!(
                    "SELECT id FROM calls
                     WHERE id != ? AND started_at < (SELECT started_at FROM calls WHERE id = ?)
                       AND status NOT IN ('recording', 'paused')
                       AND (EXISTS (SELECT 1 FROM call_participants p
                                    WHERE p.call_id = calls.id AND p.person_id IN ({m}))
                            OR EXISTS (SELECT 1 FROM speakers s
                                       WHERE s.call_id = calls.id AND s.person_id IN ({m})))
                     ORDER BY started_at DESC LIMIT {CARRY_CALLS}"
                ))
                .and_then(|mut q| q.query_map(params_from_iter(args), |r| r.get(0))?.collect())
                .map_err(internal)?;
            if calls.is_empty() {
                return Ok(vec![]);
            }
            c.prepare(&format!(
                "SELECT id, rev FROM items WHERE call_id IN ({}) AND status = 'open'
                   AND review_state IN ('accepted', 'suggested') ORDER BY id",
                crate::util::marks(calls.len())
            ))
            .and_then(|mut q| {
                q.query_map(params_from_iter(calls.iter()), |r| {
                    Ok((r.get(0)?, r.get(1)?))
                })?
                .collect()
            })
            .map_err(internal)
        })?;
        let n = items.len();
        // @cpt-begin:cpt-noter-flow-core-people-carry:p1:inst-st-carried
        self.set_status(items, "open", "carried", "carry_start")?;
        // @cpt-end:cpt-noter-flow-core-people-carry:p1:inst-st-carried
        // @cpt-end:cpt-noter-flow-core-people-carry:p1:inst-carry-start
        Ok(n)
    }

    /// The call's stop: carried items go back to open unless they were closed or answered
    /// meanwhile, and talk time is kept for the call's people while behaviour metrics are on.
    pub(crate) fn carry_end(&self, _call: &CallId) -> Result<(), CoreError> {
        // @cpt-begin:cpt-noter-flow-core-people-carry:p1:inst-carry-end
        // @cpt-begin:cpt-noter-flow-core-people-carry:p1:inst-st-return-open
        // Review state and the source call stay: only the status moves back.
        self.set_status(self.carried_now()?, "carried", "open", "carry_end")?;
        // @cpt-end:cpt-noter-flow-core-people-carry:p1:inst-st-return-open
        // @cpt-end:cpt-noter-flow-core-people-carry:p1:inst-carry-end
        Ok(())
    }

    /// Talk time per participant of a stopped call, from its live lines; never for a call
    /// recorded with behaviour metrics off and never back-computed (D5).
    pub(crate) fn keep_talk_time(&self, call: &CallId) -> Result<(), CoreError> {
        if !lock(&self.settings).privacy.behaviour_metrics {
            return Ok(());
        }
        let id = call.as_str().to_string();
        let mut meta = self.change_meta(
            &crate::util::main_window_ctx(),
            "Kept talk time".into(),
            "talk_time",
        );
        meta.undoable = false;
        let done = self.store().write_with(meta, move |tx| {
            let mut log = Vec::new();
            let rows: Vec<(String, String, i64)> = tx
                .prepare(
                    "SELECT cp.id, cp.person_id, COALESCE((SELECT sum(g.t1_ms - g.t0_ms)
                       FROM segments g JOIN speakers s ON s.id = g.speaker_id
                       WHERE s.call_id = cp.call_id AND s.person_id = cp.person_id
                         AND s.pass = 'live'), 0)
                     FROM call_participants cp WHERE cp.call_id = ?1 AND cp.talk_time_ms IS NULL",
                )
                .and_then(|mut q| {
                    q.query_map([&id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
                        .collect()
                })
                .map_err(internal)?;
            for (row, _, ms) in rows {
                db(tx.execute(
                    "UPDATE call_participants SET talk_time_ms = ?1 WHERE id = ?2",
                    params![ms, row],
                ))?;
                log.push(logged(
                    "call_participant",
                    &row,
                    vec![("talk_time_ms", serde_json::Value::Null, json!(ms))],
                ));
            }
            if log.is_empty() {
                return Err(CoreError::new(ErrorCode::NotFound, "no participants"));
            }
            Ok(((), log))
        });
        match done {
            Err(e) if e.code == ErrorCode::NotFound => Ok(()),
            other => other.map(|_| ()),
        }
    }
}
