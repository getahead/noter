//! Heading chunks: each section of a document becomes one or more chunks of at most 400 tokens
//! (200–400 when the section is long enough) on paragraph boundaries, with the title and
//! heading path prepended, and the keyword text normalised as retrieval normalises queries.

use unicode_normalization::UnicodeNormalization;

use crate::extract::Extracted;

/// A section long enough is cut into chunks of at least this many tokens (its last may be less).
#[cfg(test)]
const MIN_TOKENS: usize = 200;
const MAX_TOKENS: usize = 400;

/// One retrieval unit of a document.
#[derive(Debug, Clone, PartialEq)]
pub struct Chunk {
    /// Headings, outermost first; empty for text before the first heading.
    pub heading_path: Vec<String>,
    /// `Title › Heading › Sub-heading`, a blank line, then the section text.
    pub text: String,
    pub token_count: usize,
}

/// NFKC, lower case, ё → е, ß → ss: the keyword index's text (the same rule as 2.22's query
/// side).
pub fn normalize(text: &str) -> String {
    text.nfkc()
        .collect::<String>()
        .to_lowercase()
        .replace('ё', "е")
        .replace('ß', "ss")
}

/// shortcut: about four tokens per three words, not the bge-m3 tokenizer; good enough for chunk
/// sizes, upgrade if retrieval needs exact budgets.
pub(crate) fn tokens(text: &str) -> usize {
    (text.split_whitespace().count() * 4).div_ceil(3)
}

/// Splits a paragraph longer than a chunk into pieces of `MAX_TOKENS` at word boundaries.
fn pieces(paragraph: &str) -> Vec<String> {
    if tokens(paragraph) <= MAX_TOKENS {
        return vec![paragraph.to_string()];
    }
    let words: Vec<&str> = paragraph.split_whitespace().collect();
    words
        .chunks(MAX_TOKENS * 3 / 4)
        .map(|w| w.join(" "))
        .collect()
}

/// The chunks of an extracted document, in order.
pub(crate) fn chunks(doc: &Extracted) -> Vec<Chunk> {
    let mut out = vec![];
    for section in &doc.sections {
        let prefix = std::iter::once(doc.title.as_str())
            .chain(section.path.iter().map(String::as_str))
            .collect::<Vec<_>>()
            .join(" › ");
        let close = |open: &mut Vec<String>, out: &mut Vec<Chunk>| {
            if open.is_empty() {
                return;
            }
            let text = format!("{prefix}\n\n{}", open.join("\n\n"));
            out.push(Chunk {
                heading_path: section.path.clone(),
                token_count: tokens(&text),
                text,
            });
            open.clear();
        };
        let mut open: Vec<String> = vec![];
        let mut n = 0;
        let paragraphs = section
            .body
            .split("\n\n")
            .map(str::trim)
            .filter(|p| !p.is_empty())
            .flat_map(pieces);
        for p in paragraphs {
            let t = tokens(&p);
            if n + t > MAX_TOKENS {
                close(&mut open, &mut out);
                n = 0;
            }
            open.push(p);
            n += t;
        }
        close(&mut open, &mut out);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::extract::Section;

    fn doc(sections: Vec<(Vec<&str>, String)>) -> Extracted {
        Extracted {
            title: "Guide".into(),
            sections: sections
                .into_iter()
                .map(|(path, body)| Section {
                    path: path.into_iter().map(String::from).collect(),
                    body,
                })
                .collect(),
        }
    }

    fn para(words: usize) -> String {
        vec!["word"; words].join(" ")
    }

    #[test]
    fn sections_split_into_chunks_of_two_to_four_hundred_tokens_on_paragraphs() {
        let body = (0..12).map(|_| para(60)).collect::<Vec<_>>().join("\n\n");
        let out = chunks(&doc(vec![(vec!["Setup", "Install"], body)]));
        assert!(out.len() >= 3, "{}", out.len());
        for c in &out {
            assert!(c.token_count <= MAX_TOKENS + 10, "{}", c.token_count);
            assert!(c.text.starts_with("Guide › Setup › Install\n\n"));
            assert_eq!(c.heading_path, ["Setup", "Install"]);
        }
        for c in &out[..out.len() - 1] {
            assert!(c.token_count >= MIN_TOKENS, "{}", c.token_count);
        }
    }

    #[test]
    fn a_heading_always_starts_a_chunk_and_empty_sections_make_none() {
        let out = chunks(&doc(vec![
            (vec![], "Intro text.".into()),
            (vec!["Empty"], "  \n\n ".into()),
            (vec!["Usage"], "Run it.".into()),
        ]));
        assert_eq!(out.len(), 2);
        assert_eq!(out[0].text, "Guide\n\nIntro text.");
        assert_eq!(out[1].text, "Guide › Usage\n\nRun it.");
        assert!(chunks(&doc(vec![])).is_empty());
    }

    #[test]
    fn a_paragraph_longer_than_a_chunk_is_cut_at_words() {
        let out = chunks(&doc(vec![(vec![], para(1000))]));
        assert!(out.len() >= 3);
        assert!(out.iter().all(|c| c.token_count <= MAX_TOKENS + 5));
        let words: usize = out
            .iter()
            .map(|c| c.text.split_whitespace().count() - 1)
            .sum();
        assert_eq!(words, 1000);
    }

    #[test]
    fn normalisation_folds_width_case_yo_and_sharp_s() {
        assert_eq!(normalize("Ｆｕｌｌ ЁЛКА Straße"), "full елка strasse");
    }
}
