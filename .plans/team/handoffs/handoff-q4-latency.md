# Handoff — Q4 live-ASR latency (feature 2.8 `-latency` DoD), 25 Oct 2026

Worker: be-q4-fable (Fable), worktree `~/orca/workspaces/noter/be-q4-fable`, branch
`lane/engine/q4-latency`. Evidence and the owner's re-run block: `.plans/backend/q4-latency-evidence.md`
(on the branch). Earlier: be-eng-2 (Opus) diagnosed the clock and left uncommitted work in
`~/orca/workspaces/noter/be-eng-2` (branch `fix/q4-live-latency`); that work is carried in this branch
unchanged, so that worktree can be reset.

## Found
- The reported 40-56 s came from timing segments from `session_started` (capture started ~30 s late,
  cold model load). From the capture clock the surviving live run (`~/q4-call.jsonl`, 2nd run, Teams,
  low load) still fails: hypothesis p95 7.5 s, confirmed p50 11 s / p95 17 s.
- Structural cause (replay on the stored audio, release build, model loaded): one decode ≈ 0.3 s
  encoder (30 s window regardless of audio) + ~20 ms per token (+ 0.33 s language ID, + fallbacks);
  the policy re-decoded a 20 s utterance about once a second per channel on one FIFO queue, so the
  queue was ~97 % busy and a confirmation (2 encoder passes + ~100 tokens ≈ 3 s) queued behind the
  other channel's hypothesis and confirmation. Both channels carried the same speech (no headset).
- File mode never loaded the model (`main.swift` built `EngineLoop` without `transcriber:`), so no
  replay or golden-set run ever transcribed.

## Done (branch, tests first)
- `LiveASR`: confirmations first on the decode queue (new test). With be-eng-2's changes (10 s cap,
  IO hand-off, in-place append, session-only language ID, file-mode model load, capture-clock
  `latency.py`): replay of the 6-min slice hypothesis p95 1.74 s, confirmed p95 3.12 s (was 5.86 s with
  be-eng-2's changes alone; main's policy: see the evidence table).
- Spec note under the `-latency` DoD rewritten to the verified numbers; DoD stays `[ ]` until the
  owner's live re-run passes (one copy-paste block in the evidence doc, writes `~/q4c-call.jsonl`).

## Open
- Owner: run the re-run block during a real EN/RU/DE call; send back the report lines. PASS → tick
  the `-latency` DoD and, with everything else ticked, the 2.8 box (writer's docs PR).
- Headroom is 0.3 s / 0.9 s on a quiet Mac. If the live run misses: drop the temperature fallback on
  hypotheses (14 % of queue time), then LocalAgreement (hypothesis decodes only the unconfirmed tail);
  fold language ID into the decode (saves 0.33 s per confirmation). Parakeet only if those fail.
- Model warm-up before the call (load on `call_detected` or at engine start) is a product decision;
  cold compile is 2-3 min once per Mac, warm load 1-2 s.
- Not measured: the text decoder on the GPU instead of the Neural Engine (one `ModelComputeOptions`
  line) as a contention-proof alternative when Teams or another app uses the ANE.
