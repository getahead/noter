# Custom Agent Navigation Rules

Add your project-specific WHEN rules here.
These rules are loaded alongside the generated rules in `{cf-studio-path}/.gen/AGENTS.md`.

## Noter: exit criteria and gates

- WHEN implementing or reviewing CODE for a FEATURE (cf-sdlc-implement, cf-coding): ALWAYS use `just gate` as the deterministic gate in addition to `cfs validate`, and treat it as the FEATURE's definition of done (docs/HARNESS.md, ADR-0003).
- WHEN authoring a FEATURE: ALWAYS list the unit, conformance and E2E tests that prove it, with the DESIGN.md story IDs the E2E tests cover, and end its definition of done with "`just gate` passes".
- WHEN authoring a DECOMPOSITION: ALWAYS keep each FEATURE inside one milestone of `harness/milestones.toml`.

## Noter: code generation and review

<!-- @cpt-flow:cpt-noter-flow-developer-workflow-skills-scoped-work:p2 -->
- ALWAYS open and follow `{cf-studio-path}/config/rules/code-skills.md` in the controller before preparing any inline or delegated launch WHEN writing CODE (`cf-coding`, `cf-coding-gen`, `cf-sdlc-implement`) or reviewing CODE (`cf-coding-review`, `cf-sdlc-code-review`, `cf-sdlc-pr-review`). In PR review, apply the policy to the code in the diff. Include the same applicable criteria in both inline and delegated prompts.
- WHEN routing a standalone code review or `/cf-review` request in Noter, ALWAYS select `cf-sdlc-code-review`, the registered project workflow for read-only findings.
- WHEN reviewing CODE or closing a FEATURE, ALWAYS run `/ponytail-review` on the change and merge its findings into the review. A "Must fix" finding blocks FEATURE completion the same way a failing `just gate` does.
- WHEN delivering a pull request: the agent that delivers it ALWAYS runs `/ponytail-review` itself, locally in its own session, on the PR's diff (`.prs/<N>/diff.patch` from `/cf-sdlc-pr-review <N>`), and puts its findings into `.prs/<N>/review.md` before `just review-publish <N>`; any "Must fix" finding makes the verdict `REQUEST CHANGES`, so the agent loops until it is fixed. Never run it in CI and never with an API token or secret: the review is the delivering agent's own work, published as its self-review (docs/HARNESS.md › The agent loop).
