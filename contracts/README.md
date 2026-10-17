# contracts/ — generated, do not edit

Everything here is generated from `crates/noter-protocol` by

    cargo run -p noter-protocol --bin noter-contract-export

and checked in CI with `-- --check`. Design: `docs/DESIGN-core.md` 3.3; decisions: `docs/ADR/0001`, `docs/ADR/0002`.

| File | Contract | Consumer |
| --- | --- | --- |
| `ipc.manifest.json` | UI ↔ core: 161 commands (group, stability, windows, args, result, Channel), 20 events, error codes | Tauri capability generation, reviews, the IPC host parity test |
| `engine.schema.json` | Core ↔ engine JSON Lines (command and event lines) | Swift `Codable` generation in `engine/Sources/Protocol` |
| `mcp-tools.schema.json` | noter-mcp tool inputs and outputs, and the core socket messages | noter-mcp `tools/list`, core socket handler |
| `skills/*.schema.json` | Output schemas of the LLM skills | `claude --json-schema`, `codex --output-schema`, Ollama `format` |
| `fixtures/world.json` | Typed example data (Thursday 16 Oct 2026) | The fake core in `apps/desktop/src/core/fake` |

The TypeScript bindings are written to `apps/desktop/src/core/bindings.ts`.
