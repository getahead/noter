# Storage authorization spike for #998

Standalone test artifacts, **not a Noter patch or accepted D14/C18 policy change**. E1 stays unchanged: unsandboxed host; independently App-Sandboxed child; no network or inherit entitlement. Only public Foundation/AppKit/Security/POSIX APIs. No App Groups, model loaders, microphone use, Keychain or login-item APIs, installers, certificates, private APIs, external requests or dependencies.

**Do not open either test app or execute `run` in the normal user session.** Build, inspect and pure tests are safe local preparation. Runtime requires separate owner approval and an already disposable macOS GUI user/session or VM. The script's flag is an operator attestation, not proof of isolation. Changing HOME or CFFIXED_USER_HOME is not an isolation mechanism.

## Package

- `Sources/Host.swift`: tiny AppKit host. Selects only the generated workspace; mints a fresh bookmark before each child launch. Sends one bounded frame on stdin, never an environment token or stored authorization. Own child deadline 15 seconds; outer driver deadline 120 seconds.
- `Sources/Child.swift`: independently signed, nested `.app` main executable spawned directly by Foundation `Process`. Resolves/starts the scope before file observations, keeps it active until completion, then balances access. Reports observations; does not assert success itself.
- `Sources/Shared.swift`: versioned 4-byte big-endian length plus JSON bootstrap, maximum 64 KiB, bookmark maximum 32 KiB. Validates nonce/hash/port/root, strict framing/EOF. No code from production contracts was copied or edited.
- `spike.py`: build/sign/static-inspect driver, local synthetic fixture/loopback supervisor, conservative result evaluator and ownership-checked fixture cleanup.
- `Tests`: pure Swift parser tests and Python verdict/guard/cleanup/static-artifact tests. They never launch either app or call bookmark/GUI/sandbox consent APIs.
- `out/latest.json`: chosen unique build IDs, source and binary SHA256. `out/<build>/inspection.json`: verified effective entitlements and raw codesign details. No certificate is used.

## Build, inspect and pure tests (no probe execution)

Prerequisites: macOS, full Xcode with Swift 6, Python 3.9+ from the standard library. No network/dependency installation. Sources target macOS 14 and the build machine's architecture; runtime qualification should use a currently supported macOS GUI environment and record its exact build. Local preparation was checked on Apple Silicon with Xcode 27.1 / Swift 6.4. Build outputs, signatures and per-machine identity records are generated locally and are not committed.

From this directory:

```sh
python3 spike.py build
python3 spike.py inspect
python3 spike.py test
```

`build` compiles and ad-hoc signs **only** `out/build-<random>/StorageAuthHost.app` and its nested test child. Every build uses new `org.getahead.storageauthspike.host.<random>` and `.child.<random>` IDs; neither uses Noter's identities or global installation paths. Effective host entitlements must be exactly empty and child entitlements exactly `{com.apple.security.app-sandbox: true}`. Deep strict codesign verification is required. The runner refuses source/binary drift from the manifest.

These checks establish compilation, frame/evaluator behavior and signed-artifact configuration. **They do not establish sandbox activation, bookmark transfer, GUI behavior, denied file/network access or Noter inference/capture.** The standalone package is outside production/harness coverage; no repository `just gate` result is claimed and no native gate is launched in the normal session.

## Disposable runtime prerequisites — operator review before execution

Provide a disposable macOS GUI session/VM with no real accounts, recordings, models or Noter data. Creation of a user/VM is outside this package. No Developer ID, Apple login or enrollment is needed for the proposed test. Copy the package locally; inspect/build there if needed. If Gatekeeper or execution policy blocks it, record the error and stop: do not strip quarantine, alter security policy, reset TCC or silently switch launch routes.

Before execution, approve the standard folder chooser and any system access prompts for these **test** identities only. Record exact prompt text, requesting process and chosen response in `consent-notes.md` next to the run's results. No automated clicking is included. A prompt does not prove that access was granted, and absence of a prompt is not treated as success. The 15-second child deadline can produce an explicit failure if OS consent cannot be completed in time; no blind retry or sleep hides that result.

The driver checks for Noter/engine/xcodebuild/native runner activity and takes `/tmp/noter-issue-team-native.lock` nonblocking. It starts no Noter binaries. Other supervised native work must be settled before running. `NOTER_E2E_LOCK=/tmp/noter-issue-team-e2e.lock` remains the required setting if subsequent work invokes Noter E2E/visual tooling; this package invokes none.

## Runtime matrix — ONLY after disposable-session authorization

