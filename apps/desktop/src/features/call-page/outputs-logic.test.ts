import { describe, expect, it } from "vitest";

import type { ItemView, OutputSection, SectionKind } from "../../core/bindings";
import { applyProgress, mergeSection, metaLine, orderSections, sectionCounts, summaryReadyNow, versionLabel } from "./outputs-logic";

const item = (review: ItemView["review"]) => ({ id: `i_${review}_${Math.random()}`, review }) as unknown as ItemView;
const sec = (kind: SectionKind, o: Partial<OutputSection> = {}): OutputSection =>
  ({ kind, state: { type: "ready" }, summary_id: null, rev: null, body_md: null, items: [], reviews: [], writer: null, user_edited: false, regenerated_with_edits: false, names_updated: false, version_count: 1, ...o }) as OutputSection;

describe("orderSections", () => {
  it("keeps PRD order whatever order the core sent", () => {
    const out = orderSections([sec("open_questions"), sec("summary"), sec("per_participant"), sec("decisions"), sec("action_items")]);
    expect(out.map((s) => s.kind)).toEqual(["summary", "decisions", "action_items", "open_questions", "per_participant"]);
  });
  it("omits an empty Risks section and the M4 role reviews, keeps other empty sections", () => {
    const out = orderSections([sec("risks", { state: { type: "empty" } }), sec("role_reviews"), sec("decisions", { state: { type: "empty" } })]);
    expect(out.map((s) => s.kind)).toEqual(["decisions"]);
  });
  it("keeps Risks when it has items", () => {
    expect(orderSections([sec("risks", { items: [item("suggested")] })]).map((s) => s.kind)).toEqual(["risks"]);
  });
});

describe("sectionCounts", () => {
  it("counts non-rejected rows and the suggestions among them", () => {
    const s = sec("action_items", { items: [item("suggested"), item("suggested"), item("accepted"), item("rejected")] });
    expect(sectionCounts(s)).toEqual({ shown: 3, review: 2, rejected: 1 });
  });
  it("hides review while the section is still writing", () => {
    const s = sec("action_items", { state: { type: "writing" }, items: [item("suggested")] });
    expect(sectionCounts(s).review).toBe(0);
  });
});

describe("applyProgress", () => {
  const base = { call_id: "c1", status: "writing" as const };
  it("changes only the matching call and section", () => {
    const secs = [sec("summary"), sec("decisions")];
    const next = applyProgress(secs, "c1", { ...base, section: "decisions", state: { type: "writing" } });
    expect(next[0]).toBe(secs[0]);
    expect(next[1]!.state).toEqual({ type: "writing" });
  });
  it("ignores another call", () => {
    const secs = [sec("summary")];
    expect(applyProgress(secs, "c2", { ...base, section: "summary", state: { type: "writing" } })).toBe(secs);
  });
  it("keeps prior text on a failure", () => {
    const secs = [sec("summary", { body_md: "old" })];
    const next = applyProgress(secs, "c1", { ...base, section: "summary", state: { type: "failed", code: "job_failed", local_fallback_available: true } as never });
    expect(next[0]!.body_md).toBe("old");
    expect(next[0]!.state.type).toBe("failed");
  });
});

describe("mergeSection", () => {
  const read = sec("summary", { body_md: "old" });
  it("prefers the section the core sent whole over the one read", () => {
    const sent = sec("summary", { body_md: "new" });
    expect(mergeSection(read, sent, undefined)).toBe(sent);
  });
  it("overlays the state progress reported, keeping the text", () => {
    const m = mergeSection(read, undefined, { call_id: "c", status: "writing", section: "summary", state: { type: "writing" } });
    expect(m).toMatchObject({ body_md: "old", state: { type: "writing" } });
  });
  it("returns nothing for a section nobody has", () => expect(mergeSection(undefined, undefined, undefined)).toBeUndefined());
});

describe("metaLine and versionLabel", () => {
  const call = { started_at: 1_000_000, duration_ms: 60_000, languages: ["en"] } as never;
  const writer = { runtime: "claude_api_key", model: "m", skill: "s", skill_version: "1", generated_at: 1_160_000, from_pass: "final" } as never;
  it("names the writer and the time after the call", () => {
    expect(metaLine(sec("summary", { writer }), call, "Summary")).toBe("Summary · English · Claude Code · 1 min 40 s after the call");
  });
  it("is the heading alone for text nobody wrote yet", () => expect(metaLine(sec("summary"), call, "Summary")).toBe("Summary"));
  it("labels a user's edit with its time and a generated version with its number and writer", () => {
    const prefs = { time_format: "h24", first_weekday: 1, time_zone: "UTC" } as never;
    expect(versionLabel({ id: "v", n: 3, kind: "user_edit", writer: null, created_at: Date.UTC(2026, 10, 5, 10, 42) }, prefs)).toBe("Your Edit · 10:42");
    expect(versionLabel({ id: "v", n: 1, kind: "generated", writer, created_at: 0 }, prefs)).toBe("v1 · Claude Code · 00:00");
  });
});

describe("summaryReadyNow", () => {
  it("is true only when the Summary section itself settled as ready", () => {
    expect(summaryReadyNow("summary:ready")).toBe(true);
    expect(summaryReadyNow("decisions:ready,summary:ready")).toBe(true);
    expect(summaryReadyNow("decisions:ready")).toBe(false);
    expect(summaryReadyNow("summary:failed")).toBe(false);
    expect(summaryReadyNow("")).toBe(false);
  });
});
