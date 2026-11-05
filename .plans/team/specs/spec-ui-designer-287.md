# Designer: baseline review of PR #287

First: export PATH=/opt/homebrew/bin:/usr/bin:$PATH. You are the UI DESIGNER. Read ~/projects/noter-wt/_team/spec-ui-designer.md and spec-ui-r11-designer-223.md (same procedure).

Task: PR #287 (fit the record prompt to its content, UI half of 2.9/2.10) changes 10 visual baselines (png files under the `__screenshots__` folders of apps/desktop/tests/visual):
- record-prompt.spec.ts: call-ended, default, disk-full, event, model-missing, new-meeting, not-a-call, system-audio-off
- l10n-pseudo.spec.ts: record-prompt-cyrillic, record-prompt-german

Steps:
1. Check out the PR branch in your worktree (gh pr checkout 287). List the changed png files with gh pr view 287 --json files.
2. OPEN EVERY IMAGE with the Read tool.
3. Compare each with docs/DESIGN.md 4007 (record prompt: 360 pt wide up to 440, height fits content about 100 to 124, no window title bar, Record button fully visible) and 4036, and the clickable prototype state. Check: clipping, padding, Record button visible, Cyrillic and German not truncated, light and dark if both exist.
4. Post ONE PR comment with a table (image, verdict, note).
5. If every image passes: gh pr edit 287 --add-label visual-change-approved.
6. If any fails: do NOT label; list the defects in the comment and tell the coordinator (run_ba2441689556) and the core-click-focus worker (dispatch ctx_62c4cfca4050) in one line each.

Never edit baselines. Report one line to the coordinator and stop.
