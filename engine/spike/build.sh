#!/usr/bin/env bash
# Builds the spike: build/SpikeHost.app (sandboxed stand-in app with the sandboxed spike CLI
# inside, both ad hoc signed unless SIGN_IDENTITY is set) and build/noter-spike (the same CLI,
# unsigned and unsandboxed, for the latency run, which downloads the model).
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
cd "$here"
swift build -c release
bin=$(swift build -c release --show-bin-path)
rm -rf build && mkdir -p build/SpikeHost.app/Contents/MacOS
cp Resources/SpikeHost-Info.plist build/SpikeHost.app/Contents/Info.plist
cp "$bin/SpikeHost" build/SpikeHost.app/Contents/MacOS/SpikeHost
cp "$bin/noter-spike" build/SpikeHost.app/Contents/MacOS/noter-spike
cp "$bin/noter-spike" build/noter-spike
# WhisperKit's resources ship as a bundle next to the binary.
for b in "$bin"/*.bundle; do [ -e "$b" ] && cp -R "$b" build/ && cp -R "$b" build/SpikeHost.app/Contents/MacOS/; done
id="${SIGN_IDENTITY:--}"
codesign --force --options runtime --timestamp=none --entitlements Resources/helper.entitlements --sign "$id" build/SpikeHost.app/Contents/MacOS/noter-spike
codesign --force --options runtime --timestamp=none --entitlements Resources/host.entitlements --sign "$id" build/SpikeHost.app
codesign --force --timestamp=none --sign "$id" build/noter-spike
echo "built: $here/build/SpikeHost.app and $here/build/noter-spike"
