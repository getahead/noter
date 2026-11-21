#!/usr/bin/env bash
# Builds noter-engine for release and signs it with its own entitlements and hardened runtime.
#   SIGN_IDENTITY="Developer ID Application: …" engine/scripts/sign.sh
# Without it, it signs ad hoc (how releases ship, ADR-0004).
# Prints the path of the signed binary; `codesign -d --entitlements - <path>` shows what it got.
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
swift build -c release --package-path "$root" >&2
bin="$root/.build/release/noter-engine"
codesign --force --options runtime --timestamp=none --entitlements "$root/Resources/noter-engine.entitlements" --sign "${SIGN_IDENTITY:--}" "$bin" >&2
echo "$bin"
