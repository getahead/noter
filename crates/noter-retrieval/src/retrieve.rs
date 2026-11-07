//! The one retrieval function behind search, Ask, the copilot and the pre-call brief
//! (`cpt-noter-algo-core-retrieval-ask-retrieve`): normalised keyword search over the FTS5
//! shadows, local vectors over sqlite-vec, filters and privacy before fusion, RRF k = 60.

use std::collections::HashSet;

use noter_db::rusqlite::types::Value as Sql;
use noter_db::rusqlite::{params_from_iter, Connection, OptionalExtension, Row};
use noter_protocol::error::ValidationRule;
use noter_protocol::model::*;
use noter_protocol::*;

use crate::normalize::{match_expr, normalize, query_lang, terms};

/// Reciprocal rank fusion constant.
pub const RRF_K: f64 = 60.0;
/// Vector candidates fetched per wanted hit, before filters and privacy drop some.
pub const OVER_FETCH: usize = 4;
/// Cosine similarity a semantic-only hit needs.
// shortcut: one fixed floor until the golden set (owner, TL-35) tunes it; bge-m3 puts unrelated
// text near 0.4–0.6 and paraphrases above 0.8.
pub const MIN_SIMILARITY: f64 = 0.8;
const DAY_MS: i64 = 86_400_000;

/// Who will read the evidence: a cloud runtime never gets sensitive calls or sources.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Privacy {
    #[default]
    Local,
    Cloud,
}

/// What a question or a search is limited to besides the filter (Ask scope presets).
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Scope {
    pub call_id: Option<CallId>,
    pub topic_id: Option<TopicId>,
    /// Knowledge sources too; `false` = calls only.
    pub include_documents: bool,
}

/// One retrieval request.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Query {
    pub text: String,
    pub filter: CallFilter,
    pub scope: Scope,
    pub privacy: Privacy,
    /// Hits wanted per section.
    pub wanted: usize,
    /// The query's local embedding when the vector indexes are ready; `None` is keyword-only.
    pub vector: Option<Vec<f32>>,
}

/// The stored evidence a hit stands for: what an Ask citation names.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum Evidence {
    Segment(SegmentId),
    Chunk(ChunkId),
    Item(ItemId),
    Document {
        document_id: DocumentId,
        chunk_id: ChunkId,
    },
}

/// One ranked piece of evidence, with the raw text as stored.
#[derive(Debug, Clone, PartialEq)]
pub struct Hit {
    pub evidence: Evidence,
    pub target: HitTarget,
    pub title: String,
    /// The evidence text as stored (a segment, an item, a chunk without its call header).
    pub text: String,
    pub lang: Option<Lang>,
    pub call: Option<CallRef>,
    pub provenance: Provenance,
    /// A literal keyword match: strong evidence.
    pub keyword: bool,
    /// A vector match.
    pub semantic: bool,
    /// Fused RRF score.
    pub score: f64,
}

impl Hit {
    pub fn strength(&self) -> MatchStrength {
        if self.keyword {
            MatchStrength::Strong
        } else {
            MatchStrength::Weak
        }
    }

    /// The call span this hit covers, for deduplication.
    fn span(&self) -> Option<(&CallId, u32, u32)> {
        match &self.target {
            HitTarget::Segment { span } => Some((&span.call_id, span.t0_ms.0, span.t1_ms.0)),
            _ => None,
        }
    }
}

/// What the document side asks of knowledge sources (`noter_knowledge::permitted_chunks`, 2.24).
#[derive(Debug, Clone, PartialEq)]
pub struct DocQuery<'a> {
    /// The FTS5 expression over normalised text, terms anchored at word starts.
    pub fts: &'a str,
    pub vector: Option<&'a [f32]>,
    pub privacy: Privacy,
    /// Sources scoped to call types only count where the question is about those types.
    pub call_types: &'a [CallTypeId],
    /// Candidates wanted from each ranking.
    pub fetch: usize,
}

/// Permitted document candidates, each ranking best first; already filtered by source privacy
/// and scope, with the sensitive sources the filter skipped.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct DocHits {
    pub keyword: Vec<Hit>,
    pub semantic: Vec<Hit>,
    pub sensitive_skipped: u32,
}

