//! Topic threads (`cpt-noter-flow-core-retrieval-ask-topics`) and the attachment of new items
//! to topics (`cpt-noter-algo-core-retrieval-ask-attach-topic`). A topic's centroid is derived
//! from its items' vectors in `item_vec`: it is written beside the logged changes, never logged
//! itself, and refreshed wherever links move (a merge, an attachment, an undo).

use std::collections::{BTreeMap, BTreeSet};

use noter_db::rusqlite::types::FromSql;
use noter_db::rusqlite::{params, Connection, OptionalExtension, Transaction};
use noter_db::{Logged, Mutation};
use noter_protocol::error::ValidationRule;
use noter_protocol::model::TopicRow;
use noter_protocol::*;
use serde_json::{json, Map, Value};

use crate::normalize::normalize;
use crate::retrieve::invalid;
use crate::DIMS;

/// An item joins its nearest topic at this cosine similarity or above (PRD).
pub const ATTACH_SIMILARITY: f32 = 0.8;
/// Topics this similar are suggested for a merge, never merged automatically (PRD).
pub const SUGGEST_SIMILARITY: f32 = 0.9;
/// The suppression kind Keep Separate stores.
const KEEP_SEPARATE: &str = "topic_merge";
/// A locally named topic keeps this many words of the item's first clause.
const NAME_WORDS: usize = 6;

type Db<T> = noter_db::rusqlite::Result<T>;

fn internal(e: noter_db::rusqlite::Error) -> CoreError {
    CoreError::new(ErrorCode::Internal, e.to_string())
}

fn not_found() -> CoreError {
    CoreError::new(ErrorCode::NotFound, "no such topic")
}

fn blob(v: &[f32]) -> Vec<u8> {
    v.iter().flat_map(|x| x.to_le_bytes()).collect()
}

fn floats(b: &[u8]) -> Vec<f32> {
    b.chunks_exact(4)
        .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
        .collect()
}

fn cosine(a: &[f32], b: &[f32]) -> f32 {
    let dot: f32 = a.iter().zip(b).map(|(x, y)| x * y).sum();
    let norm = |v: &[f32]| v.iter().map(|x| x * x).sum::<f32>().sqrt();
    let n = norm(a) * norm(b);
    if n > 0.0 {
        dot / n
    } else {
        0.0
    }
}

/// The canonical unordered pair, as `suppressions.key` holds it.
fn pair(a: &str, b: &str) -> (String, String) {
    if a <= b {
        (a.to_owned(), b.to_owned())
    } else {
        (b.to_owned(), a.to_owned())
    }
}

fn pair_key(a: &str, b: &str) -> String {
    let (a, b) = pair(a, b);
    format!("{a}|{b}")
}

/// Several columns' before and after, as the history service replays them.
fn logged(entity_type: &'static str, id: &str, pairs: Vec<(&str, Value, Value)>) -> Logged {
    let columns: Map<String, Value> = pairs
        .into_iter()
        .map(|(column, before, after)| (column.to_owned(), json!([before, after])))
        .collect();
    Logged {
        entity_type,
        entity_id: id.to_owned(),
        field: None,
        before: None,
        after: None,
        delta: Some(Value::Object(columns)),
    }
}

/// Every centroid, and the Keep Separate pairs: what merge suggestions come from.
struct Neighbours {
    centroids: Vec<(String, String, Vec<f32>)>,
    kept: BTreeSet<String>,
}

impl Neighbours {
    fn read(conn: &Connection) -> Db<Self> {
        let centroids = conn
            .prepare("SELECT id, name, centroid FROM topics WHERE centroid IS NOT NULL")?
            .query_map([], |r| {
                Ok((r.get(0)?, r.get(1)?, floats(&r.get::<_, Vec<u8>>(2)?)))
            })?
            .collect::<Db<_>>()?;
        let kept = conn
            .prepare("SELECT key FROM suppressions WHERE kind = ?1")?
            .query_map([KEEP_SEPARATE], |r| r.get(0))?
            .collect::<Db<_>>()?;
        Ok(Neighbours { centroids, kept })
    }

