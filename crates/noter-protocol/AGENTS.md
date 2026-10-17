# noter-protocol — agent notes

Lane: `contract`. This crate is the single source of truth for every boundary (ADR-0001); everything under `contracts/` and `apps/desktop/src/core/bindings.ts` is generated from it.

- Types and declarations only: no I/O, no logic, no Tauri. Allowed dependencies: serde, serde_json, specta, schemars (`just arch` enforces it).
- Change process (DESIGN-core 4.1): edit types and the registry in `src/ipc/mod.rs` → `just contract-regen` → update the fake handlers if a frozen surface changed → bump `CONTRACT_VERSION` → place new commands in `harness/milestones.toml` → one core and one UI review.
- Frozen surfaces change only additively in a minor version; draft surfaces (Copilot, Agents, Performance, `storage_move`) may change until their milestone gate.
- `just contract` must pass; helper functions here are unit-tested in `tests/helpers.rs` (80% line coverage applies; `src/fixtures.rs` is excluded as data).
