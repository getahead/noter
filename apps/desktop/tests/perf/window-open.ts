// Performance scenario `ui_window_open` (harness/perf.toml, docs/ADR/0003): every window opens through the
// core bridge (core-bridge feature: subscribe to the 20 events, `app_snapshot`, READY), takes an hour of
// app events (records by identity, whole state by version, older versions dropped), reloads three times
// and closes. The UI side of `core_app_snapshot`. The transport is an in-memory stand-in that answers at
// once, so only the bridge and the window store are measured, not the fake core.
// Deterministic: fixed workload, no clock, no randomness. Bundled by Vite and run with `node --jitless --predictable`
// like `stream-flush.ts`. Exits non-zero when the store ends up wrong, so a fast but wrong path cannot pass.

import world from "../../../../contracts/fixtures/world.json";
import { createBridge } from "../../src/app/bridge/bridge";
import { WHOLE_STATE } from "../../src/app/store/window-store";
import type { AppSnapshot, CallRow, EventName, ItemView, PersonRow, Transport, WindowLabel } from "../../src/core/bindings";

const WINDOWS: WindowLabel[] = ["main", "call-screen", "record-prompt", "settings", "first-run"];
// Sized for about 1 G instructions under cachegrind: each record event copies its entity slice, so the
// cost grows with records × events, and a year of calls (the Library's "212 calls") would take minutes.
const CALLS = 100;
const ITEMS = 300;
const PEOPLE = 50;
const UPDATES = 600; // record changes in the hour: ticks, edits, outputs landing
const VERSIONS = 20; // newer versions of each whole-state slice in the hour
const REMOVED = 30;
const RELOADS = 3;

const app = world.app as unknown as AppSnapshot;
const call = world.calls[0] as unknown as CallRow;
const item = world.items[0] as unknown as ItemView;
const person = world.people[0] as unknown as PersonRow;
// The whole-state events whose slice the snapshot carries, so they start from a real payload.
const whole = (Object.entries(WHOLE_STATE) as [EventName, string][]).filter(([, slice]) => slice in app);

const expect = (ok: boolean, what: string) => {
  if (!ok) throw new Error(`ui_window_open: ${what}`);
};

async function session(label: WindowLabel): Promise<void> {
  const handlers = new Map<EventName, (payload: unknown) => void>();
  const transport: Transport = {
    async invoke(cmd) {
      if (cmd === "app_snapshot") return { ...app, window: label };
      if (cmd === "log_ui" || cmd === "stream_unsubscribe") return null;
      throw new Error(`ui_window_open: unexpected command ${cmd}`);
    },
    async listen(event, handler) {
      handlers.set(event, handler);
      return () => handlers.delete(event);
    },
  };
  const emit = (event: EventName, payload: unknown) => handlers.get(event)!(payload);
  const bridge = createBridge(label, transport);
  await bridge.open();

  for (let n = 0; n < CALLS; n++) emit("entity:changed", { type: "call", call: { ...call, id: `call_${n}`, rev: 1 } });
  for (let n = 0; n < ITEMS; n++) emit("entity:changed", { type: "item", item: { ...item, id: `item_${n}`, call: `call_${n % CALLS}`, rev: 1 } });
  for (let n = 0; n < PEOPLE; n++) emit("entity:changed", { type: "person", person: { ...person, id: `person_${n}`, rev: 1 } });
  for (let n = 0; n < UPDATES; n++) {
    if (n % 10 === 0) emit("entity:changed", { type: "call", call: { ...call, id: `call_${n % CALLS}`, rev: 2 + n } });
    else emit("entity:changed", { type: "item", item: { ...item, id: `item_${(n * 7) % ITEMS}`, status: "done", rev: 2 + n } });
  }
  for (let v = 2; v <= VERSIONS + 1; v++) {
    for (const [event, slice] of whole) {
      emit(event, { ...(app[slice as keyof AppSnapshot] as object), version: v });
      emit(event, { ...(app[slice as keyof AppSnapshot] as object), version: v - 1 }); // older: dropped
    }
  }
  for (let n = 0; n < REMOVED; n++) emit("entity:changed", { type: "removed", kind: "item", id: `item_${n}` });
  for (let r = 0; r < RELOADS; r++) await bridge.open(); // reload: the snapshot is older than what is held

  const s = bridge.store.getState();
  expect(s.status === "READY" && s.app?.window === label, "window not READY after reload");
  expect(Object.keys(s.entities.call).length === CALLS && Object.keys(s.entities.person).length === PEOPLE, "calls or people lost");
  expect(Object.keys(s.entities.item).length === ITEMS - REMOVED && !("item_0" in s.entities.item), "items lost, doubled or not removed");
  expect(whole.every(([, slice]) => (s.whole as Record<string, { version: number }>)[slice]!.version === VERSIONS + 1), "a slice lost its newest version");
  await bridge.close();
  expect(bridge.store.getState().status === "CLOSED" && handlers.size === 0, "window did not close cleanly");
}

for (const label of WINDOWS) await session(label);