    /// The most similar other topic at `SUGGEST_SIMILARITY` or above that was not kept apart.
    fn suggestion(&self, id: &str) -> Option<(String, String)> {
        let (_, _, own) = self.centroids.iter().find(|(t, ..)| t == id)?;
        self.centroids
            .iter()
            .filter(|(t, ..)| t != id && !self.kept.contains(&pair_key(id, t)))
            .map(|(t, name, c)| (cosine(own, c), t, name))
            .filter(|(s, ..)| *s >= SUGGEST_SIMILARITY)
            .max_by(|a, b| a.0.total_cmp(&b.0))
            .map(|(_, t, name)| (t.clone(), name.clone()))
    }

    fn set(&mut self, id: &str, name: &str, centroid: Option<Vec<f32>>) {
        self.centroids.retain(|(t, ..)| t != id);
        if let Some(c) = centroid {
            self.centroids.push((id.to_owned(), name.to_owned(), c));
        }
    }
}

/// A topic as lists show it: its aliases, the counts of its items (rejected ones count
/// nowhere) and its merge suggestion.
fn row(conn: &Connection, id: &str, near: &Neighbours) -> Db<Option<TopicRow>> {
    conn.query_row(
        "SELECT t.id, t.rev, t.name, t.last_seen,
                (SELECT group_concat(alias, char(31)) FROM
                   (SELECT alias FROM topic_aliases WHERE topic_id = t.id ORDER BY alias)),
                (SELECT count(DISTINCT call_id) FROM items WHERE topic_id = t.id
                   AND review_state != 'rejected'),
                (SELECT count(*) FROM items WHERE topic_id = t.id AND kind = 'decision'
                   AND review_state != 'rejected'),
                (SELECT count(*) FROM items WHERE topic_id = t.id AND status = 'open'
                   AND review_state != 'rejected')
         FROM topics t WHERE t.id = ?1",
        params![id],
        |r| {
            let aliases: Option<String> = r.get(4)?;
            Ok(TopicRow {
                id: TopicId::new(r.get::<_, String>(0)?),
                rev: Rev(r.get(1)?),
                name: r.get(2)?,
                last_seen: TimestampMs(r.get(3)?),
                aliases: aliases
                    .map(|a| a.split('\u{1f}').map(String::from).collect())
                    .unwrap_or_default(),
                calls: r.get(5)?,
                decisions: r.get(6)?,
                open_items: r.get(7)?,
                merge_suggestion: near.suggestion(id).map(|(id, name)| TopicChip {
                    id: TopicId::new(id),
                    name,
                }),
            })
        },
    )
    .optional()
}

// @cpt-flow:cpt-noter-flow-core-retrieval-ask-topics:p1
// @cpt-dod:cpt-noter-dod-core-retrieval-ask-topics:p1
/// `topics_list`: every topic, most recently seen first.
pub fn topic_list(conn: &Connection) -> Db<Vec<TopicRow>> {
    // @cpt-begin:cpt-noter-flow-core-retrieval-ask-topics:p1:inst-topic-read
    let near = Neighbours::read(conn)?;
    let ids: Vec<String> = conn
        .prepare("SELECT id FROM topics ORDER BY last_seen DESC, id")?
        .query_map([], |r| r.get(0))?
        .collect::<Db<_>>()?;
    let mut out = Vec::with_capacity(ids.len());
    for id in ids {
        out.extend(row(conn, &id, &near)?);
    }
    Ok(out)
    // @cpt-end:cpt-noter-flow-core-retrieval-ask-topics:p1:inst-topic-read
}

/// One topic as lists show it, or `None` when there is no such topic.
pub fn topic_row(conn: &Connection, id: &str) -> Db<Option<TopicRow>> {
    row(conn, id, &Neighbours::read(conn)?)
}

/// The topic's thread: its items' ids, newest call first and in their order within a call;
/// none once no call holds one.
pub fn thread_items(conn: &Connection, id: &str) -> Db<Vec<String>> {
    // @cpt-begin:cpt-noter-flow-core-retrieval-ask-topics:p1:inst-topic-read
    conn.prepare(
        "SELECT i.id FROM items i JOIN calls c ON c.id = i.call_id
         WHERE i.topic_id = ?1 AND i.review_state != 'rejected'
         ORDER BY c.started_at DESC, c.id, i.rowid",
    )?
    .query_map([id], |r| r.get(0))?
    .collect()
    // @cpt-end:cpt-noter-flow-core-retrieval-ask-topics:p1:inst-topic-read
}

