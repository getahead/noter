# Syncing docs/PRD.md from the living copy

`docs/PRD.md` is a snapshot. The source of truth is the **living copy**, the Claude Doc / artifact linked in the
header comment at the top of `docs/PRD.md` (edit, comment and review happen there). The repository copy exists so
that agents, `cfs validate` and code review can read the PRD offline and so every change to it shows up in a diff.

Never edit `docs/PRD.md` by hand to change requirements: change the living copy, then sync. A fix made only in
the file is lost at the next sync.

## When to sync

Whenever the living copy changes in a way the code or the design depends on: a requirement, a decision, the
roadmap, or a backport from `docs/DESIGN*.md`, a review or the prototype. Sync before starting work that relies
on the change, not after.

## How (manual, about five minutes)

1. Open the living copy and note its revision number (version history of the doc).
2. On a branch of its own (`docs/prd-sync-<date>`), replace everything **below** the header comment in
   `docs/PRD.md` with the living copy exported as Markdown. An agent with the Claude artifact tools can do this:
   read the artifact linked in the header and write its Markdown body into the file.
3. Update the header comment, keeping its first three lines as they are:
   `Last sync: <YYYY-MM-DD> (living copy rev <N>; <one line on what changed or was backported>)`, plus the
   pointers to the review files, `docs/DESIGN.md` version, diagrams and prototype of record if they moved.
4. Run `just docs` (`cfs validate`): IDs the PRD defines must still resolve, and DESIGN references must still
   point at existing PRD IDs. Fix the living copy, not the file, if it fails, and export again.
5. Commit as `docs(prd): sync living copy rev <N>` and open a PR. The diff is the review: anything that changed
   unexpectedly is a sign the living copy and the repository drifted.

If a change was made in the repository first (a backport from a design review, for example), make the same change
in the living copy before the next sync and say so in the header line, as the 17 Oct 2026 sync did.