/// The seam knowledge sources fill (2.24); until then there are no documents.
pub trait DocumentSource: Send + Sync {
    fn permitted_chunks(
        &self,
        conn: &Connection,
        q: &DocQuery<'_>,
    ) -> noter_db::rusqlite::Result<DocHits>;
}

pub struct NoDocuments;

impl DocumentSource for NoDocuments {
    fn permitted_chunks(
        &self,
        _conn: &Connection,
        _q: &DocQuery<'_>,
    ) -> noter_db::rusqlite::Result<DocHits> {
        Ok(DocHits::default())
    }
}

/// The ranked evidence of one request, per section, and how it was found.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Retrieved {
    pub calls: Vec<Hit>,
    pub items: Vec<Hit>,
    pub documents: Vec<Hit>,
    pub normalized: String,
    pub terms: Vec<String>,
    pub query_lang: Option<Lang>,
    pub keyword_hits: u32,
    pub semantic_hits: u32,
    /// Sensitive calls and sources a cloud request did not get.
    pub sensitive_skipped: u32,
    pub filters_applied: u32,
}

impl Retrieved {
    /// The top `n` across sections for one answer: items first, then call and document
    /// evidence by fused score.
    pub fn ranked(&self, n: usize) -> Vec<&Hit> {
        let mut rest: Vec<&Hit> = self.calls.iter().chain(&self.documents).collect();
        rest.sort_by(|a, b| b.score.total_cmp(&a.score));
        self.items.iter().chain(rest).take(n).collect()
    }

    pub fn is_empty(&self) -> bool {
        self.calls.is_empty() && self.items.is_empty() && self.documents.is_empty()
    }
}

/// A request checked once, before it reaches the store: its dates as day bounds.
#[derive(Debug, Clone)]
pub struct Prepared {
    query: Query,
    from_ms: Option<i64>,
    to_ms: Option<i64>,
}

/// Checks the filter's dates (`invalid_input` on a malformed date or `from` after `to`).
pub fn prepare(query: Query) -> Result<Prepared, CoreError> {
    let day = |d: &Option<LocalDate>, field: &str| match d {
        None => Ok(None),
        Some(d) => day_number(d)
            .map(Some)
            .ok_or_else(|| invalid(field, ValidationRule::InvalidFormat)),
    };
    let from = day(&query.filter.from, "filter.from")?;
    let to = day(&query.filter.to, "filter.to")?;
    if from.zip(to).is_some_and(|(from, to)| from > to) {
        return Err(invalid("filter.to", ValidationRule::OutOfRange));
    }
    // shortcut: a day is a UTC day, as `calls_list` counts it; use the user's time zone when
    // settings carry one.
    Ok(Prepared {
        query,
        from_ms: from.map(|d| d * DAY_MS),
        to_ms: to.map(|d| (d + 1) * DAY_MS),
    })
}

pub(crate) fn invalid(field: &str, rule: ValidationRule) -> CoreError {
    CoreError::new(ErrorCode::InvalidInput, format!("{field}: {rule:?}")).with_detail(
        ErrorDetail::Validation {
            field: field.into(),
            rule,
        },
    )
}

/// Days since 1970-01-01 of a `YYYY-MM-DD` date; `None` for anything else.
pub fn day_number(date: &LocalDate) -> Option<i64> {
    let mut parts = date.0.split('-');
    let (y, m, d) = (parts.next()?, parts.next()?, parts.next()?);
    if parts.next().is_some() || y.len() != 4 || m.len() != 2 || d.len() != 2 {
        return None;
    }
    let (y, m, d): (i64, i64, i64) = (y.parse().ok()?, m.parse().ok()?, d.parse().ok()?);
    let leap = y % 4 == 0 && (y % 100 != 0 || y % 400 == 0);
    let last = match m {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if leap => 29,
        2 => 28,
        _ => return None,
    };
    if !(1..=last).contains(&d) {
        return None;
    }
    // Days from civil (Howard Hinnant).
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    Some(era * 146_097 + doe - 719_468)
}

pub(crate) fn lang_code(lang: &Lang) -> String {
    match lang {
        Lang::En => "en".into(),
        Lang::Ru => "ru".into(),
        Lang::De => "de".into(),
        Lang::Other { code } => code.clone(),
    }
}

pub(crate) fn lang_of(code: &str) -> Lang {
    match code {
        "en" => Lang::En,
        "ru" => Lang::Ru,
        "de" => Lang::De,
        code => Lang::Other { code: code.into() },
    }
}

