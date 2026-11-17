import { describe, expect, it } from "vitest";
import type { PersonRow, UnnamedSpeaker } from "../../core/bindings";
import { fold, matches, sortPeople, view } from "./identity";

const person = (o: Partial<PersonRow>): PersonRow => ({
  id: "per_x", rev: 1, display_name: "Anna Kuznetsova", short_name: "Anna K.", initials: "AK", email: null, role: null,
  org: null, aliases: [], is_you: false, voice_profile: false, last_call_at: null, open_items: 0, you_owe: 0, notes: null, ...o,
});
const speaker = (n: number): UnnamedSpeaker => ({ call: { id: "call_1", title: "Sync", started_at: 0 } as never, speaker_id: `spk_${n}`, n, segment_count: 3, sample: null, suggestion: null });

describe("cpt-noter-algo-ui-people-identity", () => {
  it("folds ё/е and ß/ss and ignores case, keeping the original spelling", () => {
    expect(fold("Фёдор")).toBe("федор");
    expect(fold("Straße")).toBe("strasse");
    expect(matches(person({ display_name: "Фёдор Ж." }), "ФЕДОР")).toBe(true);
    expect(matches(person({ display_name: "Max Strauß" }), "strauss")).toBe(true);
  });
  it("matches the display name, the short name and every alias; a blank query matches all", () => {
    const p = person({ aliases: ["Дима"] });
    expect(["kuz", "anna k", "дима", "  "].map((q) => matches(p, q))).toEqual([true, true, true, true]);
    expect(matches(p, "lena")).toBe(false);
  });
  it("sorts by short name with the interface collation", () => {
    const rows = sortPeople([person({ id: "b", short_name: "Zoe" }), person({ id: "a", short_name: "anna" })]);
    expect(rows.map((r) => r.id)).toEqual(["a", "b"]);
  });
});

describe("cpt-noter-state-ui-people-view", () => {
  const read = { people: [person({ id: "a" }), person({ id: "me", is_you: true, display_name: "You", short_name: "You" })], unnamed: [speaker(2)] };
  it("EMPTY when no one exists besides You, even with a query", () => {
    expect(view({ people: [person({ is_you: true })], unnamed: [] }, "x").status).toBe("EMPTY");
  });
  it("NO_MATCH when only the query excludes the people; LISTED otherwise, without You", () => {
    expect(view(read, "lena").status).toBe("NO_MATCH");
    const listed = view(read, "");
    expect(listed.status).toBe("LISTED");
    expect(listed.rows.map((r) => r.id)).toEqual(["a"]);
  });
  it("keeps unnamed rows keyed by call and speaker, matching their 'Speaker N' label, and omits the group when empty", () => {
    expect(view(read, "").unnamed).toHaveLength(1);
    expect(view(read, "speaker 2").unnamed).toHaveLength(1);
    expect(view({ ...read, unnamed: [] }, "").unnamed).toEqual([]);
  });
});
