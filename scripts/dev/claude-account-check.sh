#!/bin/sh
# Sends Noter's own-account test request (the sign-in sheet's Check step) to the Claude Code
# installed on this Mac, in the environment a Finder-started app has, and prints `ok` or the
# failure code. Read-only: it never signs in or out and prints no identity; it spends one tiny
# request of the signed-in plan. Run it after a Claude Code update to see that the flags and the
# output schema Noter sends are still accepted (#1235).
#   scripts/dev/claude-account-check.sh [path-to-claude]
set -eu
cd "$(dirname "$0")/../.."
claude=${1:-/opt/homebrew/bin/claude}
cargo build -q -p noter-llm --example account_check
run=$(mktemp -d)
trap 'rm -rf "$run"' EXIT
env -i HOME="$HOME" USER="$USER" LOGNAME="$USER" PATH=/usr/bin:/bin:/usr/sbin:/sbin \
    TMPDIR="${TMPDIR:-/tmp}" target/debug/examples/account_check "$claude" "$run"
