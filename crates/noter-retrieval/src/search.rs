//! `search`: the library's sectioned results over the one retrieval function
//! (`cpt-noter-flow-core-retrieval-ask-search`).

use noter_db::rusqlite::Connection;
use noter_protocol::error::ValidationRule;
use noter_protocol::model::*;
use noter_protocol::*;

use crate::normalize::{highlights, normalize, words};
use crate::retrieve::{invalid, prepare, retrieve, DocumentSource, Hit, Prepared, Query, Scope};

/// Hits per section when the request names no limit.
pub const DEFAULT_LIMIT: u32 = 20;
pub const MAX_LIMIT: u32 = 100;
/// A snippet longer than this is cut at a character boundary.
const SNIPPET_CHARS: usize = 400;

// @cpt-flow:cpt-noter-flow-core-retrieval-ask-search:p1
/// The checked request: `invalid_input` for a limit outside 1–100 or a bad date. Every section
/// and every source; the caller adds the query's vector when the indexes are ready.
pub fn search_request(args: &SearchArgs) -> Result<Prepared, CoreError> {
    // @cpt-begin:cpt-noter-flow-core-retrieval-ask-search:p1:inst-search-request
    let limit = args.limit.unwrap_or(DEFAULT_LIMIT);
    if !(1..=MAX_LIMIT).contains(&limit) {
        return Err(invalid("limit", ValidationRule::OutOfRange));
    }
    prepare(Query {
        text: args.query.clone(),
        filter: args.filter.clone(),
        scope: Scope {
            include_documents: true,
            ..Scope::default()
        },
        wanted: limit as usize,
        ..Query::default()
    })
    // @cpt-end:cpt-noter-flow-core-retrieval-ask-search:p1:inst-search-request
}

/// The sectioned results of a checked request, `mode` saying whether vectors took part.
pub fn search(
    conn: &Connection,
    query: &str,
    p: &Prepared,
    mode: SearchMode,
    docs: &dyn DocumentSource,
) -> noter_db::rusqlite::Result<SearchResults> {
    // @cpt-begin:cpt-noter-flow-core-retrieval-ask-search:p1:inst-search-retrieve
    let found = retrieve(conn, p, docs)?;
    // @cpt-end:cpt-noter-flow-core-retrieval-ask-search:p1:inst-search-retrieve
    // @cpt-begin:cpt-noter-flow-core-retrieval-ask-search:p1:inst-search-sections
    let topics = topics_matching(conn, &found.terms, p.wanted())?;
    let hit = |h: &Hit| search_hit(h, &found.terms, found.query_lang.as_ref());
    let results = SearchResults {
        query: query.to_owned(),
        mode,
        calls: found.calls.iter().map(hit).collect(),
        items: found.items.iter().map(hit).collect(),
        documents: found.documents.iter().map(hit).collect(),
        topics,
        // @cpt-begin:cpt-noter-flow-core-retrieval-ask-search:p1:inst-search-strength
        only_weak: !found.is_empty()
            && found
                .calls
                .iter()
                .chain(&found.items)
                .chain(&found.documents)
                .all(|h| !h.keyword),
        // @cpt-end:cpt-noter-flow-core-retrieval-ask-search:p1:inst-search-strength
        explain: SearchExplain {
            keyword_hits: found.keyword_hits,
            semantic_hits: found.semantic_hits,
            normalized_query: found.normalized.clone(),
            filters_applied: found.filters_applied,
        },
    };
    // @cpt-end:cpt-noter-flow-core-retrieval-ask-search:p1:inst-search-sections
    // @cpt-begin:cpt-noter-flow-core-retrieval-ask-search:p1:inst-search-return
    Ok(results)
    // @cpt-end:cpt-noter-flow-core-retrieval-ask-search:p1:inst-search-return
}

/// A hit as the results show it: a snippet with the matched words highlighted, its strength and
/// whether a semantic match crossed languages.
fn search_hit(h: &Hit, terms: &[String], query_lang: Option<&Lang>) -> SearchHit {
    let snippet: String = match h.text.char_indices().nth(SNIPPET_CHARS) {
        Some((cut, _)) => format!("{}…", &h.text[..cut]),
        None => h.text.clone(),
    };
    SearchHit {
        target: h.target.clone(),
        title: h.title.clone(),
        highlights: highlights(&snippet, terms)
            .into_iter()
            .map(|(start, end)| TextRange { start, end })
            .collect(),
        snippet,
        lang: h.lang.clone(),
        strength: h.strength(),
        call: h.call.clone(),
        provenance: h.provenance.clone(),
        cross_language: !h.keyword
            && h.lang.is_some()
            && query_lang.is_some()
            && h.lang.as_ref() != query_lang,
    }
}

/// Topics whose name or an alias has a word a query term starts.
fn topics_matching(
    conn: &Connection,
    terms: &[String],
    limit: usize,
) -> noter_db::rusqlite::Result<Vec<TopicRow>> {
    if terms.is_empty() {
        return Ok(vec![]);
    }
    let mut stmt = conn.prepare(
        "SELECT t.id, t.name, (SELECT group_concat(alias, char(31)) FROM topic_aliases
                               WHERE topic_id = t.id)
         FROM topics t ORDER BY t.last_seen DESC",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, Option<String>>(2)?,
        ))
    })?;
    let mut ids = vec![];
    for row in rows {
        let (id, name, aliases) = row?;
        let matches = |text: &str| {
            let text = normalize(text);
            words(&text)
                .into_iter()
                .any(|(s, e)| terms.iter().any(|t| text[s..e].starts_with(t.as_str())))
        };
        if matches(&name) || aliases.as_deref().is_some_and(matches) {
            ids.push(id);
        }
        if ids.len() == limit {
            break;
        }
    }
    crate::topics::topic_rows(conn, &ids)
}
