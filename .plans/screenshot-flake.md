# First-run screenshot flake

Scope: stabilize the existing `docs/features/ui/first-run.md` self-test visual states;
apply the owner's 7 Nov 2026 request for 95% screenshot match. No production behavior changes.

## Pipeline evidence

- PR #365, CI run 42409903447, visual job 128516125476:
  <https://github.com/getahead/noter/actions/runs/42409903447/job/128516125476>.
- 219 tests passed; `first-run window (light) › renders passed` timed out waiting
  for `Self-test passed`, before any image comparison.
- Artifact `visual-diffs` (13589076538), failed test's `trace.zip`:
  click action 46696.750–46808.540 ms, target center (679.34, 370.32).
  DOM snapshot 46779.884 ms has no permission-row meter; 46813.461 ms adds
  the microphone meter and `Hearing you`. The panel remains `idle`.
- Pipeline screencast frames `1794082561922.jpeg` and `1794082562248.jpeg`
  show Run Test moving down about 19 CSS pixels as the row arrives.

## Change and verification

Reuse `settled(page)` before first-run state interactions, including the silent-stream
case. It waits for fonts and initial meter ticks; keep the existing post-interaction
wait and outcome assertions. No retries, sleeps, or baseline updates.

Set `min_pixel_match = 95.0`; keep the per-pixel color threshold at 0.02.
Update the gate test and docs. The new 95% assertion failed against 98% before the
configuration change. The loosening-guard test must still detect a lower match bar.

Done: `just gate-fast` passes and all required pipeline gates pass, including
the affected visual states. Per owner request, use pipeline screenshots only;
do not capture screenshots locally or regenerate baselines.
