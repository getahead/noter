#!/usr/bin/env bash
# Builds noter-engine for release and signs it with its own entitlements and hardened runtime.
#   TEAM_ID=ABCDE12345 SIGN_IDENTITY="Developer ID Application: …" engine/scripts/sign.sh
# Without them it signs ad hoc with TEAMID left as is (local development only).
# Prints the path of the signed binary; `codesign -d --entitlements - <path>` shows what it got.
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
swift build -c release --package-path "$root" >&2
bin="$root/.build/release/noter-engine"
ents=$(mktemp -t noter-engine-entitlements)
sed "s/TEAMID/${TEAM_ID:-TEAMID}/" "$root/Resources/noter-engine.entitlements" > "$ents"
codesign --force --options runtime --timestamp=none --entitlements "$ents" --sign "${SIGN_IDENTITY:--}" "$bin" >&2
rm -f "$ents"
echo "$bin"
