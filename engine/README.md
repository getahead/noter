# noter-engine

The Swift sidecar that captures audio and runs on-device speech. It speaks the JSON Lines
protocol of `contracts/engine.schema.json` (source: `crates/noter-protocol/src/engine.rs`) on
stdin and stdout; the Rust supervisor is `crates/noter-engine-client`. Spec:
`docs/features/core/core-engine-foundation.md`.

| Command | What |
| --- | --- |
| `swift test --package-path engine` | Tests (CI runs them on the macOS runner): protocol, self-test, WAV, file mode |
| `swift build --package-path engine` | Debug build, unsigned and unsandboxed: `engine/.build/debug/noter-engine` |
| `engine/scripts/sign.sh` | Release build signed with its own entitlements (`TEAM_ID`, `SIGN_IDENTITY`; ad hoc without) |
| `noter-engine --mic mic.wav --sys sys.wav [--fast]` | File mode: replays a recording through the same protocol |

M0 answers `ping`, `shutdown`, `set_detection` (acknowledged; detection listeners come with
capture in M1) and `self_test`; other commands are refused with `bad_command`. The engine is
offline by code discipline (ADR-0004): it runs without App Sandbox, `Resources/noter-engine.entitlements`
grants audio input only, WhisperKit is always created with `download: false`, and `just arch`
fails on any network entitlement under `engine/`. The core passes its data folder
(`~/Library/Application Support/Noter`) as `NOTER_DATA_DIR`; models, audio and `engine-io/` live there.
