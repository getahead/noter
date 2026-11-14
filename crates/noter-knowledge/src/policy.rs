//! Source policy on indexed evidence: retrieval asks which document chunks a request may see,
//! always under the source's current privacy class and scope.

use std::collections::HashSet;

use noter_db::rusqlite::{self, params, Connection, OptionalExtension};
use noter_protocol::model::{AskScope, SourceScope};
use noter_protocol::{ChunkId, DocumentId, PrivacyClass, SourceId};

/// A chunk retrieval may use, with its provenance.
#[derive(Debug, Clone, PartialEq)]
pub struct Permitted {
    pub chunk_id: ChunkId,
    pub document_id: DocumentId,
    pub source_id: SourceId,
    pub source_name: String,
    pub title: String,
    pub heading_path: Vec<String>,
    pub text: String,
}

/// The call types and people a request is about: the scope's own, plus the type and named
/// people of the call it names (TL-45).
fn requested(conn: &Connection, scope: &AskScope) -> rusqlite::Result<(Vec<String>, Vec<String>)> {
    let mut types: Vec<String> = scope.call_types.iter().map(|t| t.0.clone()).collect();
    let mut people: Vec<String> = scope.people.iter().map(|p| p.0.clone()).collect();
    if let Some(call) = &scope.call_id {
        if let Some(t) = conn
            .query_row(
                "SELECT call_type FROM calls WHERE id = ?1",
                [call.as_str()],
                |r| r.get(0),
            )
            .optional()?
        {
            types.push(t);
        }
        let mut st = conn.prepare(
            "SELECT DISTINCT person_id FROM speakers WHERE call_id = ?1 AND person_id IS NOT NULL",
        )?;
        for p in st.query_map([call.as_str()], |r| r.get(0))? {
            people.push(p?);
        }
    }
    Ok((types, people))
}

struct Candidate {
    document: String,
    source: String,
    name: String,
    title: String,
    path: String,
    text: String,
    privacy: String,
    scope: String,
}

// @cpt-algo:cpt-noter-algo-core-knowledge-policy:p1
// @cpt-dod:cpt-noter-dod-core-knowledge-policy:p1
/// The candidates a request may use, in the order given. `cloud`: the packet goes to a cloud
/// runtime. A chunk of a removed source, a sensitive source for a cloud runtime, a source whose
/// scope excludes the request, or any document when the scope leaves documents out is dropped.
/// An unscoped request (no call types, people or call) sees limited sources; a scoped one sees a
/// limited source when any of its call types or people is the source's (TL-45).
pub fn permitted_chunks(
    conn: &Connection,
    candidates: &[ChunkId],
    scope: &AskScope,
    cloud: bool,
) -> rusqlite::Result<Vec<Permitted>> {
    // @cpt-begin:cpt-noter-algo-core-knowledge-policy:p1:inst-policy-source
    if !scope.include_documents {
        return Ok(vec![]);
    }
    let (types, people) = requested(conn, scope)?;
    let scoped = !types.is_empty() || !people.is_empty();
    let mut st = conn.prepare(
        "SELECT d.id, s.id, s.name, d.title, c.heading_path, c.text, s.privacy_class, s.scope
         FROM doc_chunks c JOIN documents d ON d.id = c.document_id
         JOIN sources s ON s.id = d.source_id
         WHERE c.id = ?1 AND s.mode = 'indexed' AND s.removing = 0",
    )?;
    // @cpt-end:cpt-noter-algo-core-knowledge-policy:p1:inst-policy-source
    let mut seen = HashSet::new();
    let mut out = vec![];
    for id in candidates.iter().filter(|id| seen.insert(id.as_str())) {
        // @cpt-begin:cpt-noter-algo-core-knowledge-policy:p1:inst-policy-current
        // The source row as it is now, whatever policy the chunk was indexed under; a chunk of
        // a removed source has no row.
        let found = st
            .query_row([id.as_str()], |r| {
                Ok(Candidate {
                    document: r.get(0)?,
                    source: r.get(1)?,
                    name: r.get(2)?,
                    title: r.get(3)?,
                    path: r.get(4)?,
                    text: r.get(5)?,
                    privacy: r.get(6)?,
                    scope: r.get(7)?,
                })
            })
            .optional()?;
        let Some(c) = found else { continue };
        let policy: SourceScope = serde_json::from_str(&c.scope).unwrap_or(SourceScope::Limited {
            call_types: vec![],
            people: vec![],
        });
        // @cpt-end:cpt-noter-algo-core-knowledge-policy:p1:inst-policy-current
        // @cpt-begin:cpt-noter-algo-core-knowledge-policy:p1:inst-policy-sensitive
        if cloud && c.privacy != "normal" {
            continue;
        }
        // @cpt-end:cpt-noter-algo-core-knowledge-policy:p1:inst-policy-sensitive
        // @cpt-begin:cpt-noter-algo-core-knowledge-policy:p1:inst-policy-scope
        if !in_scope(&policy, scoped, &types, &people) {
            continue;
        }
        // @cpt-end:cpt-noter-algo-core-knowledge-policy:p1:inst-policy-scope
        // @cpt-begin:cpt-noter-algo-core-knowledge-policy:p1:inst-policy-return
        out.push(Permitted {
            chunk_id: id.clone(),
            document_id: DocumentId::new(c.document),
            source_id: SourceId::new(c.source),
            source_name: c.name,
            title: c.title,
            heading_path: serde_json::from_str(&c.path).unwrap_or_default(),
            text: c.text,
        });
        // @cpt-end:cpt-noter-algo-core-knowledge-policy:p1:inst-policy-return
    }
    Ok(out)
}

