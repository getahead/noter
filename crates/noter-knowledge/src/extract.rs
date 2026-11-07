//! Text extraction (TL-41): Markdown, text and code are read directly, HTML through html2text,
//! PDF through pdf-extract, Word through zip + quick-xml on `word/document.xml`. Every format
//! becomes a title and its sections (heading path + body).

use std::io::Read;
use std::path::Path;

use quick_xml::events::Event;

/// The formats a folder source indexes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Format {
    Markdown,
    Text,
    Pdf,
    Docx,
    Html,
    Code,
}

const CODE: &[&str] = &[
    "rs", "py", "js", "jsx", "ts", "tsx", "go", "java", "kt", "swift", "c", "h", "cc", "cpp",
    "hpp", "cs", "rb", "php", "sh", "sql", "scala", "m", "mm", "lua", "toml", "yaml", "yml",
];

impl Format {
    /// The format of a file by its extension, if it is one the index reads.
    pub(crate) fn of(path: &Path) -> Option<Format> {
        let ext = path.extension()?.to_str()?.to_ascii_lowercase();
        Some(match ext.as_str() {
            "md" | "markdown" => Format::Markdown,
            "txt" => Format::Text,
            "pdf" => Format::Pdf,
            "docx" => Format::Docx,
            "html" | "htm" => Format::Html,
            e if CODE.contains(&e) => Format::Code,
            _ => return None,
        })
    }

    pub(crate) fn mime(self) -> &'static str {
        match self {
            Format::Markdown => "text/markdown",
            Format::Text | Format::Code => "text/plain",
            Format::Pdf => "application/pdf",
            Format::Docx => {
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            }
            Format::Html => "text/html",
        }
    }
}

/// A section of a document: its headings (outermost first) and its text.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Section {
    pub path: Vec<String>,
    pub body: String,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Extracted {
    pub title: String,
    pub sections: Vec<Section>,
}

/// The document's text by format; `Err` carries the reason for the log, never file text.
pub(crate) fn extract(path: &Path, bytes: &[u8], format: Format) -> Result<Extracted, String> {
    let stem = path
        .file_stem()
        .map_or_else(String::new, |s| s.to_string_lossy().into_owned());
    match format {
        Format::Markdown => Ok(markdown(&stem, &String::from_utf8_lossy(bytes))),
        Format::Html => {
            let text = html2text::from_read(bytes, 10_000).map_err(|e| format!("html: {e}"))?;
            Ok(markdown(&stem, &text))
        }
        Format::Docx => Ok(markdown(&stem, &docx(bytes)?)),
        Format::Pdf => {
            // pdf-extract panics on some malformed files: a broken PDF is an error, not a dead job.
            let text = std::panic::catch_unwind(|| pdf_extract::extract_text_from_mem(bytes))
                .map_err(|_| "pdf: unreadable".to_string())?
                .map_err(|e| format!("pdf: {e}"))?;
            Ok(plain(stem, text))
        }
        Format::Text | Format::Code => Ok(plain(stem, String::from_utf8_lossy(bytes).into_owned())),
    }
}

/// A document without headings: one section under its file name.
fn plain(title: String, body: String) -> Extracted {
    Extracted {
        title,
        sections: vec![Section { path: vec![], body }],
    }
}

/// A `#`-heading's level and text.
fn heading(line: &str) -> Option<(usize, String)> {
    let level = line.bytes().take_while(|b| *b == b'#').count();
    let rest = &line[level..];
    ((1..=6).contains(&level) && rest.starts_with(' '))
        .then(|| (level, rest.trim().trim_end_matches('#').trim().to_string()))
        .filter(|(_, text)| !text.is_empty())
}

