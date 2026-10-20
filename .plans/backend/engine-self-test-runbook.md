# Engine self-test on a real Mac: runbook for the owner

Closes the engine-foundation acceptance criterion (`docs/features/core/core-engine-foundation.md`, section 6):
*"The self-test passes on a Mac with both channels producing sound and fails with the right reason when one
channel is silent or only zeros arrive."* About 15 minutes.

It runs the engine's own self-test (`cpt-noter-flow-core-engine-foundation-self-test`) from a terminal, over
the engine's JSON Lines protocol. The first-run screen in the app is the same test behind a button; the app's
frontend is not wired to the Tauri host yet, so the engine run is the way to do it today. The engine used here
is the unsandboxed debug build (macOS names Terminal in the prompts); the sandbox question is already settled
(`DESIGN-core.md` Q4, `spike-q4-evidence.md`).

## 0. Build and prepare (3 min, once)

From the repository root, on a branch with the current `main`:

```sh
export PATH=/opt/homebrew/bin:/usr/bin:$PATH
swift build --package-path engine          # engine/.build/debug/noter-engine

# The self-test only checks that a model folder exists, not its contents.
export NOTER_APP_GROUP_DIR=$(mktemp -d)
mkdir -p "$NOTER_APP_GROUP_DIR/models/dummy-model"
```

Terminal needs **Microphone** and **System Audio Recording** permission (System Settings › Privacy &
Security; "System Audio Recording Only" section). The spike already granted both. If a prompt appears, allow it.

A helper that sends the command, waits, then shuts the engine down (keep it in your shell for the runs below):

```sh
selftest() {
  ( echo '{"cmd":{"type":"self_test","play_clip":false,"timeout_ms":10000},"id":1}'
    sleep 14
    echo '{"cmd":{"type":"shutdown"},"id":2}' ) | engine/.build/debug/noter-engine
}
```

## 1. Pass: both channels have sound (5 min)

Play audio you can hear (a YouTube video, any speech) **and** talk or tap the desk, then run `selftest`
and keep both going for the whole 10 seconds.

**Expected:** `self_test_stream` events for `mic` and `sys`, `self_test_line`/levels lines as they arrive, and
finally

```json
{"event":{"type":"self_test_result","passed":true,"failure":null, ...}}
```

## 2. Fail: system audio silent (3 min)

Pause all audio (nothing playing, no notification sounds), keep talking, run `selftest`.

**Expected:** `self_test_result` with `"passed":false` and `"failure":"zero_buffers"` (the system stream
delivered only exact zeros: the System Audio Recording case the first-run screen explains).

## 3. Fail: microphone silent (3 min)

Mute the microphone input (System Settings › Sound › Input: input volume to zero, or a hardware mute), play audio, run
`selftest`.

**Expected:** `"passed":false` with `"failure":"zero_buffers"` (or `"device_unavailable"` if the mic stream
never arrives). Restore the input volume afterwards.

## 4. Fail: no model folder (1 min)

```sh
rm -r "$NOTER_APP_GROUP_DIR/models/dummy-model"   # only the dummy folder created in step 0
selftest
```

**Expected:** `"passed":false`, `"failure":"model_missing"`. Recreate the folder with `mkdir` if you run
step 1 again.

## What to send back

| Run | Result: `passed` / `failure` | Anything odd |
| --- | --- | --- |
| 1 pass (sound on both) | | |
| 2 system silent | | |
| 3 mic silent | | |
| 4 no model folder | | |

Paste the final `self_test_result` line of each run. Then the owner (or the backend team) ticks the
acceptance criterion in `core-engine-foundation.md` and the engine-foundation box once the code-signing check
(`scripts/ci/check-engine-signature.sh`, in CI) is green on `main`.

## Not covered here

The first-run screen's own Run Test button and the system-audio re-check after returning from System Settings
(`inst-play-clip`, moved to M1). They need the app frontend wired to the Tauri host.