/// Bound values of one statement, as `?N` marks.
#[derive(Default)]
struct Binds(Vec<Sql>);

impl Binds {
    fn bind(&mut self, v: impl Into<Sql>) -> String {
        self.0.push(v.into());
        format!("?{}", self.0.len())
    }

    fn bind_all<T: Into<Sql>>(&mut self, values: impl IntoIterator<Item = T>) -> String {
        let marks: Vec<String> = values.into_iter().map(|v| self.bind(v)).collect();
        marks.join(", ")
    }
}

/// Which rows a predicate set is for: call evidence (segments, chunks) or items.
#[derive(Clone, Copy, PartialEq)]
enum Section {
    Calls,
    Items,
}

impl Prepared {
    pub fn text(&self) -> &str {
        &self.query.text
    }

    pub fn wanted(&self) -> usize {
        self.query.wanted.max(1)
    }

    /// The query's embedding, once the caller has it (`None`: keyword-only).
    pub fn with_vector(mut self, vector: Option<Vec<f32>>) -> Self {
        self.query.vector = vector;
        self
    }

    /// Parameterised predicates over `c` (calls) and, for items, `i` (`inst-retrieve-filters`).
    fn predicates(&self, section: Section, b: &mut Binds) -> String {
        // @cpt-begin:cpt-noter-algo-core-retrieval-ask-retrieve:p1:inst-retrieve-filters
        let (f, s) = (&self.query.filter, &self.query.scope);
        let mut out = vec!["1".to_owned()];
        if !f.call_types.is_empty() {
            let marks = b.bind_all(f.call_types.iter().map(|t| t.0.clone()));
            out.push(format!("c.call_type IN ({marks})"));
        }
        if !f.tags.is_empty() {
            let marks = b.bind_all(f.tags.iter().map(|t| t.to_lowercase()));
            out.push(format!(
                "EXISTS (SELECT 1 FROM call_tags t WHERE t.call_id = c.id AND t.tag_norm IN ({marks}))"
            ));
        }
        if !f.languages.is_empty() {
            let marks = b.bind_all(f.languages.iter().map(lang_code));
            out.push(format!(
                "EXISTS (SELECT 1 FROM segments l WHERE l.call_id = c.id AND l.lang IN ({marks}))"
            ));
        }
        if !f.people.is_empty() {
            let marks = b.bind_all(f.people.iter().map(|p| p.0.clone()));
            let speakers = format!(
                "EXISTS (SELECT 1 FROM speakers p WHERE p.call_id = c.id AND p.person_id IN ({marks}))"
            );
            out.push(match section {
                Section::Calls => speakers,
                Section::Items => format!("(i.owner_person_id IN ({marks}) OR {speakers})"),
            });
        }
        if let Some(from) = self.from_ms {
            out.push(format!("c.started_at >= {}", b.bind(from)));
        }
        if let Some(to) = self.to_ms {
            out.push(format!("c.started_at < {}", b.bind(to)));
        }
        let open = "i.status = 'open' AND i.review_state != 'rejected'";
        match (section, f.has_open_items) {
            (_, None) => {}
            (Section::Items, Some(true)) => out.push(format!("({open})")),
            (Section::Items, Some(false)) => out.push(format!("NOT ({open})")),
            (Section::Calls, Some(wanted)) => out.push(format!(
                "{}EXISTS (SELECT 1 FROM items i WHERE i.call_id = c.id AND {open})",
                if wanted { "" } else { "NOT " }
            )),
        }
        if let Some(call) = &s.call_id {
            out.push(format!("c.id = {}", b.bind(call.0.clone())));
        }
        if let Some(topic) = &s.topic_id {
            let mark = b.bind(topic.0.clone());
            out.push(match section {
                Section::Calls => format!(
                    "EXISTS (SELECT 1 FROM items x WHERE x.call_id = c.id AND x.topic_id = {mark})"
                ),
                Section::Items => format!("i.topic_id = {mark}"),
            });
        }
        if section == Section::Items {
            out.push("i.review_state != 'rejected'".into());
        }
        out.join(" AND ")
        // @cpt-end:cpt-noter-algo-core-retrieval-ask-retrieve:p1:inst-retrieve-filters
    }

