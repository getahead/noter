# apps/desktop — agent notes

Lane: `ui` (the fake core and `tests/conformance` belong to the `contract` lane).

- Talk to the core only through `src/core` (`createCore()`); only `src/core/tauri-transport.ts` imports `@tauri-apps/*`, and only `main.tsx`, tests and stories import the fake core (`just arch` enforces it).
- Follow the bridge rules in `src/core/README.md`: snapshot then stream, wanted state with `rev`, never retry on your own, map every `ErrorCode` to the screen's named state.
- Tests: unit tests next to the code (`*.test.ts(x)`, ≥ 90% line coverage); UI flows in `tests/e2e`, one per DESIGN.md story, with the story ID in the test title; one screenshot spec per screen and state in `tests/visual`, rendered against the fake core.
- Screenshot baselines are rendered only in the pinned Playwright container (`just visual-update` or the `update-screenshots` PR label); never commit screenshots taken on a Mac.
- `pnpm test:unit`, `pnpm test:conformance`, `pnpm test:visual`, `pnpm typecheck`; `just gate-fast` before finishing.