/// Markdown by its `#` headings outside fenced code. A level-1 heading before any other heading
/// is the title, not part of the paths.
fn markdown(stem: &str, text: &str) -> Extracted {
    let mut title = None;
    let mut stack: Vec<(usize, String)> = vec![];
    let mut sections = vec![Section {
        path: vec![],
        body: String::new(),
    }];
    let mut fenced = false;
    for line in text.lines() {
        if line.trim_start().starts_with("```") {
            fenced = !fenced;
        }
        match (fenced, heading(line)) {
            (false, Some((1, text))) if title.is_none() && stack.is_empty() => {
                title = Some(text);
            }
            (false, Some((level, text))) => {
                while stack.last().is_some_and(|(l, _)| *l >= level) {
                    stack.pop();
                }
                stack.push((level, text));
                sections.push(Section {
                    path: stack.iter().map(|(_, t)| t.clone()).collect(),
                    body: String::new(),
                });
            }
            _ => {
                let body = &mut sections.last_mut().expect("one section").body;
                body.push_str(line);
                body.push('\n');
            }
        }
    }
    Extracted {
        title: title.unwrap_or_else(|| stem.to_string()),
        sections,
    }
}

/// The most `word/document.xml` text a `.docx` may inflate to.
const MAX_XML: u64 = 64 * 1024 * 1024;

