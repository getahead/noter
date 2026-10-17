# Custom Agent Navigation Rules

Add your project-specific WHEN rules here.
These rules are loaded alongside the generated rules in `{cf-studio-path}/.gen/AGENTS.md`.

## Noter: exit criteria and gates

- WHEN implementing or reviewing CODE for a FEATURE (cf-sdlc-implement, cf-coding): ALWAYS use `just gate` as the deterministic gate in addition to `cfs validate`, and treat it as the FEATURE's definition of done (docs/HARNESS.md, ADR-0003).
- WHEN authoring a FEATURE: ALWAYS list the unit, conformance and E2E tests that prove it, with the DESIGN.md story IDs the E2E tests cover, and end its definition of done with "`just gate` passes".
- WHEN authoring a DECOMPOSITION: ALWAYS keep each FEATURE inside one milestone of `harness/milestones.toml`.

## Noter: code quality review (ponytail)

- WHEN writing CODE (cf-coding, cf-coding-gen, cf-sdlc-implement): ALWAYS follow the `ponytail` skill (smallest complete change: reuse before adding, no speculative abstractions, never cut validation, error handling, security or accessibility).
- WHEN reviewing CODE (cf-coding-review, cf-sdlc-pr-review) or closing a FEATURE: ALWAYS also run `/ponytail-review` on the change and merge its findings into the review; a "Must fix" finding blocks the FEATURE's definition of done the same way a failing `just gate` does.
- WHEN delivering a pull request: the agent that delivers it ALWAYS runs `/ponytail-review` itself, locally in its own session, on the PR's diff (`.prs/<N>/diff.patch` from `/cf-sdlc-pr-review <N>`), and puts its findings into `.prs/<N>/review.md` before `just review-publish <N>`; any "Must fix" finding makes the verdict `REQUEST CHANGES`, so the agent loops until it is fixed. Never run it in CI and never with an API token or secret: the review is the delivering agent's own work, published as its self-review (docs/HARNESS.md › The agent loop).