/// `topic_rename`: a non-empty name, written with its change row only at the revision the
/// caller saw (`conflict { current_rev }` otherwise).
pub fn rename(id: &TopicId, rev: Rev, name: &str) -> Result<Mutation, CoreError> {
    // @cpt-begin:cpt-noter-flow-core-retrieval-ask-topics:p1:inst-topic-rename
    let name = name.trim();
    if name.is_empty() {
        return Err(invalid("name", ValidationRule::Required));
    }
    Ok(Mutation {
        entity_type: "topic",
        table: "topics",
        id: id.as_str().to_owned(),
        base_rev: Some(rev),
        bump_rev: true,
        values: vec![("name", json!(name))],
    })
    // @cpt-end:cpt-noter-flow-core-retrieval-ask-topics:p1:inst-topic-rename
}

struct Stored {
    rev: i64,
    name: String,
    first_seen: i64,
    last_seen: i64,
}

fn stored(tx: &Transaction<'_>, id: &str) -> Result<Stored, CoreError> {
    tx.query_row(
        "SELECT rev, name, first_seen, last_seen FROM topics WHERE id = ?1",
        [id],
        |r| {
            Ok(Stored {
                rev: r.get(0)?,
                name: r.get(1)?,
                first_seen: r.get(2)?,
                last_seen: r.get(3)?,
            })
        },
    )
    .optional()
    .map_err(internal)?
    .ok_or_else(not_found)
}

/// `(id, value)` rows of a one-argument query.
fn rows<T: FromSql>(
    tx: &Transaction<'_>,
    sql: &str,
    arg: &str,
) -> Result<Vec<(String, T)>, CoreError> {
    tx.prepare(sql)
        .and_then(|mut s| {
            s.query_map([arg], |r| Ok((r.get(0)?, r.get(1)?)))?
                .collect()
        })
        .map_err(internal)
}

