# ui-mid-2 r6 — #202 designer CHANGES
- Reset lane/ui/notifications to 391c388. Fixed tests/visual/settings.spec.ts: notifications-off fixture now also sets app.environment.notifications = "denied" (a4a8541). Unit test for the row already existed.
- Bot refreshed only notifications-off.png (f2c2b28); inspected: off row + Open System Settings… render, differs from pane-general.
- icloud/no-match/self-test: explained in a PR comment (General pane's new row shifts rows below).
- gate-fast green; checks all green; self-review APPROVE published at f2c2b28.
- Skipped: /ponytail-review (diff is a one-line fixture + a bot baseline).