    fn filters_applied(&self) -> u32 {
        let f = &self.query.filter;
        [
            !f.people.is_empty(),
            !f.call_types.is_empty(),
            !f.tags.is_empty(),
            !f.languages.is_empty(),
            f.from.is_some(),
            f.to.is_some(),
            f.has_open_items.is_some(),
        ]
        .into_iter()
        .filter(|on| *on)
        .count() as u32
    }
}

/// A candidate hit, its call and whether that call is sensitive.
type Candidate = (Hit, CallId, bool);

const CALL_COLUMNS: &str = "c.id, c.title, c.started_at, c.call_type, c.privacy_class";

fn call_of(r: &Row<'_>, at: usize) -> noter_db::rusqlite::Result<(CallRef, bool)> {
    Ok((
        CallRef {
            id: CallId::new(r.get::<_, String>(at)?),
            title: r.get(at + 1)?,
            started_at: TimestampMs(r.get(at + 2)?),
            call_type: CallTypeId(r.get(at + 3)?),
        },
        r.get::<_, String>(at + 4)? == "sensitive",
    ))
}

fn span_hit(
    evidence: Evidence,
    call: CallRef,
    channel: Option<AudioChannel>,
    (t0, t1): (i64, i64),
    text: String,
    lang: Option<Lang>,
) -> Hit {
    let span = TimeSpan {
        call_id: call.id.clone(),
        channel,
        t0_ms: OffsetMs(t0.max(0) as u32),
        t1_ms: OffsetMs(t1.max(0) as u32),
    };
    Hit {
        evidence,
        target: HitTarget::Segment { span: span.clone() },
        title: call.title.clone(),
        text,
        lang,
        provenance: Provenance::PastCall {
            call: call.clone(),
            span,
        },
        call: Some(call),
        keyword: false,
        semantic: false,
        score: 0.0,
    }
}

fn channel_of(word: Option<String>) -> Option<AudioChannel> {
    match word.as_deref() {
        Some("mic") => Some(AudioChannel::Mic),
        Some("sys") => Some(AudioChannel::Sys),
        _ => None,
    }
}

/// A chunk's text without its call header line.
fn chunk_body(text: String) -> String {
    match text.split_once('\n') {
        Some((header, body)) if header.starts_with("Call: ") => body.to_owned(),
        _ => text,
    }
}

fn little_endian(v: &[f32]) -> Vec<u8> {
    v.iter().flat_map(|x| x.to_le_bytes()).collect()
}

