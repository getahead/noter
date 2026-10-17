# noter-protocol

The Noter contracts as Rust types: UI ↔ core IPC (`ipc`), view models (`model`), errors (`error`), the engine stdio protocol (`engine`), noter-mcp (`mcp`) and LLM skill outputs (`skills`), plus typed fixtures (`fixtures`). Types only; no I/O, no logic, no Tauri. See `docs/DESIGN-core.md` 3.3 and ADR-0001.

    cargo test -p noter-protocol                                  # contract tests
    cargo run  -p noter-protocol --bin noter-contract-export      # regenerate bindings, manifest, schemas, fixtures
    cargo run  -p noter-protocol --bin noter-contract-export -- --check   # CI: fail if anything is stale

To change the contract: edit the types and the registry in `src/ipc/mod.rs`, regenerate, update the fake handlers in `apps/desktop/src/core/fake/handlers.ts` if a frozen surface changed, bump `CONTRACT_VERSION`, and get one core and one UI review (DESIGN-core 4.1).
