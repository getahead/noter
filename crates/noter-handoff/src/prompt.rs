//! The handoff skill's packet and its output as Markdown.

use noter_llm::{Packet, PacketItem, SourceClass};
use noter_protocol::model::settings::AuditWhat;
use noter_protocol::model::{HandoffTarget, ItemKind};
use noter_protocol::skills::HandoffPromptOutput;

/// One evidence line: the transcript words of an item's span, with speaker and time.
#[derive(Debug, Clone, PartialEq)]
pub struct Quote {
    /// The segment the words come from.
    pub segment_id: String,
    pub speaker: String,
    /// `m:ss` into the call.
    pub at: String,
    pub text: String,
}

/// What the prompt may say: only knowledge the core actually has (indexed documents are M3).
#[derive(Debug, Clone, PartialEq)]
pub struct Facts {
    pub kind: ItemKind,
    pub text: String,
    pub call_title: String,
    pub linked_issue: Option<String>,
    pub evidence: Vec<Quote>,
    /// Decisions of the same call.
    pub decisions: Vec<String>,
    /// The mapped repository's key and folder.
    pub repo: Option<(String, String)>,
    pub target: HandoffTarget,
    /// A sensitive call's words never go to a cloud packet.
    pub sensitive: bool,
}

// @cpt-begin:cpt-noter-algo-core-handoff-build:p1:inst-build-packet
/// The skill packet: the item, its evidence, decisions, link and repository as items the gate
/// releases (or keeps local for a sensitive call).
pub fn packet(f: &Facts) -> Packet {
    let source = if f.sensitive {
        SourceClass::Sensitive
    } else {
        SourceClass::Normal
    };
    let item = |id: String, text: String| PacketItem { id, source, text };
    let tool = match f.target {
        HandoffTarget::ClaudeCode => "Claude Code",
        HandoffTarget::Codex => "Codex",
    };
    let mut items = vec![
        item(
            "item".into(),
            format!("{:?} from \"{}\": {}", f.kind, f.call_title, f.text),
        ),
        item("target".into(), format!("The prompt is for {tool}.")),
    ];
    items.extend(f.evidence.iter().map(|q| {
        item(
            q.segment_id.clone(),
            format!("[{}] {}: {}", q.at, q.speaker, q.text),
        )
    }));
    items.extend(
        f.decisions
            .iter()
            .enumerate()
            .map(|(i, d)| item(format!("decision_{}", i + 1), format!("Decided: {d}"))),
    );
    if let Some(key) = &f.linked_issue {
        items.push(item("link".into(), format!("Linked issue: {key}")));
    }
    if let Some((key, path)) = &f.repo {
        items.push(item("repo".into(), format!("Repository {key} at {path}")));
    }
    let mut people: Vec<String> = f.evidence.iter().map(|q| q.speaker.clone()).collect();
    people.sort();
    people.dedup();
    Packet {
        what: AuditWhat::HandoffPrompt,
        items,
        people,
        context: Default::default(),
    }
}
// @cpt-end:cpt-noter-algo-core-handoff-build:p1:inst-build-packet

// @cpt-begin:cpt-noter-algo-core-handoff-build:p1:inst-build-render
/// The output with only the links the packet carried (the linked issue): the model may not
/// invent references.
pub fn checked(mut out: HandoffPromptOutput, permitted: &[String]) -> HandoffPromptOutput {
    out.links.retain(|l| permitted.contains(l));
    out
}

/// The prompt as Markdown, sections in the schema's order (empty ones left out), closing with
/// the instruction to ask before going outside the scope.
pub fn render(out: &HandoffPromptOutput) -> String {
    let mut md = format!(
        "# {}\n\n## Context\n\n{}\n",
        out.goal.trim(),
        out.context.trim()
    );
    let list = |md: &mut String, title: &str, lines: &[String]| {
        if !lines.is_empty() {
            md.push_str(&format!("\n## {title}\n\n"));
            for l in lines {
                md.push_str(&format!("- {}\n", l.trim()));
            }
        }
    };
    list(&mut md, "Constraints", &out.constraints);
    list(&mut md, "Acceptance criteria", &out.acceptance);
    list(&mut md, "Links", &out.links);
    if let Some(repo) = &out.repo {
        md.push_str(&format!("\n## Repository\n\n{}\n", repo.trim()));
    }
    md.push_str(&format!(
        "\n## Guardrails\n\n{}\n\nAsk before touching anything outside this scope.\n",
        out.guardrails.trim()
    ));
    md
}
// @cpt-end:cpt-noter-algo-core-handoff-build:p1:inst-build-render
