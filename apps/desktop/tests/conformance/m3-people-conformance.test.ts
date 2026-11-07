// M3 people conformance (2.23, slice 1): people_list, person_get, person_create, person_update,
// people_merge and person_delete answer the same on the fake and the real core — result shapes,
// revisions and every typed error. Each test makes its own people, so no fixture detail matters.
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Core } from "../../src/core/bindings";
import { exercised } from "../support/core";
import { ok, refused } from "../support/results";
import { openScenario, type Scenario } from "../support/scenario";

let s: Scenario;
let main: Core;
let n = 0;
beforeEach(() => {
  s = openScenario({ alsoRecord: exercised });
  main = s.core("main");
});
afterEach(async () => {
  await s.dispose();
});

/** A person with a name no other test or fixture uses. */
const make = async (name = `Conf Person ${++n}`) => ok(await main.personCreate({ display_name: name, email: null, role: null, org: null })).person;

describe("people_list", () => {
  it("lists people with You and the unnamed queue, and finds a person by a name part", async () => {
    const made = await make("Zinaida Quill");
    const all = ok(await main.peopleList({ query: null }));
    expect(all.people.some((p) => p.is_you)).toBe(true);
    expect(all.people.some((p) => p.id === made.id)).toBe(true);
    expect(Array.isArray(all.unnamed)).toBe(true);
    const found = ok(await main.peopleList({ query: "quill" })).people;
    expect(found.map((p) => p.id)).toContain(made.id);
    expect(ok(await main.peopleList({ query: "no such person xyz" })).people).toEqual([]);
  });
});

describe("person_create and person_get", () => {
  it("creates a person with rev 1 and a change, and a new page has empty sections", async () => {
    const done = ok(await main.personCreate({ display_name: "Nina Park Conf", email: "nina@example.com", role: "PM", org: null }));
    expect(done.change_id).toBeTruthy();
    expect(done.person).toMatchObject({ rev: 1, display_name: "Nina Park Conf", email: "nina@example.com", role: "PM", is_you: false, voice_profile: false });
    const page = ok(await main.personGet({ person_id: done.person.id }));
    expect(page.person.id).toBe(done.person.id);
    expect([page.calls, page.owns_open, page.you_owe, page.open_questions]).toEqual([[], [], [], []]);
  });

  it("refuses a blank name and an unknown person", async () => {
    const blank = refused(await main.personCreate({ display_name: "  ", email: null, role: null, org: null }));
    expect(blank).toMatchObject({ code: "invalid_input", detail: { type: "validation", rule: "required" } });
    expect(refused(await main.personGet({ person_id: "per_nobody" })).code).toBe("not_found");
  });
});

describe("person_update", () => {
  it("applies the patch with a new rev and keeps the fields it does not name", async () => {
    const p = await make();
    const done = ok(await main.personUpdate({ person_id: p.id, rev: p.rev, patch: { role: "Tech lead", aliases: ["Conf Alias"] } }));
    expect(done.person.rev).toBe(p.rev + 1);
    expect(done.person).toMatchObject({ role: "Tech lead", display_name: p.display_name });
    expect(done.person.aliases).toEqual(["Conf Alias"]);
    expect(done.change_id).toBeTruthy();
  });

  it("a stale rev is a conflict with the current rev; a blank name and an unknown person are refused", async () => {
    const p = await make();
    ok(await main.personUpdate({ person_id: p.id, rev: p.rev, patch: { role: "A" } }));
    const stale = refused(await main.personUpdate({ person_id: p.id, rev: p.rev, patch: { role: "B" } }));
    expect(stale).toMatchObject({ code: "conflict", detail: { type: "conflict", current_rev: p.rev + 1 } });
    expect(refused(await main.personUpdate({ person_id: p.id, rev: p.rev + 1, patch: { display_name: "  " } })).code).toBe("invalid_input");
    expect(refused(await main.personUpdate({ person_id: "per_nobody", rev: 1, patch: {} })).code).toBe("not_found");
  });
});

describe("people_merge", () => {
  it("keeps the target with a new rev, adds the source name as an alias and removes the source", async () => {
    const source = await make("Conf Source");
    const target = await make("Conf Target");
    const done = ok(await main.peopleMerge({ source: source.id, target: target.id }));
    expect(done.change_id).toBeTruthy();
    expect(done.person).toMatchObject({ id: target.id, rev: target.rev + 1 });
    expect(done.person.aliases).toContain("Conf Source");
    expect(refused(await main.personGet({ person_id: source.id })).code).toBe("not_found");
  });

  it("refuses merging a person into themselves and unknown people", async () => {
    const p = await make();
    expect(refused(await main.peopleMerge({ source: p.id, target: p.id })).code).toBe("invalid_input");
    expect(refused(await main.peopleMerge({ source: p.id, target: "per_nobody" })).code).toBe("not_found");
    expect(refused(await main.peopleMerge({ source: "per_nobody", target: p.id })).code).toBe("not_found");
  });
});

describe("person_delete", () => {
  it("removes the person and answers the count; the page is gone", async () => {
    const p = await make();
    expect(ok(await main.personDelete({ person_id: p.id }))).toEqual({ deleted: 1 });
    expect(refused(await main.personGet({ person_id: p.id })).code).toBe("not_found");
    expect(ok(await main.peopleList({ query: null })).people.some((x) => x.id === p.id)).toBe(false);
  });

  it("refuses to delete You and an unknown person", async () => {
    const you = ok(await main.peopleList({ query: null })).people.find((x) => x.is_you)!;
    expect(refused(await main.personDelete({ person_id: you.id })).code).toBe("invalid_input");
    expect(refused(await main.personDelete({ person_id: "per_nobody" })).code).toBe("not_found");
  });
});