/// `topics_merge`, inside the writer transaction: the source's item links, name and aliases
/// move to the target, the target spans both date ranges, and the source row goes. Each step
/// is logged with its before-values, so the batch undoes whole; answers the moved items.
pub fn merge(
    tx: &Transaction<'_>,
    source: &str,
    target: &str,
) -> Result<(Vec<String>, Vec<Logged>), CoreError> {
    // @cpt-begin:cpt-noter-flow-core-retrieval-ask-topics:p1:inst-topic-merge
    if source == target {
        return Err(invalid("target", ValidationRule::OutOfRange));
    }
    let (src, tgt) = (stored(tx, source)?, stored(tx, target)?);
    let mut log = vec![];
    let moved: Vec<(String, i64)> = rows(
        tx,
        "SELECT id, rev FROM items WHERE topic_id = ?1 ORDER BY rowid",
        source,
    )?;
    for (id, rev) in &moved {
        tx.execute(
            "UPDATE items SET topic_id = ?1, rev = rev + 1 WHERE id = ?2",
            params![target, id],
        )
        .map_err(internal)?;
        log.push(logged(
            "item",
            id,
            vec![
                ("topic_id", json!(source), json!(target)),
                ("rev", json!(rev), json!(rev + 1)),
            ],
        ));
    }
    // Names stay findable once each: the target's own, then the source's aliases and name.
    let own: Vec<(String, String)> = rows(
        tx,
        "SELECT id, alias FROM topic_aliases WHERE topic_id = ?1",
        target,
    )?;
    let mut seen: BTreeSet<String> = own.iter().map(|(_, a)| normalize(a)).collect();
    seen.insert(normalize(&tgt.name));
    let aliases: Vec<(String, String)> = rows(
        tx,
        "SELECT id, alias FROM topic_aliases WHERE topic_id = ?1 ORDER BY rowid",
        source,
    )?;
    for (id, alias) in aliases {
        if seen.insert(normalize(&alias)) {
            tx.execute(
                "UPDATE topic_aliases SET topic_id = ?1 WHERE id = ?2",
                params![target, id],
            )
            .map_err(internal)?;
            log.push(logged(
                "topic_aliases",
                &id,
                vec![("topic_id", json!(source), json!(target))],
            ));
        } else {
            tx.execute("DELETE FROM topic_aliases WHERE id = ?1", [&id])
                .map_err(internal)?;
            log.push(logged(
                "topic_aliases",
                &id,
                vec![
                    ("topic_id", json!(source), Value::Null),
                    ("alias", json!(alias), Value::Null),
                ],
            ));
        }
    }
    if seen.insert(normalize(&src.name)) {
        let id = format!("tal_{}", ulid::Ulid::generate().to_string().to_lowercase());
        tx.execute(
            "INSERT INTO topic_aliases (id, topic_id, alias) VALUES (?1, ?2, ?3)",
            params![id, target, src.name],
        )
        .map_err(internal)?;
        log.push(logged(
            "topic_aliases",
            &id,
            vec![
                ("topic_id", Value::Null, json!(target)),
                ("alias", Value::Null, json!(src.name)),
            ],
        ));
    }
    let first = tgt.first_seen.min(src.first_seen);
    let last = tgt.last_seen.max(src.last_seen);
    tx.execute(
        "UPDATE topics SET rev = rev + 1, first_seen = ?1, last_seen = ?2 WHERE id = ?3",
        params![first, last, target],
    )
    .map_err(internal)?;
    log.push(logged(
        "topic",
        target,
        vec![
            ("rev", json!(tgt.rev), json!(tgt.rev + 1)),
            ("first_seen", json!(tgt.first_seen), json!(first)),
            ("last_seen", json!(tgt.last_seen), json!(last)),
        ],
    ));
    refresh(tx, target).map_err(internal)?;
    tx.execute("DELETE FROM topics WHERE id = ?1", [source])
        .map_err(internal)?;
    // The removed row, column by column: undo puts it back (its centroid is refreshed then).
    log.push(logged(
        "topic",
        source,
        vec![
            ("rev", json!(src.rev), Value::Null),
            ("name", json!(src.name), Value::Null),
            ("first_seen", json!(src.first_seen), Value::Null),
            ("last_seen", json!(src.last_seen), Value::Null),
        ],
    ));
    Ok((moved.into_iter().map(|(id, _)| id).collect(), log))
    // @cpt-end:cpt-noter-flow-core-retrieval-ask-topics:p1:inst-topic-merge
}

/// `topics_keep_separate`, inside the writer transaction: the canonical unordered pair as a
/// `topic_merge` suppression; storing it again changes nothing.
pub fn keep_separate(
    tx: &Transaction<'_>,
    a: &str,
    b: &str,
    now: TimestampMs,
) -> Result<((), Vec<Logged>), CoreError> {
    // @cpt-begin:cpt-noter-flow-core-retrieval-ask-topics:p1:inst-topic-separate
    if a == b {
        return Err(invalid("b", ValidationRule::OutOfRange));
    }
    stored(tx, a)?;
    stored(tx, b)?;
    let key = pair_key(a, b);
    tx.execute(
        "INSERT OR IGNORE INTO suppressions (kind, key, created_at) VALUES (?1, ?2, ?3)",
        params![KEEP_SEPARATE, key, now.0],
    )
    .map_err(internal)?;
    let row = Logged {
        entity_type: "suppression",
        entity_id: key,
        field: Some("kind".into()),
        before: None,
        after: Some(KEEP_SEPARATE.into()),
        delta: None,
    };
    Ok(((), vec![row]))
    // @cpt-end:cpt-noter-flow-core-retrieval-ask-topics:p1:inst-topic-separate
}

/// The topic's centroid again from its items' vectors (none left: no centroid); answers it.
fn refresh(conn: &Connection, id: &str) -> Db<Option<Vec<f32>>> {
    let vectors: Vec<Vec<u8>> = conn
        .prepare(
            "SELECT v.embedding FROM items i JOIN item_vec v ON v.item_id = i.id
             WHERE i.topic_id = ?1",
        )?
        .query_map([id], |r| r.get(0))?
        .collect::<Db<_>>()?;
    let mut sum = vec![0f32; DIMS];
    for v in &vectors {
        for (s, x) in sum.iter_mut().zip(floats(v)) {
            *s += x;
        }
    }
    let n = vectors.len() as f32;
    let centroid: Option<Vec<f32>> =
        (!vectors.is_empty()).then(|| sum.iter().map(|s| s / n).collect());
    conn.execute(
        "UPDATE topics SET centroid = ?1 WHERE id = ?2",
        params![centroid.as_deref().map(blob), id],
    )?;
    Ok(centroid)
}

