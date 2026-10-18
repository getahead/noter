#!/usr/bin/env python3
"""Lane guard: which files an agent (or a commit) may change (docs/HARNESS.md › Lanes).

    lane_guard.py hook          Claude Code PreToolUse hook: reads the tool call on stdin,
                                exit 2 blocks the edit and tells the agent why.
    lane_guard.py staged        git pre-commit: checks the staged files.
    lane_guard.py check FILE…   checks the given repo-relative paths.

The lane comes from NOTER_LANE, else from a branch named lane/<lane>/<topic>.
No lane means the owner: only generated files and baselines are protected.

Rules, in order:
1. generated files are never edited by hand (regenerate them); commits may carry them.
2. baselines (screenshots, golden data) change only through their workflows,
   unless NOTER_ALLOW_BASELINE=1 is set for that one command.
3. in a lane, the harness itself is off-limits (agents cannot move the goalposts).
4. in a lane, a path must match the lane's `paths` (or `common`) and not its `deny`.
"""

from __future__ import annotations

import json
import os
import re
import shlex
import subprocess
import sys
from pathlib import Path

from common import ROOT, HarnessError, harness_config, matches_any, rel

EDIT_TOOLS = {"Edit", "Write", "MultiEdit", "NotebookEdit"}
# Shell commands that write files. Heuristic: catches `sed -i`, redirects, cp/mv/rm,
# tee and checkouts aimed at a guarded path; the pre-commit hook and CI catch the rest.
WRITE_HINT = re.compile(r"(?:^|[\s;&|])(?:sed\s+-i|perl\s+-p?i|tee|cp|mv|rm|truncate|install|git\s+(?:checkout|restore|rm|mv))\b|>{1,2}")


def _paths_from_shell(command: str) -> list[str]:
    if not WRITE_HINT.search(command):
        return []
    try:
        tokens = shlex.split(command, posix=True)
    except ValueError:
        tokens = command.split()
    out = []
    for t in tokens:
        t = t.lstrip(">").strip("'\"")
        if "/" in t or "." in t:
            out.append(rel(t))
    return out


def current_lane() -> str | None:
    lane = os.environ.get("NOTER_LANE", "").strip()
    if lane:
        return lane
    try:
        branch = subprocess.run(["git", "rev-parse", "--abbrev-ref", "HEAD"], cwd=ROOT, capture_output=True, text=True).stdout.strip()
    except OSError:
        return None
    parts = branch.split("/")
    return parts[1] if len(parts) >= 3 and parts[0] == "lane" else None


def verdict(path: str, lane: str | None, cfg: dict, *, committing: bool = False, screenshots_ok: bool = False) -> str | None:
    """None if allowed, else the reason it is not."""
    guard = cfg["guard"]
    if matches_any(path, guard["generated"]) and not committing:
        return f"{path} is generated from crates/noter-protocol. Change the Rust types and run `just contract-regen`."
    # The CI lane check passes screenshots_ok: there, changed screenshots are gated by `visual-change-approved` instead.
    shot = screenshots_ok and matches_any(path, ["**/__screenshots__/**"])
    if matches_any(path, guard["baselines"]) and not shot and os.environ.get("NOTER_ALLOW_BASELINE") != "1":
        return (f"{path} is a test baseline. Screenshot baselines are refreshed by the `update-screenshots` "
                "workflow (PR label) or `just visual-update`; golden data changes need the owner.")
    if lane is None:
        return None
    lanes = cfg.get("lanes", {})
    if lane not in lanes:
        return f"unknown lane {lane!r}; lanes: {', '.join(sorted(lanes))}"
    if matches_any(path, guard["harness"]):
        return f"{path} belongs to the harness (gates, CI, hooks). Agents in a lane cannot change it; ask the owner."
    spec = lanes[lane]
    if matches_any(path, spec.get("deny", [])):
        return f"{path} is outside lane '{lane}' (denied). {spec.get('why', '')}".strip()
    if matches_any(path, spec.get("paths", [])) or matches_any(path, guard.get("common", [])):
        return None
    return f"{path} is outside lane '{lane}' ({spec.get('why', '')}). Allowed: {', '.join(spec.get('paths', []))}"


def _shell_verdict(path: str, lane: str | None, cfg: dict) -> str | None:
    """For shell commands only guarded paths are judged; lane scope is left to the pre-commit hook."""
    guard = cfg["guard"]
    protected = guard["generated"] + guard["baselines"] + (guard["harness"] if lane else [])
    return verdict(path, lane, cfg) if matches_any(path, protected) else None


def _paths_from_hook(payload: dict) -> list[str]:
    tool_input = payload.get("tool_input", {}) or {}
    paths = [tool_input.get(k) for k in ("file_path", "notebook_path", "path") if tool_input.get(k)]
    return [rel(p) for p in paths]


def main(argv: list[str] | None = None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    mode = argv[0] if argv else "check"
    try:
        cfg = harness_config()
    except HarnessError as e:
        # Fail closed and say why: a silent guard is worse than a blocked edit.
        print(f"lane guard cannot run: {e}", file=sys.stderr)
        return 2 if mode == "hook" else 1
    lane = current_lane()

    if mode == "hook":
        payload = json.load(sys.stdin)
        tool = payload.get("tool_name")
        if tool in EDIT_TOOLS:
            candidates = _paths_from_hook(payload)
        elif tool == "Bash":
            candidates = _paths_from_shell((payload.get("tool_input") or {}).get("command", ""))
        else:
            return 0
        for p in candidates:
            if p.startswith("/") or p.startswith(".."):
                continue  # outside the repository: not ours to judge
            reason = verdict(p, lane, cfg) if tool in EDIT_TOOLS else _shell_verdict(p, lane, cfg)
            if reason:
                print(f"Blocked by the Noter lane guard: {reason}", file=sys.stderr)
                return 2
        return 0

    if mode == "staged":
        out = subprocess.run(["git", "diff", "--cached", "--name-only", "--diff-filter=ACMRD"], cwd=ROOT, capture_output=True, text=True, check=True)
        paths = [p for p in out.stdout.splitlines() if p]
    else:
        paths = [rel(p) for p in argv[1:]]
    problems = [r for p in paths if (r := verdict(p, lane, cfg, committing=(mode == "staged")))]
    for r in problems:
        print(f"lane guard: {r}", file=sys.stderr)
    return 1 if problems else 0


if __name__ == "__main__":
    raise SystemExit(main())
