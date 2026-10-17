#!/usr/bin/env python3
"""Config guard: a pull request may not loosen the quality gates unnoticed (docs/ADR/0003).

Compares harness/harness.toml, milestones.toml and perf.toml with the base
branch. Loosening means: a minimum lowered, a maximum raised, fewer wall-clock
runs, a coverage exclusion added, the milestone order or the current milestone
changed backwards, a command, story or perf entry moved to a later milestone
or removed, a frozen IPC command turned back to draft, the trace-coverage gate
removed, its ratchet turned off or its ID kinds narrowed. Any change to the
harness itself (gate scripts, CI, hooks, justfile, test configs) counts too,
because those files decide what the gates measure.

Loosening fails unless the PR carries the `harness-change-approved` label
(PR_LABELS env, comma separated). With --lane-check, the changed files are
also checked against the lane of the PR branch (lane/<lane>/<topic>).
The guard fails closed: a missing base ref is an error, not "nothing changed".
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys

from common import ROOT, write_summary

try:
    import tomllib as _toml
except ModuleNotFoundError:  # pragma: no cover
    import tomli as _toml  # type: ignore[no-redef]

APPROVAL_LABEL = "harness-change-approved"
FILES = ("harness/harness.toml", "harness/milestones.toml", "harness/perf.toml")
# Gate keys where a bigger number is stricter (everything else numeric: smaller is stricter).
BIGGER_IS_STRICTER = ("min", "wall_runs", "wall_warmups")
SMALLER_IS_STRICTER = ("max_regression_pct", "pixel_color_threshold")


def verify_ref(ref: str) -> None:
    if subprocess.run(["git", "rev-parse", "--verify", "--quiet", f"{ref}^{{commit}}"], cwd=ROOT, capture_output=True).returncode != 0:
        raise SystemExit(f"GATE FAILED: base ref {ref!r} not found (fetch it: git fetch origin main)")


def exists_at(ref: str, path: str) -> bool:
    return subprocess.run(["git", "cat-file", "-e", f"{ref}:{path}"], cwd=ROOT, capture_output=True).returncode == 0


def read_at(ref: str | None, path: str) -> dict:
    """The TOML at `ref` ({} only when the file does not exist there)."""
    if ref is None:
        with open(ROOT / path, "rb") as f:
            return _toml.load(f)
    if not exists_at(ref, path):
        return {}
    out = subprocess.run(["git", "show", f"{ref}:{path}"], cwd=ROOT, capture_output=True, text=True, check=True)
    return _toml.loads(out.stdout)


def frozen_turned_draft(ref: str) -> list[str]:
    path = "contracts/ipc.manifest.json"
    if not exists_at(ref, path):
        return []
    import json

    old = json.loads(subprocess.run(["git", "show", f"{ref}:{path}"], cwd=ROOT, capture_output=True, text=True, check=True).stdout)
    new = json.loads((ROOT / path).read_text(encoding="utf-8"))
    was = {c["name"] for c in old["commands"] if c["stability"] == "frozen"}
    now = {c["name"]: c["stability"] for c in new["commands"]}
    return [f"IPC command {n} is no longer frozen" for n in sorted(was) if now.get(n, "frozen") != "frozen"]


def changed_files(ref: str) -> list[str]:
    out = subprocess.run(["git", "diff", "--name-only", f"{ref}...HEAD"], cwd=ROOT, capture_output=True, text=True, check=True)
    return [p for p in out.stdout.splitlines() if p]


def harness_changes(files: list[str], cfg: dict) -> list[str]:
    from common import matches_any

    return [f"harness file changed: {p}" for p in files if matches_any(p, cfg["guard"]["harness"])]


def loosened(base: dict[str, dict], head: dict[str, dict]) -> list[str]:
    found: list[str] = []
    bh, hh = base.get("harness/harness.toml", {}), head.get("harness/harness.toml", {})
    if not bh:
        return found  # the harness is new on this branch: nothing to loosen
    for gate, values in bh.get("gates", {}).items():
        for key, old in values.items():
            new = hh.get("gates", {}).get(gate, {}).get(key)
            if isinstance(old, bool) or not isinstance(old, (int, float)):
                continue  # flags and lists are checked per gate below
            if new is None:
                found.append(f"gates.{gate}.{key} removed")
            elif key in SMALLER_IS_STRICTER and new > old:
                found.append(f"gates.{gate}.{key} raised {old} → {new}")
            elif any(k in key for k in BIGGER_IS_STRICTER) and key not in SMALLER_IS_STRICTER and new < old:
                found.append(f"gates.{gate}.{key} lowered {old} → {new}")
    found += _trace_loosened(bh.get("gates", {}).get("trace"), hh.get("gates", {}).get("trace"))
    old_ex = {e["path"] for e in bh.get("coverage", {}).get("exclude", [])}
    for e in hh.get("coverage", {}).get("exclude", []):
        if e["path"] not in old_ex:
            found.append(f"coverage exclusion added: {e['path']} ({e.get('why', 'no reason given')})")
    order = hh.get("milestone", {}).get("order", [])
    if bh.get("milestone", {}).get("order") not in (None, order):
        found.append(f"milestone order changed {bh['milestone']['order']} → {order}")
    idx = {m: i for i, m in enumerate(order)}
    old_cur, new_cur = bh.get("milestone", {}).get("current"), hh.get("milestone", {}).get("current")
    if old_cur in idx and new_cur in idx and idx[new_cur] < idx[old_cur]:
        found.append(f"milestone moved back {old_cur} → {new_cur}")

    def placement(doc: dict) -> dict[str, str]:
        return {item: ms for ms, body in doc.items() if isinstance(body, dict) for k in ("commands", "stories") for item in body.get(k, [])}

    old_p, new_p = placement(base.get("harness/milestones.toml", {})), placement(head.get("harness/milestones.toml", {}))
    for item, ms in old_p.items():
        nm = new_p.get(item)
        if nm is None:
            found.append(f"{item} removed from milestones.toml")
        elif nm in idx and ms in idx and idx[nm] > idx[ms]:
            found.append(f"{item} moved later {ms} → {nm}")
    old_r = {r["id"]: r for r in base.get("harness/perf.toml", {}).get("registry", [])}
    new_r = {r["id"]: r for r in head.get("harness/perf.toml", {}).get("registry", [])}
    for rid, r in old_r.items():
        n = new_r.get(rid)
        if n is None:
            found.append(f"perf registry entry {rid} removed")
        elif idx.get(n["milestone"], 0) > idx.get(r["milestone"], 0):
            found.append(f"perf registry entry {rid} moved later {r['milestone']} → {n['milestone']}")
    return found


def _trace_loosened(old: dict | None, new: dict | None) -> list[str]:
    """The trace-coverage ratchet: removing it, turning it off or tracing fewer ID kinds."""
    if old is None:
        return []
    if new is None:
        return ["gates.trace removed (trace-coverage gate)"]
    found = []
    if old.get("ratchet", False) and not new.get("ratchet", False):
        found.append("gates.trace.ratchet turned off")
    dropped = sorted(set(old.get("kinds", [])) - set(new.get("kinds", [])))
    if dropped:
        found.append(f"gates.trace.kinds narrowed: {', '.join(dropped)} no longer traced")
    return found


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--base", default=os.environ.get("NOTER_BASE_REF", "origin/main"))
    ap.add_argument("--lane-check", action="store_true", help="also check changed files against the PR branch's lane")
    args = ap.parse_args(argv)
    verify_ref(args.base)
    base = {f: read_at(args.base, f) for f in FILES}
    head = {f: read_at(None, f) for f in FILES}
    found = loosened(base, head) + frozen_turned_draft(args.base)
    files = changed_files(args.base)
    if base["harness/harness.toml"]:  # the PR that introduces the harness is reviewed as a whole
        found += harness_changes(files, head["harness/harness.toml"])
    if args.lane_check:
        lane_problems = lane_check(files, head["harness/harness.toml"])
        if lane_problems:
            write_summary("### Lane check ❌\n\n" + "\n".join(f"- {x}" for x in lane_problems) + "\n")
            print("GATE FAILED: files outside the PR branch's lane", file=sys.stderr)
            return 1
    labels = {x.strip() for x in os.environ.get("PR_LABELS", "").split(",") if x.strip()}
    if not found:
        write_summary("### Gate config ✅\n\nNo gate was loosened.\n")
        return 0
    approved = APPROVAL_LABEL in labels
    body = "\n".join(f"- {x}" for x in found)
    write_summary(f"### Gate config {'⚠️ approved' if approved else '❌'}\n\nThis PR loosens the gates:\n\n{body}\n")
    if approved:
        return 0
    print(f"GATE FAILED: gates loosened without the '{APPROVAL_LABEL}' label", file=sys.stderr)
    return 1


def lane_check(files: list[str], cfg: dict) -> list[str]:
    """Lane rules for the PR branch (GITHUB_HEAD_REF in CI, else the current branch)."""
    import lane_guard

    branch = os.environ.get("GITHUB_HEAD_REF") or subprocess.run(
        ["git", "rev-parse", "--abbrev-ref", "HEAD"], cwd=ROOT, capture_output=True, text=True).stdout.strip()
    parts = branch.split("/")
    lane = os.environ.get("NOTER_LANE") or (parts[1] if len(parts) >= 3 and parts[0] == "lane" else None)
    if lane is None:
        return []
    return [r for p in files if (r := lane_guard.verdict(p, lane, cfg, committing=True))]


if __name__ == "__main__":
    raise SystemExit(main())
