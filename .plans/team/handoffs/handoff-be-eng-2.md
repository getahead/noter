# Handoff — be-eng-2 (engine lane), 24 Oct 2026

Worktrees: `~/orca/workspaces/noter/be-eng-2` (main), plus `be-eng-2-3b`, `be-eng-2-4a`, `be-eng-2-4b` (spare, all on merged branches; reuse or `git worktree remove`). Spec: `spec-be-eng-2.md`.

## Merged (engine-capture 2.8 and the native half of 2.11)
- #139 capture sessions in Swift (ring, AAC parts, timeline.json; call-time drift fix).
- #145 one-clock capture, exclusions, `device_changed`, self-test clip/OwnSoundsLeak, `kill_drill` example, owner runbook `.plans/backend/m1-week-one-runbook.md`.
- #150 detection facts, `system_audio_silent`, replay.
- #153 live ASR on WhisperKit (pinned by revision 1bbc57c; tokenizer pinned into the whisper-turbo bundle so the sandboxed engine loads offline), `self_test_line`, `engine/scripts/latency.py` (Q4 report), runbook part C.
- #157 QA r27/r30/r31 marker and runbook fixes (B7 detection, B8 silent system audio, B9 replay).
- #160 capture-first restart re-decodes the ring's unconfirmed tail (20 s cut aware); supervisor `start_session` pinned and marked.
- #165 (replaces #163; non-lane branch `native/notifications-calendar` because it also carries 2 cargo-generated lines of `apps/desktop/src-tauri/Cargo.lock`) noter-native: `display_frame`, `post_notification`, `on_notification_click`, `announce`, `calendar_event_near` in the shape agreed with be-eng-1; capture-session flow marker restored.

