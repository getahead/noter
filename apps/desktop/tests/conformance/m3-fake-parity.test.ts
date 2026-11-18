// Fake-core parity (UI M3): four behaviours the fake once got wrong, each proven against both cores —
// people_merge keeps the voice profile, call_tags_set emits entity:changed, search matches per word,
// ask_start answers "not found" when nothing in scope matches; Claude reuse needs the personal-use box (#1000).
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { AskMsg, AskScope, Core } from "../../src/core/bindings";
import { exercised, isFake } from "../support/core";
import { ok, refused, until } from "../support/results";
import { openScenario, type Scenario } from "../support/scenario";
import { PAST_CALL } from "../support/world-presets";
import { wire } from "./history-support";

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

describe("account_use_existing of Claude needs the personal-use box", () => {
  it("cpt-noter-seq-settings-sign-in-account (Claude Code already signed in): refused unticked, signed in ticked, the confirmation kept until sign-out", async () => {
    const command = process.env.NOTER_CORE_CMD;
    const dir = mkdtempSync(join(tmpdir(), "noter-use-existing-"));
    try {
      if (!isFake) {
        // one scripted answer per test request of a reuse
        writeFileSync(join(dir, "llm.jsonl"), '{"on": "ask-answer"}\n{"on": "ask-answer"}\n');
        process.env.NOTER_CORE_CMD = `${command} --llm-script ${join(dir, "llm.jsonl")}`;
      }
      open();
      if (!isFake) await wire(s).invoke("main", "harness.account_cli", { tool: "claude_code", installed: true, path: "/bin/claude", version: "2.1.296", identity: { email: "ann@example.com", plan: "Max" } });
      const settings = s.core("settings");
      const status = (v: { accounts: Array<{ provider: string; status: { type: string } }> }) => v.accounts.find((a) => a.provider === "claude")?.status.type;
      expect(ok(await settings.accountSigninPrepare({ provider: "claude" })).existing).toBeTruthy();
      expect(refused(await settings.accountUseExisting({ provider: "claude" })).code).toBe("personal_use_not_confirmed");
      expect(status(ok(await settings.accountUseExisting({ provider: "claude", personal_use_confirmed: true })))).toBe("signed_in");
      // the ticked reuse is recorded: a later reuse without the box goes through
      expect(status(ok(await settings.accountUseExisting({ provider: "claude" })))).toBe("signed_in");
      // signing out in Noter forgets it
      ok(await settings.accountSignOut({ provider: "claude", also_in_cli: false }));
      expect(refused(await settings.accountUseExisting({ provider: "claude" })).code).toBe("personal_use_not_confirmed");
    } finally {
      process.env.NOTER_CORE_CMD = command;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