/// The centroids of these topics again from their items' vectors, after an undo moved links
/// back; a topic that is gone is skipped.
pub fn refresh_centroids(conn: &Connection, ids: &[String]) -> Db<()> {
    ids.iter().try_for_each(|id| refresh(conn, id).map(drop))
}

/// A new topic's local name: the item's first clause, at most six words.
pub fn topic_name(text: &str) -> String {
    let clause = text
        .split(['.', ',', ';', ':', '!', '?', '—', '–', '(', '\n'])
        .find(|c| c.chars().any(char::is_alphanumeric))
        .unwrap_or_default();
    let name: Vec<&str> = clause.split_whitespace().take(NAME_WORDS).collect();
    if name.is_empty() {
        "Untitled topic".into()
    } else {
        name.join(" ")
    }
}

/// A new item to attach, with its local embedding.
#[derive(Debug, Clone)]
pub struct NewItem {
    pub id: String,
    pub text: String,
    /// The post-call output's `topic_hint`, if the model gave one.
    pub hint: Option<String>,
    pub vector: Vec<f32>,
}

/// What an attachment changed: the topics it touched, the items it linked, and the merge
/// suggestions among those topics as canonical pairs.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct Attached {
    pub topics: Vec<String>,
    pub items: Vec<String>,
    pub suggestions: Vec<(String, String)>,
}

