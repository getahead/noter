# Core bridge: the UI's side of the contract

The UI talks to the Rust core only through this folder (DESIGN › Core bridge). The contract itself lives in `crates/noter-protocol`; see `docs/DESIGN-core.md` 3.3 and ADR-0001/0002.

| File | What it is | Edit? |
| --- | --- | --- |
| `bindings.ts` | Generated types, `COMMANDS`, `EventPayloads`, `ERROR_CODES` and the typed client `createCore()` | Never. Regenerate with `cargo run -p noter-protocol --bin noter-contract-export` |
| `tauri-transport.ts` | The real transport over Tauri IPC (`invoke` with `{ args, channel }`, `listen`) | Rarely |
| `fake/fake-core.ts` | In-memory transport: window scoping, `failNext`, latency, shared event bus | Yes |
| `fake/handlers.ts` | Fake behaviour per command over `contracts/fixtures/world.json` | Yes, add handlers as screens need them |
| `contract.smoke.ts` | Checks the rules the UI relies on against the fake | Yes |

## Using it

```ts
import { createCore } from "./core/bindings";
import { tauriTransport } from "./core/tauri-transport";
import { FakeCore } from "./core/fake/fake-core";

const label = /* the window label */ "main";
const core = createCore(import.meta.env.VITE_FAKE_CORE ? new FakeCore({ window: label }) : tauriTransport);

const res = await core.itemSetDone({ item_id, rev: item.rev, done: true });
if (res.status === "error") {
  // res.error.code is one of ERROR_CODES; map it to the screen's named state (DESIGN-core 3.3 › Error codes)
}
```

Rules the bridge follows (DESIGN 3.3 and DESIGN-core 3.3):

- Snapshot, then stream: call `appSnapshot` (and the screen's `*_get` / `*_subscribe`) on open, reload and after a crash; a Channel delivers `seq = last_seq + 1, + 2, …`. A gap means resubscribe.
- Send wanted state, never a toggle. Send the record's `rev` with every edit; `conflict` means "Item changed since".
- Never retry on your own; offer **Try Again** when `error.retryable` is true.
- Events carry whole state (`degraded:changed` is the full set), so a missed event cannot leave a stale banner.

## Running the fake

`VITE_FAKE_CORE=1 pnpm dev` serves the UI in a plain browser with the fake core (no Tauri needed). In stories and tests, build a `FakeCore` per window label and steer it:

```ts
const fake = new FakeCore({ window: "settings" });
fake.failNext("api_key_set", "key_rejected");      // story: Replace a rejected API key
fake.world.app.environment.disk_free_mb = 300;    // story: Not enough disk space
```

Smoke check: `pnpm --dir apps/desktop smoke`. The behaviour rules above are also checked by the conformance suite (`pnpm --dir apps/desktop test:conformance`, `apps/desktop/tests/conformance`), which runs against this fake today and against the real core through `noter-core-harness` from M0 (docs/HARNESS.md).

Dependencies are in `apps/desktop/package.json` (pinned); `tsconfig.core.json` enables `resolveJsonModule` for the fixtures import.