Each invocation creates a random owned run under the disposable user's `~/Library/Application Support/StorageAuthSpike/`. It prints the exact workspace path before opening any chooser. Choose **that workspace only**, not its parent, home, or any existing folder. The workspace contains a deterministic 4096-byte `models/probe.bin`, empty `audio/` and `engine-io/`, and `escape.bin` pointing at a sibling synthetic sentinel outside the grant. Permissions are 0700 directories and 0600 fixture files, all owned by the same disposable user. The child receives no open fixture descriptor.

The driver binds a temporary listener to `127.0.0.1` only and proves that the unsandboxed parent can connect. The child makes one bounded loopback connection attempt; ECONNREFUSED or timeout is **inconclusive/failure**, not a sandbox pass. No external DNS/HTTP/model URL is used.

```sh
# Plain path: no chooser, no bookmark; workspace access must be denied.
python3 spike.py run --disposable-session --disposable-home "$HOME" --case none

# Select exactly the printed workspace. Both fresh child launches must succeed
# inside it and be denied outside it and on loopback.
python3 spike.py run --disposable-session --disposable-home "$HOME" --case implicit --launches 2

# Select exactly the printed workspace. Strip implicit scope: access must fail.
python3 spike.py run --disposable-session --disposable-home "$HOME" --case stripped

# Corrupt bookmark: no chooser, no grant; access must fail.
python3 spike.py run --disposable-session --disposable-home "$HOME" --case corrupt

# Cancel the chooser: no child may start.
python3 spike.py run --disposable-session --disposable-home "$HOME" --case cancel
```

Each invocation exits nonzero on a failed/inconclusive expectation. Completed observations produce `result.json` with the verdict, failures, exact OS build and static signature snapshot; `host.stdout.jsonl` contains child observations and nonces. Startup/timeout/parser failures may stop before `result.json`: retain terminal output and the printed run's stdout/stderr rather than interpreting a missing verdict as success. Raw POSIX errno is retained. JSON never contains bookmark bytes or fixture content. Parent independently verifies the child-written nonce file and unchanged fixture/sentinel bytes. A candidate result is usable only when all controls pass; never publish a positive case alone.

Expected matrix:

| Case | Scoped workspace read/hash and write | Sibling read/write and symlink escape | Loopback connect |
|---|---|---|---|
| `implicit` (both spawns) | Success; hash matches; parent verifies write | Permission denied | Permission denied |
| `none`, `stripped`, `corrupt` | Permission denied | Permission denied | Permission denied |
| `cancel` | No child spawned | Not attempted | Not attempted |

Only EPERM/EACCES are accepted as observed authorization denials; ENOENT, ELOOP, connection refusal and timeout never count as one. A matching signed entitlement is configuration evidence; observed negative controls are still required. Third-party security software can also deny access, so retain raw logs/environment notes rather than asserting every denial came from App Sandbox alone.

## Cleanup and retained evidence

Save `result.json`, stdout/stderr, static inspection and manually written consent notes before cleanup. The driver prints the exact `run_dir`.

```sh
python3 spike.py cleanup --run-dir '/exact/disposable/home/Library/Application Support/StorageAuthSpike/<printed-random-id>'
```

Cleanup rejects home/unmarked/wrong-owner-namespace/symlink roots. It removes only that generated synthetic run. It does **not** remove `~/Library/Containers`, OS privacy records, Keychain items or any real app. Dispose of the throwaway environment using its normal operator procedure after collecting evidence; no TCC/security reset commands are supplied. Locally generated build outputs can be discarded with this package's directory after review, without touching a global app.

## Interpretation and next boundary

Passing this matrix would support public bookmark handoff for this exact host/child/build/layout. It would not prove old App Group access, long-lived model loading, capture, reboot persistence, ad-hoc update continuity or current release acceptance. Each build uses new identities; it does not simulate an update of a stable identity. Re-run after reboot with a fresh handoff for the reboot case; do not persist ephemeral tokens.

No existing-group access experiment is included, because it needs a separate exact-release consent plan. Do not point this spike at the real `TEAMID.ai.noter` container or the Noter database. Production D14/C18 remains unchanged; accepting a dedicated workspace still requires the proposed policy decision. E1 must remain unchanged in any follow-up. Keep #998 open until release/model/capture acceptance is actually demonstrated.

Public mechanism references: [Apple process-sharing bookmarks](https://developer.apple.com/documentation/security/accessing-files-from-the-macos-app-sandbox), [implicit-scope lifetime](https://developer.apple.com/documentation/foundation/nsurl/bookmarkcreationoptions/withoutimplicitsecurityscope), [Apple DTS file permission layers](https://developer.apple.com/forums/thread/678819).
