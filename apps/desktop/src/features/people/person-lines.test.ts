import { describe, expect, it } from "vitest";

import { languagesLine, personSubtitle, voiceLine } from "./person-lines";

const prefs = { time_format: "h24", first_weekday: 1, time_zone: "UTC" } as never;
const day = (m: number, d: number) => Date.UTC(2026, m, d, 12);

describe("Person page lines (DESIGN PE-R1, PE-R5; issue 1152)", () => {
  it("cpt-noter-seq-people-prepare-one-on-one — #1152: subtitle: role · calls since the first month · cadence", () => {
    const page = { person: { role: "Frontend" }, calls: [{ started_at: day(9, 16) }, { started_at: day(8, 4) }], cadence: { one_on_one: true, every: "weekly" } } as never;
    expect(personSubtitle(page, prefs)).toBe("Frontend · 2 calls since Sep · 1:1 weekly");
    expect(personSubtitle({ person: { role: null }, calls: [{ started_at: day(9, 2) }], cadence: null } as never, prefs)).toBe("1 call since Oct");
    expect(personSubtitle({ person: { role: null }, calls: [], cadence: { one_on_one: false, every: "every_two_weeks" } } as never, prefs)).toBe("every 2 weeks");
    expect(personSubtitle({ person: { role: "QA" }, calls: [], cadence: { one_on_one: true, every: null } } as never, prefs)).toBe("QA · 1:1");
  });
  it("cpt-noter-seq-people-prepare-one-on-one — #1152: languages: each with its whole-percent share", () => {
    expect(languagesLine([{ lang: "ru", share: 0.714 }, { lang: "en", share: 0.26 }, { lang: "de", share: 0.026 }] as never)).toBe("Russian 71 % · English 26 % · German 3 %");
    expect(languagesLine([])).toBeNull();
  });
  it("cpt-noter-seq-people-prepare-one-on-one — #1152: voice profile: since when, how many profiles matched in how many calls", () => {
    expect(voiceLine({ opted_in_at: day(9, 3), profiles: 2, matched_calls: 28 }, prefs)).toBe("On since Oct 3 · 2 profiles · matched in 28 calls");
    expect(voiceLine({ opted_in_at: null, profiles: 1, matched_calls: 1 }, prefs)).toBe("On · 1 profile · matched in 1 call");
    // right after Create Profile nothing is counted yet: a part that is 0 is left out (#1198 review)
    expect(voiceLine({ opted_in_at: day(10, 22), profiles: 0, matched_calls: 0 }, prefs)).toBe("On since Nov 22");
    expect(voiceLine({ opted_in_at: day(10, 22), profiles: 1, matched_calls: 0 }, prefs)).toBe("On since Nov 22 · 1 profile");
  });
});
