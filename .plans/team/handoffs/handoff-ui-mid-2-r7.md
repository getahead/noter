# ui-mid-2 r7 handoff (#202, designer CHANGES: info icon)
- Code fixed @92a9afb: GeneralPane `Warn` takes `icon`; notifications-off line passes "info"; unit test asserts the info path. gate-fast green, CI green.
- Reset to origin f2c2b28 first, as specced.
- Label cycled (update-screenshots); the update run on 92a9afb re-rendered and committed NOTHING (changed=false): Playwright keeps a baseline within the 98% tolerance and a 12px icon swap is inside it.
- So notifications-off.png on the branch STILL shows the warning triangle (viewed it). Designer will see the old image.
- Not done: no `design #202` / `ready #202` sent (the baseline is wrong). I did not hand-edit baselines or touch thresholds (forbidden).
- Self-review on 92a9afb published: COMMENT (explains the above). Auto-merge on; hygiene still needs the designer label.
- Owner decision needed: tighter threshold for that shot, or another way to refresh the baseline.
- Ran review via pr.py/workflow steps directly, skipped the full cf runtime bootstrap modules. /ponytail-review skipped (stated in review.md).
