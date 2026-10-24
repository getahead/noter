# M1 week one on the MacBook: kill drill, live capture checks, real-call latency

For the owner. What is left for you, in order: **C** (one real EN/RU/DE call, about 45 min with
setup) → DoD `cpt-noter-dod-core-engine-capture-latency`; **G** (golden set) only if you keep it
in M1; **B** when convenient (§6 criteria of the live pipeline). **A is done** (24 Oct, below).
Each part is one copy-paste block; send back the lines it says.

## 0. Once per shell

```sh
cd ~/projects/noter && git switch -q main && git pull -q
export PATH=/opt/homebrew/bin:/usr/bin:$PATH NOTER_APP_GROUP_DIR=$HOME/noter-week-one
mkdir -p "$NOTER_APP_GROUP_DIR" && swift build -c release --package-path engine
ENGINE=$PWD/engine/.build/release/noter-engine
```

## A. Q7 engine-kill drill: done by the backend team, 24 Oct 2026

Release build on this MacBook, replayed call (file mode, no TCC prompt needed), command
`kill_drill $ENGINE 120 3 --mic mic.wav --sys sys.wav`:
- **A1 PASS:** 3 kills, capturing again after 115–119 ms, supervisor gaps 108/184/185 ms,
  `timeline.json` with three `engine_restart` gaps and `"parts":4`.
- **A3 as designed:** 3 kills in 30 s → `session is Failed` (`CaptureFailed`, Try Again in the app).
- The same drill runs on the real core in every `just gate` (`noter-core-harness` tests `q7_*`).

Optional, not needed for any DoD: **A2**, the same drill on live capture. Play a recording through
the speakers, talk now and then, and paste the last line:

```sh
cargo build -q --release -p noter-engine-client --example kill_drill
target/release/examples/kill_drill $ENGINE 120 3     # pass: "PASS: 3 engine_restart gap(s) …"
```

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

## C. Q4 real-call latency, EN/RU/DE (DoD `-latency`)

One real call mixing English, Russian and German, captured live on both channels with one
WhisperKit Turbo instance. **Pass:** p95 hypothesis lag ≤ 2 s and p95 confirmed lag ≤ 4 s, with
segments in all three languages; if not, the numbers decide between a new streaming policy and
Parakeet as a second backend (PRD › Roadmap).

**C1. The model, once** (about 1.6 GB from the pinned manifest, every file checked). After §0:

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

**C2. The call.** Paste this as the call starts, then talk as usual, switching languages as you
naturally would. It records up to an hour; when the call ends, press Ctrl-C once (the report
works on what was captured):

```sh
{ echo '{"id":1,"cmd":{"type":"start_session","call_id":"q4","session_dir":"audio/q4","store_audio":true,"mic_device_uid":null,"exclude_bundle_ids":[],"languages":["en","ru","de"],"backend":"whisper_turbo","glossary":[],"speaker_priors":[],"enrolled_embeddings_path":null,"resume_from_ms":null}}'
  sleep 3600; echo '{"id":2,"cmd":{"type":"stop","call_id":"q4"}}'; sleep 3
  echo '{"id":3,"cmd":{"type":"shutdown"}}'; } | $ENGINE > ~/q4-call.jsonl
```

Then the report:

```sh
python3 engine/scripts/latency.py ~/q4-call.jsonl
```

**Send back:** the report's lines (count, p50/p95 per state and language, the two PASS/FAIL lines)
and `~/q4-call.jsonl` (or a few confirmed segments per language). The first seconds come late
while the model loads (taps first, then the model): expected.

## G. Golden set (DoD `-asr`): first a decision

The `-asr` budget check is the `live-hypothesis-lag` / `live-confirmed-lag` scenarios over the
golden set, and your 24 Oct order puts "live-*-lag, golden-set perf" out of development. Say
either **"G out of M1"** (the DoD gets the same D-30 note as `-replay` and does not hold the box;
the C call still measures the budgets) or **"G in"**, then:

1. Put ten hand-corrected calls in `evals/golden/<name>/` as `mic.wav` and `sys.wav` (16 kHz mono:
   `afconvert -f WAVE -d LEI16@16000 -c 1 in.m4a mic.wav`) and commit them yourself
   (`evals/golden/**` is owner-only baseline data; agents never write it).
2. After §0 and C1, run and paste the output:

```sh
for d in evals/golden/*/; do n=$(basename "$d"); echo "== $n"
  { echo '{"id":1,"cmd":{"type":"start_session","call_id":"'$n'","session_dir":"audio/'$n'","store_audio":false,"mic_device_uid":null,"exclude_bundle_ids":[],"languages":["en","ru","de"],"backend":"whisper_turbo","glossary":[],"speaker_priors":[],"enrolled_embeddings_path":null,"resume_from_ms":null}}'
    sleep $(( $(afinfo "$d/mic.wav" | awk '/duration/{print int($3)}') + 10 )); echo '{"id":2,"cmd":{"type":"shutdown"}}'
  } | $ENGINE --mic "$d/mic.wav" --sys "$d/sys.wav" > "/tmp/golden-$n.jsonl"
  python3 engine/scripts/latency.py "/tmp/golden-$n.jsonl"; done
```

## What to send back

| Step | Result | Numbers / anything odd |
| --- | --- | --- |
| A2 live, 3 kills (optional) | PASS / FAIL | last line |
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
| G golden set | out of M1 / per-call report lines | |

Paste the `device_changed` line (B4) as it is.
