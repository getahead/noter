# Spike Q4 evidence: why the sandboxed engine child traps

be-eng-2, 19 Oct 2026. Branch `lane/engine/spike`, commit `381a964` (pushed; no PR). Q4 is not decided here, and DESIGN-core and the FEATURE specs are not edited.

## Root cause

Crash report `~/Library/Logs/DiagnosticReports/noter-spike-2026-10-19-230210.ips` (bug type 309):

- `procPath`: `…/SpikeHost.app/Contents/MacOS/noter-spike`, code-signing id `ai.noter.spike.engine`
- exception `EXC_BREAKPOINT` / `SIGTRAP`, termination `Trace/BPT trap: 5` (that is the host's "child exited with 5")
- the triggered thread, top down:
  ```
  libsystem_secinit.dylib  _libsecinit_appsandbox.cold.9 + 84
  libsystem_secinit.dylib  _libsecinit_appsandbox + 2076
  libsystem_trace.dylib    _os_activity_initiate_impl + 64
  libsystem_secinit.dylib  _libsecinit_initializer + 196
  libSystem.B.dylib        libSystem_initializer + 280
  dyld                     … findAndRunAllInitializers …
  ```

So the child dies in libSystem's initializer, before `main()`, while it tries to enter an App Sandbox.

**Why.** A process that a sandboxed app spawns (`Process`, `posix_spawn`) already runs inside the parent's sandbox. When that child is signed with its *own* `com.apple.security.app-sandbox` entitlements and without `com.apple.security.inherit`, libsecinit refuses to set up a second sandbox and traps. Apple's rule for such a helper ("Enabling App Sandbox Inheritance"): it is signed with exactly two entitlements, `com.apple.security.app-sandbox` and `com.apple.security.inherit`, and nothing else. It then gets the parent's sandbox and entitlements. The spike's child was signed with `app-sandbox` and `device.audio-input`, which is what DESIGN-core asks of noter-engine ("its own entitlements"). That combination cannot work under a sandboxed parent.

**Audio, permissions and WhisperKit play no part.** Reproduced on this Mac (macOS 26.6.2, arm64) by running the host with no arguments, so the child would only print its usage:

| `Q4_VARIANT` | child signed with | host signed with | result (no-argument probe) |
|---|---|---|---|
| `own` (as before) | app-sandbox + audio-input | app-sandbox + audio-input | `child exited with 5` (trap) |
| `inherit` | app-sandbox + inherit | app-sandbox + audio-input | usage printed, `child exited with 2`: `main` reached |
| `unsandboxed-host` | app-sandbox + audio-input | audio-input only (hardened runtime, no sandbox) | usage, exit 2; macOS created the child's own container `~/Library/Containers/ai.noter.spike.engine`, so it runs in its own sandbox |

## The change on `lane/engine/spike` (381a964)

- `engine/spike/build.sh` takes `Q4_VARIANT=own|inherit|unsandboxed-host`. The default `own` is the old signing.
- `Resources/helper-inherit.entitlements`: `app-sandbox` + `inherit` only.
- `Resources/host-unsandboxed.entitlements`: `device.audio-input` only.
- `host.entitlements` already carries `device.audio-input`, which the inheriting child gets from the host.

## Owner commands (MacBook)

```sh
cd <repo> && git fetch origin && git checkout lane/engine/spike && git pull
cd engine/spike

# A: the child inherits SpikeHost's sandbox
Q4_VARIANT=inherit ./build.sh
open -W build/SpikeHost.app --args capture --seconds 20
cat ~/Library/Containers/ai.noter.spike.host/Data/tmp/spike.log

# B: SpikeHost unsandboxed, the child keeps its own sandbox and entitlements
tccutil reset Microphone ai.noter.spike.host; tccutil reset AudioCapture ai.noter.spike.host
Q4_VARIANT=unsandboxed-host ./build.sh
open -W build/SpikeHost.app --args capture --seconds 20
cat "$(getconf DARWIN_USER_TEMP_DIR)spike.log"
```

What to look for in each run:

- **No "child exited with 5".**
- **The Microphone and System Audio Recording prompts appear, attributed to "Noter Spike Host"**, the responsible app. Play a sound during the 20 s so the system channel hears something.
- **`SUMMARY sandboxed: true`** in the log.
- **Mic and sys turn non-zero**, close to the unsandboxed run (mic about 4.4 s, sys about 6.9 s).
- **If a run prints nothing but exits 0 or 1**, attach the log and `log show --last 5m --predicate 'process == "noter-spike"'`.

## What each outcome means for the real design

### A works (inherit)

- **Inherited sandbox:** noter-engine runs in Noter.app's sandbox with **Noter.app's entitlements, not its own**. DESIGN-core C18 ("the engine is signed separately … own entitlements") and the wording of `cpt-noter-dod-core-engine-foundation-offline` would change to "inherits the app's sandbox".
- **Network, stated plainly:** Noter.app has network access (model downloads, the updater, LLM runtimes through noter-llm), so **an inherited sandbox has network too**. The E1 offline guarantee, that the engine has no network entitlement, would then hold by code and review only, not by the OS. The arch/codesign check would have to change to "the engine carries exactly app-sandbox + inherit".
- **App Group:** works as is. The engine sees the app's container and App Group, because it is the app's sandbox.
- **Cost:** a one-line signing change in `engine/scripts/sign.sh` and no transport change; the stdio JSON Lines pipes keep working. Permission prompts and TCC grants are the app's.

### B works (unsandboxed app, sandboxed engine)

- **Design kept:** C18 and E1 stay as designed. The engine enters its own sandbox with its own entitlements (audio input, App Group, **no network**), and the stdio pipes still work.
- **Cost:** Noter.app itself is not App-Sandboxed (Developer ID with hardened runtime, notarised). That rules out the Mac App Store, which DESIGN does not target.
- **App Group:** needs the team identifier on both signatures; Q4 does not depend on it.
- **Change size:** the smallest change from the current design.

### Neither works (or the app must stay sandboxed and keep the engine's own entitlements)

- **XPC service** in `Contents/XPCServices/`, with its own bundle, Info.plist and entitlements (sandbox, audio input, no network), launched by launchd. It can't use stdio: the JSON Lines transport moves onto an XPC connection. That means noter-engine-client's `ProcessLauncher` and supervisor change (restart, liveness), plus a small Swift XPC listener. Roughly M–L in the engine lane.
- **LaunchServices helper app** (`Contents/Library/Helpers/noter-engine.app` launched with `NSWorkspace`/`open`), with its own bundle and entitlements. It also has no stdio pipes: the transport becomes a Unix socket in the App Group container, and the supervisor has to find, start and watch a process it did not spawn. Also M–L.

## Not done

- No real capture ran here: it needs the TCC prompts answered on the MacBook.
- Q4 is not decided, and DESIGN-core and the FEATURE specs are untouched.
- The latency run (step 2) is still owner work.

## Owner's results on the M5 MacBook (20 Oct 2026), and the decision

| Run | Result |
| --- | --- |
| Unsandboxed CLI (`build/noter-spike capture`) | mic first non-zero 4.4 s, system audio 6.9 s once Terminal had System Audio Recording permission and sound was playing. The first run had system audio all `-160 dB` (no permission or nothing playing) |
| Sandboxed host, child with its own sandbox (default build) | `child exited with 5`: SIGTRAP in `libsecinit` before `main`, no prompt |
| Variant A, `inherit` | child sandboxed, exit 0, mic 3.5 s, system audio 5.9 s; prompts name "SpikeHost" |
| Variant B, `unsandboxed-host` | child sandboxed (`sandboxed: true`), exit 0, system audio 2.5 s, mic 3.6 s; prompts name "SpikeHost" (after `tccutil reset`); no repeat prompt on later runs |

Prompt texts: "SpikeHost" would like access to record your system audio ("Spike: record system audio of a test call.") and "SpikeHost" would like to access the Microphone ("Spike: record your side of a test call.").

**Decision (owner, 20 Oct 2026): B.** Noter.app unsandboxed (Developer ID), engine sandboxed with its own entitlements. A is the fallback, kept for a possible Mac App Store release: notes in DESIGN-core, engine constraint. Not done in this spike: the three-language latency run (a 60 s attempt produced no speech: all passes empty).
