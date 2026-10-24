# Q4 real-call latency: diagnosis, fix and re-measure (24 Oct 2026)

DoD `cpt-noter-dod-core-engine-capture-latency`. The owner's EN/RU/DE call on the M5 MacBook
(`~/q4-call.jsonl`, 25 876 lines, audio `~/noter-week-one/audio/q4`, 39 min) reported
hypothesis p50 43 s / p95 51.6 s and confirmed p50 46.7 s / p95 55.5 s (budgets 2 s / 4 s), plus
stray fr/ja/uk segments. The Mac was busy with agent builds and gates (load average 40 to 80).

## What the lag was made of

`latency.py` timed each segment from `session_started` + `t1_ms`. Call time counts captured
samples, so that is only right when audio starts at once and no sample is lost. Neither held:

| Part | Size | Cause |
|---|---|---|
| First audio after `session_started` | 27.6 s | Unknown: the IO proc delivered nothing for 27.6 s (no levels at all), then both channels at once, 165 ms before Safari started playing. Needs the live re-run below. |
| Audio lost during the call | 23.3 s over 39 min, in bursts (0.02 s to 2.5 s per minute) | Core Audio dropped IO cycles: the IO proc resampled, wrote the ring and the AAC files, encoded JSON to stdout and fed the ASR (which copied the whole open utterance, up to 1.3 MB, on every chunk). On a loaded Mac that overruns the cycle. The AAC files hold 2350 s for a 2401 s call. |
| Model load (WhisperKit Turbo, cold engine) | 152 s live, 181 s in replay (load average 40 to 80); 2.5 s in a replay at load average 5 | Each engine start; what was said meanwhile is decoded after it, so on the busy Mac the first 2.5 to 3 min of confirmations came 1 to 2.5 min late. |
| Transcription itself (audio captured → segment line) | hypothesis p50 1.5 s / p95 2.2 s; confirmed p50 2.6 s, p95 3.7 s after the load backlog | Real-time: the engine kept up for the whole call (no growing queue). |

So the order-of-magnitude FAIL is a measurement of lost and late audio plus the model load, not
an engine slower than real time. Lag measured from the capture clock (the session's `levels`
line for that 100 ms of call time) on the same call:

```
capture    first audio 27623 ms after session_started; lost 23316 ms over 39.2 min
hypothesis all  n= 2135 p50=  1520 ms  p95=  2179 ms
confirmed  all  n=  228 p50=  2635 ms  p95= 19408 ms   (first 3 min: model-load backlog)
```

Stray languages: WhisperKit's `detectLangauge` returns the probability of its top language only,
so when that was fr/ja/uk the session filter left nothing and the code fell back to it
(36 hypotheses, no confirmations).

## Changes (PR `fix/q4-live-latency`)

1. `LiveAudioSource`: the IO proc only queues each chunk (`handOff`) onto a serial user-interactive
   queue; `stop` drains it, and a device swap is reported after the old device's chunks.
2. `LiveASR`: an utterance is appended in place (no whole-buffer copy per chunk); utterances are
   cut at 10 s instead of 20 s (see the replay below); language ID outside the session languages
   takes the channel's last confirmed language (else the first session language) instead of the
   stray one; the decode queue runs at user-initiated QoS, above builds.
3. File mode loads the speech model too (it had none, so a replay, the golden set included, never
   transcribed).
4. `latency.py` times lag from the capture clock and prints first-audio delay and lost audio as
   capture faults of their own.

## Re-measure offline (replay of the stored audio, real time, same busy Mac)

Release build, file mode, `start_session` with en/ru/de, cold engine. The 39-minute replays ran at
load average 40 to 80 (model load 181 s); the 14-minute slice ran at load average 5 to 8 (model load
2.5 s) while another agent's engine replayed the same audio. File mode paces its 100 ms windows with
`Thread.sleep`, so its `lost` line (3 to 4 %) is pacing slip, not capture loss.
"Steady" = utterances begun more than 60 s after the model was ready.

