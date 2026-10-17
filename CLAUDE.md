<!-- @cf:root-agents -->
```toml
cf-studio-path = ".cf-studio"
```

ALWAYS resolve and enforce prerequisites of skills/workflows/commands BEFORE applying user intent.
<!-- /@cf:root-agents -->

## Noter harness (docs/HARNESS.md, docs/ADR/0003)

- Setup, daily loop, branches and labels, screenshots, contract changes, where tests live: docs/DEVELOPMENT.md (`just setup` once per machine).
- Done means `just gate` passes; keep `just gate-fast` green while you work. Never report work as finished while either fails. CI runs the same gates as the required `gate` check.
- Quality bars (harness/harness.toml): unit line coverage ≥ 80% per side and on changed lines; E2E ≥ 60% of delivered frozen commands and stories against the real core; screenshots ≥ 98% pixel match; performance scenarios ≤ 10% worse than base (instruction counts), ≥ 60% of due registry entries covered; design-element trace coverage never lower than on the base branch.
- Write the failing test first. E2E tests name the story ID they cover (`cpt-noter-seq-…`); XCUITest tests of native surfaces (`apps/desktop/tests/native`, `just native`) spell it with underscores in the test name (`test_cpt_noter_seq_…`).
- Code that implements a design element carries its marker on the line before it: `// @cpt-{kind}:{cpt-id}:p1`, with IDs only from the `**ID**:` lines of docs/DESIGN*.md (`cfs validate` rejects unknown IDs). Never remove a marker to get green: `just trace` fails when trace coverage goes down.
- Never edit generated files (`contracts/**`, `apps/desktop/src/core/bindings.ts`): change `crates/noter-protocol` and run `just contract-regen`.
- Never edit screenshot baselines or golden data by hand, and never lower a threshold, add a coverage exclusion or skip a test to get green: fix the code, or stop and tell the owner.
- In a lane (`NOTER_LANE` or branch `lane/<lane>/…`), change only that lane's files; the harness itself (`harness/`, `scripts/harness/`, `.github/`, `justfile`, test configs) belongs to the owner.
- A new IPC command or DESIGN.md story must be placed in `harness/milestones.toml` in the same change.
- Every pull request is self-reviewed by the agent that delivers it and merges only after that review passes. After `just gate` passes: push, open the PR (Conventional Commit title), run `/cf-sdlc-pr-review <N>` (Constructor Studio, writes `.prs/<N>/review.md`), then `just review-publish <N>`. On `REQUEST CHANGES` fix every Minimum (blocking) finding, push, review again and publish again: loop until the verdict is `APPROVE` or `COMMENT`. Every push needs a new review. `review-publish` turns on auto-merge; never merge by hand, never edit the review comment or set the `review` status yourself. CodeQL posts its alerts on the PR as review threads, and an unresolved thread blocks the merge: fix the code; only the owner dismisses an alert.