## 24 Oct evening (task_a8e72d9bec30)
- #187 merged (non-lane `test/q7-kill-drill`): `noter-core-harness/tests/boot.rs` q7_* drill tests on the real core; runbook A1/A3 run on the real engine here (release, file mode, synthetic `say` WAVs, no TCC): PASS, gaps 108/184/185 ms; A3 -> Failed. DoD `-restart` + AC2 ticked, `@cpt-dod` on `restart_capture`. `-replay` has a D-30 note. Runbook: A done; C and G copy-paste.
- 2.8 box still [ ]: waits on DoD `-latency` (owner's C call) and the owner's G decision (`-asr` budget = live-*-lag perf, out per 24 Oct order?).

## Spec state
- `core-engine-capture.md`: every flow, algorithm, state and step `[x]` with markers. Open, not code: DoD `-asr` (golden set on the Mac runner; perf out of development), `-restart` (owner's Q7 drill, runbook A), `-latency` (owner's Q4 EN/RU/DE call, runbook C), `-replay` (60-min footprint = a perf scenario), §6 acceptance criteria, the feature box (writer + QA).
- `core-native-surfaces.md`: crate steps ticked (notifications `inst-request-auth`, `inst-post`; calendar `inst-no-access`, `inst-read-events`, `inst-return-events`). Host/core halves for be-eng-1 / #155: `inst-click`, `inst-read-auth`, `inst-announce`, `inst-read-displays`, calendar `inst-read-fail` (the crate has no logger; the host logs or adds `CalendarAccessDenied`).

## Owner items (batched by the Teamlead)
- Runbook `.plans/backend/m1-week-one-runbook.md`: A (Q7 kill drill, replayed + live), B1–B9 (one clock, sides, exclusions, device change, own clip, stop time, detection, silent system audio, replay), C (Q4 latency). Results tick DoD `-restart` and `-latency` and several §6 criteria.
- D-32: live labels are per side for M1 (You / `spk_1`); live diarization (FluidAudio binary or pinned pyannote/wespeaker CoreML) is an M2 decision. The parked branch was deleted (never pushed).

## Known, not mine
- Local `just arch` fails after `swift test` resolved packages: it scans gitignored `engine/.build/checkouts` (CI unaffected). Workaround: `rm -rf engine/.build` before a local gate. Owner/harness item.
- E2E flakes `m0-first-run-ui.spec.ts:154`, `m0-a11y-l10n-screens.spec.ts:127` (Unblocker).

## Notes for whoever continues
- Local gate: `cargo build -p noter-core-harness && export NOTER_CORE_CMD="$PWD/target/debug/noter-core-harness --fixture world"`; new worktrees need `just setup` (node_modules).
- Send the Teamlead every PR number at open; publish the self-review (auto-merge) only after QA PASS.
- `review-publish` checks the checkout it runs in: run it in the worktree holding the PR's head, after a fresh `pr.py fetch` and the review written after it.

## 1 Nov 2026 — 2.14 slice 1 (task_3b50a725d56e)
- PR #228 `feat(engine): offline_pass and embeddings over engine stdio` (plain branch `engine/offline-protocol`: the lane guard refuses the contract commit on `lane/engine/…`). Self-review APPROVE published at a43f2014, auto-merge on.
- API for post-call (2.17): `EngineClient::offline_pass(call_id, session_dir, result_path, constraints_path, backend) -> Result<PathBuf, OfflineError>` (fresh `result_path` per attempt), `speaker_embedding(request_id, call_id, channel, spans, out_path) -> Result<Vec<f32>>` (256), `embed_texts(request_id, texts, out_path) -> Result<Vec<Vec<f32>>>` (1024/row; batch needs out_path), `offline_state(&OfflineKey)`; drop the future = abandon. `EngineLauncher::container()`; `ScriptedEngine::with_container(dir)` gives built-in answers (empty archive, deterministic vectors) unless a script step names the command. The harness does not set a container yet (core lane, 2.17).
- Contract: `ArchiveResult`, `EngineWord` (engine.schema.json `archive_result`, `words_file`; fixtures `archive_results`, `words`).
- Swift: `Offline.swift` (`ContainerPath`, `OfflineWork` protocol, validation/ack/error/progress/done/failed/embedding events); `main.swift` passes no `OfflineWork` yet → `model_missing`.
- Slice 2: implement `OfflineWork` (Large v3 decode both channels, VAD+lang, beam 5, glossary/hallucination filters, alt-language re-decode, overlap marks, channel attribution; bge-m3 + WeSpeaker pinned via `scripts/models`), ticks `inst-archive-start/-complete`, `inst-embed-run`, `-decode` (minus cluster), `-vectors`; constraints file schema is not defined yet (speakers 2.13 persists them). Slice 3: `inst-decode-cluster` (D-32, owner).
- Local gate notes: `rm -rf engine/.build` before `just gate` (arch scans checkouts); when main moves, local `trace --base origin/main` fails on IDs merged after the branch — check with `trace_gate.py --base $(git merge-base HEAD origin/main)`, do not update a conflict-free PR.

## 1 Nov 2026 — 2.17 post-call slice 2 (task_2ffda0c6e244)
- #254 MERGED (plain branch `contract/postcall-wire`: `EntityChanged::Section`, `ErrorCode::OutputInvalid`, contract 2.2; one-line UI store fix `case "section"` forced the plain branch).
- #257 published (APPROVE, auto-merge on), `lane/core/postcall-archive`: `archive.rs` (ArchivePass), `chunks.rs` (chunks + bge-m3 embeddings, migration noter-core v6 `0006_chunks.sql` + `segments.crosstalk_with`), `merge.rs` (line diff3), Regeneration handler, suggested items + spans, summary.md, Summary ready/failed notification, D4 arithmetic (`switches_off`), `noter_llm::PacketContext`, harness engine container = data dir, `RunCtx::change_meta`.
- Open, M4: `inst-write-reviews`, `inst-notify-switch`, `inst-notify-return`. Slice 3: story tests call-page-review-outputs, notifications-open-outputs, core-call-end-outputs.
- Coordination for 2.13: archive reads `audio/<call>/constraints.json` (container-relative) if present, else writes live names; term fixes read from `segments.corrections` as `TermCorrection[]` with CHAR ranges.
- Lessons: cfs parses a CDSL step only when the `inst-…` id ends the line — put "(M4: …)" notes BEFORE the id, else the step vanishes and a `[ ]` parent whose remaining steps all have markers fails `code-task-unchecked`. Local `trace` compares with origin/main's tip: rebase before opening if main moved (IDs merged meanwhile read as "lost"). The scripted engine refuses `session_dir` with a trailing slash. A Regeneration trigger must be `Trigger::OnDemand` (its job def), else `trigger` returns None.
