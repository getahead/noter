//! FEATURE cpt-noter-feature-core-people (slice 1): the people tables behind `people_list`,
//! `person_get`, `person_create`, `person_update`, `people_merge` and `person_delete`. Voice
//! profiles and carry-forward are slice 2.

use std::collections::{BTreeSet, HashMap};

use noter_db::rusqlite::types::{Value as Sql, ValueRef};
use noter_db::rusqlite::{params, params_from_iter, Connection, OptionalExtension, Transaction};
use noter_db::Logged;
use noter_protocol::error::ValidationRule;
use noter_protocol::ipc::CommandCtx;
use noter_protocol::model::*;
use noter_protocol::*;
use serde_json::{json, Map, Value};

use crate::items::items_where;
use crate::settings::invalid;
use crate::{internal, Core};

type Db<T> = noter_db::rusqlite::Result<T>;

const MAX_NAME: usize = 200;

/// Open work: accepted or suggested, not rejected, not finished.
const OPEN: &str = "i.status IN ('open', 'carried') AND i.review_state != 'rejected'";

/// The calls a person was on, by participation or by a speaker named as them (`?1`).
const THEIR_CALLS: &str = "SELECT call_id FROM call_participants WHERE person_id = ?1
     UNION SELECT call_id FROM speakers WHERE person_id = ?1";

/// Lookup form shared with transcript and document keyword search.
pub(crate) fn norm(text: &str) -> String {
    noter_retrieval::normalize(text.trim())
}

/// "Anna Koval" is "Anna K."; one word stays as it is.
pub(crate) fn short_of(name: &str) -> String {
    let words: Vec<&str> = name.split_whitespace().collect();
    match words.as_slice() {
        [first, .., last] => format!("{first} {}.", last.chars().next().unwrap_or_default()),
        _ => name.to_string(),
    }
}

pub(crate) fn initials_of(name: &str) -> String {
    name.split_whitespace()
        .filter_map(|w| w.chars().next())
        .take(2)
        .collect::<String>()
        .to_uppercase()
}

pub(crate) fn not_found() -> CoreError {
    CoreError::new(ErrorCode::NotFound, "this person no longer exists")
}

pub(crate) fn db<T>(r: Db<T>) -> Result<T, CoreError> {
    r.map_err(internal)
}

/// A named speaker's or item owner's chip from the person row, so a rename needs no transcript
/// rewrite; `None` when the person is gone.
/// Resolve a person by email first, then by display name or normalized alias.
pub(crate) fn by_name(c: &Connection, name: &str, email: Option<&str>) -> Db<Option<String>> {
    if let Some(email) = email.filter(|email| !email.trim().is_empty()) {
        let person = c
            .query_row(
                "SELECT id FROM people WHERE lower(email) = lower(?1) ORDER BY rowid LIMIT 1",
                [email.trim()],
                |r| r.get(0),
            )
            .optional()?;
        if person.is_some() {
            return Ok(person);
        }
    }
    let wanted = norm(name);
    if wanted.is_empty() {
        return Ok(None);
    }
    let aliases: Vec<(String, String)> = c
        .prepare(
            "SELECT a.person_id, a.alias FROM person_aliases a JOIN people p ON p.id = a.person_id
             ORDER BY a.rowid",
        )?
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<Result<_, _>>()?;
    if let Some((id, _)) = aliases.into_iter().find(|(_, alias)| norm(alias) == wanted) {
        return Ok(Some(id));
    }
    let people: Vec<(String, String)> = c
        .prepare("SELECT id, display_name FROM people ORDER BY rowid")?
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<Result<_, _>>()?;
    if let Some((id, _)) = people
        .into_iter()
        .find(|(_, display)| norm(display) == wanted)
    {
        return Ok(Some(id));
    }
    let speakers: Vec<(String, String)> = c
        .prepare(
            "SELECT person_id, label FROM speakers WHERE person_id IS NOT NULL ORDER BY rowid DESC",
        )?
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<Result<_, _>>()?;
    Ok(speakers
        .into_iter()
        .find(|(_, label)| norm(label) == wanted)
        .map(|(id, _)| id))
}

pub(crate) fn chip_from_name(person_id: &str, name: &str) -> PersonChip {
    PersonChip {
        id: PersonId::new(person_id),
        display_name: name.to_owned(),
        short_name: short_of(name),
        initials: initials_of(name),
        is_you: false,
    }
}

pub(crate) fn chip_for(c: &Connection, person_id: &str, fallback_name: &str) -> Db<PersonChip> {
    Ok(chip_of(c, person_id)?.unwrap_or_else(|| chip_from_name(person_id, fallback_name)))
}

pub(crate) fn chip_of(c: &Connection, person_id: &str) -> Db<Option<PersonChip>> {
    c.query_row(
        "SELECT display_name, short_name, is_you FROM people WHERE id = ?1",
        [person_id],
        |r| {
            let display_name: String = r.get(0)?;
            Ok(PersonChip {
                id: PersonId::new(person_id),
                short_name: r.get(1)?,
                initials: initials_of(&display_name),
                display_name,
                is_you: r.get(2)?,
            })
        },
    )
    .optional()
}

