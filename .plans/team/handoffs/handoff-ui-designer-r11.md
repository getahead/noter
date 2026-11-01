# designer r11 handoff — #223 baseline review
- Read all 15 library-calls baselines (756db01) against DESIGN 3.2 Library, library-calls.md, prototype states.
- OK (6): empty-{wide,medium,narrow}, loading-{wide,medium,narrow}.
- CHANGES (9): default/selected/statuses at all widths. Wide: status cell icon-only, no text. Medium/Narrow: Length not hidden; Narrow: Type + tags not hidden, no two-line rows.
- selected-medium/narrow show cell dividers in selected rows (wide has none). Export… absent (confirm it is a later feature).
- Test widths 1280/1100/820 give content 1060/880/820: none is Narrow, first is Medium. Suggest 1320/1100/740.
- Review table posted as a PR comment on #223. Label visual-change-approved NOT added. No baseline or branch touched.
r11 round 2 (3fe22ee): 14/15 OK; selected-medium.png CHANGES (vertical cell dividers remain in selected rows at Medium).
Table posted on #223; label visual-change-approved NOT added.
Next: ui-mid-2 removes the Medium selected-row dividers, bot re-renders, I re-review that one image.
- r11 round 3 (#223, bot 6119e269): 15/15 OK, selected-medium dividers gone; label visual-change-approved added.
- Note: branch tip 61548875 (accent-fill specificity fix) postdates the reviewed baselines; the selected rows already showed the accent fill.
- Round 4 (#223, bot 10a736d): selected-wide OK, selected-narrow OK, selected-medium CHANGES (vertical dividers either side of the Open column on selected rows). Label visual-change-approved removed; PR comment posted.
- Next: ui-mid-2 removes the Open-cell border in the selected/Medium state, bot re-renders selected-medium, designer re-checks that one image.
- Round 5 (#223): NOT reviewed. e9aebb6 is a test-only commit (m1-library-calls-ui.spec.ts); no PNG changed since bot 10a736d, and the Screenshots check on the tip was still pending. No comment, no label.
- Next: wait for the bot's refresh commit after d02a64d/e9aebb6 (no baseline PNG changes in that commit yet), then re-check selected-medium.
- Round 5 (#223, tip e9aebb6): d02a64d judged credible (per-cell accent fill + 1px bleed); other 14 images OK. Label visual-change-approved added; PR comment posted.
- Owner item: selected-medium baseline still carries a sub-tolerance hairline; delete the file and re-run the update-screenshots bot for a clean render.
