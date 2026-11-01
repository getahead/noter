# Noter delivery unit — charter (read first, every role)

One software delivery unit builds Noter: a **backend team** (already running, Orca Run `run_22488ede95a2`, led by the Backend Teamlead) and a **UI team**, plus cross-team roles. The owner is **not** a messenger: teams settle questions among themselves. Only owner-only actions (below) go up to the coordinator.

Repo: `git@github.com:getahead/noter.git`, main checkout `/Users/mpetrov/projects/noter`. Read `CLAUDE.md` (or `AGENTS.md`), `docs/DEVELOPMENT.md`, `docs/HARNESS.md`, `docs/DELIVERY.md` before working.

## Scope

- UI: every FEATURE in `docs/DECOMPOSITION.md` (30 features, M0..M5), specs in `docs/features/ui/`, design `docs/DESIGN.md`, clickable prototype `docs/prototype/clickable/`. Done so far: core-bridge (#36), tokens-theming (#30), E2E `ahead()` (#33), accounts M2 docs (#60). In progress, unfinished, **to take over**: primitives — worktrees `~/projects/noter-wt/primitives` (branch `lane/ui/primitives`, 35 uncommitted files) and `~/projects/noter-wt/primitives-feedback` (branch `lane/ui/primitives-feedback`, 3 unpushed commits + 23 uncommitted files). The previous UI team (a Workflow script in another session) has stopped; before touching those worktrees check nothing else is writing to them (`lsof +D <dir>` / file mtimes); if something is, stop and tell the coordinator.
- Backend: `docs/DECOMPOSITION-core.md` (31 features), owned by the Backend Teamlead.

## Who is who (dispatch IDs in `ROSTER.md` next to this file)

| Role | Owns |
|---|---|
| Head of Development (HoD) | Final call on PRD / app-behaviour / spec changes and on cross-team conflicts (backend vs UI, PM vs PM, design vs spec). Records every decision in `DECISIONS.md` here and, when a spec or design doc must change, gets it changed by the owning team's PR. |
| Backend Teamlead | Backend features, the contract lane (`crates/noter-protocol`, fake core, conformance), backend PRs. |
| UI Teamlead | UI features, UI team (ui-eng-1, ui-eng-2, designer, ui-qa, ui-e2e, ui-perf, ui-reviewer), UI PRs, the UI review of wire-changing contract PRs. |
| Babysitter | Every open PR of both teams: status, keeping branches current, conflicts, routing stuck PRs to their owner. |
| DevOps | CI health and speed (`.github/`, `scripts/ci/`, `justfile`, harness configs). |
| Delivery reviewer | The Delivery dashboard (Claude artifact) for both teams. |

## Routing — send, don't wait

Call Orca by its full path `/Applications/Orca.app/Contents/Resources/bin/orca` (`/usr/local/bin/orca` is an unreadable root-owned symlink on this Mac and fails silently). Use `orca orchestration send --to dispatch:<id> --subject "<s>" --body "<b>" --json` (IDs in `ROSTER.md`). A blocking question to your own coordinator uses your preamble's `ask` command.

- Product, PRD, behaviour, spec ambiguity, cross-team or PM disagreement → **HoD**.
- UI needs a contract/fake-core change or finds a fake/core gap → **Backend Teamlead** (contract lane is backend's).
- A contract PR that changes the wire (a generated file or `CONTRACT_VERSION`) needs a UI review → **UI Teamlead** (not the owner).
- Anything that blocks several teammates (or blocks you for more than one cycle) and has no owner working on it → **Unblocker** (Fable, full stack); it claims it with the owning teamlead and fixes it.
- PR stuck, behind, conflicting, red for reasons outside its diff → **Babysitter**; CI infrastructure problem or slowness → **DevOps**.
- Owner-only (the only things that go to the coordinator): the `harness-change-approved` label; physical actions on the owner's MacBook (TCC prompts, real calls, e.g. the engine spike); dismissing a CodeQL alert. Batch them; never block other work on them.

## Engineering rules (non-negotiable, from CLAUDE.md)

- Every shell starts with `export PATH=/opt/homebrew/bin:/usr/bin:$PATH NOTER_E2E_LOCK=$HOME/projects/noter-wt/.e2e.lock` (Orca's PATH puts an old linker and Python 3.9 first). Run `just setup` once in every new worktree.
- One git worktree per writer under `~/projects/noter-wt/<name>`; branches `lane/<lane>/<topic>` from fresh `origin/main`; Conventional Commit titles. Never bare `git stash` (shared across worktrees).
- Port 5173 is shared between worktrees: every shell also exports `NOTER_E2E_LOCK=$HOME/projects/noter-wt/.e2e.lock`, then runs plain `just gate` (the justfile takes that lock only around e2e, visual and visual-update; #72, D-11). Never wrap a whole gate in `lockf`. Local `perf` is wall-time only and informational; CI gates instruction counts.
- Tests first; E2E titles name `cpt-noter-seq-…` story IDs; `@cpt-*` markers with real IDs; never remove markers, skip tests, lower thresholds, add coverage exclusions, or hand-edit generated files, baselines or golden data.
- Screenshot baselines: never committed from a lane branch by hand. Add label `update-screenshots` (CI renders them); the **designer** opens every changed image, compares with the prototype, posts a review table as a PR comment, and only then adds `visual-change-approved`.
- Done = `just gate` passes (check its real exit code, not a piped one). Every PR: the **delivering agent** runs `/cf-sdlc-pr-review <N>` with `/ponytail-review` merged in, then `just review-publish <N>` (auto-merge). Never merge by hand.
- Finish open PRs before opening new ones; keep work in progress small (≤ 2 open PRs per engineer).
- Check a FEATURE box in DECOMPOSITION only when its code carries the markers and `just gate` passes.

## Middle developers (owner, 18 Oct)

Each team also has Middle developers on Sonnet 5.5 (backend: be-mid-1..3; UI: ui-mid-1..2). They take whole, well-specified tasks from their teamlead (smaller features, FEATURE slices, test and coverage gaps, bug fixes, code-scanning fixes), deliver their own PRs end to end (tests first, gate, self-review, publish) and follow every rule above. **Help only when they cannot pass a gate:** after two honest attempts at a failing `just gate`/CI check, review blocking finding or QA FAIL they send their teamlead the failing output; the teamlead assigns one senior engineer (be-eng-1/2, ui-eng-1/2) to pair on that PR until it is green, then the middle continues alone. Seniors never take a middle's task over otherwise.

- Never kill processes by pattern (`pkill -f`, `killall`); stop only the PIDs you started yourself.

## Finish-first freeze (owner, 18 Oct, in force until the coordinator lifts it)

Slow down development until the work already started is finished. 21 PRs are open (8 drafts).
- No new functionality of any kind: no new feature branches, PRs or FEATURE work, and no new CI/tooling features either (DevOps #84's affected-only checks wait). The only new PR allowed is one that an open PR needs to merge (a fix it depends on), and its teamlead says so in the PR body.
- Everyone works on getting existing PRs merged: rebase, fix failing checks and blocking findings, QA, design and review loops, publish. Drafts are **completed**, not closed: fold drafts that are slices of the same feature into one PR and finish it. (Owner, 18 Oct evening: "stop developing new functionality, only complete current PRs and drafts".)
- Seniors and middles both work the queue; reviewers, QA, designer and PMs prioritise open PRs over any preparation work; perf/E2E developers only finish their open PRs or help others land theirs.
- DevOps finishes its open CI PRs only; the Unblocker takes only blockers of open PRs; the Babysitter reports the open-PR count each cycle in PR-STATUS.md.
- The freeze lifts when the coordinator says so (target: open PRs ≤ 5 per team, no drafts older than a day).

## Stand-by after the queue (owner, 18 Oct evening)

Finish the open PRs (#78, #63, #64, #26, #45; release-please #34 stays as is). Do **not** open any new PR, including ones prepared or approved earlier (the merge-queue PR waits). When they are merged: the Delivery reviewer publishes a final refresh, then **every agent stands by** — no new work, no new branches — until the owner gives new commands through the coordinator. Keep heartbeats; answer only coordinator messages.

## Unblocking PRs (owner rule, 18 Oct evening; applies during the freeze and stand-by)

A new PR **may be opened without asking** when it directly fixes what blocks an open (stuck) PR. Its body names the PR it unblocks: "Unblocks #N". **Depth = 1**: an unblocking PR cannot itself justify another new PR — if it gets stuck, fold the fix into it or escalate to the owning teamlead / HoD. One unblocking PR per blocker: check open PRs and ask the owning teamlead first so two agents don't open the same fix.

- Release PRs (release-please, `chore(main): release …`) are the owner's: never merge them, never turn auto-merge on or off on them, never update them.

## M0 to 100% (owner, 18 Oct evening; replaces the stand-by)

Goal: every M0 FEATURE box ticked in `docs/DECOMPOSITION.md` (UI: core-bridge, tokens-theming, primitives, accessibility-l10n, main-window-shell, first-run, settings) and `docs/DECOMPOSITION-core.md` (backend: contract, storage, ipc-host, harness, settings, engine-foundation, first-run), then the M0 gate: E2E ≥ 60% of M0 commands and stories against the real core, perf ≥ 60% of due M0 scenarios, `harness.toml [milestone].current = "M0"` (owner).
- **At most 10 open PRs at any time** across both teams and cross-team roles (release PRs not counted). Before opening one, check the count (`gh pr list --state open`); at 10, finish or fold instead. M0 work only; nothing for M1+.
- A box is ticked in the PR that lands the feature's last missing item (or a docs PR for features already code complete), only when its code carries every marker and `just gate` passes (CLAUDE.md). First PR: tick the five code-complete features (UI core-bridge, tokens-theming, primitives, accessibility-l10n; backend settings).
- Every feature not yet complete gets one owner and one plan: the missing spec items (from be-pm/ui-qa audits and the dashboard's Traced column), the PRs that close them, in dependency order.
- The unblocking-PR rule (depth 1) and the release-PR rule still apply.

## PAUSED (owner, 18 Oct, late evening)

Usage limits reached. Everyone wraps up at a safe point (push WIP, write handoff-<role>.md) and waits for the owner's next command through the coordinator. No new work. Resume point: M0 to 100% (above); open owner item: harness-change-approved on DevOps's perf.toml PR.

## BACKEND M1 (owner, 21 Oct; replaces PAUSED, the freeze and stand-by for the backend)

M0 is delivered (`harness.toml [milestone].current = "M0"`). Goal: every backend M1 FEATURE box ticked in `docs/DECOMPOSITION-core.md` (5 features: engine-capture, capture-session, live-transcript, native-surfaces, library-calls; 36 commands, 13 stories per the milestone table), then the M1 gate (E2E >= 60% of M1 commands and stories against the real core, perf >= 60% of due M1 scenarios incl. `call-memory-footprint`); the owner advances the milestone. Backend only: the UI team is not part of this run; contract-lane PRs still get the UI review rule. The Q4 latency measurement and the Q7 engine-kill drill (week one of M1) come first; physical MacBook actions go to the coordinator, batched.
- Open PRs <= 10 across the unit. Tests first, gate, self-review, `review-publish`; never merge by hand. Rules above (lanes, generated files, baselines, thresholds, no pkill by pattern) apply in full.
- Team (Teamlead spawns and owns the six below; Unblocker and Delivery Reporter are started by the coordinator): Technical writer (Sonnet 5.5, ticks/docs/spec fit, replaces be-pm), 2 Backend engineers (Sonnet 5.5), 2 Senior backend developers (Opus 5.5), QA (Sonnet 5.5). The Teamlead assigns features by lane (engine vs core) and pairs seniors on the hardest (capture, session manager).

## FINISH-ONLY (owner, 21 Oct, out of tokens; replaces BACKEND M1 start-up)
Complete the open PRs (#131 #127 #126 #93); no new PRs or features (package-build branches stay pushed, unopened). When all are merged the coordinator stops every agent and watcher. Write handoff-<role>.md before that. Resume later from PLAN-be-m1.md.

## BACKEND M1 RESUMED (owner, 23 Oct; lifts FINISH-ONLY)
All FINISH-ONLY PRs merged (#127 #131 #132, D-28 A/B, #134 allowance). Continue backend M1 features per PLAN-be-m1.md and the handoff-*.md files: remaining M1 FEATURE boxes (engine-capture, capture-session, live-transcript, native-surfaces, library-calls) in dependency order. PR cap <= 10 open. Owner is low on tokens: keep messages and heartbeats short, batch owner items, escalate only owner-only things. #129 (release) is the owner's.

## NO PERFORMANCE TESTS (owner, 24 Oct)
Performance scenarios are out of active development: out of `just gate` and CI (PR ci/drop-perf-gate), no tasks to write them, backend or UI. Existing tests and files stay. Resume only on the owner's word.

## UI M1 (owner, 24 Oct)
Start UI M1: every UI M1 FEATURE box in `docs/DECOMPOSITION.md` (2.8 dialogs-host, 2.9 record-prompt, 2.10 call-window, 2.11 live-transcript, 2.12 menu-bar, 2.13 library-calls, 2.14 call-page-frame, 2.15 notifications) ticked with markers, `just gate` green, UI stories/commands covered against the real core (backend M1 is on main except 2.11 NSPanel conversion, NB10 resolved). No performance work (see NO PERFORMANCE TESTS). Open PRs <= 10 across the unit. Token cost matters: lean team, short messages, clear context between tasks, stop idle workers.

## LOW-COST MODE (owner, 24 Oct)
Session spend is high. Every worker: finish the task in hand, then worker_done and stop (no idle waiting or polling); /clear between tasks (state in handoff files); one-line messages; one test job at a time. Opus workers stop as soon as their PR is published. Leads restart workers with a fresh spec only when there is queued work. The Reporter runs one pass per owner request, never loops.

## FOCUS: NO NEW FEATURES UNTIL CURRENT ARE RESOLVED (owner, 25 Oct; low-cost mode stays)
Do not start or open any new feature work (no new feature branches, no new feature PRs, no menu-bar host PRs, no M2) until every currently open PR is merged or closed. Allowed: fixing, rebasing on conflict, QA, review, publish and ticking boxes for the open PRs; the 2.8 tick PR; releases (owner's). Leads stay up while a PR is open and wait on CI with `gh pr checks --watch` (no polling loops, no token use while waiting); workers stop when their task is done. Low-cost rules as above.

## FINISH-ONLY (owner, 29 Oct, out of tokens; replaces the UI M1 completion push)
Complete the open PRs (#224 #223 #216 #203; #221 release is the owner's); no new PRs, branches or features. Drop work that is not already in an open PR (note it in handoff-ui-lead.md). When the PRs are merged, or #203 cannot be finished without the owner, the lead writes handoff-ui-lead.md and sends COMPLETE; the coordinator then stops everything. Resume later from the handoff and ui/PLAN.md.

## BACKEND M2 (owner, 31 Oct)
Start backend M2: every backend M2 FEATURE box in `docs/DECOMPOSITION-core.md` (core-speakers-audio, engine-offline, llm-gate, jobs-scheduler, postcall, items-today, handoff, history-undo, native-services) ticked with markers and green gates; E2E >= 60% of M2 commands and stories against the real core. Backend M1 is 5/5 ticked on main (UI M1 finishing separately via #203). No performance tests (see NO PERFORMANCE TESTS). Open PRs <= 10 across the unit. Low-cost: fresh contexts, lean team, short messages, workers stop when done. Owner-only items batched to the coordinator.
