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
// @cpt-algo:cpt-noter-algo-core-knowledge-sync:p1
pub(crate) fn tokens(text: &str) -> usize {
    (text.split_whitespace().count() * 4)
        .div_ceil(3)
        .max(text.chars().count().div_ceil(4))
}

/// Splits long paragraphs at character boundaries so an unbroken minified line is bounded too.
// @cpt-algo:cpt-noter-algo-core-knowledge-sync:p1
fn pieces(paragraph: &str) -> Vec<String> {
    if tokens(paragraph) <= MAX_TOKENS {
        return vec![paragraph.to_string()];
    }
    // Leave headroom for the document title and heading path added to every chunk.
    let max_chars = MAX_TOKENS * 4 - 100;
    let max_words = MAX_TOKENS * 3 / 4 - 25;
    let mut out = Vec::new();
    let mut start = 0;
    let mut count = 0;
    let mut words = 0;
    let mut in_word = false;
    for (index, ch) in paragraph.char_indices() {
        let next_word = !ch.is_whitespace() && !in_word;
        if count > 0 && (count == max_chars || words + usize::from(next_word) > max_words) {
            out.push(paragraph[start..index].to_string());
            start = index;
            count = 0;
            words = 0;
            in_word = false;
        }
        count += 1;
        if ch.is_whitespace() {
            in_word = false;
        } else if !in_word {
            words += 1;
            in_word = true;
        }
    }
    if start < paragraph.len() {
        out.push(paragraph[start..].to_string());
    }
    out
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

    #[test]
    fn a_minified_paragraph_is_split_on_unicode_character_boundaries() {
        let body = "界".repeat(MAX_TOKENS * 4 + 17);
        let out = chunks(&doc(vec![(vec![], body)]));
        assert!(out.len() > 1);
        assert!(out.iter().all(|chunk| chunk.token_count <= MAX_TOKENS + 1));
        assert_eq!(
            out.iter()
                .map(|chunk| chunk.text.matches('界').count())
                .sum::<usize>(),
            MAX_TOKENS * 4 + 17
        );
    }

    #[test]
    fn a_word_dense_line_is_split_before_its_token_estimate_exceeds_the_limit() {
        let out = chunks(&doc(vec![(vec![], para(1_000))]));
        assert!(out.len() > 1);
        assert!(out.iter().all(|chunk| chunk.token_count <= MAX_TOKENS));
    }
}
