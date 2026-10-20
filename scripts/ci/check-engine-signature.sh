#!/usr/bin/env bash
# Checks the BUILT engine binary, not the source file `just arch` reads
# (cpt-noter-constraint-core-engine-offline, engine-foundation AC "codesign of the built engine"):
# signed with the hardened runtime, App Sandbox and audio input on, and no network entitlement.
#   scripts/ci/check-engine-signature.sh [path-to-signed-noter-engine]
# Without an argument it builds and signs the engine ad hoc with engine/scripts/sign.sh.
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
bin=${1:-$("$root/engine/scripts/sign.sh")}

flags=$(codesign -dv "$bin" 2>&1 | grep -E '^CodeDirectory' || true)
codesign -d --entitlements - --xml "$bin" 2>/dev/null | python3 -c '
import plistlib, sys
raw = sys.stdin.buffer.read()
if not raw.strip():
    sys.exit("FAIL: the engine has no entitlements (unsigned?)")
ents = plistlib.loads(raw)
bad = [f"{k} is not true in the built engine" for k in
       ("com.apple.security.app-sandbox", "com.apple.security.device.audio-input") if ents.get(k) is not True]
bad += [f"the built engine carries {k}" for k in
        ("com.apple.security.network.client", "com.apple.security.network.server", "com.apple.security.inherit") if k in ents]
if bad:
    sys.exit("FAIL: " + "; ".join(bad))
'
echo "$flags" | grep -q 'runtime' || { echo "FAIL: hardened runtime flag is missing ($flags)" >&2; exit 1; }
echo "engine signature ok: $bin (app-sandbox, audio-input, hardened runtime, no network or inherit entitlement)"
