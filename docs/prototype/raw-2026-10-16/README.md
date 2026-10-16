# Noter UI prototype — RAW snapshot (2026-10-16) — NEEDS APPROVAL

**Status: raw. Not reviewed or approved by the product owner.** Nothing in this folder is a committed design decision; the PRD (`docs/PRD.md`, section "UI prototype") is the source of truth, and only decisions written there count.

Live, editable copy: https://claude.ai/artifact/Kuh85UsA1zoFYNh4U7B2U9 (Claude Design artifact, 26 boards, light and dark). This folder is a point-in-time copy of its source files, kept for history and diffing. Later snapshots go in sibling folders (`raw-YYYY-MM-DD/`); an approved set is copied to `docs/prototype/approved/` once the owner signs it off.

## What is here

- `canvas.json` — board layout (positions, sizes, row titles).
- `<Screen>.dc.html` — one board each, standard macOS look (system font, source-list sidebar, toolbar, push buttons, system accent). Each file carries a `STATUS: RAW — NEEDS APPROVAL` header comment.
- `<Screen>-dark.dc.html` — dark twin of the light board (a `dc-import` wrapper with `theme="dark"`); edit the light board only.

The boards reference `./support.js`, the artifact runtime served by the Design type; they do not render standalone from this folder. Open the live copy to view or edit.

## Boards

| Board | Title | Size |
| --- | --- | --- |
| `Main.dc.html` | Today dashboard · light | 1440×1000 |
| `CallScreen.dc.html` | Call screen on the dedicated display · light | 1920×1080 |
| `FloatingPanel.dc.html` | Floating panel (single display) · light | 420×760 |
| `PostCall.dc.html` | Post-call outputs with handoff drawer · light | 1440×1000 |
| `Main-dark.dc.html` | Today dashboard · dark | 1440×1000 |
| `CallScreen-dark.dc.html` | Call screen · dark | 1920×1080 |
| `FloatingPanel-dark.dc.html` | Floating panel · dark | 420×760 |
| `PostCall-dark.dc.html` | Post-call outputs · dark | 1440×1000 |
| `Agents.dc.html` | Agents · light | 1440×1000 |
| `Settings.dc.html` | Settings · light | 1440×1000 |
| `Agents-dark.dc.html` | Agents · dark | 1440×1000 |
| `Settings-dark.dc.html` | Settings · dark | 1440×1000 |
| `Library.dc.html` | Library · light | 1440×1000 |
| `Ask.dc.html` | Ask · light | 1440×1000 |
| `Person.dc.html` | Person page with History · light | 1440×1000 |
| `Activity.dc.html` | Activity and proposals · light | 1440×1000 |
| `Library-dark.dc.html` | Library · dark | 1440×1000 |
| `Ask-dark.dc.html` | Ask · dark | 1440×1000 |
| `Person-dark.dc.html` | Person page · dark | 1440×1000 |
| `Activity-dark.dc.html` | Activity · dark | 1440×1000 |
| `Performance.dc.html` | Performance · light | 1440×1000 |
| `FirstRun.dc.html` | First-run wizard · light | 760×560 |
| `MenuBar.dc.html` | Menu bar quick actions · light | 420×460 |
| `Performance-dark.dc.html` | Performance · dark | 1440×1000 |
| `FirstRun-dark.dc.html` | First-run wizard · dark | 760×560 |
| `MenuBar-dark.dc.html` | Menu bar · dark | 420×460 |

## Sync rule

Decisions taken while reviewing these boards are written into the living PRD first, then exported to `docs/PRD.md`; the prototype itself is updated in the artifact, and a new raw snapshot is taken here when the set changes materially. The approval that lifts a snapshot out of "raw" is the owner's word, recorded in the PRD decision log.
