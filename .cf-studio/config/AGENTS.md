# Custom Agent Navigation Rules

Add your project-specific WHEN rules here.
These rules are loaded alongside the generated rules in `{cf-studio-path}/.gen/AGENTS.md`.

## Noter: exit criteria and gates

- WHEN implementing or reviewing CODE for a FEATURE (cf-sdlc-implement, cf-coding): ALWAYS use `just gate` as the deterministic gate in addition to `cfs validate`, and treat it as the FEATURE's definition of done (docs/HARNESS.md, ADR-0003).
- WHEN authoring a FEATURE: ALWAYS list the unit, conformance and E2E tests that prove it, with the DESIGN.md story IDs the E2E tests cover, and end its definition of done with "`just gate` passes".
- WHEN authoring a DECOMPOSITION: ALWAYS keep each FEATURE inside one milestone of `harness/milestones.toml`.
