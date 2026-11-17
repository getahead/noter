import { describe, expect, it } from "vitest";

import type { AskAnswer, AskMsg, Citation, CoreError } from "../../core/bindings";
import { foldTurn, groupThreads, paragraphs, phaseOf, suggestionsOf, announcementOf, errorKeyOf, failedView } from "./model";

const cite = (n: number): Citation => ({ n, provenance: { type: "model_guess" }, quote: "q", speaker: null, strength: "strong", deleted: false });
const answer = (o: Partial<AskAnswer> = {}): AskAnswer => ({ turn_id: "t1", question: "Q", answer_md: "A", citations: [cite(1)], found: true, runtime: "claude_api_key", answered_locally: false, sensitive_sources_skipped: 0, keyword_only: false, only_weak_evidence: false, stopped: false, asked_at: 0, ...o });
const msgs = (...events: AskMsg["event"][]): AskMsg[] => events.map((event, i) => ({ seq: i + 1, event }));
const failed = (code: string): CoreError => ({ code, message: "", retryable: true }) as CoreError;

describe("foldTurn", () => {
  it("keeps the runtime and mode the core reported in started", () => {
    const v = foldTurn(msgs({ type: "started", runtime: "claude_account", mode: "cloud" }, { type: "delta", text: "x" }));
    expect([v.runtime, v.mode]).toEqual(["claude_account", "cloud"]);
  });
  it("appends deltas and keeps citations by their number", () => {
    const v = foldTurn(msgs({ type: "delta", text: "Hello " }, { type: "citation", citation: cite(1) }, { type: "delta", text: "world" }, { type: "citation", citation: cite(1) }));
    expect(v.text).toBe("Hello world");
    expect(v.citations.map((c) => c.n)).toEqual([1]);
    expect(phaseOf(v)).toBe("streaming");
  });
  it("replaces the partial with the authoritative answer on done", () => {
    const v = foldTurn(msgs({ type: "delta", text: "par" }, { type: "done", answer: answer({ answer_md: "full" }) }, { type: "ended", reason: "call_stopped" }));
    expect(v.text).toBe("full");
    expect(phaseOf(v)).toBe("ready");
  });
  it("names not found, weak, stopped, failed and interrupted turns", () => {
    expect(phaseOf(foldTurn(msgs({ type: "done", answer: answer({ found: false, citations: [] }) })))).toBe("not_found");
    expect(phaseOf(foldTurn(msgs({ type: "done", answer: answer({ citations: [] }) })))).toBe("not_found");
    expect(phaseOf(foldTurn(msgs({ type: "done", answer: answer({ only_weak_evidence: true }) })))).toBe("weak");
    const stopped = foldTurn(msgs({ type: "delta", text: "x" }, { type: "failed", error: failed("answer_stopped") }));
    expect(phaseOf(stopped)).toBe("stopped");
    expect(stopped.text).toBe("x");
    expect(phaseOf(foldTurn(msgs({ type: "failed", error: failed("runtime_unreachable") })))).toBe("error");
    expect(phaseOf(foldTurn(msgs({ type: "delta", text: "x" }, { type: "ended", reason: "unsubscribed" })))).toBe("interrupted");
  });
});

describe("paragraphs", () => {
  it("splits on blank lines and drops empties", () => {
    expect(paragraphs("a\nb\n\n\n c \n\n")).toEqual(["a\nb", "c"]);
  });
});

describe("groupThreads", () => {
  const now = new Date(2026, 10, 17, 12).getTime();
  const row = (id: string, at: Date) => ({ id, title: id, turns: 1, updated_at: at.getTime() });
  it("groups Today, Last week and Earlier, newest first", () => {
    const groups = groupThreads([row("old", new Date(2026, 10, 1)), row("y", new Date(2026, 10, 16, 23)), row("t", new Date(2026, 10, 17, 1))], now);
    expect(groups.map((g) => [g.key, g.rows.map((r) => r.id)])).toEqual([["today", ["t"]], ["last_week", ["y"]], ["earlier", ["old"]]]);
  });
});

describe("suggestionsOf", () => {
  it("asks about the first three people, and nothing while the directory is empty or unread", () => {
    const people = ["Ann", "Bo", "Cy", "Di"].map((name) => ({ display_name: name })) as never;
    expect(suggestionsOf(people, (n) => `Q ${n}`)).toEqual(["Q Ann", "Q Bo", "Q Cy"]);
    expect(suggestionsOf([{ display_name: "You", is_you: true }, ...(people as object[])] as never, (n) => `Q ${n}`)).toEqual(["Q Ann", "Q Bo", "Q Cy"]); // never the user's own row
    expect(suggestionsOf(null, (n) => n)).toEqual([]);
    expect(suggestionsOf(undefined, (n) => n)).toEqual([]);
  });
});

describe("announcementOf", () => {
  it("announces a ready turn once, with the citation count, and nothing else", () => {
    expect(announcementOf("ready", 1)).toBe("ask.ready_one");
    expect(announcementOf("ready", 3)).toBe("ask.ready_other");
    expect(announcementOf("weak", 2)).toBe("ask.ready_weak");
    expect(announcementOf("streaming", 0)).toBeNull();
    expect(announcementOf(null, 0)).toBeNull();
  });
});

describe("errorKeyOf", () => {
  it("names the unreachable runtime and falls back to the generic line", () => {
    expect(errorKeyOf(foldTurn(msgs({ type: "failed", error: failed("runtime_unavailable") })))).toBe("ask.error_runtime");
    expect(errorKeyOf(foldTurn(msgs({ type: "failed", error: failed("other") })))).toBe("ask.error");
  });
});

describe("a stored stopped turn", () => {
  it("reads as stopped on reopen and keeps its partial text and citations", () => {
    const v = foldTurn(msgs({ type: "done", answer: answer({ stopped: true, found: false, answer_md: "So far [1]", citations: [cite(1)] }) }));
    expect(phaseOf(v)).toBe("stopped");
    expect(v.text).toBe("So far [1]");
    expect(v.citations).toHaveLength(1);
  });
});

describe("failedView", () => {
  it("is a turn with no text and the error, which reads as an error (or the unreachable runtime)", () => {
    expect(phaseOf(failedView("runtime_unavailable"))).toBe("error");
    expect(errorKeyOf(failedView("runtime_unavailable"))).toBe("ask.error_runtime");
    expect(errorKeyOf(failedView(null))).toBe("ask.error");
  });
});