| Run | Hypothesis p50 / p95 | Confirmed p50 / p95 | Languages |
|---|---|---|---|
| Live call, capture clock | 1.52 / 2.18 s | 2.64 / 19.4 s (3.7 s steady) | en ru de + fr ja uk |
| Replay, 39 min, 20 s cap, whole call | 1.45 / 2.16 s | 2.46 / 66.7 s | en ru de |
| Replay, 39 min, 20 s cap, steady | 1.46 / 2.15 s | 2.43 / 3.54 s | en ru de |
| Replay, 15:00-29:00, 20 s cap, steady | 1.56 / 2.18 s | 2.49 / 3.16 s | en ru de |
| Replay, 15:00-29:00, 10 s cap, steady | 1.14 / 1.73 s | 1.71 / 3.16 s | en ru de |
| Replay, 15:00-29:00, 10 s cap, whole slice (`latency.py`) | 1.17 / **1.78 s PASS** | 1.81 / **3.30 s PASS** | en ru de |

Hypothesis lag grows with the utterance (each hypothesis decodes all of it): p95 1.82 s under
10 s, 2.05 s at 10-15 s, 2.38 s at 15-20 s; 194 of 205 utterances ran to the 20 s cap (the
energy VAD rarely finds a 700 ms pause in a call). Hence the 10 s cap. That within-run split is the
controlled evidence for it; the slice's lower numbers also owe to the quieter Mac.

## What is left, and the proposal

- **Model load (decision for the HoD/owner).** Turbo took 2.5 to 3 min to load on this Mac
  under load average 40 to 80 (2.5 s when quiet), and the core starts the engine "on first need", so every first call after launch
  confirms its first minutes late and the whole-call p95 fails. Options: load the model when the
  engine starts with detection on, or on `call_detected` (before the user presses Record), at the
  cost of keeping about 1 GB resident while idle; and measure `prewarm: false` (WhisperKit loads
  each model twice with prewarm). Parakeet as a second backend is **not** indicated by this
  evidence: once the model is loaded, Turbo keeps up in real time on the M5 even under load
  average 40 to 80, and with the 10 s cap the budgets are met.
- **27.6 s before the first audio (live only).** Not reproducible offline; the re-run below
  prints it (`capture first audio … after session_started`).
- **Dropouts.** Fixed by design (nothing but a copy and an enqueue on the IO thread); only a live
  run can prove it: the re-run prints `lost … ms`, expected near 0.
- **Engine crash on a failed stdout write.** One replay died with SIGABRT in
  `EventWriter.stdout()` (`-[NSFileHandle writeData:]` raises on a write error). Not part of this
  change; worth `write(contentsOf:)` with error handling in its own PR.

## Owner re-run (one block, after this PR is on main)

The self-test loads the model before the call, so the run measures streaming lag; drop the
`self_test` line and its `sleep 240` to measure a cold engine instead.

```sh
cd ~/projects/noter && git switch -q main && git pull -q
export PATH=/opt/homebrew/bin:/usr/bin:$PATH NOTER_APP_GROUP_DIR=$HOME/noter-week-one
swift build -c release --package-path engine && ENGINE=$PWD/engine/.build/release/noter-engine
{ echo '{"id":9,"cmd":{"type":"self_test","play_clip":false,"timeout_ms":5000}}'; sleep 240
  echo '{"id":1,"cmd":{"type":"start_session","call_id":"q4b","session_dir":"audio/q4b","store_audio":true,"mic_device_uid":null,"exclude_bundle_ids":[],"languages":["en","ru","de"],"backend":"whisper_turbo","glossary":[],"speaker_priors":[],"enrolled_embeddings_path":null,"resume_from_ms":null}}'
  sleep 3600; echo '{"id":2,"cmd":{"type":"stop","call_id":"q4b"}}'; sleep 3
  echo '{"id":3,"cmd":{"type":"shutdown"}}'; } | $ENGINE > ~/q4b-call.jsonl
```

Start the block 4 minutes before the call (the model loads during the `sleep 240`); press Ctrl-C
once when the call ends, then run `python3 engine/scripts/latency.py ~/q4b-call.jsonl` and send
back its lines.
