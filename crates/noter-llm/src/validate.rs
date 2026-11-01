//! Output validation (`cpt-noter-algo-core-llm-gate-validate`): the app-owned schema, no raw
//! HTML in Markdown fields, and every citation inside the permitted packet. The repair retry,
//! the simpler fallback and the typed failure are the runtime's (`runtime.rs`).

use std::sync::OnceLock;

use regex::Regex;
use serde_json::Value;

use crate::runtime::Skill;

/// The keys outputs cite evidence with.
const CITATIONS: [&str; 4] = [
    "evidence_segment_ids",
    "evidence_chunk_ids",
    "segment_ids",
    "chunk_ids",
];

/// Why an output was refused. `explain` goes to the model in the repair packet (through the
/// gate); it names fields and counts, never the output's text, so it is also safe to log.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Invalid {
    pub reason: &'static str,
    pub explain: String,
}

pub(crate) fn validate(skill: Skill, output: &Value, permitted: &[String]) -> Result<(), Invalid> {
    // @cpt-begin:cpt-noter-algo-core-llm-gate-validate:p1:inst-validate-schema
    if let Err(e) = skill.conforms(output) {
        let what = e.to_string();
        let what = if what.starts_with("missing field") {
            what
        } else {
            "a field has the wrong type or value".to_owned()
        };
        return Err(Invalid {
            reason: "schema",
            explain: format!(
                "The output does not match the {} schema: {what}.",
                skill.id()
            ),
        });
    }
    if let Some(field) = html_field(output) {
        return Err(Invalid {
            reason: "html",
            explain: format!("`{field}` contains raw HTML; write Markdown only."),
        });
    }
    // @cpt-end:cpt-noter-algo-core-llm-gate-validate:p1:inst-validate-schema
    // @cpt-begin:cpt-noter-algo-core-llm-gate-validate:p1:inst-validate-citations
    let (uncited, unknown) = citations(output, permitted);
    if uncited > 0 || unknown > 0 {
        return Err(Invalid {
            reason: "citations",
            explain: format!(
                "{uncited} entries cite no evidence and {unknown} cited ids are not in the packet; cite only the ids given."
            ),
        });
    }
    // @cpt-end:cpt-noter-algo-core-llm-gate-validate:p1:inst-validate-citations
    Ok(())
}

/// An HTML tag or comment; Markdown autolinks (`<https://…>`) are not tags.
fn html() -> &'static Regex {
    static HTML: OnceLock<Regex> = OnceLock::new();
    HTML.get_or_init(|| {
        Regex::new(r"<!--|<\s*/?\s*[A-Za-z][A-Za-z0-9-]*(\s[^>]*)?/?\s*>").expect("a valid pattern")
    })
}

/// Whether Markdown holds raw HTML (a tag or a comment): what the gate refuses in `*_md` fields,
/// and what an edit of a section may not store either.
pub fn raw_html(md: &str) -> bool {
    html().is_match(md)
}

/// The first Markdown field (`*_md`) holding raw HTML.
fn html_field(v: &Value) -> Option<String> {
    match v {
        Value::Object(map) => map.iter().find_map(|(k, v)| match v {
            Value::String(s) if k.ends_with("_md") && html().is_match(s) => Some(k.clone()),
            _ => html_field(v),
        }),
        Value::Array(items) => items.iter().find_map(html_field),
        _ => None,
    }
}

/// Entries that cite nothing, and cited ids outside the packet.
fn citations(v: &Value, permitted: &[String]) -> (usize, usize) {
    let sum = |a: (usize, usize), b: (usize, usize)| (a.0 + b.0, a.1 + b.1);
    match v {
        Value::Object(map) => {
            let cites: Vec<&Value> = CITATIONS.iter().filter_map(|k| map.get(*k)).collect();
            let ids: Vec<&str> = cites
                .iter()
                .filter_map(|v| v.as_array())
                .flatten()
                .filter_map(Value::as_str)
                .collect();
            let unknown = ids
                .iter()
                .filter(|id| !permitted.iter().any(|p| p == *id))
                .count();
            let uncited = usize::from(!cites.is_empty() && ids.is_empty());
            map.values()
                .map(|v| citations(v, permitted))
                .fold((uncited, unknown), sum)
        }
        Value::Array(items) => items
            .iter()
            .map(|v| citations(v, permitted))
            .fold((0, 0), sum),
        _ => (0, 0),
    }
}
