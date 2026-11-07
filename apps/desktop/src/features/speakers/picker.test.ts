import { describe, expect, it } from "vitest";

import type { PersonChip, PersonRow, SpeakerView } from "../../core/bindings";
import {
  candidates,
  fold,
  matchPeople,
  validateNew,
  CAP_INLINE,
  CAP_POPOVER,
  type Group,
} from "./picker";

const chip = (id: string, name: string, you = false): PersonChip => ({
  id,
  display_name: name,
  short_name: name.split(" ")[0],
  initials: name.slice(0, 2),
  is_you: you,
});
const entry = (id: string, name: string, caption = "") => ({
  id,
  display_name: name,
  short_name: name,
  initials: name.slice(0, 2),
  caption,
});
const group = (names: string[]): Group => ({
  key: "call",
  entries: names.map((n, i) => entry(`p${i}`, n)),
});

describe("fold", () => {
  it("ignores case, ё/е, ß/ss and surrounding spaces", () => {
    expect(fold("  Фёдор ")).toBe(fold("федор"));
    expect(fold("Strauß")).toBe(fold("STRAUSS"));
  });
});

describe("matchPeople", () => {
  it("keeps the core order, folds the query and caps the group", () => {
    const g = group([
      "Pavel R.",
      "Anna K.",
      "Paula S.",
      "Pablo",
      "Pat",
      "Pam",
      "Pia",
    ]);
    expect(
      matchPeople("pa", [g], CAP_INLINE)[0].entries.map((e) => e.display_name),
    ).toEqual(["Pavel R.", "Paula S.", "Pablo", "Pat", "Pam"]);
    expect(matchPeople("", [g], CAP_POPOVER)[0].entries).toHaveLength(7);
    expect(
      matchPeople(
        "",
        [group(Array.from({ length: 12 }, (_, i) => `N${i}`))],
        CAP_POPOVER,
      )[0].entries,
    ).toHaveLength(CAP_POPOVER);
  });
  it("matches aliases and drops empty groups", () => {
    const g: Group = {
      key: "recent",
      entries: [{ ...entry("a", "Alexander"), aliases: ["Саша"] }],
    };
    expect(matchPeople("саша", [g], 5)[0].entries).toHaveLength(1);
    expect(matchPeople("zzz", [g], 5)).toEqual([]);
  });
});

describe("validateNew", () => {
  it("trims the name to 1–80 characters and checks the email shape", () => {
    expect(validateNew({ name: "  ", email: "" })).toEqual({
      name: "speakers.new.name_required",
    });
    expect(validateNew({ name: "x".repeat(81), email: "" }).name).toBeDefined();
    expect(validateNew({ name: "Lena", email: "" })).toEqual({});
    expect(validateNew({ name: "Lena", email: "lena@" })).toEqual({
      email: "speakers.new.email_invalid",
    });
    expect(validateNew({ name: "Lena", email: "lena@example.com" })).toEqual(
      {},
    );
  });
});

describe("candidates", () => {
  const spk = (
    label: SpeakerView["label"],
    suggestion: PersonChip | null = null,
  ) => ({ label, suggestion }) as SpeakerView;
  it("In this call: participants, named speakers and suggestions, once each and never you; Recent: the rest in core order", () => {
    const people = [chip("p1", "Pavel R."), chip("p9", "Zed")].map(
      (c) => ({ ...c, email: null }) as unknown as PersonRow,
    );
    const g = candidates(
      [chip("me", "Me", true), chip("p1", "Pavel R."), chip("p2", "Anna K.")],
      [
        spk({ type: "person", person: chip("p3", "Dmitri S.") }),
        spk({ type: "unnamed", n: 3 }, chip("p2", "Anna K.")),
      ],
      people,
    );
    expect(g[0].entries.map((e) => e.id)).toEqual(["p1", "p2", "p3"]);
    expect(g[1].entries.map((e) => e.id)).toEqual(["p9"]);
  });
  it("hides Recent people when the core has none to list", () => {
    expect(candidates([chip("p1", "Pavel")], [], null)).toHaveLength(1);
  });
});
