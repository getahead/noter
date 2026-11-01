# 2.13 library-calls r8 — PR #212 @32cb738 (auto-merge on, self-review COMMENT published, CI green)
Done (tests first): inst-live-status — outputs:progress sets the row's status cell (withProgress) and a spinner glyph beside Calls in the sidebar (writing()); unit + fake E2E.
Edit flow: NOT touched (teamlead: ui-eng-1 owns the whole flow, steps and header; my markers and ticks were removed in 32cb738).
Ticked: inst-live-status, flow-browse. cfs validate, just docs, E2E fake+stdio green; CI green (one m0 first-run flake rerun once).
Left open, with reason:
- 4 acceptance boxes (§6): states identical (screenshot proof), no status-icon truncation, Back restores scroll AND selection (no E2E), one calls_list per page (partly covered) — need tests/baselines; not done here.
- edit flow, dod-table, featstatus, feature line, DECOMPOSITION row: ui-eng-1 ticks the edit flow; the 4 boxes hold the rest.
- Owner/core gap: the real core sends no outputs:progress in M1, so the progress E2E step runs on the fake only (FAKE guard); stdio asserts the no-glyph baseline.
Notes: latest progress wins over a newer entity:changed until the next read (shortcut comment in calls-page.tsx). Baselines unchanged.
