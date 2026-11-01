# Handoff: Delivery reviewer (Noter Delivery dashboard)

Written 2026-10-18 ~10:05 UTC by the outgoing Delivery reviewer (dispatch ctx_b55a2a6b6e2a, task task_6b22498d9847).

## Artifact
- URL: https://claude.ai/artifact/DDQr9uACu2QJux7STNQFnA ("Noter Delivery", version 2, published ~10:04 UTC). Private: only the owner can open it until they share it.
- Local source file (the built page): `~/projects/noter-wt/_team/delivery/noter-delivery.html`
- From a new session, publish with the Artifact tool using `url: https://claude.ai/artifact/DDQr9uACu2QJux7STNQFnA` and `file_path:` set to the built page, so the URL stays the same. A first publish from a new conversation may be refused until you `read` the URL; read it, then publish your rebuilt file.
- The coordinator already has the URL (subject "Delivery dashboard"). Don't send it again.

## Scripts (all in `~/projects/noter-wt/_team/delivery/`)
- `refresh.sh`: runs `git fetch`, then `collect.py` → `data.json`, then embeds data.json into `template.html` → `noter-delivery.html`. Takes about 2.5 min, mostly gh calls for the CI pass rates. It runs against the read-only worktree `/Users/mpetrov/orca/workspaces/noter/delivery` (edit `R=` in refresh.sh to use another one). Everything is read from `origin/main` with `git show`, so nothing is checked out.
- `collect.py <worktree> <out.json>`: imports the repo's own harness modules (`scripts/harness/trace_gate.py`, `e2e_coverage.py`, `coverage_gate.py`, `common.py`). Its sources:
  - Features: `docs/DECOMPOSITION.md` and `DECOMPOSITION-core.md` on origin/main (checkbox, Milestone, Status, spec link).
  - Partial credit: FEATURE spec IDs of kinds flow/algo/state/dod with `@cpt` markers in the codebase (trace_gate.measure on GitRef origin/main).
  - PRs: `gh pr list --state all` plus a GraphQL query for unresolved review threads. A PR maps to a feature by a feature ID in the title/body, else the spec path, else the lane branch topic.
  - CI pass rates per suite: the last 20 `ci.yml` push runs on main and the last 40 pull_request runs, read job and step conclusions (see SUITES in collect.py).
  - Unit and E2E coverage: downloads the `coverage-unit` and `coverage-e2e` artifacts of the latest green main CI run and runs the harness parsers on them. E2E is split into real-core and fake-core runs per milestone of `harness/milestones.toml`.
  - Test counts: regex over test files on origin/main. Perf: `harness/perf.toml` registry vs scenarios.
  - Lane worktrees from `git worktree list`; code-scanning alerts from the gh API; `_team/DECISIONS.md`, `PR-STATUS.md` (not published yet) and `CI-METRICS.md` (DevOps, rendered as markdown).
  - Appends one point per run to `~/projects/noter-wt/_team/delivery-history.json`. A re-run on the same main within 20 min replaces the last point.
- `watch.sh`: blocking wait loop. Run it in the background. It sends a heartbeat every 5 min (it is hard-coded to the OLD terminal handle, task and dispatch IDs, so change ME/--task-id/--dispatch-id to yours). It exits when origin/main moves (a merge, so refresh), when a coordinator message arrives (saved to `msgs.json` next to the script), or after 28 min.
- Loop used: run `watch.sh` in the background → on wake run `refresh.sh` → publish the built page with `url` → run watch.sh again.

## Definitions shown on the page (keep them stable)
- Feature % = 100 when its box is checked. Otherwise 90 × (spec flow/algo/state/dod IDs with markers on main ÷ all such IDs). Team, milestone and overall figures are plain means over features.
- Work status: closed = checked; in progress = markers, a PR, or doc status IN_PROGRESS; open = nothing yet.

## Current numbers (10:03 UTC, main 5a9f2b4)
Overall 5.1% (UI 6.0, backend 4.1), 0 of 61 checked, M0 at 22%. Trace coverage 5.3% (44/835). Unit coverage 98.9% Rust and 100% UI. E2E against the real core is 0 (all 10 logs are fake core). 86 open code-scanning alerts on main. 11 open PRs.

## Half-done / ideas
- Nothing half-done. Possible improvements: per-engineer owner once the UI Teamlead fills in the ROSTER UI members; switch to PR-STATUS.md data once the Babysitter publishes it.
