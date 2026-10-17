<!-- @cf:root-agents -->
```toml
cf-studio-path = ".cf-studio"
```

ALWAYS resolve and enforce prerequisites of skills/workflows/commands BEFORE applying user intent.
<!-- /@cf:root-agents -->

## Noter harness (docs/HARNESS.md, docs/ADR/0003)

- Done means `just gate` passes; keep `just gate-fast` green while you work. Never report work as finished while either fails. CI runs the same gates as the required `gate` check.
- Quality bars (harness/harness.toml): unit line coverage ≥ 90% per side and on changed lines; E2E ≥ 80% of delivered frozen commands and stories against the real core; screenshots ≥ 99% pixel match; performance scenarios ≤ 5% worse than base, ≥ 80% of due registry entries covered.
- Write the failing test first. E2E tests name the story ID they cover (`cpt-noter-seq-…`).
- Never edit generated files (`contracts/**`, `apps/desktop/src/core/bindings.ts`): change `crates/noter-protocol` and run `just contract-regen`.
- Never edit screenshot baselines or golden data by hand, and never lower a threshold, add a coverage exclusion or skip a test to get green: fix the code, or stop and tell the owner.
- In a lane (`NOTER_LANE` or branch `lane/<lane>/…`), change only that lane's files; the harness itself (`harness/`, `scripts/harness/`, `.github/`, `justfile`, test configs) belongs to the owner.
- A new IPC command or DESIGN.md story must be placed in `harness/milestones.toml` in the same change.
