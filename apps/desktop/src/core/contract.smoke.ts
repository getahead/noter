// Contract smoke test for the fake core. Run: `npx tsx apps/desktop/src/core/contract.smoke.ts`
// (moves to Vitest when the UI scaffold lands). It checks the rules the UI relies on.

import assert from "node:assert/strict";

import { COMMANDS, ERROR_CODES, createCore, type CommandName, type TranscriptMsg } from "./bindings";
import { FakeCore } from "./fake/fake-core";

async function main() {
  const main = new FakeCore({ window: "main" });
  const core = createCore(main);

  // 1. Snapshot carries the contract version and the calling window.
  const snap = await core.appSnapshot({});
  assert.equal(snap.status, "ok");
  if (snap.status === "ok") {
    assert.equal(snap.data.window, "main");
    assert.equal(snap.data.contract_version.split(".")[0], "1");
  }

  // 2. Window scoping (PM-08): the record prompt may not delete calls.
  const prompt = createCore(new FakeCore({ window: "record-prompt" }));
  const del = await prompt.callsDelete({ call_ids: ["call_backend"] });
  assert.equal(del.status, "error");
  if (del.status === "error") assert.equal(del.error.code, "window_not_allowed");

  // 3. Optimistic concurrency: a stale rev is a conflict ("Item changed since").
  const ok = await core.itemSetDone({ item_id: "itm_spec", rev: 1, done: true });
  assert.equal(ok.status, "ok");
  const stale = await core.itemSetDone({ item_id: "itm_spec", rev: 1, done: false });
  assert.equal(stale.status, "error");
  if (stale.status === "error") {
    assert.equal(stale.error.code, "conflict");
    assert.equal(stale.error.detail?.type, "conflict");
  }

  // 4. Snapshot, then stream: seq continues from last_seq with no gap.
  const call = createCore(new FakeCore({ window: "call-screen" }));
  const got: TranscriptMsg[] = [];
  const sub = await call.transcriptSubscribe({ call_id: "call_live" }, (m) => got.push(m));
  assert.equal(sub.status, "ok");
  await new Promise((r) => setTimeout(r, 3300));
  if (sub.status === "ok") {
    assert.ok(got.length >= 2, "stream delivered");
    got.forEach((m, i) => assert.equal(m.seq, sub.data.last_seq + i + 1));
  }

  // 5. Forced failures are typed CoreErrors with known codes.
  main.failNext("search", "index_rebuilding");
  const s = await core.search({ query: "drawer", filter: { people: [], call_types: [], tags: [], languages: [] }, limit: null });
  assert.equal(s.status, "error");
  if (s.status === "error") assert.ok(ERROR_CODES.includes(s.error.code));

  // 6. Every command either has a fake handler or says not_implemented; none crash.
  const names = Object.keys(COMMANDS) as CommandName[];
  let implemented = 0;
  for (const name of names) {
    const window = COMMANDS[name].windows[0];
    const fake = new FakeCore({ window });
    try {
      await fake.invoke(name, {}, COMMANDS[name].channel ? () => {} : undefined);
      implemented++;
    } catch (e) {
      const code = (e as { code?: string }).code;
      assert.ok(code && (ERROR_CODES as readonly string[]).includes(code), `${name} threw a non-CoreError: ${String(e)}`);
      if (code !== "not_implemented") implemented++;
    } finally {
      fake.dispose();
    }
  }
  console.log(`contract smoke: OK — ${names.length} commands, ${implemented} answered by the fake core`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
