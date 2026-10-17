#!/usr/bin/env bash
# Noter developer setup (docs/DEVELOPMENT.md). Idempotent: installs what is missing,
# then verifies every tool the gates use and prints its version.
#
#   scripts/dev/setup.sh           install what is missing, then verify   (just setup)
#   scripts/dev/setup.sh --check   verify only, change nothing             (just doctor)
#
# Exits non-zero when something `just gate` needs on this machine is missing.
# Optional tools (Docker, Xcode before the native suite exists, valgrind, linters)
# are reported as notes.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

mode=install
[ "${1:-}" = "--check" ] && mode=check
os=$(uname -s)
missing=0

ok()   { printf '  ok       %-15s %s\n' "$1" "$2"; }
note() { printf '  note     %-15s %s\n' "$1" "$2"; }
bad()  { printf '  MISSING  %-15s %s\n' "$1" "$2"; missing=1; }
has()  { command -v "$1" >/dev/null 2>&1; }
installing() { [ "$mode" = install ]; }
brew_install() { has brew && HOMEBREW_NO_AUTO_UPDATE=1 brew install "$@"; }
# version_ge 3.12.1 3.11 -> true
version_ge() { [ "$(printf '%s\n%s\n' "$2" "$1" | sort -V | head -1)" = "$2" ]; }

echo "Noter setup ($mode) on $os $(uname -m)"

# -- git hooks: the lane guard and Rust formatting on every commit (all worktrees share this setting)
if installing; then git config core.hooksPath .githooks; fi
if [ "$(git config core.hooksPath || true)" = ".githooks" ]; then ok "git hooks" "core.hooksPath=.githooks"
else bad "git hooks" "run: git config core.hooksPath .githooks"; fi

# -- Python 3.11+ (tomllib) for the gate scripts and Constructor Studio
py=$(python3 -c 'import sys; print("%d.%d.%d" % sys.version_info[:3])' 2>/dev/null || echo 0)
if version_ge "$py" 3.11; then ok "python3" "$py ($(command -v python3))"
else bad "python3" "$py at $(command -v python3 || echo none); need 3.11+ first on PATH (brew install python@3.12)"; fi

# -- just
if has just; then ok "just" "$(just --version | awk '{print $2}')"; else bad "just" "brew install just"; fi

# -- Rust: the toolchain and components pinned in rust-toolchain.toml
want_rust=$(sed -n 's/^channel *= *"\(.*\)"/\1/p' rust-toolchain.toml)
if has rustup; then
  if installing; then rustup toolchain install >/dev/null 2>&1 || rustup show active-toolchain >/dev/null; fi
  have_rust=$(rustc --version 2>/dev/null | awk '{print $2}')
  if [ "$have_rust" = "$want_rust" ]; then ok "rust" "$have_rust (rust-toolchain.toml)"; else bad "rust" "have ${have_rust:-none}, want $want_rust: rustup toolchain install"; fi
  comps=$(rustup component list --installed 2>/dev/null || true)
  for c in rustfmt clippy llvm-tools; do
    if grep -q "^$c" <<<"$comps"; then ok "  $c" "installed"; else bad "  $c" "rustup component add ${c/llvm-tools/llvm-tools-preview}"; fi
  done
else
  bad "rustup" "install from https://rustup.rs (Homebrew's rust cannot follow rust-toolchain.toml)"
fi

# -- cargo-llvm-cov for `just cov-unit`
if ! has cargo-llvm-cov && installing; then
  if [ "$os" = Darwin ] && has brew; then brew_install cargo-llvm-cov; else cargo install cargo-llvm-cov --locked; fi
fi
if has cargo-llvm-cov; then ok "cargo-llvm-cov" "$(cargo llvm-cov --version | awk '{print $2}')"; else bad "cargo-llvm-cov" "brew install cargo-llvm-cov (or cargo install cargo-llvm-cov --locked)"; fi