// @cpt-algo:cpt-noter-algo-core-retrieval-ask-retrieve:p1
// @cpt-dod:cpt-noter-dod-core-retrieval-ask-search:p1
/// Ranked permitted evidence for a request. Reads only; never logs the query or source text.
pub fn retrieve(
    conn: &Connection,
    p: &Prepared,
    docs: &dyn DocumentSource,
) -> noter_db::rusqlite::Result<Retrieved> {
    let q = &p.query;
    // @cpt-begin:cpt-noter-algo-core-retrieval-ask-retrieve:p1:inst-retrieve-normalize
    let normalized = normalize(q.text.trim());
    let terms = terms(&normalized);
    let fts = match_expr(&terms);
    // @cpt-end:cpt-noter-algo-core-retrieval-ask-retrieve:p1:inst-retrieve-normalize
    let wanted = q.wanted.max(1);
    let fetch = wanted * OVER_FETCH;
    let mut sensitive: HashSet<CallId> = HashSet::new();
    let mut permit = |rows: Vec<Candidate>| -> Vec<Hit> {
        // @cpt-begin:cpt-noter-algo-core-retrieval-ask-retrieve:p1:inst-retrieve-privacy
        rows.into_iter()
            .filter_map(|(hit, call, is_sensitive)| {
                if q.privacy == Privacy::Cloud && is_sensitive {
                    sensitive.insert(call);
                    None
                } else {
                    Some(hit)
                }
            })
            .collect()
        // @cpt-end:cpt-noter-algo-core-retrieval-ask-retrieve:p1:inst-retrieve-privacy
    };
    // @cpt-begin:cpt-noter-algo-core-retrieval-ask-retrieve:p1:inst-retrieve-keywords
    let (seg_kw, chunk_kw, item_kw) = match &fts {
        Some(m) => (
            permit(segment_keywords(conn, p, m, fetch)?),
            permit(chunk_keywords(conn, p, m, fetch)?),
            permit(item_keywords(conn, p, m, fetch)?),
        ),
        None => (vec![], vec![], vec![]),
    };
    // @cpt-end:cpt-noter-algo-core-retrieval-ask-retrieve:p1:inst-retrieve-keywords
    // @cpt-begin:cpt-noter-algo-core-retrieval-ask-retrieve:p1:inst-retrieve-vectors
    let (chunk_sem, item_sem) = match &q.vector {
        Some(v) if !normalized.is_empty() => (
            permit(chunk_vectors(conn, p, v, fetch)?),
            permit(item_vectors(conn, p, v, fetch)?),
        ),
        // @cpt-begin:cpt-noter-algo-core-retrieval-ask-retrieve:p1:inst-retrieve-keyword-only
        _ => (vec![], vec![]),
        // @cpt-end:cpt-noter-algo-core-retrieval-ask-retrieve:p1:inst-retrieve-keyword-only
    };
    // @cpt-end:cpt-noter-algo-core-retrieval-ask-retrieve:p1:inst-retrieve-vectors
    let doc_hits = match (&fts, q.scope.include_documents) {
        (Some(m), true) => docs.permitted_chunks(
            conn,
            &DocQuery {
                fts: m,
                vector: q.vector.as_deref(),
                privacy: q.privacy,
                call_types: &q.filter.call_types,
                fetch,
            },
        )?,
        _ => DocHits::default(),
    };
    // @cpt-begin:cpt-noter-algo-core-retrieval-ask-retrieve:p1:inst-retrieve-fuse
    let mut calls = fuse(vec![(seg_kw, true), (chunk_kw, true), (chunk_sem, false)]);
    let mut items = fuse(vec![(item_kw, true), (item_sem, false)]);
    let mut documents = fuse(vec![(doc_hits.keyword, true), (doc_hits.semantic, false)]);
    for section in [&mut calls, &mut items, &mut documents] {
        section.truncate(wanted);
    }
    // @cpt-end:cpt-noter-algo-core-retrieval-ask-retrieve:p1:inst-retrieve-fuse
    // @cpt-begin:cpt-noter-algo-core-retrieval-ask-retrieve:p1:inst-retrieve-evidence
    for hit in calls.iter_mut().filter(|h| h.lang.is_none()) {
        if let Some((call, t0, t1)) = hit.span() {
            let lang = span_lang(conn, call, t0, t1)?;
            hit.lang = lang;
        }
    }
    let all = || calls.iter().chain(&items).chain(&documents);
    let keyword_hits = all().filter(|h| h.keyword).count() as u32;
    let semantic_hits = all().filter(|h| h.semantic).count() as u32;
    // @cpt-end:cpt-noter-algo-core-retrieval-ask-retrieve:p1:inst-retrieve-evidence
    // @cpt-begin:cpt-noter-algo-core-retrieval-ask-retrieve:p1:inst-retrieve-return
    Ok(Retrieved {
        query_lang: query_lang(&normalized),
        normalized,
        terms,
        keyword_hits,
        semantic_hits,
        sensitive_skipped: sensitive.len() as u32 + doc_hits.sensitive_skipped,
        filters_applied: p.filters_applied(),
        calls,
        items,
        documents,
    })
    // @cpt-end:cpt-noter-algo-core-retrieval-ask-retrieve:p1:inst-retrieve-return
}

/// Reciprocal rank fusion of rankings (best first; `true` = a keyword ranking). The same
/// evidence counts once; a chunk folds into a segment hit of the same call it overlaps, so a span
/// is not shown twice. Best fused score first.
pub(crate) fn fuse(rankings: Vec<(Vec<Hit>, bool)>) -> Vec<Hit> {
    let mut out: Vec<Hit> = vec![];
    for (ranking, keyword) in rankings {
        for (rank, hit) in ranking.into_iter().enumerate() {
            let score = 1.0 / (RRF_K + rank as f64 + 1.0);
            let same = out
                .iter()
                .position(|h| h.evidence == hit.evidence)
                .or_else(|| {
                    let (call, t0, t1) = hit.span()?;
                    out.iter().position(|h| {
                        matches!(h.evidence, Evidence::Segment(_))
                            && h.span()
                                .is_some_and(|(c, a, b)| c == call && a < t1 && t0 < b)
                    })
                });
            let i = same.unwrap_or_else(|| {
                out.push(Hit { score: 0.0, ..hit });
                out.len() - 1
            });
            out[i].score += score;
            if keyword {
                out[i].keyword = true;
            } else {
                out[i].semantic = true;
            }
        }
    }
    out.sort_by(|a, b| b.score.total_cmp(&a.score));
    out
}

