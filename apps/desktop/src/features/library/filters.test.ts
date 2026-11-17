import { describe, expect, it } from "vitest";
import { apply, BLANK, datePreset, isFiltered, reconcile, shiftDay, tokens, type Lookups } from "./filters";

const look: Lookups = { person: (id) => ({ per_anna: "Anna", per_bo: "Boris" })[id] ?? id, type: (id) => ({ planning: "Planning" })[id] ?? id };

describe("filter state (cpt-noter-algo-ui-library-search-topics-filters)", () => {
  it("sets a value once and removes it on the second choice; groups combine", () => {
    let s = apply(BLANK, { type: "toggle", group: "people", value: "per_anna" });
    s = apply(s, { type: "toggle", group: "people", value: "per_anna" });
    expect(s.filter.people).toEqual([]);
    s = apply(s, { type: "toggle", group: "people", value: "per_anna" });
    s = apply(s, { type: "toggle", group: "people", value: "per_bo" });
    s = apply(s, { type: "toggle", group: "tags", value: "release" });
    expect(s.filter).toMatchObject({ people: ["per_anna", "per_bo"], tags: ["release"] });
  });
  it("derives tokens in order: people, types, tags, languages, date, open items", () => {
    let s = BLANK;
    s = apply(s, { type: "open_items", on: true });
    s = apply(s, { type: "date", preset: "7d", today: "2026-11-17" });
    s = apply(s, { type: "toggle", group: "languages", value: "ru" });
    s = apply(s, { type: "toggle", group: "tags", value: "release" });
    s = apply(s, { type: "toggle", group: "call_types", value: "planning" });
    s = apply(s, { type: "toggle", group: "people", value: "per_anna" });
    expect(tokens(s, look).map((x) => x.label)).toEqual(["Anna", "Planning", "Tag: release", "RU", "Last 7 Days", "Has open items"]);
  });
  it("removing a token removes only its value", () => {
    let s = apply(BLANK, { type: "toggle", group: "people", value: "per_anna" });
    s = apply(s, { type: "toggle", group: "people", value: "per_bo" });
    s = apply(s, { type: "open_items", on: true });
    const [anna, , open] = tokens(s, look);
    s = apply(s, { type: "remove", token: anna! });
    expect(s.filter.people).toEqual(["per_bo"]);
    s = apply(s, { type: "remove", token: open! });
    expect(s.filter.has_open_items).toBeNull();
  });
  it("Clear drops filters and tokens but keeps the typed words", () => {
    let s = apply({ ...BLANK, words: "websocket" }, { type: "toggle", group: "tags", value: "x" });
    s = apply(s, { type: "date", preset: "30d", today: "2026-11-17" });
    s = apply(s, { type: "clear" });
    expect(s).toEqual({ ...BLANK, words: "websocket" });
    expect(tokens(s, look)).toEqual([]);
  });
  it("date presets map to from/to and back: Any Time, Last 7 Days, Last 30 Days, Custom range", () => {
    expect(datePreset({})).toBe("any");
    let s = apply(BLANK, { type: "date", preset: "7d", today: "2026-11-17" });
    expect(s.filter).toMatchObject({ from: "2026-11-11", to: "2026-11-17" });
    expect(datePreset(s.filter)).toBe("7d");
    s = apply(s, { type: "date", preset: "30d", today: "2026-11-17" });
    expect(s.filter.from).toBe("2026-10-19");
    s = apply(s, { type: "date", preset: "custom", from: "2026-01-02", to: "2026-01-09" });
    expect(datePreset(s.filter)).toBe("custom");
    expect(tokens(s, look).at(-1)!.label).toBe("2026-01-02 – 2026-01-09");
    s = apply(s, { type: "date", preset: "any", today: "2026-11-17" });
    expect(s.filter.from).toBeNull();
    expect(shiftDay("2026-03-01", -1)).toBe("2026-02-28");
  });
  it("words are kept apart from the filter", () => {
    expect(apply(BLANK, { type: "words", words: "hi" })).toEqual({ ...BLANK, words: "hi" });
  });
  it("a tag choice from the # suggestions adds the tag filter once", () => {
    const s = apply(BLANK, { type: "toggle", group: "tags", value: "release" });
    expect(apply(s, { type: "add", group: "tags", value: "release" }).filter.tags).toEqual(["release"]);
  });
});

describe("reconcile and isFiltered", () => {
  it("re-reads only when the filter changed, never for words", () => {
    expect(reconcile(BLANK, { type: "words", words: "x" }).reread).toBe(false);
    const r = reconcile(BLANK, { type: "open_items", on: true });
    expect(r.reread).toBe(true);
    expect(isFiltered(r.next.filter)).toBe(true);
    expect(isFiltered(reconcile(r.next, { type: "clear" }).next.filter)).toBe(false);
  });
});