# -- Node 22+ and pnpm (version pinned by packageManager in package.json)
node_v=$(node --version 2>/dev/null | tr -d v || echo 0)
if version_ge "$node_v" 22; then ok "node" "$node_v"; else bad "node" "have ${node_v}, need 22+ (brew install node)"; fi
want_pnpm=$(sed -n 's/.*"packageManager": *"pnpm@\([^"]*\)".*/\1/p' package.json)
if ! has pnpm && installing && has corepack; then corepack enable pnpm || true; fi
if has pnpm; then
  have_pnpm=$(pnpm --version)
  if [ "$have_pnpm" = "$want_pnpm" ]; then ok "pnpm" "$have_pnpm"; else note "pnpm" "$have_pnpm on PATH; pnpm switches to the pinned $want_pnpm by itself (packageManager)"; fi
  if installing; then pnpm install --frozen-lockfile; fi
  if [ -d apps/desktop/node_modules/@playwright/test ]; then ok "node_modules" "installed (pnpm install --frozen-lockfile)"; else bad "node_modules" "pnpm install --frozen-lockfile"; fi
else
  bad "pnpm" "brew install pnpm (or corepack enable pnpm)"
fi

# -- Playwright WebKit for the e2e project (the visual project renders in the pinned container)
if [ -d apps/desktop/node_modules/@playwright/test ]; then
  pw() { pnpm --dir apps/desktop exec playwright "$@"; }
  if installing; then pw install webkit; fi
  loc=$(pw install --dry-run webkit 2>/dev/null | sed -n 's/^ *Install location: *//p' | head -1)
  if [ -n "$loc" ] && [ -d "$loc" ]; then ok "webkit" "$(pw --version | awk '{print $2}') at $loc"
  else bad "webkit" "pnpm --dir apps/desktop exec playwright install webkit"; fi
fi

# -- Constructor Studio core for `just docs` (gitignored; a worktree may link the main checkout's)
if [ ! -f .cf-studio/.core/skills/studio/scripts/studio.py ] && installing; then scripts/ci/fetch-cf-studio.sh; fi
if [ -f .cf-studio/.core/skills/studio/scripts/studio.py ]; then ok "cf-studio" "$(sed -n 's/^version *= *"\(.*\)"/\1/p' .cf-studio/version.toml) core present"
else bad "cf-studio" "scripts/ci/fetch-cf-studio.sh"; fi

# -- Docker: `just visual` and `just visual-update` run in the pinned Playwright container
if has docker && docker info >/dev/null 2>&1; then ok "docker" "$(docker version --format '{{.Server.Version}}' 2>/dev/null) (daemon running)"
elif has docker; then note "docker" "CLI only, no daemon: start Docker Desktop (or colima start); until then 'just visual' skips and CI checks screenshots"
else note "docker" "not installed: 'just visual' skips locally and CI checks screenshots"; fi

# -- macOS: Xcode for `just native` (XCUITest), Swift for the engine
if [ "$os" = Darwin ]; then
  if xcodebuild -version >/dev/null 2>&1; then ok "xcode" "$(xcodebuild -version | head -1)"
  elif [ -d apps/desktop/tests/native/NoterNativeTests.xcodeproj ]; then bad "xcode" "install Xcode, then: sudo xcode-select -s /Applications/Xcode.app (Command Line Tools cannot run XCUITest)"
  else note "xcode" "only Command Line Tools ($(xcode-select -p 2>/dev/null)); 'just native' needs Xcode once apps/desktop/tests/native exists"; fi
  if has swift; then ok "swift" "$(swift --version 2>&1 | sed -n 's/.*Swift version \([0-9.]*\).*/\1/p' | head -1)"; else note "swift" "not found (xcode-select --install)"; fi
fi

# -- valgrind: instruction counts for `just perf` (Linux only)
if has valgrind; then ok "valgrind" "$(valgrind --version)"
elif [ "$os" = Darwin ]; then note "valgrind" "Linux only: 'just perf' reports wall time here; CI gates instruction counts"
else note "valgrind" "missing: 'just perf' reports wall time only (sudo apt-get install valgrind)"; fi

# -- workflow and shell linters (optional, used before pushing CI changes)
for t in actionlint shellcheck; do
  if ! has "$t" && installing && [ "$os" = Darwin ]; then brew_install "$t" || true; fi
  if has "$t"; then ok "$t" "$("$t" --version | grep -m1 -oE '[0-9]+\.[0-9]+\.[0-9]+')"; else note "$t" "optional (brew install $t)"; fi
done

if [ "$missing" -ne 0 ]; then
  echo "Setup incomplete: install what is marked MISSING ('just setup' installs most of it)." >&2
  exit 1
fi
echo "Ready: 'just gate-fast' while you work, 'just gate' before a PR (docs/DEVELOPMENT.md)."