/// Whether a source's scope admits a request: an unscoped request sees limited sources, a scoped
/// one a limited source when any of its call types or people is the source's (TL-45).
fn in_scope(policy: &SourceScope, scoped: bool, types: &[String], people: &[String]) -> bool {
    match policy {
        SourceScope::AllCalls => true,
        SourceScope::Limited {
            call_types,
            people: allowed,
        } => {
            !scoped
                || call_types.iter().any(|t| types.contains(&t.0))
                || allowed.iter().any(|p| people.contains(&p.0))
        }
    }
}

/// A live MCP source a cloud run may query.
#[derive(Debug, Clone, PartialEq)]
pub struct LiveSource {
    pub id: SourceId,
    pub name: String,
    pub server: String,
}

/// The live sources (`mode = live`) a cloud run over `scope` may query now: never a sensitive
/// source, and a limited one only where the run's call type or people are the source's. Oldest
/// first, so a source keeps its place (and its tool names) while the others change.
pub fn live_sources(conn: &Connection, scope: &AskScope) -> rusqlite::Result<Vec<LiveSource>> {
    let (types, people) = requested(conn, scope)?;
    let scoped = !types.is_empty() || !people.is_empty();
    let mut st = conn.prepare(
        "SELECT id, name, location, scope FROM sources
         WHERE mode = 'live' AND privacy_class = 'normal' AND removing = 0 ORDER BY rowid",
    )?;
    let rows = st.query_map([], |r| {
        Ok((
            LiveSource {
                id: SourceId::new(r.get::<_, String>(0)?),
                name: r.get(1)?,
                server: r.get(2)?,
            },
            r.get::<_, String>(3)?,
        ))
    })?;
    let mut out = vec![];
    for row in rows {
        let (source, scope_json) = row?;
        let policy = serde_json::from_str(&scope_json).unwrap_or(SourceScope::Limited {
            call_types: vec![],
            people: vec![],
        });
        if in_scope(&policy, scoped, &types, &people) {
            out.push(source);
        }
    }
    Ok(out)
}

/// Indexed chunks whose text matches `fts`, retrieval's word-start expression (`" term" OR …`),
/// best first. Candidates only: [`permitted_chunks`] decides what a request may use.
pub fn keyword_chunks(
    conn: &Connection,
    fts: &str,
    fetch: usize,
) -> rusqlite::Result<Vec<ChunkId>> {
    let mut st = conn.prepare(
        "SELECT c.id FROM doc_chunks_fts f JOIN doc_chunks c ON c.rowid = f.rowid
         WHERE doc_chunks_fts MATCH ?1 ORDER BY bm25(doc_chunks_fts) LIMIT ?2",
    )?;
    let rows = st.query_map(params![fts, fetch as i64], |r| r.get::<_, String>(0))?;
    rows.map(|id| id.map(ChunkId::new)).collect()
}

/// The `fetch` indexed chunks nearest `vector` within the cosine `max_distance`, best first;
/// candidates for [`permitted_chunks`] like [`keyword_chunks`].
pub fn nearest_chunks(
    conn: &Connection,
    vector: &[f32],
    fetch: usize,
    max_distance: f64,
    privacy: Option<PrivacyClass>,
) -> rusqlite::Result<Vec<ChunkId>> {
    let blob: Vec<u8> = vector.iter().flat_map(|x| x.to_le_bytes()).collect();
    let privacy = match privacy {
        Some(PrivacyClass::Normal) => " AND privacy_class = 'normal'",
        Some(PrivacyClass::Sensitive) => " AND privacy_class = 'sensitive'",
        None => "",
    };
    let mut st = conn.prepare(&format!(
        "SELECT chunk_id FROM (SELECT chunk_id, distance FROM doc_vec
                 WHERE embedding MATCH ?1 AND k = ?2{privacy})
             WHERE distance <= ?3 ORDER BY distance"
    ))?;
    let rows = st.query_map(params![blob, fetch as i64, max_distance], |r| {
        r.get::<_, String>(0)
    })?;
    rows.map(|id| id.map(ChunkId::new)).collect()
}
