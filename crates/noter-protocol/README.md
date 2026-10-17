# noter-protocol

The Noter contracts as Rust types: UI ↔ core IPC (`ipc`), view models (`model`), errors (`error`), the engine stdio protocol (`engine`), noter-mcp (`mcp`) and LLM skill outputs (`skills`), plus typed fixtures (`fixtures`). Types only; no I/O, no logic, no Tauri. See `docs/DESIGN-core.md` 3.3 and ADR-0001.

    cargo test -p noter-protocol                                  # contract tests
    cargo run  -p noter-protocol --bin noter-contract-export      # regenerate bindings, manifest, schemas, fixtures
    cargo run  -p noter-protocol --bin noter-contract-export -- --check   # CI: fail if anything is stale

To change the contract: edit the types and the registry in `src/ipc/mod.rs`, regenerate, update the fake handlers in `apps/desktop/src/core/fake/handlers.ts` (every command has one), bump `CONTRACT_VERSION`, and get one core and one UI review (DESIGN-core 4.1). Frozen surfaces change only additively in a minor version; anything else is a major version both teams sign off.

The contract tests (`tests/contract.rs`) also check: every `Option` field an argument type can contain has `#[serde(default)]`; every whole-state event payload has a `version`; the stability of named surfaces; the window scopes the reviews fixed; and that no setup or permission code can refuse `capture_start`.

The crate is checked by `just contract` and counts toward the 80% unit-coverage gate (fixtures excluded as data); see docs/HARNESS.md.
