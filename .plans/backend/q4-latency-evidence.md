# Q4 real-call latency: cause, fix and re-measure (24-25 Oct 2026)

DoD `cpt-noter-dod-core-engine-capture-latency`: hypothesis lag p95 ≤ 2 s, confirmed lag p95 ≤ 4 s
on a real EN/RU/DE call, both channels, one WhisperKit Turbo instance, M5 MacBook (32 GB).

## The two live runs

`latency.py` on main timed every segment from `session_started` + `t1_ms`, which charges the
capture start delay, lost audio and the cold model load to transcription. Timed from the capture
clock (the `levels` line of the 100 ms that held `t1_ms`; `latency.py` does this now):

| Live run (owner, 24 Oct) | As reported | From the capture clock |
|---|---|---|
| 1st, load 40-80, Safari (`q4-call.jsonl` overwritten by the 2nd run) | hyp p95 51.6 s, conf p95 55.5 s | hyp p95 2.2 s, conf p95 3.7 s after the model load (be-eng-2's analysis, 24 Oct; the file no longer exists) |
| 2nd, load 4-9, Teams (the surviving `~/q4-call.jsonl`, 30.7 min) | hyp p95 40.4 s, conf p95 50.2 s | first audio 31.8 s after `session_started`, lost 1.7 s; **hyp p50 1.7 s / p95 7.5 s, conf p50 11.0 s / p95 17.0 s** |

So the 2nd run fails on transcription itself, not on the clock: 237 hypotheses and 171
confirmations in 30 min (one segment line every 4-6 s), 26 `no_segments` facts (speech flowing,
nothing out for 10 s), and `ru` confirmed at p50 14 s.

## The structural cause, measured on the stored audio

Replay of `~/noter-week-one/audio/q4` (AAC → 16 kHz WAV, `afconvert`), minutes 15:00-21:00
(English, both channels carry the same speech: the mic hears the speakers, no headset), release
build, file mode with the model loaded (`main.swift` never passed `transcriber:` in file mode: a
replay, the golden set included, never transcribed), warm model, load average 4-7.

What one decode costs (WhisperKit's own timings, 152 decodes): mel 9 ms, **encoder 305 ms** (a
30 s window whatever the audio length), decoder loop **~20 ms per token** (29 tokens p50, 63 p95),
and a temperature fallback re-runs the loop (23 of 152 decodes). Language ID is a second mel +
encoder pass, 330 ms. Model load 1.2-2.0 s warm (the 2.5 min seen live is CoreML's first compile,
cached under `~/Library/Caches/ai.noter.engine`).

The policy on main re-decodes the whole open utterance about once a second per channel (an
utterance runs to 20 s; the energy VAD rarely finds a 700 ms pause in a call), both channels on one
FIFO queue, and a confirmation decodes up to 20 s (2 encoder passes + ~100 tokens ≈ 3 s). Each
captured second is decoded about four times, the queue is busy ~97 % of the time, and a
confirmation waits behind the other channel's hypothesis and, in crosstalk, behind the other
channel's confirmation too:

| Replay, 6 min slice | Decodes | Hypothesis p50 / p95 | Confirmed p50 / p95 |
|---|---|---|---|
| main's policy (20 s cap, FIFO) | 342 | 1.41 / **2.20 s FAIL** | 3.05 / **5.56 s FAIL** |
| be-eng-2's changes (10 s cap, IO hand-off, in-place append, session-language ID) | 514 | 1.18 / 1.74 s | 1.99 / **5.86 s FAIL** |
| + confirmations first on the decode queue (this PR) | 502 | 1.19 / 1.74 s | 1.76 / **3.12 s PASS** |

(File mode plays 100 ms windows with `Thread.sleep`, so the replay runs ~3.7 % slower than real
time: "lost 13.5 s" in the report is that drift, not lost audio.)

Offline, main's policy fails by 1.1 s / 1.6 s; the live 2nd run failed by 5 s / 13 s on the same
policy. The extra factor is the live Mac itself and is not measured here: that call ran in
Microsoft Teams (its noise suppression and background effects share the Neural Engine the
decoder runs on), while the 1st run, in Safari at load 40-80, decoded at p95 2.2 s / 3.7 s. The
re-run below says whether the policy change alone is enough on a Teams call.

## The change (`lane/engine/q4-latency`)

1. `LiveASR`: decodes wait in a list the queue drains confirmations-first (test: a confirmation
   queued behind two hypotheses is decoded second, not third). Stale hypotheses were already
   skipped by generation.
2. be-eng-2's uncommitted work, kept as it was: the IO proc only hands chunks to a serial queue
   (no overruns, no lost audio), utterances are cut at 10 s, an utterance is appended in place,
   language ID never takes a language outside the session's (the channel's last confirmed language
   leads), the decode queue runs at user-initiated QoS, file mode loads the model, `latency.py`
   times from the capture clock and prints the capture faults.

Not changed, named: hypotheses still re-decode the whole utterance (the queue stays ~96 % busy;
the next step if a loaded Mac misses the budget is no temperature fallback on hypotheses, 14 % of
queue time, then LocalAgreement so a hypothesis decodes only the unconfirmed tail); language ID at
confirmation is a second encoder pass (330 ms) that WhisperKit could fold into the decode with
session-only language tokens; the decoder on the GPU instead of the Neural Engine was not measured.

## Decision for the owner

On this evidence Turbo on the M5 meets both budgets once the policy stops starving confirmations:
Parakeet as a second backend is **not** indicated. The budgets have 0.3 s (hypothesis) and 0.9 s
(confirmed) of headroom on a quiet Mac in crosstalk (both channels decoding the same speech, the
worst case); with a headset the sys channel is quiet while the user speaks and the load halves.
If the live re-run below still fails, the numbers it prints decide: a confirmed p95 between 4 and
6 s is the hypothesis fallback / LocalAgreement work; above that, the Mac's load, and then
Parakeet TDT v3 (FluidAudio, ~10× fewer decoder steps) is the fallback to budget.

## Owner re-run (one block, after this PR is on main)

Writes a new file (`~/q4c-call.jsonl`); the self-test loads the model before the call so the run
measures streaming lag, as the budget is defined. Start it 1 minute before the call, press Ctrl-C
once when the call ends, then run the report.

```sh
cd ~/projects/noter && git switch -q main && git pull -q
export PATH=/opt/homebrew/bin:/usr/bin:$PATH NOTER_APP_GROUP_DIR=$HOME/noter-week-one
swift build -c release --package-path engine && ENGINE=$PWD/engine/.build/release/noter-engine
{ echo '{"id":9,"cmd":{"type":"self_test","play_clip":false,"timeout_ms":5000}}'; sleep 45
  echo '{"id":1,"cmd":{"type":"start_session","call_id":"q4c","session_dir":"audio/q4c","store_audio":true,"mic_device_uid":null,"exclude_bundle_ids":[],"languages":["en","ru","de"],"backend":"whisper_turbo","glossary":[],"speaker_priors":[],"enrolled_embeddings_path":null,"resume_from_ms":null}}'
  sleep 3600; echo '{"id":2,"cmd":{"type":"stop","call_id":"q4c"}}'; sleep 3
  echo '{"id":3,"cmd":{"type":"shutdown"}}'; } | $ENGINE > ~/q4c-call.jsonl
python3 engine/scripts/latency.py ~/q4c-call.jsonl
```

Send back the report's lines (the `capture` line, the per-language p50/p95 and the two PASS/FAIL
lines). If the model has to compile first (a new Mac or a cleared cache), the self-test takes
2-3 minutes: make the first `sleep 45` a `sleep 200`.
