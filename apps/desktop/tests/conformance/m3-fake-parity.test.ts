// Fake-core parity (UI M3): four behaviours the fake once got wrong, each proven against both cores —
// people_merge keeps the voice profile, call_tags_set emits entity:changed, search matches per word,
// ask_start answers "not found" when nothing in scope matches.
import { afterEach, describe, expect, it } from "vitest";

import type { AskMsg, AskScope, Core } from "../../src/core/bindings";
import { exercised } from "../support/core";
import { ok, until } from "../support/results";
import { openScenario, type Scenario } from "../support/scenario";
import { PAST_CALL } from "../support/world-presets";

let s: Scenario;
let main: Core;
afterEach(async () => {
  await s.dispose();
});
const open = () => {
  s = openScenario({ alsoRecord: exercised });
  main = s.core("main");
};
const person = async (name: string) => ok(await main.personCreate({ display_name: name, email: null, role: null, org: null })).person;

describe("people_merge keeps the voice profile", () => {
  it("the target gains the source's profile", async () => {
    open();
    const target = await person("Parity Target");
    const source = { id: "per_pavel" }; // a fixture person: the real core builds a profile from a named speaker
    ok(await main.voiceProfileCreate({ person_id: source.id }));
    expect(ok(await main.peopleMerge({ source: source.id, target: target.id })).person.voice_profile).toBe(true);
  });

  it("the target keeps its own profile when the source has none", async () => {
    open();
    const source = await person("Parity Source Two");
    const target = { id: "per_pavel" };
    ok(await main.voiceProfileCreate({ person_id: target.id }));
    expect(ok(await main.peopleMerge({ source: source.id, target: target.id })).person.voice_profile).toBe(true);
  });
});

describe("call_tags_set emits entity:changed", () => {
  it("for a call whose tags changed, carrying the new tag, and not for an unchanged one", async () => {
    open();
    const changed = await s.events("entity:changed");
    ok(await main.callTagsSet({ call_ids: [PAST_CALL], add: ["ParityTag"], remove: [] }));
    const seen = await until(() => changed.all.find((e) => e.type === "call" && e.call.id === PAST_CALL && e.call.tags.includes("ParityTag")), "the call's entity:changed");
    expect(seen.type).toBe("call");
    expect(ok(await main.callGet({ call_id: PAST_CALL })).call.rev).toBe(seen.type === "call" ? seen.call.rev : -1); // the event carries the call's new rev
    const before = changed.all.length;
    ok(await main.callTagsSet({ call_ids: [PAST_CALL], add: ["ParityTag"], remove: [] }));
    await new Promise((r) => setTimeout(r, 200));
    expect(changed.all.length).toBe(before);
  });
});

describe("search matches per word", () => {
  it("a mixed-language query finds the span of its Russian word, not only a whole-phrase match", async () => {
    open();
    const r = ok(await main.search({ query: "websocket уведомления", filter: {}, limit: null }));
    expect(r.calls.some((h) => h.snippet.includes("уведомления"))).toBe(true);
    // A word that matches nothing does not hide the word that does.
    expect(ok(await main.search({ query: "zzqx уведомления", filter: {}, limit: null })).calls.some((h) => h.snippet.includes("уведомления"))).toBe(true);
  });
});

describe("ask_start answers not found", () => {
  it("when no word of the question is in scope: the sentence, no citations, found false", async () => {
    open();
    const scope: AskScope = { people: [], call_types: [], from: null, to: null, topic_id: null, call_id: PAST_CALL, include_documents: false };
    const got: AskMsg[] = [];
    ok(await main.askStart({ thread_id: null, question: "zzqx quuxplan frobnicate", scope }, (m: AskMsg) => got.push(m)));
    const done = await until(() => got.find((m) => m.event.type === "done"), "done");
    const answer = done.event.type === "done" ? done.event.answer : null;
    expect(answer).toMatchObject({ found: false, citations: [], answer_md: "I could not find this in your calls." });
  });
});

describe("ask_scope_presets names each preset in its scope", () => {
  it("scope.preset is the preset id", async () => {
    open();
    const { presets } = ok(await main.askScopePresets({}));
    expect(presets.length).toBeGreaterThan(0);
    for (const p of presets) expect(p.scope.preset).toBe(p.id);
  });
});