/// The active transcript of a call: the archive pass once it exists, else the live one.
const ACTIVE_PASS: &str = "s.pass = (CASE WHEN EXISTS (SELECT 1 FROM segments a
    WHERE a.call_id = s.call_id AND a.pass = 'archive') THEN 'archive' ELSE 'live' END)";

fn segment_keywords(
    conn: &Connection,
    p: &Prepared,
    m: &str,
    fetch: usize,
) -> noter_db::rusqlite::Result<Vec<Candidate>> {
    let mut b = Binds::default();
    let m = b.bind(m.to_owned());
    let pred = p.predicates(Section::Calls, &mut b);
    let limit = b.bind(fetch as i64);
    let sql = format!(
        "SELECT s.id, s.channel, s.t0_ms, s.t1_ms, s.text, s.lang, {CALL_COLUMNS}
         FROM segments_fts f JOIN segments s ON s.rowid = f.rowid JOIN calls c ON c.id = s.call_id
         WHERE segments_fts MATCH {m} AND {ACTIVE_PASS} AND {pred}
         ORDER BY bm25(segments_fts) LIMIT {limit}"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params_from_iter(b.0.iter()), |r| {
        let (call, sensitive) = call_of(r, 6)?;
        let id = call.id.clone();
        let hit = span_hit(
            Evidence::Segment(SegmentId::new(r.get::<_, String>(0)?)),
            call,
            channel_of(r.get(1)?),
            (r.get(2)?, r.get(3)?),
            r.get(4)?,
            r.get::<_, Option<String>>(5)?.as_deref().map(lang_of),
        );
        Ok((hit, id, sensitive))
    })?;
    rows.collect()
}

fn chunk_row(r: &Row<'_>) -> noter_db::rusqlite::Result<Candidate> {
    let (call, sensitive) = call_of(r, 4)?;
    let id = call.id.clone();
    let hit = span_hit(
        Evidence::Chunk(ChunkId::new(r.get::<_, String>(0)?)),
        call,
        None,
        (r.get(1)?, r.get(2)?),
        chunk_body(r.get(3)?),
        None,
    );
    Ok((hit, id, sensitive))
}

