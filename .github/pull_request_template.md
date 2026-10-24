## What and why

<!-- One or two sentences: the change, and the FEATURE / story / ADR it serves (IDs).
     The PR title becomes the squash commit and the changelog line: Conventional Commits,
     e.g. "feat(ui): show the speaker split" or "fix(core): keep late results out". -->

## Exit criteria

`just gate` is the definition of done (docs/HARNESS.md). CI runs it as the `gate` check.

- [ ] `just gate` passes locally (or every CI job is green)
- [ ] Self-reviewed with `/cf-sdlc-pr-review` and published with `just review-publish` (repeat after every push until it passes)
- [ ] New behaviour has unit tests; changed lines are ≥ 80% covered
- [ ] Delivered commands and stories have E2E tests (≥ 60% of the milestone)
- [ ] Screenshot baselines unchanged — or refreshed with `update-screenshots` and every image reviewed (`visual-change-approved`)
- [ ] Contract changed? Types first, `just contract-regen`, `CONTRACT_VERSION` bumped, one core and one UI review
- [ ] No gate loosened — or the reason is below and the PR has `harness-change-approved`
