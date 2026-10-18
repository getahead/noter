#!/usr/bin/env python3
"""Claude Code Stop hook: the agent may not finish while the fast gate is red.

When the work differs from what last passed (uncommitted changes, or commits
not on origin/main), runs `just gate-fast`. On failure it exits 2,
which keeps the agent working and hands it the failing output. After three
blocked attempts in a row it lets the agent stop, so it can report the failure
to the owner instead of looping.

Once the fast gate is green, the self-review loop (review.py): while the
branch has an open PR without a passing self-review of its head, the agent
keeps working (push, /cf-sdlc-pr-review, fix, `just review-publish`). After
MAX_REVIEW_ROUNDS blocked attempts it may stop to report to the owner.

Codex has no hook: AGENTS.md tells it to do the same, and CI enforces the full
gate and the `review` status either way.
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

from common import ROOT
import review

MAX_BLOCKS = 3
MAX_REVIEW_ROUNDS = 5
TIMEOUT_S = 900
IGNORED_PREFIXES = (".plans/", "docs/", ".claude/", ".idea/")


def _git(*args: str) -> str:
    return subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True).stdout.strip()


def state_dir() -> Path:
    # `git rev-parse --git-path` also works in worktrees, where .git is a file.
    d = Path(_git("rev-parse", "--git-path", "noter-harness"))
    d = d if d.is_absolute() else ROOT / d
    d.mkdir(parents=True, exist_ok=True)
    return d


def changed_paths() -> list[str]:
    """Uncommitted changes plus files committed on this branch but not on origin/main."""
    out = _git("status", "--porcelain")
    paths = [line[3:].split(" -> ")[-1] for line in out.splitlines() if line.strip()]
    base = _git("merge-base", "origin/main", "HEAD")
    if base:
        paths += _git("diff", "--name-only", base, "HEAD").splitlines()
    return sorted({p for p in paths if p and not p.startswith(IGNORED_PREFIXES)})


def fingerprint() -> str:
    """Identity of the work as it is now: HEAD plus the uncommitted diff."""
    h = hashlib.sha256(_git("rev-parse", "HEAD").encode())
    h.update(subprocess.run(["git", "diff", "HEAD"], cwd=ROOT, capture_output=True).stdout)
    h.update(_git("status", "--porcelain", "--untracked-files=all").encode())
    return h.hexdigest()


def attempts(delta: int | None, name: str = "stop-attempts") -> int:
    f = state_dir() / name
    n = int(f.read_text() or 0) if f.exists() else 0
    n = 0 if delta is None else n + delta
    f.write_text(str(n))
    return n


def main() -> int:
    try:
        json.load(sys.stdin)
    except ValueError:
        pass
    green = state_dir() / "last-green"
    fp = fingerprint()
    if not changed_paths() or (green.exists() and green.read_text() == fp):
        attempts(None)
        return review_loop()
    if not shutil.which("just"):
        print("The fast gate needs `just` (brew install just). Run `just setup`.", file=sys.stderr)
        return 2
    try:
        env = dict(os.environ)
        if sys.platform == "darwin":
            # Terminals launched by Orca put the CommandLineTools `ld` (cannot read the Xcode SDK) and Python 3.9 first.
            # shortcut: Apple Silicon Homebrew only; add /usr/local/bin before /usr/bin if an Intel Mac joins.
            env["PATH"] = "/opt/homebrew/bin:/usr/bin:" + env.get("PATH", "")
        proc = subprocess.run(["just", "gate-fast"], cwd=ROOT, capture_output=True, text=True, timeout=TIMEOUT_S, env=env)
    except subprocess.TimeoutExpired:
        print(f"`just gate-fast` took longer than {TIMEOUT_S}s; run it yourself and fix what is slow.", file=sys.stderr)
        return 2
    if proc.returncode == 0:
        attempts(None)
        green.write_text(fp)
        return review_loop()
    n = attempts(1)
    tail = (proc.stdout + proc.stderr)[-6000:]
    if n > MAX_BLOCKS:
        attempts(None)
        print(f"Fast gate still failing after {MAX_BLOCKS} attempts; stopping so you can report it.", file=sys.stderr)
        return 0
    print(
        "The fast gate (`just gate-fast`) fails, so the work is not done. Fix the failures below "
        "(do not weaken tests or thresholds), then finish.\n\n" + tail,
        file=sys.stderr,
    )
    return 2


def review_loop() -> int:
    """Block while the branch's open PR has no passing self-review of its head."""
    message = review.stop_check()
    if message is None:
        attempts(None, "review-attempts")
        return 0
    n = attempts(1, "review-attempts")
    if n > MAX_REVIEW_ROUNDS:
        attempts(None, "review-attempts")
        print(f"Self-review still not passing after {MAX_REVIEW_ROUNDS} rounds; stopping so you can report it to the owner.",
              file=sys.stderr)
        return 0
    print(message, file=sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