fn chunk_keywords(
    conn: &Connection,
    p: &Prepared,
    m: &str,
    fetch: usize,
) -> noter_db::rusqlite::Result<Vec<Candidate>> {
    let mut b = Binds::default();
    let m = b.bind(m.to_owned());
    let pred = p.predicates(Section::Calls, &mut b);
    let limit = b.bind(fetch as i64);
    let sql = format!(
        "SELECT ch.id, ch.t0_ms, ch.t1_ms, ch.text, {CALL_COLUMNS}
         FROM chunks_fts f JOIN chunks ch ON ch.rowid = f.rowid JOIN calls c ON c.id = ch.call_id
         WHERE chunks_fts MATCH {m} AND {pred}
         ORDER BY bm25(chunks_fts) LIMIT {limit}"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params_from_iter(b.0.iter()), chunk_row)?;
    rows.collect()
}

/// The KNN subquery over a vec0 table: `k` nearest, the date filter pushed into its metadata.
fn knn(p: &Prepared, table: &str, key: &str, v: &[f32], fetch: usize, b: &mut Binds) -> String {
    let vector = b.bind(little_endian(v));
    let k = b.bind(fetch as i64);
    let mut dates = String::new();
    if let Some(from) = p.from_ms {
        dates.push_str(&format!(" AND started_at >= {}", b.bind(from)));
    }
    if let Some(to) = p.to_ms {
        dates.push_str(&format!(" AND started_at < {}", b.bind(to)));
    }
    format!(
        "(SELECT {key}, distance FROM {table} WHERE embedding MATCH {vector} AND k = {k}{dates})"
    )
}

fn chunk_vectors(
    conn: &Connection,
    p: &Prepared,
    v: &[f32],
    fetch: usize,
) -> noter_db::rusqlite::Result<Vec<Candidate>> {
    let mut b = Binds::default();
    let knn = knn(p, "chunk_vec", "chunk_id", v, fetch, &mut b);
    let pred = p.predicates(Section::Calls, &mut b);
    let floor = b.bind(1.0 - MIN_SIMILARITY);
    let sql = format!(
        "SELECT ch.id, ch.t0_ms, ch.t1_ms, ch.text, {CALL_COLUMNS}
         FROM {knn} v JOIN chunks ch ON ch.id = v.chunk_id JOIN calls c ON c.id = ch.call_id
         WHERE v.distance <= {floor} AND {pred} ORDER BY v.distance"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params_from_iter(b.0.iter()), chunk_row)?;
    rows.collect()
}

const ITEM_COLUMNS: &str = "i.id, i.text, i.lang, sp.channel, sp.t0_ms, sp.t1_ms";
const ITEM_SPAN: &str = "LEFT JOIN item_spans sp ON sp.item_id = i.id AND sp.t0_ms =
    (SELECT min(t0_ms) FROM item_spans WHERE item_id = i.id)";

fn item_row(r: &Row<'_>) -> noter_db::rusqlite::Result<Candidate> {
    let (call, sensitive) = call_of(r, 6)?;
    let id = call.id.clone();
    let item_id = ItemId::new(r.get::<_, String>(0)?);
    let text: String = r.get(1)?;
    let hit = span_hit(
        Evidence::Item(item_id.clone()),
        call,
        channel_of(r.get(3)?),
        (
            r.get::<_, Option<i64>>(4)?.unwrap_or(0),
            r.get::<_, Option<i64>>(5)?.unwrap_or(0),
        ),
        text.clone(),
        Some(lang_of(&r.get::<_, String>(2)?)),
    );
    let hit = Hit {
        target: HitTarget::Item { item_id },
        title: text,
        ..hit
    };
    Ok((hit, id, sensitive))
}

fn item_keywords(
    conn: &Connection,
    p: &Prepared,
    m: &str,
    fetch: usize,
) -> noter_db::rusqlite::Result<Vec<Candidate>> {
    let mut b = Binds::default();
    let m = b.bind(m.to_owned());
    let pred = p.predicates(Section::Items, &mut b);
    let limit = b.bind(fetch as i64);
    let sql = format!(
        "SELECT {ITEM_COLUMNS}, {CALL_COLUMNS}
         FROM items_fts f JOIN items i ON i.rowid = f.rowid JOIN calls c ON c.id = i.call_id {ITEM_SPAN}
         WHERE items_fts MATCH {m} AND {pred}
         ORDER BY bm25(items_fts) LIMIT {limit}"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params_from_iter(b.0.iter()), item_row)?;
    rows.collect()
}

fn item_vectors(
    conn: &Connection,
    p: &Prepared,
    v: &[f32],
    fetch: usize,
) -> noter_db::rusqlite::Result<Vec<Candidate>> {
    let mut b = Binds::default();
    let knn = knn(p, "item_vec", "item_id", v, fetch, &mut b);
    let pred = p.predicates(Section::Items, &mut b);
    let floor = b.bind(1.0 - MIN_SIMILARITY);
    let sql = format!(
        "SELECT {ITEM_COLUMNS}, {CALL_COLUMNS}
         FROM {knn} v JOIN items i ON i.id = v.item_id JOIN calls c ON c.id = i.call_id {ITEM_SPAN}
         WHERE v.distance <= {floor} AND {pred} ORDER BY v.distance"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params_from_iter(b.0.iter()), item_row)?;
    rows.collect()
}

/// The language most of a span's active segments are in.
fn span_lang(
    conn: &Connection,
    call: &CallId,
    t0: u32,
    t1: u32,
) -> noter_db::rusqlite::Result<Option<Lang>> {
    let code: Option<String> = conn
        .query_row(
            &format!(
                "SELECT s.lang FROM segments s WHERE s.call_id = ?1 AND {ACTIVE_PASS}
                   AND s.t0_ms < ?3 AND s.t1_ms > ?2 AND s.lang IS NOT NULL
                 GROUP BY s.lang ORDER BY count(*) DESC LIMIT 1"
            ),
            noter_db::rusqlite::params![call.as_str(), t0, t1],
            |r| r.get(0),
        )
        .optional()?;
    Ok(code.as_deref().map(lang_of))
}
