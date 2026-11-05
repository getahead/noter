# be-eng-1 (Opus 5.5, senior, core lane) — 2.15 LLM gate, slice 2: the three real adapters with lockdown

Worktree `~/orca/workspaces/noter/be-eng-1` (start from fresh `origin/main`, which has your #229). Read `spec-be-m2-common.md`, `PLAN-be-m2.md` (TL-13, TL-14), `docs/features/core/core-llm-gate.md` §5 DoD `-adapters` and `-tests`, §6 ACs 2 and 5, your `noter-llm` runtime (`Llm`, `Adapters`, the `Scripted` adapter) and PRD › LLM orchestration (the lockdown flag list per CLI, the tested version ranges).

**Target:** `feat(llm): Claude Code, Codex and Ollama adapters with run lockdown`, one PR on `lane/core/llm-adapters`. Closes the flow steps left `[ ]` in #229 (`inst-run-adapter`, `inst-session-open`, the child-process halves of `inst-run-cancel` / `inst-session-close`), DoD `cpt-noter-dod-core-llm-gate-adapters`, DoD `-tests` except the owner's network-monitor run, ACs 2 and 5, and ticks the flow IDs `cpt-noter-flow-core-llm-gate-run` / `-session` when every nested step is `[x]`.

**Change:**
1. `adapters/claude_code.rs`: pinned tested major/version range; runs in an empty Noter-owned directory with a strict per-run MCP config, a tool allow-list without WebFetch/WebSearch/Bash, empty setting sources, nonessential traffic disabled; API-key runs `--bare`, own-account runs the same restrictions without `--bare`; structured output against the app-owned schema.
2. `adapters/codex.rs`: isolated `CODEX_HOME` without user config, read-only sandbox, the same schema; credential use proven without reading subscription tokens into Noter.
3. `adapters/ollama.rs`: localhost `/api/chat` with the schema in `format` (reqwest is allowed in noter-llm only; the host must be in `contracts/egress-hosts.json` or localhost).
4. Lifecycle: temporary capabilities and configs deleted after every outcome (success, failure, timeout, cancel, dropped future); timeout/cancel terminates the child; `cli_version_unsupported` for unknown majors or out-of-range versions, checked at `open_session`/`resume` (`inst-session-open`).
5. TL-14 lockdown tests: a stub CLI script under `crates/noter-llm/tests/stub-cli/` that records argv, env, cwd and which files it can see; tests prove the flags, the isolation, that hostile user hooks, plugins, repo instructions and MCP config planted in `$HOME` and the cwd never reach the run (AC 2), and cleanup after every outcome (AC 5); adapter conformance for all three runtimes on the stub; no real CLI, no real network in CI.
6. Runbook `.plans/backend/m2-network-monitor-runbook.md` for the owner's Mac: real pinned CLIs + a recording proxy, every provider connection matched to an `audit_log`/`llm_runs` row by run id and time, every other host in `contracts/egress-hosts.json`, zero engine connections.

**Constraints:** core lane only (`crates/noter-llm`, `crates/noter-core` if the composition root must pick adapters). No new dependency that `deny.toml` would refuse. Tests must not depend on a CLI being installed (the stub is the CLI). The gate remains the only path to an adapter.

**Acceptance:** the items above `[x]` with markers (the network-monitor part of DoD `-tests` and AC 6 stay `[ ]` with a one-line note naming the runbook); `just gate` green; PR published with the self-review; `worker_done` names the PR and anything left for slice 3 (`accounts_get`/`api_key_set`, `SecretStore`, harness `--llm-script`).