pub(crate) fn chips_of(
    c: &Connection,
    people: &BTreeSet<String>,
) -> Db<HashMap<String, PersonChip>> {
    const BATCH: usize = 400;
    let mut chips = HashMap::new();
    for ids in people.iter().collect::<Vec<_>>().chunks(BATCH) {
        let marks = crate::util::marks(ids.len());
        for row in c
            .prepare(&format!(
                "SELECT id, display_name, short_name, is_you FROM people WHERE id IN ({marks})"
            ))?
            .query_map(params_from_iter(ids.iter()), |r| {
                let id: String = r.get(0)?;
                let display_name: String = r.get(1)?;
                Ok((
                    id.clone(),
                    PersonChip {
                        id: PersonId::new(id),
                        display_name: display_name.clone(),
                        short_name: r.get(2)?,
                        initials: initials_of(&display_name),
                        is_you: r.get(3)?,
                    },
                ))
            })?
        {
            let (id, chip) = row?;
            chips.insert(id, chip);
        }
    }
    Ok(chips)
}

// @cpt-algo:cpt-noter-algo-core-people-page:p1
/// Every person (or `only` one) with aliases, last call and open-item count, in grouped queries.
fn rows_of(c: &Connection, only: Option<&str>) -> Db<Vec<PersonRow>> {
    // @cpt-begin:cpt-noter-algo-core-people-page:p1:inst-page-people
    let filter = if only.is_some() { " WHERE id = ?1" } else { "" };
    let mut people: Vec<PersonRow> = c
        .prepare(&format!(
            "SELECT id, rev, display_name, short_name, email, role, org, is_you, voice_profile_optin
             FROM people{filter}"
        ))?
        .query_map(params_from_iter(only), |r| {
            let display_name: String = r.get(2)?;
            Ok(PersonRow {
                id: PersonId::new(r.get::<_, String>(0)?),
                rev: Rev(r.get(1)?),
                initials: initials_of(&display_name),
                display_name,
                short_name: r.get(3)?,
                email: r.get(4)?,
                role: r.get(5)?,
                org: r.get(6)?,
                aliases: vec![],
                is_you: r.get(7)?,
                voice_profile: r.get(8)?,
                last_call_at: None,
                open_items: 0,
            })
        })?
        .collect::<Result<_, _>>()?;
    let person_filter = if only.is_some() {
        " WHERE person_id = ?1"
    } else {
        ""
    };
    let mut aliases: HashMap<String, Vec<String>> = HashMap::new();
    for row in c
        .prepare(&format!(
            "SELECT person_id, alias FROM person_aliases{person_filter} ORDER BY rowid"
        ))?
        .query_map(params_from_iter(only), |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        })?
    {
        let (person, alias) = row?;
        aliases.entry(person).or_default().push(alias);
    }
    let mut last: HashMap<String, i64> = c
        .prepare(&format!(
            "SELECT p.person_id, max(c.started_at) FROM
               (SELECT person_id, call_id FROM call_participants
                UNION SELECT person_id, call_id FROM speakers WHERE person_id IS NOT NULL) p
             JOIN calls c ON c.id = p.call_id {person_filter} GROUP BY p.person_id",
        ))?
        .query_map(params_from_iter(only), |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<Result<_, _>>()?;
    let mut open: HashMap<String, u32> = c
        .prepare(&format!(
            "SELECT i.owner_person_id, count(*) FROM items i
             WHERE i.owner_person_id IS NOT NULL AND i.kind = 'action_item' AND {OPEN}
               {}
             GROUP BY i.owner_person_id",
            if only.is_some() {
                "AND i.owner_person_id = ?1"
            } else {
                ""
            }
        ))?
        .query_map(params_from_iter(only), |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<Result<_, _>>()?;
    for p in &mut people {
        let id = p.id.as_str();
        p.aliases = aliases.remove(id).unwrap_or_default();
        p.last_call_at = last.remove(id).map(TimestampMs);
        p.open_items = open.remove(id).unwrap_or(0);
    }
    Ok(people)
    // @cpt-end:cpt-noter-algo-core-people-page:p1:inst-page-people
}

/// Speaker rows without a person, one per call: a label's text never joins two calls.
fn unnamed_of(c: &Connection) -> Db<Vec<UnnamedSpeaker>> {
    // @cpt-begin:cpt-noter-algo-core-people-page:p1:inst-page-unnamed
    c.prepare(
        "SELECT s.id, s.n, c.id, c.title, c.started_at, c.call_type,
                (SELECT count(*) FROM segments g WHERE g.speaker_id = s.id),
                (SELECT t0_ms FROM segments g WHERE g.speaker_id = s.id ORDER BY t0_ms LIMIT 1),
                (SELECT t1_ms FROM segments g WHERE g.speaker_id = s.id ORDER BY t0_ms LIMIT 1),
                c.audio_deleted = 0 AND c.audio_not_stored = 0
         FROM speakers s JOIN calls c ON c.id = s.call_id
         WHERE s.person_id IS NULL AND s.n IS NOT NULL AND s.channel = 'sys'
           AND s.pass = (CASE WHEN EXISTS
                 (SELECT 1 FROM speakers a WHERE a.call_id = s.call_id AND a.pass = 'archive')
                 THEN 'archive' ELSE 'live' END)
         ORDER BY c.started_at DESC, s.n",
    )?
    .query_map([], |r| {
        let call = CallRef {
            id: CallId::new(r.get::<_, String>(2)?),
            title: r.get(3)?,
            started_at: TimestampMs(r.get(4)?),
            call_type: CallTypeId(r.get(5)?),
        };
        let playable: bool = r.get(9)?;
        let span: (Option<u32>, Option<u32>) = (r.get(7)?, r.get(8)?);
        Ok(UnnamedSpeaker {
            sample: match span {
                (Some(t0), Some(t1)) if playable => Some(TimeSpan {
                    call_id: call.id.clone(),
                    channel: None,
                    t0_ms: OffsetMs(t0),
                    t1_ms: OffsetMs(t1),
                }),
                _ => None,
            },
            call,
            speaker_id: SpeakerId::new(r.get::<_, String>(0)?),
            n: r.get(1)?,
            segment_count: r.get(6)?,
            suggestion: None,
        })
    })?
    .collect()
    // @cpt-end:cpt-noter-algo-core-people-page:p1:inst-page-unnamed
}

/// Topics of the items from the person's calls (the topics table is retrieval's, 2.22).
fn topics_of(c: &Connection, person_id: &str) -> Db<Vec<TopicRow>> {
    c.prepare(&format!(
        "SELECT t.id, t.rev, t.name, t.last_seen, count(DISTINCT i.call_id),
                coalesce(sum(i.kind = 'decision'), 0),
                coalesce(sum(i.kind != 'decision' AND i.status IN ('open', 'carried')), 0)
         FROM topics t JOIN items i ON i.topic_id = t.id
         WHERE i.call_id IN ({THEIR_CALLS})
         GROUP BY t.id ORDER BY t.last_seen DESC, t.id"
    ))?
    .query_map([person_id], |r| {
        Ok(TopicRow {
            id: TopicId::new(r.get::<_, String>(0)?),
            rev: Rev(r.get(1)?),
            name: r.get(2)?,
            aliases: vec![],
            calls: r.get(4)?,
            decisions: r.get(5)?,
            open_items: r.get(6)?,
            last_seen: TimestampMs(r.get(3)?),
            merge_suggestion: None,
        })
    })?
    .collect()
}

/// The person's share of the talk time recorded in calls where they have some: only rows the
/// recorder filled, so nothing older is ever computed.
fn talk_share(c: &Connection, person_id: &str) -> Db<Option<f32>> {
    let (own, all): (Option<i64>, Option<i64>) = c.query_row(
        "SELECT sum(CASE WHEN person_id = ?1 THEN talk_time_ms END), sum(talk_time_ms)
         FROM call_participants
         WHERE talk_time_ms IS NOT NULL AND call_id IN
           (SELECT call_id FROM call_participants WHERE person_id = ?1 AND talk_time_ms IS NOT NULL)",
        [person_id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    Ok(own
        .zip(all)
        .filter(|(_, all)| *all > 0)
        .map(|(own, all)| (own as f64 / all as f64) as f32))
}

/// Trimmed, blanks dropped, one spelling per normalized form (the first).
fn clean_aliases(aliases: &[String]) -> Vec<(String, String)> {
    let mut seen = BTreeSet::new();
    aliases
        .iter()
        .map(|a| a.split_whitespace().collect::<Vec<_>>().join(" "))
        .filter(|a| !a.is_empty())
        .map(|a| {
            let n = norm(&a);
            (a, n)
        })
        .filter(|(_, n)| seen.insert(n.clone()))
        .collect()
}

/// A name of 1..=200 characters, trimmed.
fn name_of(name: &str, field: &str) -> Result<String, CoreError> {
    let name = name.trim();
    match name.chars().count() {
        0 => Err(invalid(field, ValidationRule::Required)),
        n if n > MAX_NAME => Err(invalid(field, ValidationRule::TooLong)),
        _ => Ok(name.to_string()),
    }
}

/// A detail that is blank means none.
fn detail_of(text: &str) -> Option<String> {
    Some(text.trim().to_string()).filter(|t| !t.is_empty())
}

pub(crate) type Pairs<'a> = Vec<(&'a str, Value, Value)>;

/// A change row's reversible delta: `{"column": [before, after]}`, no `id` (replay keys by it).
pub(crate) fn logged(entity_type: &'static str, id: &str, pairs: Pairs<'_>) -> Logged {
    let columns: Map<String, Value> = pairs
        .into_iter()
        .map(|(column, before, after)| (column.to_string(), json!([before, after])))
        .collect();
    Logged {
        entity_type,
        entity_id: id.to_string(),
        field: None,
        before: None,
        after: None,
        delta: Some(Value::Object(columns)),
    }
}

/// The columns of a person a change or a merge reads.
struct Stored {
    rev: u32,
    display_name: String,
    short_name: String,
    email: Option<String>,
    role: Option<String>,
    org: Option<String>,
    notes: Option<String>,
    is_you: bool,
    optin: bool,
    optin_date: Option<i64>,
}

fn stored(c: &Connection, id: &str) -> Result<Stored, CoreError> {
    db(c.query_row(
        "SELECT rev, display_name, short_name, email, role, org, notes, is_you,
                voice_profile_optin, optin_date FROM people WHERE id = ?1",
        [id],
        |r| {
            Ok(Stored {
                rev: r.get(0)?,
                display_name: r.get(1)?,
                short_name: r.get(2)?,
                email: r.get(3)?,
                role: r.get(4)?,
                org: r.get(5)?,
                notes: r.get(6)?,
                is_you: r.get(7)?,
                optin: r.get(8)?,
                optin_date: r.get(9)?,
            })
        },
    )
    .optional())?
    .ok_or_else(not_found)
}

/// What a merge or a delete touched, for the events after the commit.
#[derive(Default)]
struct Touched {
    calls: BTreeSet<String>,
    items: Vec<String>,
}

pub(crate) fn new_id(prefix: &str) -> String {
    format!("{prefix}_{}", ulid::Ulid::generate())
}

/// The rows of `sql` for one bound id, each value as JSON (null, integer or text).
fn rows(tx: &Connection, sql: &str, who: &str) -> Result<Vec<Vec<Value>>, CoreError> {
    let mut stmt = db(tx.prepare(sql))?;
    let n = stmt.column_count();
    let out = db(stmt.query_map([who], |r| {
        (0..n)
            .map(|i| {
                Ok(match r.get_ref(i)? {
                    ValueRef::Integer(v) => json!(v),
                    ValueRef::Text(t) => json!(String::from_utf8_lossy(t)),
                    _ => Value::Null,
                })
            })
            .collect()
    }))?;
    db(out.collect())
}

fn text(v: &Value) -> String {
    v.as_str().unwrap_or_default().to_string()
}

impl Core {
    /// The person as the People list shows them, `None` when they are gone.
    pub(crate) fn person_row(&self, id: &str) -> Result<Option<PersonRow>, CoreError> {
        self.store()
            .read(|c| Ok(rows_of(c, Some(id))?.into_iter().next()))
    }

    pub(crate) fn publish_person(&self, id: &str) -> Result<(), CoreError> {
        match self.person_row(id)? {
            Some(person) => self.emit_entity_changed(&EntityChanged::Person { person }),
            None => self.emit_entity_changed(&EntityChanged::Removed {
                kind: EntityKind::Person,
                id: id.to_string(),
            }),
        }
        Ok(())
    }

    /// Items and call speakers a merge or a delete moved: windows read the new owners and names.
    fn publish_moved(&self, touched: &Touched) {
        for id in &touched.items {
            if let Ok(Some(item)) = self.item_view(id) {
                self.emit_entity_changed(&EntityChanged::Item { item });
            }
        }
        for call in &touched.calls {
            if let Err(e) = self.publish_corrected(&CallId::new(call.clone()), &[]) {
                self.log(crate::object(json!({
                    "level": "error", "module": "people", "code": "publish", "message_len": e.message.len()
                })));
            }
        }
    }

    // @cpt-dod:cpt-noter-dod-core-people-pages:p4
    // @cpt-flow:cpt-noter-flow-core-people-read:p1
    pub(crate) fn list_people(&self, args: PeopleListArgs) -> Result<PeopleList, CoreError> {
        self.ready()?;
        // @cpt-begin:cpt-noter-flow-core-people-read:p1:inst-read-list
        let query = args.query.as_deref().map(norm).filter(|q| !q.is_empty());
        // @cpt-end:cpt-noter-flow-core-people-read:p1:inst-read-list
        // @cpt-begin:cpt-noter-flow-core-people-read:p1:inst-read-people
        let mut list = self.store().read(move |c| {
            let mut people = rows_of(c, None)?;
            if let Some(q) = &query {
                people.retain(|p| {
                    [&p.display_name, &p.short_name]
                        .into_iter()
                        .chain(&p.aliases)
                        .any(|name| norm(name).contains(q.as_str()))
                });
            }
            people.sort_by_cached_key(|p| (!p.is_you, norm(&p.display_name)));
            Ok(PeopleList {
                people,
                unnamed: unnamed_of(c)?,
            })
        })?;
        let speakers: Vec<String> = list
            .unnamed
            .iter()
            .map(|u| u.speaker_id.as_str().to_string())
            .collect();
        for (u, suggestion) in list.unnamed.iter_mut().zip(self.suggestions_for(&speakers)) {
            u.suggestion = suggestion;
        }
        Ok(list)
        // @cpt-end:cpt-noter-flow-core-people-read:p1:inst-read-people
    }

    pub(crate) fn get_person(&self, args: PersonIdArgs) -> Result<PersonPage, CoreError> {
        self.ready()?;
        // @cpt-begin:cpt-noter-flow-core-people-read:p1:inst-read-page
        let id = args.person_id.as_str().to_string();
        let metrics = crate::settings::load(self.store())?
            .privacy
            .behaviour_metrics;
        let page = self.store().read(move |c| {
            let Some(person) = rows_of(c, Some(&id))?.into_iter().next() else {
                return Ok(None);
            };
            // @cpt-begin:cpt-noter-algo-core-people-page:p1:inst-page-joins
            let ids: Vec<String> = c
                .prepare(&format!(
                    "SELECT t.call_id FROM ({THEIR_CALLS}) t JOIN calls c ON c.id = t.call_id
                     ORDER BY c.started_at DESC, c.id"
                ))?
                .query_map([&id], |r| r.get(0))?
                .collect::<Result<_, _>>()?;
            let theirs = format!("i.call_id IN ({THEIR_CALLS})");
            let args = || vec![Sql::Text(id.clone())];
            let owns_open = items_where(
                c,
                &format!("i.owner_person_id = ?1 AND i.kind = 'action_item' AND {OPEN}"),
                args(),
            )?;
            // What they asked of the user: the user's open actions from calls they were on.
            let you_owe = if person.is_you {
                vec![]
            } else {
                items_where(
                    c,
                    &format!(
                        "i.owner_person_id = (SELECT id FROM people WHERE is_you = 1)
                         AND i.kind = 'action_item' AND {OPEN} AND {theirs}"
                    ),
                    args(),
                )?
            };
            let open_questions = items_where(
                c,
                &format!("i.kind = 'open_question' AND {OPEN} AND {theirs}"),
                args(),
            )?;
            let topics = topics_of(c, &id)?;
            // @cpt-end:cpt-noter-algo-core-people-page:p1:inst-page-joins
            // @cpt-begin:cpt-noter-algo-core-people-page:p1:inst-page-metrics
            let talk_share = if metrics { talk_share(c, &id)? } else { None };
            // @cpt-end:cpt-noter-algo-core-people-page:p1:inst-page-metrics
            Ok(Some((
                person,
                ids,
                owns_open,
                you_owe,
                open_questions,
                topics,
                talk_share,
            )))
        })?;
        // @cpt-end:cpt-noter-flow-core-people-read:p1:inst-read-page
        // @cpt-begin:cpt-noter-flow-core-people-read:p1:inst-read-return
        // @cpt-begin:cpt-noter-algo-core-people-page:p1:inst-page-empty
        // @cpt-begin:cpt-noter-algo-core-people-page:p1:inst-page-return
        let (person, ids, owns_open, you_owe, open_questions, topics, talk_share) =
            page.ok_or_else(not_found)?;
        let mut calls = Vec::with_capacity(ids.len());
        for id in &ids {
            calls.extend(self.call_row(id)?);
        }
        Ok(PersonPage {
            person,
            calls,
            owns_open,
            you_owe,
            open_questions,
            topics,
            talk_share,
        })
        // @cpt-end:cpt-noter-algo-core-people-page:p1:inst-page-return
        // @cpt-end:cpt-noter-algo-core-people-page:p1:inst-page-empty
        // @cpt-end:cpt-noter-flow-core-people-read:p1:inst-read-return
    }

    // @cpt-flow:cpt-noter-flow-core-people-edit:p1
    pub(crate) fn create_person(
        &self,
        ctx: &CommandCtx,
        args: PersonCreateArgs,
    ) -> Result<PersonMutation, CoreError> {
        self.ready()?;
        // @cpt-begin:cpt-noter-flow-core-people-edit:p1:inst-edit-create
        let display_name = name_of(&args.display_name, "display_name")?;
        // @cpt-end:cpt-noter-flow-core-people-edit:p1:inst-edit-create
        // @cpt-begin:cpt-noter-flow-core-people-edit:p1:inst-edit-insert
        let id = new_id("per");
        let meta = self.change_meta(ctx, "Added a person".into(), "person_create");
        let written = self.store().write(
            noter_db::Mutation {
                entity_type: "person",
                table: "people",
                id: id.clone(),
                base_rev: None,
                bump_rev: true,
                values: vec![
                    ("short_name", json!(short_of(&display_name))),
                    ("display_name", json!(display_name)),
                    ("email", json!(args.email.as_deref().and_then(detail_of))),
                    ("role", json!(args.role.as_deref().and_then(detail_of))),
                    ("org", json!(args.org.as_deref().and_then(detail_of))),
                    ("is_you", json!(0)),
                    ("voice_profile_optin", json!(0)),
                ],
            },
            meta,
        )?;
        // @cpt-end:cpt-noter-flow-core-people-edit:p1:inst-edit-insert
        // @cpt-begin:cpt-noter-flow-core-people-edit:p1:inst-edit-return
        self.publish_person(&id)?;
        let person = self.person_row(&id)?.ok_or_else(not_found)?;
        Ok(PersonMutation {
            person,
            change_id: written.change_id,
        })
        // @cpt-end:cpt-noter-flow-core-people-edit:p1:inst-edit-return
    }

    pub(crate) fn update_person(
        &self,
        ctx: &CommandCtx,
        args: PersonUpdateArgs,
    ) -> Result<PersonMutation, CoreError> {
        self.ready()?;
        // @cpt-begin:cpt-noter-flow-core-people-edit:p1:inst-edit-update
        let patch = args.patch;
        let display = patch
            .display_name
            .as_deref()
            .map(|n| name_of(n, "display_name"))
            .transpose()?;
        let short = patch
            .short_name
            .as_deref()
            .map(|n| name_of(n, "short_name"))
            .transpose()?;
        let aliases = patch.aliases.as_deref().map(clean_aliases);
        // @cpt-end:cpt-noter-flow-core-people-edit:p1:inst-edit-update
        // @cpt-begin:cpt-noter-flow-core-people-edit:p1:inst-edit-commit
        let (id, rev) = (args.person_id.as_str().to_string(), args.rev.0);
        let meta = self.change_meta(ctx, "Edited a person".into(), "person_update");
        let target = id.clone();
        let done = self.store().write_with(meta, move |tx| {
            let now = stored(tx, &target)?;
            if now.rev != rev {
                return Err(CoreError::new(
                    ErrorCode::Conflict,
                    "this person changed since its rev",
                )
                .with_detail(ErrorDetail::Conflict {
                    current_rev: Rev(now.rev),
                }));
            }
            // A short name that was the derived one follows a new display name.
            let short = short.or_else(|| {
                let follows = now.short_name == short_of(&now.display_name);
                display.as_deref().filter(|_| follows).map(short_of)
            });
            let mut sets: Pairs<'_> = vec![];
            let mut put = |column: &'static str, before: &Option<String>, after: Option<String>| {
                if before.as_deref() != after.as_deref() {
                    sets.push((column, json!(before), json!(after)));
                }
            };
            if let Some(name) = display {
                put("display_name", &Some(now.display_name.clone()), Some(name));
            }
            if let Some(name) = short {
                put("short_name", &Some(now.short_name.clone()), Some(name));
            }
            // A detail given blank clears it; one left out stays.
            for (column, before, given) in [
                ("email", &now.email, &patch.email),
                ("role", &now.role, &patch.role),
                ("org", &now.org, &patch.org),
                ("notes", &now.notes, &patch.notes),
            ] {
                if let Some(text) = given {
                    put(column, before, detail_of(text));
                }
            }
            sets.push(("rev", json!(rev), json!(rev + 1)));
            let assigns: Vec<String> = sets.iter().map(|(c, _, _)| format!("{c} = ?")).collect();
            let mut values: Vec<Sql> = sets.iter().map(|(_, _, after)| noter_db::to_sql(after)).collect();
            values.push(Sql::Text(target.clone()));
            db(tx.execute(
                &format!("UPDATE people SET {} WHERE id = ?", assigns.join(", ")),
                params_from_iter(values),
            ))?;
            let mut log = vec![logged("person", &target, sets)];
            if let Some(wanted) = &aliases {
                let held: Vec<(String, String, String)> = rows(
                    tx,
                    "SELECT id, alias, alias_norm FROM person_aliases WHERE person_id = ?1 ORDER BY rowid",
                    &target,
                )?
                .iter()
                .map(|r| (text(&r[0]), text(&r[1]), text(&r[2])))
                .collect();
                for (alias_id, alias, n) in &held {
                    let normalized = norm(alias);
                    match wanted
                        .iter()
                        .find(|(_, wanted_norm)| wanted_norm == &normalized)
                    {
                        None => {
                            db(tx.execute("DELETE FROM person_aliases WHERE id = ?1", [alias_id]))?;
                            log.push(logged(
                                "person_aliases",
                                alias_id,
                                vec![
                                    ("person_id", json!(target), Value::Null),
                                    ("alias", json!(alias), Value::Null),
                                    ("alias_norm", json!(n), Value::Null),
                                ],
                            ));
                        }
                        Some((spelling, wanted_norm)) if spelling != alias || n != wanted_norm => {
                            let mut changes = Vec::new();
                            if spelling != alias {
                                changes.push(("alias", json!(alias), json!(spelling)));
                            }
                            if n != wanted_norm {
                                changes.push(("alias_norm", json!(n), json!(wanted_norm)));
                            }
                            db(tx.execute(
                                "UPDATE person_aliases SET alias = ?1, alias_norm = ?2 WHERE id = ?3",
                                params![spelling, wanted_norm, alias_id],
                            ))?;
                            log.push(logged("person_aliases", alias_id, changes));
                        }
                        Some(_) => {}
                    }
                }
                for (spelling, n) in wanted
                    .iter()
                    .filter(|(_, n)| !held.iter().any(|h| norm(&h.1) == *n))
                {
                    let alias_id = new_id("pal");
                    db(tx.execute(
                        "INSERT INTO person_aliases (id, person_id, alias, alias_norm) VALUES (?1, ?2, ?3, ?4)",
                        params![alias_id, target, spelling, n],
                    ))?;
                    log.push(logged(
                        "person_aliases",
                        &alias_id,
                        vec![
                            ("person_id", Value::Null, json!(target)),
                            ("alias", Value::Null, json!(spelling)),
                            ("alias_norm", Value::Null, json!(n)),
                        ],
                    ));
                }
            }
            Ok(((), log))
        })?;
        // @cpt-end:cpt-noter-flow-core-people-edit:p1:inst-edit-commit
        // @cpt-begin:cpt-noter-flow-core-people-edit:p1:inst-edit-return
        self.publish_person(&id)?;
        let person = self.person_row(&id)?.ok_or_else(not_found)?;
        Ok(PersonMutation {
            person,
            change_id: done.change_ids[0].clone(),
        })
        // @cpt-end:cpt-noter-flow-core-people-edit:p1:inst-edit-return
    }

    // @cpt-dod:cpt-noter-dod-core-people-identity:p4
    // @cpt-flow:cpt-noter-flow-core-people-merge-delete:p1
    pub(crate) fn merge_people(
        &self,
        ctx: &CommandCtx,
        args: PeopleMergeArgs,
    ) -> Result<PersonMutation, CoreError> {
        self.ready()?;
        // @cpt-begin:cpt-noter-flow-core-people-merge-delete:p1:inst-identity-merge
        let (source, target) = (
            args.source.as_str().to_string(),
            args.target.as_str().to_string(),
        );
        if source == target {
            return Err(invalid("target", ValidationRule::OutOfRange));
        }
        // @cpt-end:cpt-noter-flow-core-people-merge-delete:p1:inst-identity-merge
        // @cpt-begin:cpt-noter-flow-core-people-merge-delete:p1:inst-identity-merged
        let meta = self.change_meta(ctx, "Merged people".into(), "people_merge");
        let done = self
            .store()
            .write_with(meta, move |tx| merge_tx(tx, &source, &target))?;
        // @cpt-begin:cpt-noter-algo-core-people-merge:p1:inst-merge-return
        let (touched, removed, kept) = done.value;
        self.publish_person(&removed)?;
        self.publish_person(&kept)?;
        self.publish_moved(&touched);
        let person = self.person_row(&kept)?.ok_or_else(not_found)?;
        Ok(PersonMutation {
            person,
            change_id: done.change_ids[0].clone(),
        })
        // @cpt-end:cpt-noter-algo-core-people-merge:p1:inst-merge-return
        // @cpt-end:cpt-noter-flow-core-people-merge-delete:p1:inst-identity-merged
    }

    pub(crate) fn delete_person(
        &self,
        ctx: &CommandCtx,
        args: PersonIdArgs,
    ) -> Result<DeleteResult, CoreError> {
        self.ready()?;
        // @cpt-begin:cpt-noter-flow-core-people-merge-delete:p1:inst-identity-delete
        let id = args.person_id.as_str().to_string();
        let mut meta = self.change_meta(ctx, "Deleted a person".into(), "person_delete");
        // @cpt-end:cpt-noter-flow-core-people-merge-delete:p1:inst-identity-delete
        // @cpt-begin:cpt-noter-flow-core-people-merge-delete:p1:inst-identity-remove
        // Never undoable, and the change row carries no name, profile or link.
        meta.undoable = false;
        let target = id.clone();
        let done = self.store().write_with(meta, move |tx| {
            if stored(tx, &target)?.is_you {
                return Err(invalid("person_id", ValidationRule::OutOfRange));
            }
            let mut touched = Touched::default();
            touched.calls.extend(
                rows(tx, "SELECT DISTINCT call_id FROM speakers WHERE person_id = ?1", &target)?
                    .iter()
                    .map(|r| text(&r[0])),
            );
            touched.items = rows(tx, "SELECT id FROM items WHERE owner_person_id = ?1", &target)?
                .iter()
                .map(|r| text(&r[0]))
                .collect();
            for sql in [
                "DELETE FROM voice_profiles WHERE person_id = ?1",
                "DELETE FROM person_aliases WHERE person_id = ?1",
                "DELETE FROM call_participants WHERE person_id = ?1",
                "UPDATE speakers SET person_id = NULL, name = NULL, named_by = NULL WHERE person_id = ?1",
                "UPDATE items SET owner_person_id = NULL, rev = rev + 1 WHERE owner_person_id = ?1",
                "DELETE FROM people WHERE id = ?1",
            ] {
                db(tx.execute(sql, [&target]))?;
            }
            let tombstone = Logged {
                entity_type: "person",
                entity_id: target.clone(),
                field: None,
                before: None,
                after: None,
                delta: None,
            };
            Ok((touched, vec![tombstone]))
        })?;
        // @cpt-end:cpt-noter-flow-core-people-merge-delete:p1:inst-identity-remove
        // @cpt-begin:cpt-noter-flow-core-people-merge-delete:p1:inst-identity-publish
        // shortcut: no matching cache exists before slice 2; its in-flight matches recheck the
        // person row before they commit (inst-match-recheck).
        self.publish_person(&id)?;
        self.publish_moved(&done.value);
        // @cpt-end:cpt-noter-flow-core-people-merge-delete:p1:inst-identity-publish
        // @cpt-begin:cpt-noter-flow-core-people-merge-delete:p1:inst-identity-return
        Ok(DeleteResult { deleted: 1 })
        // @cpt-end:cpt-noter-flow-core-people-merge-delete:p1:inst-identity-return
    }
}

type Merged = (Touched, String, String);

// @cpt-algo:cpt-noter-algo-core-people-merge:p1
/// Runs inside the writer transaction: every move is logged as a reversible delta, so the batch
/// undoes through the history service; any failure rolls the whole transaction back.
fn merge_tx(
    tx: &Transaction<'_>,
    source: &str,
    target: &str,
) -> Result<(Merged, Vec<Logged>), CoreError> {
    // @cpt-begin:cpt-noter-algo-core-people-merge:p1:inst-merge-read
    let (src, tgt) = (stored(tx, source)?, stored(tx, target)?);
    // The single You is never the one removed.
    if src.is_you {
        return Err(invalid("source", ValidationRule::OutOfRange));
    }
    let mut log: Vec<Logged> = vec![];
    let mut touched = Touched::default();
    // @cpt-end:cpt-noter-algo-core-people-merge:p1:inst-merge-read
    // @cpt-begin:cpt-noter-algo-core-people-merge:p1:inst-merge-links
    for row in rows(
        tx,
        "SELECT id, call_id, name FROM speakers WHERE person_id = ?1",
        source,
    )? {
        let id = text(&row[0]);
        db(tx.execute(
            "UPDATE speakers SET person_id = ?1, name = ?2 WHERE id = ?3",
            params![target, tgt.display_name, id],
        ))?;
        touched.calls.insert(text(&row[1]));
        log.push(logged(
            "speaker",
            &id,
            vec![
                ("person_id", json!(source), json!(target)),
                ("name", row[2].clone(), json!(tgt.display_name)),
            ],
        ));
    }
    let participation =
        "SELECT id, call_id, talk_time_ms FROM call_participants WHERE person_id = ?1";
    for row in rows(tx, participation, source)? {
        let (id, call) = (text(&row[0]), text(&row[1]));
        let twin: bool = db(tx.query_row(
            "SELECT EXISTS (SELECT 1 FROM call_participants WHERE call_id = ?1 AND person_id = ?2)",
            params![call, target],
            |r| r.get(0),
        ))?;
        if twin {
            db(tx.execute("DELETE FROM call_participants WHERE id = ?1", [&id]))?;
            log.push(logged(
                "call_participants",
                &id,
                vec![
                    ("call_id", json!(call), Value::Null),
                    ("person_id", json!(source), Value::Null),
                    ("talk_time_ms", row[2].clone(), Value::Null),
                ],
            ));
        } else {
            db(tx.execute(
                "UPDATE call_participants SET person_id = ?1 WHERE id = ?2",
                params![target, id],
            ))?;
            log.push(logged(
                "call_participants",
                &id,
                vec![("person_id", json!(source), json!(target))],
            ));
        }
    }
    for row in rows(
        tx,
        "SELECT id, rev FROM items WHERE owner_person_id = ?1",
        source,
    )? {
        let (id, rev) = (text(&row[0]), row[1].as_i64().unwrap_or_default());
        db(tx.execute(
            "UPDATE items SET owner_person_id = ?1, rev = rev + 1 WHERE id = ?2",
            params![target, id],
        ))?;
        log.push(logged(
            "item",
            &id,
            vec![
                ("owner_person_id", json!(source), json!(target)),
                ("rev", json!(rev), json!(rev + 1)),
            ],
        ));
        touched.items.push(id);
    }
    // @cpt-end:cpt-noter-algo-core-people-merge:p1:inst-merge-links
    // @cpt-begin:cpt-noter-algo-core-people-merge:p1:inst-merge-profile
    // Centroid rows move as they are: the blobs are never read, decrypted or logged.
    for row in rows(
        tx,
        "SELECT id FROM voice_profiles WHERE person_id = ?1",
        source,
    )? {
        let id = text(&row[0]);
        db(tx.execute(
            "UPDATE voice_profiles SET person_id = ?1 WHERE id = ?2",
            params![target, id],
        ))?;
        log.push(logged(
            "voice_profiles",
            &id,
            vec![("person_id", json!(source), json!(target))],
        ));
    }
    let optin = tgt.optin || src.optin;
    let optin_date = if tgt.optin {
        tgt.optin_date
    } else {
        src.optin_date.filter(|_| src.optin)
    };
    // @cpt-end:cpt-noter-algo-core-people-merge:p1:inst-merge-profile
    // @cpt-begin:cpt-noter-algo-core-people-merge:p1:inst-merge-aliases
    let mut seen: BTreeSet<String> = rows(
        tx,
        "SELECT alias FROM person_aliases WHERE person_id = ?1",
        target,
    )?
    .iter()
    .map(|r| norm(&text(&r[0])))
    .collect();
    seen.insert(norm(&tgt.display_name));
    let source_aliases =
        "SELECT id, alias, alias_norm FROM person_aliases WHERE person_id = ?1 ORDER BY rowid";
    for row in rows(tx, source_aliases, source)? {
        let (id, alias, n) = (text(&row[0]), text(&row[1]), text(&row[2]));
        let normalized = norm(&alias);
        if seen.insert(normalized.clone()) {
            let mut changes = vec![("person_id", json!(source), json!(target))];
            if n != normalized {
                changes.push(("alias_norm", json!(n), json!(normalized)));
            }
            db(tx.execute(
                "UPDATE person_aliases SET person_id = ?1, alias_norm = ?2 WHERE id = ?3",
                params![target, normalized, id],
            ))?;
            log.push(logged("person_aliases", &id, changes));
        } else {
            db(tx.execute("DELETE FROM person_aliases WHERE id = ?1", [&id]))?;
            log.push(logged(
                "person_aliases",
                &id,
                vec![
                    ("person_id", json!(source), Value::Null),
                    ("alias", json!(alias), Value::Null),
                    ("alias_norm", json!(n), Value::Null),
                ],
            ));
        }
    }
    let name_norm = norm(&src.display_name);
    if seen.insert(name_norm.clone()) {
        let id = new_id("pal");
        db(tx.execute(
            "INSERT INTO person_aliases (id, person_id, alias, alias_norm) VALUES (?1, ?2, ?3, ?4)",
            params![id, target, src.display_name, name_norm],
        ))?;
        log.push(logged(
            "person_aliases",
            &id,
            vec![
                ("person_id", Value::Null, json!(target)),
                ("alias", Value::Null, json!(src.display_name)),
                ("alias_norm", Value::Null, json!(name_norm)),
            ],
        ));
    }
    // @cpt-end:cpt-noter-algo-core-people-merge:p1:inst-merge-aliases
    // @cpt-begin:cpt-noter-algo-core-people-merge:p1:inst-merge-batch
    db(tx.execute(
        "UPDATE people SET rev = rev + 1, voice_profile_optin = ?1, optin_date = ?2 WHERE id = ?3",
        params![optin, optin_date, target],
    ))?;
    let mut pairs = vec![("rev", json!(tgt.rev), json!(tgt.rev + 1))];
    if optin != tgt.optin {
        pairs.push(("voice_profile_optin", json!(tgt.optin), json!(optin)));
        pairs.push(("optin_date", json!(tgt.optin_date), json!(optin_date)));
    }
    log.push(logged("person", target, pairs));
    db(tx.execute("DELETE FROM people WHERE id = ?1", [source]))?;
    // The removed row, column by column: undo puts it back as it was.
    let mut gone: Pairs<'_> = vec![
        ("rev", json!(src.rev), Value::Null),
        ("display_name", json!(src.display_name), Value::Null),
        ("short_name", json!(src.short_name), Value::Null),
        ("is_you", json!(0), Value::Null),
        (
            "voice_profile_optin",
            json!(i32::from(src.optin)),
            Value::Null,
        ),
    ];
    for (column, value) in [
        ("email", &src.email),
        ("role", &src.role),
        ("org", &src.org),
        ("notes", &src.notes),
    ] {
        if value.is_some() {
            gone.push((column, json!(value), Value::Null));
        }
    }
    if let Some(date) = src.optin_date {
        gone.push(("optin_date", json!(date), Value::Null));
    }
    log.push(logged("person", source, gone));
    // @cpt-end:cpt-noter-algo-core-people-merge:p1:inst-merge-batch
    // @cpt-begin:cpt-noter-algo-core-people-merge:p1:inst-merge-commit
    // The transaction commits when `write_with` returns; an error above drops it, so nothing moved.
    Ok(((touched, source.to_string(), target.to_string()), log))
    // @cpt-end:cpt-noter-algo-core-people-merge:p1:inst-merge-commit
}
