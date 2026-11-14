//! The shadow form of text and queries (`inst-retrieve-normalize`): NFKC, lower case, ё → е,
//! ß → ss, and Snowball stems for English, Russian and German. Raw text stays for display.

use rust_stemmers::{Algorithm, Stemmer};
use unicode_normalization::UnicodeNormalization;

use noter_protocol::Lang;

/// NFKC, lower case, ё → е, ß → ss.
pub fn normalize(text: &str) -> String {
    text.nfkc()
        .collect::<String>()
        .to_lowercase()
        .replace('ё', "е")
        .replace('ß', "ss")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// Approximate token count used by chunking before a model tokenizer is available.
// @cpt-algo:cpt-noter-algo-core-knowledge-sync:p1
pub fn estimate_tokens(text: &str) -> usize {
    (text.split_whitespace().count() * 4)
        .div_ceil(3)
        .max(text.chars().count().div_ceil(4))
}

/// The words of a text, as `(start, end)` byte ranges: runs of letters and digits.
pub(crate) fn words(text: &str) -> Vec<(usize, usize)> {
    let mut out = vec![];
    let mut start = None;
    for (i, ch) in text.char_indices() {
        match (ch.is_alphanumeric(), start) {
            (true, None) => start = Some(i),
            (false, Some(s)) => {
                out.push((s, i));
                start = None;
            }
            _ => {}
        }
    }
    if let Some(s) = start {
        out.push((s, text.len()));
    }
    out
}

/// One query term per word of the normalised query: the shortest Snowball stem (Russian for
/// Cyrillic words, English and German for the others) that is still a prefix of the word, so the
/// term matches the word's other forms at a word start; a stem that rewrites the word (German
/// umlauts) is not a prefix, and the word stays whole. One-letter words are dropped.
pub fn terms(normalized: &str) -> Vec<String> {
    let ru = Stemmer::create(Algorithm::Russian);
    let en = Stemmer::create(Algorithm::English);
    let de = Stemmer::create(Algorithm::German);
    let mut out: Vec<String> = vec![];
    for (s, e) in words(normalized) {
        let word = &normalized[s..e];
        if word.chars().count() < 2 {
            continue;
        }
        let stems = if word.chars().any(is_cyrillic) {
            vec![ru.stem(word).into_owned()]
        } else {
            vec![en.stem(word).into_owned(), de.stem(word).into_owned()]
        };
        let term = stems
            .into_iter()
            .filter(|stem| word.starts_with(stem.as_str()) && stem.chars().count() >= 3)
            .min_by_key(|stem| stem.len())
            .unwrap_or_else(|| word.to_owned());
        if !out.contains(&term) {
            out.push(term);
        }
    }
    out
}

/// The FTS5 query for the terms: any term at a word start (`" term"`, see the migration), ranked
/// by BM25; `None` when nothing is left to look for.
pub(crate) fn match_expr(terms: &[String]) -> Option<String> {
    let quoted: Vec<String> = terms
        .iter()
        .map(|t| format!("\" {}\"", t.replace('"', "\"\"")))
        .collect();
    (!quoted.is_empty()).then(|| quoted.join(" OR "))
}

/// The language a query is most likely written in, from its letters.
// shortcut: script and umlauts only, not a language model; enough to flag a semantic hit in
// another language. Upgrade with the engine's language ID when it takes text.
pub(crate) fn query_lang(normalized: &str) -> Option<Lang> {
    if normalized.chars().any(is_cyrillic) {
        Some(Lang::Ru)
    } else if normalized.contains(['ä', 'ö', 'ü']) {
        Some(Lang::De)
    } else if normalized.chars().any(|c| c.is_ascii_alphabetic()) {
        Some(Lang::En)
    } else {
        None
    }
}

fn is_cyrillic(c: char) -> bool {
    ('\u{0400}'..='\u{04FF}').contains(&c)
}

/// Ranges of `text` (UTF-16 code units, as `TextRange` counts) of the words a term starts.
pub(crate) fn highlights(text: &str, terms: &[String]) -> Vec<(u32, u32)> {
    let utf16 = |byte: usize| text[..byte].encode_utf16().count() as u32;
    words(text)
        .into_iter()
        .filter(|&(s, e)| {
            let word = normalize(&text[s..e]);
            terms.iter().any(|t| word.starts_with(t.as_str()))
        })
        .map(|(s, e)| (utf16(s), utf16(e)))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizing_folds_case_compatibility_forms_yo_and_sharp_s() {
        assert_eq!(normalize("Ёлка ВСЁ"), "елка все");
        assert_eq!(normalize("Straße GROSS"), "strasse gross");
        // NFKC: the ligature and the full-width letters become plain letters.
        assert_eq!(normalize("ﬁle ＡＰＩ"), "file api");
        // A decomposed ё (е + combining diaeresis) composes first, then folds.
        assert_eq!(normalize("е\u{0308}ж"), "еж");
        // Preserve people matching's former collapsed-whitespace behavior.
        assert_eq!(normalize(" Anna\u{00a0}  Koval "), "anna koval");
    }

    #[test]
    fn terms_are_prefix_stems_in_english_russian_and_german() {
        assert_eq!(
            terms("decisions about websockets"),
            ["decis", "about", "websocket"]
        );
        assert_eq!(terms("мы решили"), ["мы", "реш"]);
        assert_eq!(terms("entscheidungen"), ["entscheid"]);
        // A German stem that rewrites an umlaut is not a prefix: the word stays whole.
        assert_eq!(terms("häuser"), ["häuser"]);
        // One-letter words go; repeated words count once.
        assert_eq!(terms("a websocket a websockets"), ["websocket"]);
        assert!(terms("  ,.;  ").is_empty());
    }

    #[test]
    fn the_match_expression_anchors_each_term_at_a_word_start() {
        let t = vec!["decis".to_owned(), "ws".to_owned()];
        assert_eq!(match_expr(&t).as_deref(), Some("\" decis\" OR \" ws\""));
        assert_eq!(match_expr(&[]), None);
    }

    #[test]
    fn the_query_language_follows_its_letters() {
        assert_eq!(query_lang("что решили"), Some(Lang::Ru));
        assert_eq!(query_lang("über websockets"), Some(Lang::De));
        assert_eq!(query_lang("websockets"), Some(Lang::En));
        assert_eq!(query_lang("2024"), None);
    }

    #[test]
    fn highlights_cover_whole_words_in_utf16_units() {
        let text = "Мы решили: WebSockets – да. Straße";
        let h = highlights(
            text,
            &["решил".into(), "websocket".into(), "strasse".into()],
        );
        let utf16: Vec<u16> = text.encode_utf16().collect();
        let words: Vec<String> = h
            .iter()
            .map(|&(s, e)| String::from_utf16_lossy(&utf16[s as usize..e as usize]))
            .collect();
        assert_eq!(words, ["решили", "WebSockets", "Straße"]);
    }
}
