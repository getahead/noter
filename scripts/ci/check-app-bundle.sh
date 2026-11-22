#!/usr/bin/env bash
# Checks the BUILT app bundle (DESIGN-core › Signing and permissions, #1140): the merged
# Info.plist carries a usage string for every permission Noter asks for, the app has its
# entitlements and no App Group, and the embedded engine passes check-engine-signature.sh.
#   scripts/ci/check-app-bundle.sh path/to/Noter.app
set -euo pipefail
app=${1:?usage: check-app-bundle.sh path/to/Noter.app}
root=$(cd "$(dirname "$0")/../.." && pwd)
fail=0
for key in NSMicrophoneUsageDescription NSAudioCaptureUsageDescription \
           NSCalendarsFullAccessUsageDescription NSAppleEventsUsageDescription; do
  value=$(plutil -extract "$key" raw -o - "$app/Contents/Info.plist" 2>/dev/null || true)
  [ -n "$value" ] || { echo "FAIL: $app/Contents/Info.plist has no $key" >&2; fail=1; }
done
codesign -d --entitlements - --xml "$app" 2>/dev/null | python3 -c '
import plistlib, sys
raw = sys.stdin.buffer.read()
ents = plistlib.loads(raw) if raw.strip() else {}
need = ("com.apple.security.device.audio-input", "com.apple.security.personal-information.calendars",
        "com.apple.security.automation.apple-events")
bad = [f"the app lacks {k}" for k in need if ents.get(k) is not True]
bad += [f"the app carries {k}" for k in ("com.apple.security.application-groups",) if k in ents]
if bad:
    sys.exit("FAIL: " + "; ".join(bad))
' || fail=1
"$root/scripts/ci/check-engine-signature.sh" "$app/Contents/MacOS/noter-engine" || fail=1
[ "$fail" = 0 ] || exit 1
echo "app bundle ok: $app (usage strings, entitlements, no App Group, engine signature)"