// @cpt-algo:cpt-noter-algo-core-retrieval-ask-attach-topic:p1
/// Attaches the call's new items, inside the writer transaction: each joins its nearest topic
/// at `ATTACH_SIMILARITY` or above, else starts one named from its hint or its first clause.
/// Items gone or already attached are left alone. Writes each item's vector to `item_vec`.
pub fn attach_topics(
    tx: &Transaction<'_>,
    call_id: &str,
    items: &[NewItem],
) -> Result<(Attached, Vec<Logged>), CoreError> {
    let started: i64 = tx
        .query_row(
            "SELECT started_at FROM calls WHERE id = ?1",
            [call_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(internal)?
        .ok_or_else(|| CoreError::new(ErrorCode::NotFound, "no such call"))?;
    let mut near = Neighbours::read(tx).map_err(internal)?;
    // The topics this call touched: name, seen dates, and the stored row of an existing one.
    let mut touched: BTreeMap<String, (String, i64, i64, Option<Stored>)> = BTreeMap::new();
    let mut out = Attached::default();
    let mut log = vec![];
    for item in items {
        let unattached: bool = tx
            .query_row(
                "SELECT EXISTS (SELECT 1 FROM items WHERE id = ?1 AND call_id = ?2
                                AND topic_id IS NULL)",
                params![item.id, call_id],
                |r| r.get(0),
            )
            .map_err(internal)?;
        if !unattached {
            continue;
        }
        // vec0 has no upsert: a vector the rebuild wrote meanwhile is replaced.
        tx.execute("DELETE FROM item_vec WHERE item_id = ?1", [&item.id])
            .map_err(internal)?;
        tx.execute(
            "INSERT INTO item_vec (item_id, embedding, call_id, started_at) VALUES (?1, ?2, ?3, ?4)",
            params![item.id, blob(&item.vector), call_id, started],
        )
        .map_err(internal)?;
        // @cpt-begin:cpt-noter-algo-core-retrieval-ask-attach-topic:p1:inst-attach-nearest
        let nearest = near
            .centroids
            .iter()
            .map(|(id, _, c)| (cosine(&item.vector, c), id))
            .max_by(|a, b| a.0.total_cmp(&b.0));
        // @cpt-end:cpt-noter-algo-core-retrieval-ask-attach-topic:p1:inst-attach-nearest
        let topic = match nearest {
            // @cpt-begin:cpt-noter-algo-core-retrieval-ask-attach-topic:p1:inst-attach-existing
            Some((s, id)) if s >= ATTACH_SIMILARITY => id.clone(),
            // @cpt-end:cpt-noter-algo-core-retrieval-ask-attach-topic:p1:inst-attach-existing
            // @cpt-begin:cpt-noter-algo-core-retrieval-ask-attach-topic:p1:inst-attach-new
            // Named locally (TL-37): the item's hint, else its first clause; no model run.
            _ => {
                let name = item
                    .hint
                    .as_deref()
                    .map(str::trim)
                    .filter(|h| !h.is_empty())
                    .map_or_else(|| topic_name(&item.text), String::from);
                let id = format!("top_{}", ulid::Ulid::generate().to_string().to_lowercase());
                tx.execute(
                    "INSERT INTO topics (id, rev, name, first_seen, last_seen)
                     VALUES (?1, 1, ?2, ?3, ?3)",
                    params![id, name, started],
                )
                .map_err(internal)?;
                log.push(logged(
                    "topic",
                    &id,
                    vec![
                        ("rev", Value::Null, json!(1)),
                        ("name", Value::Null, json!(name)),
                        ("first_seen", Value::Null, json!(started)),
                        ("last_seen", Value::Null, json!(started)),
                    ],
                ));
                touched.insert(id.clone(), (name, started, started, None));
                id
            } // @cpt-end:cpt-noter-algo-core-retrieval-ask-attach-topic:p1:inst-attach-new
        };
        // @cpt-begin:cpt-noter-algo-core-retrieval-ask-attach-topic:p1:inst-attach-commit
        // A fresh suggestion's revision stays: whoever reviews it saw it as it was written.
        tx.execute(
            "UPDATE items SET topic_id = ?1 WHERE id = ?2",
            params![topic, item.id],
        )
        .map_err(internal)?;
        log.push(Logged {
            entity_type: "item",
            entity_id: item.id.clone(),
            field: Some("topic_id".into()),
            before: None,
            after: Some(topic.clone()),
            delta: None,
        });
        if !touched.contains_key(&topic) {
            let was = stored(tx, &topic)?;
            let seen = (was.name.clone(), was.first_seen, was.last_seen, Some(was));
            touched.insert(topic.clone(), seen);
        }
        let Some(seen) = touched.get_mut(&topic) else {
            continue;
        };
        seen.1 = seen.1.min(started);
        seen.2 = seen.2.max(started);
        let centroid = refresh(tx, &topic).map_err(internal)?;
        near.set(&topic, &seen.0, centroid);
        out.items.push(item.id.clone());
        // @cpt-end:cpt-noter-algo-core-retrieval-ask-attach-topic:p1:inst-attach-commit
    }
    // @cpt-begin:cpt-noter-algo-core-retrieval-ask-attach-topic:p1:inst-attach-commit
    for (id, (_, first, last, was)) in &touched {
        let Some(was) = was else {
            continue;
        };
        if (*first, *last) == (was.first_seen, was.last_seen) {
            continue;
        }
        tx.execute(
            "UPDATE topics SET first_seen = ?1, last_seen = ?2 WHERE id = ?3",
            params![first, last, id],
        )
        .map_err(internal)?;
        log.push(logged(
            "topic",
            id,
            vec![
                ("first_seen", json!(was.first_seen), json!(first)),
                ("last_seen", json!(was.last_seen), json!(last)),
            ],
        ));
    }
    // @cpt-end:cpt-noter-algo-core-retrieval-ask-attach-topic:p1:inst-attach-commit
    // @cpt-begin:cpt-noter-algo-core-retrieval-ask-attach-topic:p1:inst-attach-suggest
    let pairs: BTreeSet<(String, String)> = touched
        .keys()
        .filter_map(|id| near.suggestion(id).map(|(other, _)| pair(id, &other)))
        .collect();
    // @cpt-end:cpt-noter-algo-core-retrieval-ask-attach-topic:p1:inst-attach-suggest
    // @cpt-begin:cpt-noter-algo-core-retrieval-ask-attach-topic:p1:inst-attach-return
    out.topics = touched.into_keys().collect();
    out.suggestions = pairs.into_iter().collect();
    Ok((out, log))
    // @cpt-end:cpt-noter-algo-core-retrieval-ask-attach-topic:p1:inst-attach-return
}
