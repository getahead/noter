#!/usr/bin/env python3
"""Unit-coverage gate (docs/ADR/0003).

Reads LCOV reports for the Rust and UI unit suites, drops the paths that
harness.toml excludes (each with a reason), and fails when

* total line coverage of a side is below gates.unit.<side>_min_lines, or
* coverage of the lines this change adds or modifies (against --base) is
  below gates.unit.changed_min_lines.

A side with no instrumented lines passes (there is nothing to cover yet).
"""

from __future__ import annotations

import argparse
import re
import subprocess
from dataclasses import dataclass, field
from pathlib import Path

from common import ROOT, HarnessError, fail, harness_config, matches_any, pct, rel, write_summary


@dataclass
class FileCov:
    lines: dict[int, int] = field(default_factory=dict)  # line -> hits

    @property
    def total(self) -> int:
        return len(self.lines)

    @property
    def covered(self) -> int:
        return sum(1 for h in self.lines.values() if h > 0)


def parse_lcov(path: Path, prefix: str = "") -> dict[str, FileCov]:
    """Parse an LCOV file into repo-relative path -> line hits.

    `prefix` is prepended to relative SF paths (Vitest writes them relative to its root).
    """
    if not path.exists():
        raise HarnessError(f"coverage report not found: {path} (did the test step run?)")
    files: dict[str, FileCov] = {}
    current: FileCov | None = None
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if line.startswith("SF:"):
            sf = line[3:]
            name = rel(sf) if Path(sf).is_absolute() else (Path(prefix) / sf).as_posix() if prefix else sf
            current = files.setdefault(name, FileCov())
        elif line.startswith("DA:") and current is not None:
            parts = line[3:].split(",")
            num, hits = int(parts[0]), int(float(parts[1]))
            current.lines[num] = max(current.lines.get(num, 0), hits)
        elif line == "end_of_record":
            current = None
    return files


def exclusions(cfg: dict) -> list[str]:
    return [e["path"] for e in cfg.get("coverage", {}).get("exclude", [])]


def filtered(files: dict[str, FileCov], excludes: list[str]) -> dict[str, FileCov]:
    return {p: c for p, c in files.items() if not matches_any(p, excludes)}


_HUNK = re.compile(r"^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@")


def changed_lines(base: str, root: Path = ROOT) -> dict[str, set[int]]:
    """Lines added or modified since the merge base with `base` (working tree included)."""
    merge_base = subprocess.run(
        ["git", "merge-base", base, "HEAD"], cwd=root, capture_output=True, text=True, check=True
    ).stdout.strip()
    diff = subprocess.run(
        ["git", "diff", "--unified=0", "--no-color", "--no-ext-diff", merge_base],
        cwd=root, capture_output=True, text=True, check=True,
    ).stdout
    return parse_diff(diff)


def parse_diff(diff: str) -> dict[str, set[int]]:
    out: dict[str, set[int]] = {}
    current: str | None = None
    for line in diff.splitlines():
        if line.startswith("+++ "):
            target = line[4:]
            current = None if target == "/dev/null" else target[2:] if target.startswith("b/") else target
        elif current and (m := _HUNK.match(line)):
            start, count = int(m.group(1)), int(m.group(2) or "1")
            out.setdefault(current, set()).update(range(start, start + count))
    return out


def evaluate(sides: dict[str, dict[str, FileCov]], cfg: dict, changed: dict[str, set[int]] | None) -> tuple[list[str], str]:
    gates = cfg["gates"]["unit"]
    errors: list[str] = []
    rows = ["| Suite | Covered lines | Total lines | Line coverage | Gate |", "| --- | ---: | ---: | ---: | ---: |"]
    for side, files in sides.items():
        cov = sum(f.covered for f in files.values())
        tot = sum(f.total for f in files.values())
        value = pct(cov, tot)
        need = float(gates[f"{side}_min_lines"])
        ok = value + 1e-9 >= need
        rows.append(f"| {side} unit | {cov} | {tot} | {value:.2f}% | ≥ {need:.0f}% {'✅' if ok else '❌'} |")
        if not ok:
            worst = sorted(files.items(), key=lambda kv: pct(kv[1].covered, kv[1].total))[:8]
            detail = ", ".join(f"{p} {pct(c.covered, c.total):.0f}%" for p, c in worst)
            errors.append(f"{side} unit line coverage {value:.2f}% < {need:.0f}% (lowest: {detail})")
    if changed is not None:
        all_files = {p: c for files in sides.values() for p, c in files.items()}
        hit = tot = 0
        missed: list[str] = []
        for path, nums in sorted(changed.items()):
            fc = all_files.get(path)
            if not fc:
                continue
            for n in sorted(nums):
                if n in fc.lines:
                    tot += 1
                    if fc.lines[n] > 0:
                        hit += 1
                    else:
                        missed.append(f"{path}:{n}")
        value = pct(hit, tot)
        need = float(gates["changed_min_lines"])
        ok = value + 1e-9 >= need
        rows.append(f"| changed lines | {hit} | {tot} | {value:.2f}% | ≥ {need:.0f}% {'✅' if ok else '❌'} |")
        if not ok:
            errors.append(f"changed-line coverage {value:.2f}% < {need:.0f}% (uncovered: {', '.join(missed[:20])})")
    report = "### Unit coverage\n\n" + "\n".join(rows) + "\n"
    return errors, report


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--rust", type=Path, help="LCOV from cargo llvm-cov")
    ap.add_argument("--ui", type=Path, help="LCOV from vitest (paths relative to --ui-root)")
    ap.add_argument("--ui-root", default="apps/desktop")
    ap.add_argument("--base", help="git ref to measure changed lines against (e.g. origin/main)")
    args = ap.parse_args(argv)
    try:
        cfg = harness_config()
        excludes = exclusions(cfg)
        sides: dict[str, dict[str, FileCov]] = {}
        if args.rust:
            sides["rust"] = filtered(parse_lcov(args.rust), excludes)
        if args.ui:
            sides["ui"] = filtered(parse_lcov(args.ui, args.ui_root), excludes)
        if not sides:
            raise HarnessError("pass --rust and/or --ui")
        changed = changed_lines(args.base) if args.base else None
    except (HarnessError, subprocess.CalledProcessError) as e:
        fail(str(e))
    errors, report = evaluate(sides, cfg, changed)
    write_summary(report)
    if errors:
        fail("; ".join(errors))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
