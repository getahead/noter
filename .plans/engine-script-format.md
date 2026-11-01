# Engine script format (M1-D3)

Proposal by be-e2e for be-eng-2, 2026-10-18. The engine-lane half (timed scripts and the kill switch in `noter-engine-client`'s `ScriptedEngine`) is be-eng-2's. The core-lane half (`noter-core-harness --engine-script <file>` and the harness controls) is be-e2e's and builds against the API below. Please edit this file if you want a different shape; the harness follows what is merged here.

## File: JSON Lines, one step per line

```jsonl
{"on": "start_session", "after_ms": 0,    "event": {"type": "session_started", "call_id": "call_live", "...": "..."}}
{"on": "start_session", "after_ms": 1500, "event": {"type": "segment", "...": "..."}}
{"on": "start_session", "after_ms": 9000, "kill": true}
{"on": "stop",          "after_ms": 200,  "event": {"type": "session_stopped", "...": "..."}}
```

- **`on`**: the `type` tag of an `EngineCommand` (`start_session`, `pause`, `stop`, `self_test`, …; not `ping` or `shutdown`, which a step can never follow). The step runs after the engine has `ack`ed that command. Each time the command arrives, its steps run again, in file order.
- **`after_ms`**: milliseconds after that `ack`, on the scripted engine's clock (tokio time, so a test can pause and advance it, decision NB5).
- **`event`**: one `EngineEvent` exactly as the protocol serialises it (`contracts/engine.schema.json`). The engine adds `seq` and `at`; a script never writes them.
- An `offline_done` step whose `result_path` is absolute names a recorded `ArchiveResult` file: the scripted engine copies it into the result file the core asked for, with the asked call id, and sends `offline_done` with that path (a file it cannot read sends `offline_failed`). A relative path is sent as written.
- **`kill`**: `true` ends the current engine as `kill_current()` does (its stdout closes). The supervisor then sees a dead engine and runs its restart rules. A step has either `event` or `kill`, never both.
- Blank lines and lines starting with `//` are ignored. Any other line that does not parse fails the whole script, naming the line number.

Without a script, the scripted engine keeps its M0 behaviour (`ready`, `ack`, `pong`, the built-in self-test).

## API the harness calls (noter-engine-client, engine lane)

```rust
pub struct Script { /* parsed steps */ }
impl Script {
    /// Parses the JSON Lines above; `Err` names the first bad line.
    pub fn parse(text: &str) -> Result<Script, ScriptError>;
}
impl ScriptedEngine {
    /// Engines of this launcher play `script` on top of the default behaviour.
    pub fn with_script(self, script: Script) -> Self;
    /// Sends `event` now on the current engine's stdout (next `seq`); `false` when no engine runs.
    pub fn inject(&self, event: EngineEvent) -> bool;
    /// Exists today.
    pub fn kill_current(&self);
}
```

## Harness side (core lane, be-e2e)

| Piece | Calls | Status |
| --- | --- | --- |
| `--engine-script <file>` | `Script::parse(&read_to_string(file))`; a parse error exits 2 before any request is read | waits for `Script` |
| `harness.engine_fact { event }` | `ScriptedEngine::inject(event)` → `{ delivered: bool }` | waits for `inject` |
| `harness.engine_kill {}` | `ScriptedEngine::kill_current()` | waits for the core's engine seam in the harness's base (see below) |
| `harness.set_output_route { route, output_device }` | the scripted Mac's reading, then `Core::environment_changed` | done (draft PR on #47) |
| `harness.set_free_disk { mb }` | same | done (draft PR on #47) |

All four engine pieces also need `CoreDeps::with_engine` (from `lane/core/first-run-selftest`) in the harness's base. A core-lane branch cannot carry the merged `crates/noter-engine-client/**` (lane guard), so that merge has to happen where the engine lane's files can be committed.

`tests/support/scenario.ts` (UI lane) gains the matching scenario controls when these land; the control names above are the contract.
