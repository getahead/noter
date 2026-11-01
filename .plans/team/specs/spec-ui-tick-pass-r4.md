# UI M1 r4 — tick pass per feature (read spec-ui-r3-common.md first)

Goal: the feature's DECOMPOSITION box, `featstatus` and feature line ticked, which `cfs validate` allows only when EVERY CDSL item of the feature is `[x]` with its marker in code. Branch from current main: `lane/ui/tick-<feature>`; PR title `feat(ui): <feature> tick pass`.
For every open `[ ]` item in `docs/features/ui/<feature>.md` and the feature's DECOMPOSITION rows, do exactly one of:
1. Code exists → add the `// @cpt-…:inst-…` marker (or `@cpt-begin/@cpt-end`) on it, tick the item.
2. Small leftover (≤ ~50 lines incl. its test, inside the feature, M1 scope) → test first, implement, mark, tick.
3. Not this lane's to deliver (core step the core already does, M2/M4 step, XCUITest-only proof, backend ask) → leave `[ ]` and list it in the handoff with the reason, one line each. Never tick without the marker and never delete a marker.
Run `cfs validate` (`python3 .cf-studio/.core/skills/studio/scripts/studio.py validate`), `just docs`, `just gate-fast`, own E2E spec fake+stdio under the lock, `just trace` (coverage never lower). Tick the DECOMPOSITION/featstatus/feature line ONLY if every item is `[x]` and `cfs validate` passes; otherwise leave them and say exactly which items hold them open. Push, `gh pr checks --watch`, self-review (`/cf-sdlc-pr-review` + `/ponytail-review`), `just review-publish` when green (no QA needed for marker/tick-only PRs; send `ready #N @sha` if you implemented anything beyond markers so QA runs). Handoff ≤ 20 lines, worker_done.
