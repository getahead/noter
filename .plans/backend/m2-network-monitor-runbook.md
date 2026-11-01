# Network-monitor release test (2.15 llm-gate): runbook for the owner

Closes the open half of DoD `cpt-noter-dod-core-llm-gate-tests` and of AC 6 in
`docs/features/core/core-llm-gate.md` (TL-14). About 35 minutes on the owner's Mac.

CI already proves the lockdown on a stub CLI (`crates/noter-llm/tests/lockdown.rs`): the flags,
the empty working directory, the isolated homes, the per-run MCP config, that hostile hooks,
plugins, MCP servers and instructions are never loaded, and cleanup after every outcome. This run
proves what CI cannot: that the **real pinned CLIs** accept those flags and honour them, and what
actually crosses the network.

## 0. What you need (5 min, once)

- The pinned versions (`claude --version`, `codex --version`):
  - Claude Code **2.1.x** (tested 2.1.296), `crates/noter-llm/src/adapters/claude_code.rs` `TESTED`;
  - Codex **0.163.x** (tested 0.163.0), `crates/noter-llm/src/adapters/codex.rs` `TESTED`;
  - Ollama with `qwen3:8b` pulled.

  Noter refuses any other version (`cli_version_unsupported`). To move a pin, run this runbook on
  the new version first, then widen `TESTED` in the same pull request as the evidence.
- An Anthropic API key and an OpenAI API key in your shell (`ANTHROPIC_API_KEY`, `CODEX_API_KEY`);
  optionally your own Claude and ChatGPT sign-ins in the CLIs.
- mitmproxy 11 or later (`brew install mitmproxy`) in **local capture mode**: it records the
  connections of the named processes through a macOS network extension (approve it once in System
  Settings › General › Login Items & Extensions › Network Extensions). Noter starts each CLI with
  a cleared environment, so `HTTPS_PROXY` would never reach it; local mode needs no proxy variable.
  `--ignore-hosts '.*'` passes TLS through without decrypting it, so no CA certificate is
  installed; the log still names every host and time.

## 1. The pinned CLIs accept and honour the lockdown flags (10 min; can run today)

The commands below are the adapters' exact argv and environment (compare with the `argv`/`env`
lines the stub records in the CI test). Scratch run root:

```sh
export R=$(mktemp -d) && mkdir -p "$R/work" "$R/home" "$R/codex-api" "$R/codex-account"
echo '{"mcpServers":{}}' > "$R/mcp.json"
echo 'Answer with {"ok": true}.' > "$R/skill.md"
echo '{"type":"object","properties":{"ok":{"type":"boolean"}},"required":["ok"],"additionalProperties":false}' > "$R/schema.json"
cd "$R/work"
```

**Claude Code, API key** (`--bare`, Noter-owned home):

```sh
echo '{"skill":"post-call","items":[]}' | env -i PATH="$PATH" HOME="$R/home" TMPDIR="$R" \
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY" \
  claude -p --bare --output-format json --json-schema "$(cat "$R/schema.json")" \
  --append-system-prompt-file "$R/skill.md" --strict-mcp-config --mcp-config "$R/mcp.json" \
  --tools "" --setting-sources "" --permission-mode dontAsk --max-turns 8 --effort low \
  --max-budget-usd 0.05
```

Pass: one JSON object with `"is_error": false` and a `structured_output`. Any "unknown option"
or schema error fails the release.

**Claude Code, own account** (same flags without `--bare`, your home): back up
`~/.claude/settings.json`, then add a hostile hook to it:

```sh
cp ~/.claude/settings.json ~/.claude/settings.json.bak
# add under "hooks": {"SessionStart": [{"hooks": [{"type": "command", "command": "touch /tmp/noter-hostile-hook"}]}]}
echo '{"skill":"post-call","items":[]}' | env -i PATH="$PATH" HOME="$HOME" TMPDIR="$R" \
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 \
  claude -p --output-format json --json-schema "$(cat "$R/schema.json")" \
  --append-system-prompt-file "$R/skill.md" --strict-mcp-config --mcp-config "$R/mcp.json" \
  --tools "" --setting-sources "" --permission-mode dontAsk --max-turns 8 --effort low
ls /tmp/noter-hostile-hook          # Pass: "No such file or directory"
mv ~/.claude/settings.json.bak ~/.claude/settings.json
```

