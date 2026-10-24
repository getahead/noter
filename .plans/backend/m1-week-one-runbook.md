# M1 week one on the MacBook: kill drill, live capture checks, real-call latency

For the owner. Closes, on real hardware, what CI cannot run (it has no TCC prompts and no
speakers): the Q7 engine-kill drill (`cpt-noter-dod-core-engine-capture-restart`), the live half
of the capture pipeline (one clock, exclusions, device changes, the self-test clip:
`cpt-noter-dod-core-engine-capture-pipeline`), and the Q4 real-call latency measurement
(`cpt-noter-dod-core-engine-capture-latency`). Parts A and B take about 40 minutes and need
#139 and the one-clock capture PR on `main`. Part C needs live ASR (PR 4); its commands land with that PR.

Send back the table at the end. The backend team records the results in
`docs/features/core/core-engine-capture.md` and ticks what they prove.

## 0. Build (5 min, once)

From the repository root on a current `main`, in Terminal (the prompts then name Terminal; it
already has Microphone and System Audio Recording from the Q4 spike, so no prompt is expected):

```sh
export PATH=/opt/homebrew/bin:/usr/bin:$PATH
swift build -c release --package-path engine                      # engine/.build/release/noter-engine
cargo build --release -p noter-engine-client --example kill_drill # target/release/examples/kill_drill
ENGINE=$PWD/engine/.build/release/noter-engine
DRILL=$PWD/target/release/examples/kill_drill
```

