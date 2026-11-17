// Copy one turn as Markdown for a status update: the answer, then its citations in first-use order.
import type { AskAnswer, Citation } from "../../core/bindings";
import { zoned } from "../../i18n/format";

/** Where a citation points, as text: a call by name and time, a document by title and source; never a link. */
function sourceOf(c: Citation): string {
  const p = c.provenance;
  if (p.type === "past_call") return `${p.call.title}, ${zoned(p.call.started_at, { dateStyle: "medium", timeStyle: "short" }, undefined)}`;
  if (p.type === "document") return [p.title, p.section, p.source_name].filter(Boolean).join(", ");
  return p.type === "jira" ? p.key : "";
}

// @cpt-algo:cpt-noter-algo-ui-ask-copy:p1
/** The selected turn only: answer text and reference numbers, then citations with their quotes and qualifiers. */
export function toMarkdown(a: Pick<AskAnswer, "answer_md" | "citations">): string {
  // @cpt-begin:cpt-noter-algo-ui-ask-copy:p1:inst-answer
  const out = [a.answer_md.trim()];
  // @cpt-end:cpt-noter-algo-ui-ask-copy:p1:inst-answer
  // @cpt-begin:cpt-noter-algo-ui-ask-copy:p1:inst-citations
  const used = [...a.answer_md.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]));
  const order = [...new Set(used)].flatMap((n) => a.citations.filter((c) => c.n === n));
  const rest = a.citations.filter((c) => !order.includes(c));
  for (const c of [...order, ...rest]) {
    // @cpt-begin:cpt-noter-algo-ui-ask-copy:p1:inst-qualifiers
    const marks = [c.strength === "weak" ? "Weak match" : "", c.deleted ? "Source deleted" : ""].filter(Boolean);
    // @cpt-end:cpt-noter-algo-ui-ask-copy:p1:inst-qualifiers
    out.push(`[${c.n}] ${[sourceOf(c), ...marks].filter(Boolean).join(" · ")}${c.quote ? `\n> ${c.quote.replace(/\n/g, "\n> ")}` : ""}`);
  }
  // @cpt-end:cpt-noter-algo-ui-ask-copy:p1:inst-citations
  // @cpt-begin:cpt-noter-algo-ui-ask-copy:p1:inst-return
  return out.join("\n\n");
  // @cpt-end:cpt-noter-algo-ui-ask-copy:p1:inst-return
}