/// `word/document.xml` as Markdown: a paragraph styled `Title` is the title, `HeadingN` a heading
/// one level below it.
fn docx(bytes: &[u8]) -> Result<String, String> {
    let bad = |e: &dyn std::fmt::Display| format!("docx: {e}");
    let mut zip = zip::ZipArchive::new(std::io::Cursor::new(bytes)).map_err(|e| bad(&e))?;
    let mut xml = String::new();
    // A crafted archive can inflate far past its size: read at most `MAX_XML`.
    zip.by_name("word/document.xml")
        .map_err(|e| bad(&e))?
        .take(MAX_XML + 1)
        .read_to_string(&mut xml)
        .map_err(|e| bad(&e))?;
    if xml.len() as u64 > MAX_XML {
        return Err(bad(&"document.xml is too large"));
    }
    let mut reader = quick_xml::Reader::from_str(&xml);
    let mut out = String::new();
    let mut text = String::new();
    let mut style: Option<String> = None;
    let mut in_text = false;
    loop {
        match reader.read_event().map_err(|e| bad(&e))? {
            Event::Start(e) if e.name().as_ref() == b"w:t" => in_text = true,
            Event::End(e) if e.name().as_ref() == b"w:t" => in_text = false,
            Event::Empty(e) | Event::Start(e) if e.name().as_ref() == b"w:pStyle" => {
                style = e
                    .try_get_attribute("w:val")
                    .ok()
                    .flatten()
                    .map(|a| String::from_utf8_lossy(&a.value).into_owned());
            }
            Event::Text(t) if in_text => text.push_str(&t.decode().map_err(|e| bad(&e))?),
            // `&amp;`, `&#38;`: entity references arrive on their own.
            Event::GeneralRef(r) if in_text => {
                if let Some(c) = r.resolve_char_ref().map_err(|e| bad(&e))? {
                    text.push(c);
                } else {
                    let name = r.decode().map_err(|e| bad(&e))?;
                    text.push_str(quick_xml::escape::resolve_xml_entity(&name).unwrap_or(""));
                }
            }
            Event::End(e) if e.name().as_ref() == b"w:p" => {
                let level = match style.take().as_deref() {
                    Some("Title") => 1,
                    Some(s) => s
                        .strip_prefix("Heading")
                        .and_then(|n| n.parse::<usize>().ok())
                        .map_or(0, |n| (n + 1).min(6)),
                    None => 0,
                };
                let line = std::mem::take(&mut text);
                if level > 0 {
                    out.push_str(&format!("{} {}\n\n", "#".repeat(level), line.trim()));
                } else {
                    out.push_str(&line);
                    out.push_str("\n\n");
                }
            }
            Event::Eof => break,
            _ => {}
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_by_extension() {
        let of = |p: &str| Format::of(Path::new(p));
        assert_eq!(of("a/B.MD"), Some(Format::Markdown));
        assert_eq!(of("x.htm"), Some(Format::Html));
        assert_eq!(of("main.rs"), Some(Format::Code));
        assert_eq!(of("notes.txt").map(Format::mime), Some("text/plain"));
        assert_eq!(of("photo.png"), None);
        assert_eq!(of("Makefile"), None);
    }

    #[test]
    fn markdown_headings_make_paths_and_fences_hide_hashes() {
        let doc = markdown(
            "file",
            "intro\n# Guide\n## Setup\nsteps\n```\n# not a heading\n```\n### Linux\napt\n## Use\nrun\n",
        );
        assert_eq!(doc.title, "Guide");
        let paths: Vec<Vec<String>> = doc.sections.iter().map(|s| s.path.clone()).collect();
        assert_eq!(
            paths,
            vec![
                vec![],
                vec!["Setup".to_string()],
                vec!["Setup".into(), "Linux".into()],
                vec!["Use".to_string()],
            ]
        );
        assert!(doc.sections[1].body.contains("# not a heading"));
        assert_eq!(markdown("stem", "no headings").title, "stem");
        assert_eq!(heading("#hashtag"), None);
        assert_eq!(heading("## Closed ##"), Some((2, "Closed".into())));
    }

    /// The fixture's title and each section's heading path with a phrase of its text.
    fn fixture(name: &str) -> (String, Vec<(Vec<String>, String)>) {
        let path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures")
            .join(name);
        let bytes = std::fs::read(&path).unwrap();
        let doc = extract(&path, &bytes, Format::of(&path).unwrap()).unwrap();
        let sections = doc
            .sections
            .into_iter()
            .filter(|s| !s.body.trim().is_empty())
            .map(|s| {
                (
                    s.path,
                    s.body.split_whitespace().collect::<Vec<_>>().join(" "),
                )
            })
            .collect();
        (doc.title, sections)
    }

    #[test]
    fn the_six_formats_keep_their_title_and_heading_provenance() {
        let (title, sections) = fixture("guide.md");
        assert_eq!(title, "Install Guide");
        assert_eq!(sections[1].0, ["Setup"]);
        assert_eq!(sections[2].0, ["Setup", "macOS"]);
        assert!(sections[2].1.contains("system extension"));

        let (title, sections) = fixture("spec.docx");
        assert_eq!(title, "Design Spec");
        assert_eq!(sections[0].0, ["Overview"]);
        assert!(sections[0].1.contains("websockets"));
        assert_eq!(sections[1].0, ["Overview", "Limits"]);
        assert!(sections[1].1.contains("100 & no more"), "{}", sections[1].1);

        let (title, sections) = fixture("page.html");
        assert_eq!(title, "Release Notes");
        assert!(sections
            .iter()
            .any(|(p, t)| p == &["Fixes"] && t.contains("Crash on launch")));

        let (title, sections) = fixture("report.pdf");
        assert_eq!(title, "report");
        assert!(
            sections[0].1.contains("Quarterly report"),
            "{}",
            sections[0].1
        );
        assert!(sections[0].1.contains("third quarter"));

        let (title, sections) = fixture("notes.txt");
        assert_eq!((title.as_str(), sections[0].0.len()), ("notes", 0));
        assert!(sections[0].1.contains("beta on Friday"));

        let (title, sections) = fixture("retry.rs");
        assert_eq!(title, "retry");
        assert!(sections[0].1.contains("pub fn backoff"));
    }

    #[test]
    fn a_docx_inflating_past_the_limit_is_refused() {
        use std::io::Write;
        let mut zip = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
        zip.start_file(
            "word/document.xml",
            zip::write::SimpleFileOptions::default(),
        )
        .unwrap();
        let block = vec![b' '; 1 << 20];
        for _ in 0..=MAX_XML >> 20 {
            zip.write_all(&block).unwrap();
        }
        let bytes = zip.finish().unwrap().into_inner();
        assert!(bytes.len() < 1 << 20, "{}", bytes.len());
        let e = extract(Path::new("x.docx"), &bytes, Format::Docx).unwrap_err();
        assert!(e.contains("too large"), "{e}");
    }

    #[test]
    fn broken_files_are_errors_without_their_text() {
        let e = extract(Path::new("x.docx"), b"secret words", Format::Docx).unwrap_err();
        assert!(e.starts_with("docx:") && !e.contains("secret"), "{e}");
        assert!(extract(Path::new("x.pdf"), b"secret", Format::Pdf).is_err());
    }
}
