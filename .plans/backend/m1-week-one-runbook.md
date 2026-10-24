# M1 week one on the MacBook: kill drill, live capture checks, real-call latency

For the owner. Closes, on real hardware, what CI cannot run (it has no TCC prompts and no
speakers): the Q7 engine-kill drill (`cpt-noter-dod-core-engine-capture-restart`), the live half
of the capture pipeline (one clock, exclusions, device changes, the self-test clip:
`cpt-noter-dod-core-engine-capture-pipeline`), and the Q4 real-call latency measurement
(`cpt-noter-dod-core-engine-capture-latency`). Parts A and B take about an hour and need
#139 and the one-clock capture PR on `main`; part C (one real call) needs the live ASR PR too.

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

## B. Live capture checks (35 min)

These talk to the engine over its JSON Lines protocol. Keep this helper in your shell; it starts a
session, waits, sends any extra command lines you pass half way, waits again, then stops and
shuts down (set `SHOW=levels` to keep the `levels` lines, hidden by default, and `LANGS` for the
session languages, English by default):

```sh
export NOTER_APP_GROUP_DIR=$(mktemp -d)
session() {  # session <seconds> <exclude_bundle_ids JSON> [command lines…]
  local secs=$1 excl=$2; shift 2
  { echo '{"id":1,"cmd":{"type":"start_session","call_id":"call_1","session_dir":"audio/call_1","store_audio":true,"mic_device_uid":null,"exclude_bundle_ids":'"$excl"',"languages":'"${LANGS:-[\"en\"]}"',"backend":"whisper_turbo","glossary":[],"speaker_priors":[],"enrolled_embeddings_path":null,"resume_from_ms":null}}'
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

**B7. Call detection** (facts only; the app decides what to show). Run this, and while it runs
start a FaceTime or Zoom test call (or a Google Meet in Chrome) with the microphone on, wait
10 s, hang up:

```sh
( echo '{"id":1,"cmd":{"type":"set_detection","enabled":true,"known_bundle_ids":["us.zoom.xos","com.apple.FaceTime","com.google.Chrome","com.microsoft.teams2"]}}'
  sleep 90; echo '{"id":2,"cmd":{"type":"shutdown"}}' ) | $ENGINE | grep -E 'call_detected|call_audio_released'
```

**Pass:** `call_detected` with the app's bundle id, name and pid about a second after the call
audio starts, and `call_audio_released` about a second after hanging up. A Meet in **Safari** is
not detected yet (Safari plays from WebKit processes without its bundle id): say whether you use
Safari for calls. Then, a second sound source: `session 30 '[]'` and start Music half way: one
`audio_source_added` line for `com.apple.Music`.

**B8. Silent system audio** (the permission is off). In System Settings › Privacy & Security ›
System Audio Recording, turn **Terminal off**; join a FaceTime/Zoom test call so its audio plays;
then (the detection list goes in half way):

```sh
session 40 '[]' '{"id":5,"cmd":{"type":"set_detection","enabled":false,"known_bundle_ids":["us.zoom.xos","com.apple.FaceTime","com.google.Chrome"]}}'
```

**Pass:** `system_audio_silent` lines with `since_ms` near 0 and `confidence` 0.6, 0.8, then 0.95
(at 30 s of zeros). Turn Terminal back **on** and run it again with the call playing: no
`system_audio_silent` line.

**B9. Replay.** After B1 (the call's audio is stored), keep a copy and play a span of it:

```sh
cp -R "$NOTER_APP_GROUP_DIR/audio/call_1" "$NOTER_APP_GROUP_DIR/audio/old"
( echo '{"id":1,"cmd":{"type":"play","call_id":"old","from_ms":5000,"to_ms":15000,"channel":null}}'; sleep 12
  echo '{"id":2,"cmd":{"type":"shutdown"}}' ) | $ENGINE | grep -E 'playback_position|error'
```

**Pass:** you hear seconds 5 to 15 of that recording; `playback_position` lines about every 250 ms
rising from 5000 to 15000, the last one `"playing":false`. With `"call_id":"none"` instead: an
`error` for the command. Then the replay must never enter a recording: with nothing else playing
and staying silent, run
`SHOW=levels session 30 '[]' '{"id":5,"cmd":{"type":"play","call_id":"old","from_ms":0,"to_ms":null,"channel":null}}'`.
**Pass:** you hear the replay, and `sys_db` stays near -160 throughout.

## C. Q4 real-call latency, EN/RU/DE (one real call, 30-60 min)

What it measures (`cpt-noter-dod-core-engine-capture-latency`): one real call that mixes English,
Russian and German, captured live through this pipeline on both channels with one WhisperKit
Turbo instance and per-utterance language ID. For every segment line: **lag** = when the line
arrived minus when its words ended (session start + `t1_ms`), for hypotheses and for confirmed
segments.

**Pass:** p95 hypothesis lag ≤ 2 s and p95 confirmed lag ≤ 4 s, with segments in all three
languages. If not met, the backend team changes the streaming policy or adds Parakeet as a second
backend (PRD › Roadmap); the numbers decide which.

**C1. The model, once** (about 1.6 GB, from the pinned manifest, every file checked):

```sh
python3 - "$NOTER_APP_GROUP_DIR/models/whisper-turbo" <<'EOF'
import hashlib, json, pathlib, sys, urllib.request
out = pathlib.Path(sys.argv[1])
for f in json.load(open("scripts/models/manifest.json"))["files"]:
    if f["bundle"] != "whisper-turbo":
        continue
    dest = out / f["path"]
    dest.parent.mkdir(parents=True, exist_ok=True)
    if not dest.exists():
        urllib.request.urlretrieve(f["url"], dest)
    assert hashlib.sha256(dest.read_bytes()).hexdigest() == f["sha256"], f["path"]
print("model ready:", out)
EOF
```

**C2. The call.** Start this as the call starts (set the seconds to the call's length plus a
minute), then hold the call as usual, switching languages as you naturally would:

```sh
LANGS='["en","ru","de"]' session 3600 '[]' > /tmp/q4-call.jsonl
python3 engine/scripts/latency.py /tmp/q4-call.jsonl
```

The first lines after `session_started` come once the model has loaded (taps first, then the
model): a few seconds of the call's start are transcribed late, which is expected; say how long
the load took (the first `segment` line's `at` minus `session_started`'s).

**Send back:** the report's lines (count, p50 and p95 per state and language, the two PASS/FAIL
lines), and a few confirmed segments per language as they are, for a look at the quality.

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
| B7 detection | `call_detected` / `call_audio_released` lines, `audio_source_added`; Safari used? | |
| B8 silent system audio | `system_audio_silent` lines (since, confidence); none with the permission on | |
| B9 replay | positions 5000→15000, error for an unknown call, `sys_db` during a replay | |
| C latency | p95 hypothesis / confirmed per language, model load time | |

Paste the final lines of A1–A3 and the `device_changed` line as they are.