Pass: the answer is valid and the hook never ran. If the run says it is not signed in, note which
environment variable it needed (Noter passes only `PATH`, `HOME`, `TMPDIR` and the flag above).

**Codex, API key** (isolated `CODEX_HOME`, no user config, no `AGENTS.md`):

```sh
echo 'Answer the packet: {"skill":"post-call","items":[]}' | env -i PATH="$PATH" HOME="$R/home" \
  TMPDIR="$R" CODEX_HOME="$R/codex-api" CODEX_API_KEY="$CODEX_API_KEY" \
  codex exec --json --skip-git-repo-check --ignore-user-config --ignore-rules --sandbox read-only \
  --output-schema "$R/schema.json" -C "$R/work" -c project_doc_max_bytes=0 \
  -c 'model_reasoning_effort="low"' -
```

Pass: an `item.completed` event of type `agent_message` whose text is JSON matching the schema.
Then run it once more with Noter's real post-call schema
(`contracts/skills/post-call.schema.json`) as `--output-schema`: OpenAI structured output wants a
strict schema (`additionalProperties: false`, every property required). If Codex rejects it,
the release is blocked and the adapter needs a strict variant of the schema; report the error.

**Codex, own account**: `ln -s ~/.codex/auth.json "$R/codex-account/auth.json"` and repeat with
`CODEX_HOME="$R/codex-account"` and without `CODEX_API_KEY`. Pass: a valid answer.

## 2. Record a release run (20 min; needs post-call on the router, 2.17)

1. Start the recorder (Noter's own processes and the CLIs it starts):

   ```sh
   mitmdump --mode local:Noter,noter-core,noter-engine,claude,codex,node \
     --ignore-hosts '.*' 2>&1 | tee ~/noter-egress.log
   ```

2. In Noter, with the API keys set: record three short calls and let post-call finish, one each on
   Claude Code (API key), Codex (API key) and local; if you have them, one each on your own Claude
   and ChatGPT accounts. Then one call marked **sensitive** and one in **local-only** mode.
3. Stop the recorder. Export the runs:

   ```sh
   DB="$HOME/Library/Application Support/Noter/noter.db"
   sqlite3 -header -csv "$DB" "SELECT a.ts, a.runtime_choice, a.destination, a.llm_run_id, r.duration_ms
     FROM audit_log a JOIN llm_runs r ON r.id = a.llm_run_id ORDER BY a.ts" > ~/noter-audit.csv
   grep -E 'server connect' ~/noter-egress.log > ~/noter-connects.log
   ```

## 3. Pass criteria (5 min)

- **Every provider connection is a run.** Each connection to `api.anthropic.com`, `api.openai.com`
  or `chatgpt.com` (`provider_hosts` in `contracts/egress-hosts.json`) falls between an audit row's
  `ts` and `ts + duration_ms + 5 s`, and that row's `runtime_choice` lists the host. The match is by
  run id (`llm_run_id`) and time; the CLIs carry no Noter header, so time is the join.
- **Every other host is listed.** Any other host must be in `allow_without_audit` of
  `contracts/egress-hosts.json` (update feed, model downloads, CLI install, sign-in). Telemetry or
  error-reporting hosts from a CLI fail the release: `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`
  is meant to stop them.
- **The engine makes no connection.** No line from `noter-engine`.
- **Sensitive and local-only calls make no provider connection**, and their runs have no
  `audit_log` row.

Write the result to `.plans/backend/m2-network-monitor-evidence.md` (versions, the three files'
line counts, every unmatched line with its explanation) and tick DoD
`cpt-noter-dod-core-llm-gate-tests` and AC 6 in `docs/features/core/core-llm-gate.md` in the same
pull request.
