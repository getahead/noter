# Engine week-one spike: runbook for the owner

The spike answers two questions before engine capture (M1) starts
(`cpt-noter-flow-core-engine-foundation-spike`, DESIGN-core Q4 and Q7):

1. **Q4, sandbox:** when Noter.app spawns a sandboxed engine with its own entitlements, does the
   System Audio Recording prompt name the app, and do both channels deliver sound? If not, the
   engine ships unsandboxed and the CI network-monitor test becomes the offline guarantee (E1).
2. **Latency:** does one WhisperKit Turbo instance keep up with both channels of a real
   three-language call within the provisional budget (hypothesis ≤ 2 s, confirmed ≤ 4 s)? If
   not, the streaming policy changes or Parakeet joins as a second backend.

Both runs need you: the TCC prompts and a real call cannot be automated. About 30 minutes.

## 0. Build (5 min, once)

On this Mac (Xcode 27, macOS 26), from a checkout of the branch `lane/engine/spike`:

```sh
cd engine/spike
./build.sh          # ad hoc signed; SIGN_IDENTITY="Developer ID Application: …" ./build.sh for a real identity
```

You get `build/SpikeHost.app` (a sandboxed stand-in for Noter.app with the sandboxed spike CLI
inside, signed like `noter-engine`: App Sandbox + audio input, no network) and `build/noter-spike`
(the same CLI, unsandboxed, for the latency run).

## 1. Q4: prompt attribution and both channels (10 min)

1. Start audio you can hear (a YouTube video in the browser) and keep talking during the run.
2. Run the stand-in app, which spawns the CLI as its child, exactly as the app will spawn the engine:

   ```sh
   open -W build/SpikeHost.app --args capture --seconds 20
   cat ~/Library/Containers/ai.noter.spike.host/Data/tmp/spike.log
   ```

3. **Record** when the prompts appear:
   - the exact text of the System Audio Recording prompt and the microphone prompt, and which name each shows ("Noter Spike Host", "noter-spike" or something else). A screenshot is best;
   - what System Settings › Privacy & Security › *Screen & System Audio Recording* (system audio section) and › *Microphone* list afterwards.
4. Allow both, then run step 2 again and **record** the `SUMMARY` lines: `first non-zero` must be a time, not `never`, for both `mic` and `sys`, with `sandboxed: true`.
5. If a prompt never appears, or `sys` stays `never` after allowing: run the CLI directly, unsandboxed, to separate "the sandbox breaks it" from "the tap code is wrong":

   ```sh
   build/noter-spike capture --seconds 20
   ```

   Record the same lines (here the prompts name Terminal).

To start over: remove "Noter Spike Host" and "noter-spike" from both System Settings lists, or run
`tccutil reset Microphone ai.noter.spike.host`. If `tccutil` rejects a service name, use System Settings.

## 2. Latency on a real three-language call (15 min)

1. Join a real call where English, Russian and German are all spoken (about 10 minutes is enough), on headphones or speakers.
2. In Terminal, unsandboxed. The first run downloads the Turbo model (about 1.6 GB) from Hugging Face; Terminal gets the audio prompts:

   ```sh
   build/noter-spike latency --seconds 600
   ```

3. **Record** all `SUMMARY` lines: the hypothesis and confirmed p50 and p95 per channel, and the languages detected per pass. Also save the `HYP` and `CONF` lines (`… > latency.log`) and note any segment in the wrong language or script.

## 3. What to send back

Paste into `.plans/engine-spike-report.md`, or send to the Backend Teamlead:

| Item | Result |
| --- | --- |
| System Audio Recording prompt names | |
| Microphone prompt names | |
| Sandboxed child: first non-zero mic / sys | |
| Unsandboxed CLI (only if step 1.5 ran): first non-zero mic / sys | |
| Hypothesis lag p50 / p95 (mic, sys) | |
| Confirmed lag p50 / p95 (mic, sys) | |
| Languages per pass, and wrong-language segments | |
| Your decision: engine sandboxed (Q4) yes / no | |
| Your decision: streaming policy / Parakeet | |

be-eng-2 then records the decisions in DESIGN-core Q4 (with your sign-off) and in the FEATURE spec
(`inst-spike-return`); engine capture (M1) starts after that.

## Notes

- The spike is throwaway (`engine/spike`, not part of the engine build). It runs the engine's real
  `LiveAudioSource` (Core Audio process tap leaving out the engine and its parent, plus the microphone).
- The latency figure is the processing time per pass plus the 0.5 s pass interval for hypotheses, and the
  time from the end of a segment's audio to its confirmation for confirmed text. It is a first look,
  not the M1 latency gate.