A recorded call as two 16 kHz WAV files, for the replayed runs (any real call of a few minutes,
ideally the EN/RU/DE one; your side and the others' side, or the same file twice):

```sh
afconvert -f WAVE -d LEI16@16000 -c 1 my-side.m4a  /tmp/mic.wav
afconvert -f WAVE -d LEI16@16000 -c 1 their-side.m4a /tmp/sys.wav
```

## A. Q7 engine-kill drill (15 min)

The drill runs the real supervisor (`noter-engine-client`) against the real engine, kills the
engine with SIGKILL during the call, and prints every gap. It kills only its own child process.

**A1. Replayed call (file mode), three kills over two minutes:**

```sh
$DRILL $ENGINE 120 3 --mic /tmp/mic.wav --sys /tmp/sys.wav
```

**A2. Live capture of a call played through the speakers.** Start the recording playing
(`afplay their-side.m4a &` or the call app's own recording), talk now and then, and run:

```sh
$DRILL $ENGINE 120 3
```

**Pass (both):** the last line is `PASS: 3 engine_restart gap(s) for 3 kill(s), bound 2000 ms`;
each `kill N: capturing again after … ms` and each `supervisor gap EngineRestart … (N ms)` is at
most 2000; `timeline.json` lists the same three `engine_restart` gaps and `"parts":4`. (A debug
build came in at ~1.8 s in file mode on 24 Oct; use the release build.)

**A3. Restarts that cannot keep up end in `CaptureFailed`:** three kills within 30 s.

```sh
$DRILL $ENGINE 30 3 --mic /tmp/mic.wav --sys /tmp/sys.wav
```

**Expected:** `kill 3: session is Failed, not capturing` and a final `FAIL` line. That is the
designed outcome (3 restarts in 30 s → `CaptureFailed`, the app offers Try Again), not a defect.

## B. Live capture checks (20 min)

These talk to the engine over its JSON Lines protocol. Keep this helper in your shell; it starts a
session, waits, sends any extra command lines you pass half way, waits again, then stops and
shuts down (set `SHOW=levels` to keep the `levels` lines, hidden by default):

```sh
export NOTER_APP_GROUP_DIR=$(mktemp -d)
session() {  # session <seconds> <exclude_bundle_ids JSON> [command lines…]
  local secs=$1 excl=$2; shift 2
  { echo '{"id":1,"cmd":{"type":"start_session","call_id":"call_1","session_dir":"audio/call_1","store_audio":true,"mic_device_uid":null,"exclude_bundle_ids":'"$excl"',"languages":["en"],"backend":"whisper_turbo","glossary":[],"speaker_priors":[],"enrolled_embeddings_path":null,"resume_from_ms":null}}'
    sleep $((secs / 2)); for line in "$@"; do echo "$line"; done; sleep $((secs / 2))
    echo '{"id":8,"cmd":{"type":"stop","call_id":"call_1"}}'; sleep 3
    echo '{"id":9,"cmd":{"type":"shutdown"}}'; } | $ENGINE | grep -v "${SHOW:-\"levels\"}"
}
timeline() { cat "$NOTER_APP_GROUP_DIR"/audio/call_1/timeline.json; echo; }
```

**B1. One clock.** Play any audio, talk, run `session 60 '[]'`, then:

```sh
afinfo "$NOTER_APP_GROUP_DIR"/audio/call_1/mic.m4a | grep duration
afinfo "$NOTER_APP_GROUP_DIR"/audio/call_1/sys.m4a | grep duration
```

**Pass:** `session_started` names your microphone and output; the two durations differ by less
than 0.1 s (on two clocks they start apart and drift); both are ~60 s.

**B2. Which side is which.** Stop all audio and talk only: `SHOW=none session 10 '[]'`. **Pass:**
`mic_db` well above `sys_db` (-160 or close). Then play audio and stay silent: `sys_db` above
`mic_db`. If the two are swapped, say so: the aggregate device's buffer order is the one thing
the tests cannot check.

**B3. Excluded apps.** Play music in Music.app.
- `SHOW=none session 20 '["com.apple.Music"]'`: `sys_db` stays near -160 while Music plays.
- `SHOW=none session 20 '[]' '{"id":5,"cmd":{"type":"exclude_process","call_id":"call_1","bundle_id":"com.apple.Music"}}'`:
  an `ack` for id 5, and `sys_db` drops to near -160 after it.

**B4. Device change.** Run `session 40 '[]'` and, half way, plug in or unplug a microphone
(AirPods, a USB mic) or pick another input in Control Centre. **Pass:** a `device_changed` line
with the new device's name and `gap_from_ms`/`gap_to_ms` under ~1 s apart; `timeline` shows the
same gap (`"reason":"device_changed"`); capture goes on after it.

**B5. The engine never hears itself.** Play some audio, then:

```sh
mkdir -p "$NOTER_APP_GROUP_DIR/models/dummy-model"   # the self-test only checks a model folder exists
( echo '{"id":1,"cmd":{"type":"self_test","play_clip":true,"timeout_ms":10000}}'; sleep 12
  echo '{"id":2,"cmd":{"type":"shutdown"}}' ) | $ENGINE | grep self_test
```

You hear a one-second 1.5 kHz tone. **Pass:** `"passed":true,"own_sounds_leak":false`.

**B6. Stop time of a long call.** `session 1200 '[]'` (20 min, leave it running), then time from the
`ack` of id 8 to `session_stopped` (the `at` fields are epoch ms). **Pass:** under 2 s (longer
would make the supervisor's ping time out while the files are being finished).

## C. Q4 real-call latency, EN/RU/DE (with PR 4)

What it measures (`cpt-noter-dod-core-engine-capture-latency`): one real call that mixes English,
Russian and German, captured live through this pipeline on both channels with one WhisperKit
Turbo instance and per-utterance language ID. For every segment: **hypothesis lag** = when its
first hypothesis line arrived minus when its words ended (session start + `t1_ms`), and
**confirmed lag** = the same for its confirmed line.

**Pass:** p95 hypothesis lag ≤ 2 s and p95 confirmed lag ≤ 4 s, with segments in all three
languages. If not met, the backend team changes the streaming policy or adds Parakeet as a second
backend (PRD › Roadmap); the numbers decide which.

The exact commands (a `latency` report over the session's event lines, printing count and p50/p95
per kind and per language) arrive with PR 4; this section is updated then and the Teamlead tells
the owner.

## What to send back

| Step | Result | Numbers / anything odd |
| --- | --- | --- |
| A1 replay, 3 kills | PASS / FAIL | restart times, gap ms |
| A2 live, 3 kills | PASS / FAIL | restart times, gap ms |
| A3 3 kills in 30 s | Failed as expected? | |
| B1 one clock | mic vs sys duration | |
| B2 sides | mic_db / sys_db talking, then playing | |
| B3 exclusions | sys_db with Music excluded; after `exclude_process` | |
| B4 device change | `device_changed` line, gap ms | |
| B5 own clip | `passed` / `own_sounds_leak` | |
| B6 stop time | seconds | |
| C latency (later) | p95 hypothesis / confirmed per language | |

Paste the final lines of A1–A3 and the `device_changed` line as they are.
