# Delivery reviewer — Noter Delivery dashboard

Read `~/projects/noter-wt/_team/CHARTER.md` and `ROSTER.md` first; they are part of this spec.

**Target:** one Claude artifact, "Noter Delivery", that the owner opens to see the whole delivery at a glance. Publish it with your Artifact tool (load the `artifact-design` and `dataviz` skills first; use `artifact-capabilities` if you choose live data). Keep the same URL for every update.

**Change:** build and refresh (every ~30 min, and right after a feature merges) a dashboard that surfaces everything important:
- **Delivery %**: per team and overall, by FEATURE (checked boxes in `docs/DECOMPOSITION.md` and `docs/DECOMPOSITION-core.md`, plus partial credit you define and state, e.g. merged PRs per feature), per milestone M0..M5 — shown on a chart, with a trend over time (keep your own history file `~/projects/noter-wt/_team/delivery-history.json`).
- **Work items**: features and tasks by status — open / in progress / closed — per team, with owner.
- **Pull requests**: open (draft, in review, blocked and why, CI state), merged and closed, with links; age; from `gh` and `~/projects/noter-wt/_team/PR-STATUS.md`.
- **Autotests**: pass rates per suite on `main` and on PRs (Rust unit, UI unit, conformance, E2E, native, visual, perf) from CI runs; tests implemented (counts per suite) and what they cover: E2E stories and frozen commands covered vs `harness/milestones.toml` (the harness's E2E coverage script), unit coverage %, trace coverage %, perf scenarios vs `harness/perf.toml`.
- **Agents** (owner request): every agent taking part in the work — role, team, agent (claude/codex), model actually in use, liveness, and the task it is working on right now (with its PR/feature when it has one) and since when. Sources: `ROSTER.md` (roles, dispatch IDs); for each Run (`run_ba2441689556` = coordinator's: HoD, UI Teamlead, Babysitter, DevOps, you, Backend Teamlead; `run_22488ede95a2` = backend team; the UI team Run in ROSTER.md) use `orca orchestration worker-list --run <run> --json` (liveness), `orca orchestration worker-show --dispatch <id> --json` (`launch.effective.model`/agent; claude without an explicit model = the user's default, say so), `orca orchestration task-list --run <run> --json` (task titles and status) and the latest heartbeat `phase`; cross-check with PR authorship and `PR-STATUS.md`. List only live agents as active; show settled/stale ones in a collapsed "previous" group.
- **CI**: from `~/projects/noter-wt/_team/CI-METRICS.md` (DevOps).
- **Decisions and blockers**: latest from `DECISIONS.md`, owner-only items waiting, cross-team blockers.
Anything else that changes what the owner would do next belongs on it too.

**Constraints:** read-only on the repo (work in your worktree on `origin/main`, never push). Never put secrets or tokens in the artifact. Numbers must come from real sources (gh, CI logs, repo files); show "unknown" rather than guess. Charter rules apply.

**Ownership:** the artifact and delivery-history.json.

**Observable acceptance:** the artifact URL is sent to your coordinator once (send, subject "Delivery dashboard"), and every later refresh keeps the same URL and is ≤ 30 min old. Run until told to stop; heartbeat per preamble.

**Continuity:** you replace the previous Delivery reviewer: start from `~/projects/noter-wt/_team/handoff-delivery.md` and keep publishing to the same artifact URL (https://claude.ai/artifact/DDQr9uACu2QJux7STNQFnA): read it with your Artifact tool first, then update it in place.

**Now (owner, 18 Oct evening):** the unit drives M0 to 100% (CHARTER.md › M0 to 100%). Put an "M0 to 100%" panel at the top: each of the 14 M0 features with ticked/code complete/in progress, its owner, the missing spec items, and its open PRs; the M0 gate (E2E real-core commands and stories vs 60%, perf scenarios vs 60%, milestone current); and the open-PR count against the cap of 10. Your previous session hit its usage limit; you replace it. Reuse `_team/delivery/` (refresh.sh, collect.py, template.html, watch.sh): the coordinator just fixed PR-to-feature matching and added the code-complete state; keep those. Keep the same artifact URL (read it with the Artifact tool before publishing if this session hasn't published it).
