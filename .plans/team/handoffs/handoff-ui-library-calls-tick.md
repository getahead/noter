# 2.13 library-calls tick pass — PR #207 @64dec25 (auto-merge on, self-review COMMENT published)
Ticked with markers: inst-if-empty, user-row, return-delete, local-only, return-cell, medium, error-loading, listed-several, several-listed, empty-listed, row-update, return-edit; parents flow-delete, algo-status-cell, state-list, dod-delete (+@cpt-dod marker).
Implemented (tests first): Medium width status = icon only (CSS + .lb-status__text, E2E at 1100px, unit); LC-R3 data-state (listed/selected-several).
QA's 197-r3 minors: the old deleted-audio copy at library-calls.md:155 was already fixed (D-36) on main; no change needed.
Left open (rule 3):
- inst-live-status: outputs:progress is not applied to the row and the sidebar glyph is shell work.
- edit flow inst-user-edit, inst-api-update: Call page ⋯ › Rename…/Call Type menu is lane/ui/call-page-frame (no call_update caller in UI).
Therefore unticked: flow-browse, flow-edit, dod-table, featstatus, feature line, DECOMPOSITION, 4 acceptance boxes.
Note: hidden status link at Medium stays focusable (review comment, non-blocking).
Checks: cfs validate, just docs, gate-fast, E2E fake+stdio (8/8), trace, CI green except review (published).
