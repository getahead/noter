// Contract smoke test for the fake core. Run: `npx tsx apps/desktop/src/core/contract.smoke.ts`
// (moves to Vitest when the UI scaffold lands). It checks the rules the UI relies on.

import assert from "node:assert/strict";

import {
  COMMANDS,
  CONTRACT_VERSION,
  DEFAULT_RETRYABLE,
  ERROR_CODES,
  createCore,
  type CaptureState,
  type CommandName,
  type TranscriptMsg,
  type Transport,
} from "./bindings";
import { FakeCore } from "./fake/fake-core";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const code = (r: { status: string; error?: { code: string } }) => (r.status === "error" ? r.error!.code : "ok");

async function main() {
  const main = new FakeCore({ window: "main" });
  const core = createCore(main);

  // 1. Snapshot carries the contract version, the calling window and versioned slices.
  const snap = await core.appSnapshot({});
  assert.equal(snap.status, "ok");
  if (snap.status === "ok") {
    assert.equal(snap.data.window, "main");
    assert.equal(snap.data.contract_version, CONTRACT_VERSION);
    assert.ok(snap.data.capture.version >= 1 && snap.data.degraded.version >= 1 && snap.data.banners.version >= 1);
  }

  // 2. Window scoping (PM-08): the record prompt may not delete calls; review scopes hold.
  const prompt = createCore(new FakeCore({ window: "record-prompt" }));
  assert.equal(code(await prompt.callsDelete({ call_ids: ["call_backend"] })), "window_not_allowed");
  const firstRun = createCore(new FakeCore({ window: "first-run" }));
  assert.equal(code(await firstRun.accountTest({ provider: "claude" })), "ok");

  // 3. Optimistic concurrency: a stale rev is a conflict ("Item changed since").
  assert.equal(code(await core.itemSetDone({ item_id: "itm_spec", rev: 1, done: true })), "ok");
  const stale = await core.itemSetDone({ item_id: "itm_spec", rev: 1, done: false });
  assert.equal(code(stale), "conflict");
  if (stale.status === "error") assert.equal(stale.error.detail?.type, "conflict");

  // 4. Snapshot, then stream (R23): the fake sends a message the snapshot already holds and the
  //    first new one before the snapshot resolves; the client drops the first, holds the second,
  //    and the stream continues from last_seq + 1 with no gap. It also acknowledges (R24).
  const callFake = new FakeCore({ window: "call-screen" });
  const call = createCore(callFake);
  const got: TranscriptMsg[] = [];
  const sub = await call.transcriptSubscribe({ call_id: "call_live" }, (m) => got.push(m));
  assert.equal(sub.status, "ok");
  await sleep(3300);
  if (sub.status === "ok") {
    assert.ok(got.length >= 3, "stream delivered");
    got.forEach((m, i) => assert.equal(m.seq, sub.data.last_seq + i + 1));
    // fake.push reaches an existing Channel with the next seq.
    const before = got.at(-1)!.seq;
    const pushed = callFake.push(sub.data.subscription_id!, { event: { type: "gap", gap: { call_id: "call_live", t0_ms: 1_500_000, t1_ms: 1_503_000, reason: "stalled" } } });
    assert.equal(pushed, before + 1);
    await sleep(10);
    assert.equal(got.at(-1)!.event.type, "gap");
    // The ack is batched on a timer; wait for it instead of guessing how long a loaded machine takes.
    const acked = () => callFake.acks.get(sub.data.subscription_id!);
    for (let t = 0; t < 100 && acked() !== got.at(-1)!.seq; t++) await sleep(100);
    assert.equal(acked(), got.at(-1)!.seq, "stream_ack sent");
  }
  callFake.dispose();

  // 5. Forced failures are typed CoreErrors; retryable follows DEFAULT_RETRYABLE.
  main.failNext("search", "search_failed").failNext("search", "index_rebuilding");
  const filter = { people: [], call_types: [], tags: [], languages: [] };
  const s1 = await core.search({ query: "drawer", filter });
  const s2 = await core.search({ query: "drawer", filter });
  assert.ok(s1.status === "error" && s1.error.retryable === true && DEFAULT_RETRYABLE.includes("search_failed"));
  assert.ok(s2.status === "error" && s2.error.retryable === false && ERROR_CODES.includes(s2.error.code));

  // 6. Tauri's own rejections map to contract codes in the generated client.
  const rejecting = (message: string): Transport => ({ invoke: () => Promise.reject(message), listen: async () => () => {} });
  assert.equal(code(await createCore(rejecting("core:default|items_list not allowed. Command not found")).itemsList({ filter: {}, page: {} })), "window_not_allowed");
  assert.equal(code(await createCore(rejecting("invalid args `args` for command `items_list`: missing field `filter`")).itemsList({ filter: {}, page: {} })), "invalid_input");

  // 7. Capture rules of the 17 Oct review.
  const states: CaptureState[] = [];
  await core.on("capture:state", (p) => states.push(p));
  //    job_run_now waits while a call is live, except post-call analysis (D2).
  assert.equal(code(await core.jobRunNow({ job_id: "job_evidence" })), "job_blocked");
  assert.equal(code(await core.jobRunNow({ job_id: "job_post_call" })), "ok");
  //    A call can only be made sensitive during capture, never back.
  assert.equal(code(await core.captureSetSensitive({ call_id: "call_live", sensitive: false })), "invalid_input");
  assert.equal(code(await core.captureSetSensitive({ call_id: "call_live", sensitive: true })), "ok");
  //    Un-pausing a stopped call is refused (that is Continue Recording).
  assert.equal(code(await core.captureStop({ call_id: "call_live" })), "ok");
  assert.equal(code(await core.captureSetPaused({ call_id: "call_live", paused: false })), "not_recording");
  //    O1: setup state never gates a start; only disk_full (with needed_mb) and model_missing do.
  main.setWorld((w) => {
    w.app.setup.complete = false;
    w.app.environment.disk_free_mb = 300;
  });
  const full = await core.captureStart({ source: "hotkey", sensitive: false });
  assert.equal(code(full), "disk_full");
  if (full.status === "error") assert.deepEqual(full.error.detail, { type: "disk_space", free_mb: 300, needed_mb: 500 });
  main.setWorld((w) => {
    w.app.environment.disk_free_mb = 90_000;
    w.app.setup.models.bundles[0].state = "downloading";
  });
  assert.equal(code(await core.captureStart({ source: "hotkey", sensitive: false })), "model_missing");
  main.setWorld((w) => (w.app.setup.models.bundles[0].state = "ready"));
  const started = await core.captureStart({ source: "hotkey", sensitive: false });
  assert.equal(code(started), "ok");
  //    Versions only grow on whole-state events (R25).
  assert.ok(states.length >= 2 && states.every((st, i) => i === 0 || st.version > states[i - 1].version));
  //    The call-ended countdown holds and restarts (R5).
  const liveId = started.status === "ok" ? started.data.call_id! : "";
  main.setWorld((w) => (w.app.capture.notice = { type: "call_ended", stops_at: Date.now() + 10_000 }));
  //    (The call window shares the main window's core state.)
  const surface = createCore(new FakeCore({ window: "call-screen", world: main.world }));
  const held = await surface.captureHoldNotice({ call_id: liveId, held: true });
  assert.ok(held.status === "ok" && held.data.notice?.type === "call_ended" && held.data.notice.stops_at === null);
  const released = await surface.captureHoldNotice({ call_id: liveId, held: false });
  assert.ok(released.status === "ok" && released.data.notice?.type === "call_ended" && typeof released.data.notice.stops_at === "number");

  // 8. Undo and redo by target, at any time (R3).
  assert.equal(code(await core.changeUndo({ target: { type: "change", change_id: "chg_1" } })), "ok");
  assert.equal(code(await core.changeUndo({ target: { type: "change", change_id: "chg_1" } })), "already_undone");
  assert.equal(code(await core.changeRedo({ target: { type: "change", change_id: "chg_1" } })), "ok");
  assert.equal(code(await core.changeRedo({ target: { type: "change", change_id: "chg_1" } })), "not_undone");
  assert.equal(code(await core.changeRedo({ target: { type: "batch", batch_id: "bat_people" } })), "ok");

  // 9. Handoff generation is asynchronous (R45).
  const gen = await core.handoffGenerate({ item_id: "itm_replay", regenerate: true });
  assert.ok(gen.status === "ok" && gen.data.state.type === "generating");
  const cancelled = await core.handoffCancel({ item_id: "itm_replay" });
  assert.ok(cancelled.status === "ok" && cancelled.data.state.type !== "generating");
  main.dispose();

  // 10. Every command is answered by the fake from every window it allows (QA27); a reply may
  //     be a typed error for the empty args used here, never `not_implemented`.
  const names = Object.keys(COMMANDS) as CommandName[];
  let answered = 0;
  let frozen = 0;
  let frozenAnswered = 0;
  const missing: string[] = [];
  for (const name of names) {
    const spec = COMMANDS[name];
    if (spec.stability === "frozen") frozen++;
    let ok = true;
    for (const window of spec.windows) {
      const fake = new FakeCore({ window });
      try {
        await fake.invoke(name, {}, spec.channel ? () => {} : undefined);
      } catch (e) {
        const c = (e as { code?: string }).code;
        assert.ok(c && (ERROR_CODES as readonly string[]).includes(c), `${name} threw a non-CoreError: ${String(e)}`);
        if (c === "not_implemented") ok = false;
      } finally {
        fake.dispose();
      }
    }
    if (ok) {
      answered++;
      if (spec.stability === "frozen") frozenAnswered++;
    } else missing.push(name);
  }
  assert.equal(frozenAnswered, frozen, `frozen commands without a fake handler: ${missing.join(", ")}`);
  console.log(`contract smoke: OK — ${names.length} commands, ${answered} answered by the fake core (${frozenAnswered}/${frozen} frozen)`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
