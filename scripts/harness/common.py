"""Shared helpers for the Noter harness scripts (docs/HARNESS.md).

Standard library only, Python 3.11+ (tomllib); `tomli` is used if present on
older Pythons so the hooks still work there.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from functools import lru_cache
from pathlib import Path

try:  # Python 3.11+
    import tomllib as _toml
except ModuleNotFoundError:  # pragma: no cover - depends on the interpreter
    try:
        import tomli as _toml  # type: ignore[no-redef]
    except ModuleNotFoundError:
        _toml = None  # type: ignore[assignment]

ROOT = Path(__file__).resolve().parents[2]


class HarnessError(Exception):
    """A gate cannot be evaluated (bad config, missing input)."""


def load_toml(path: Path) -> dict:
    if _toml is None:
        raise HarnessError("the harness needs Python 3.11+ (or the tomli package): brew install python@3.12")
    with open(path, "rb") as f:
        return _toml.load(f)


@lru_cache(maxsize=None)
def harness_config(root: Path = ROOT) -> dict:
    return load_toml(root / "harness" / "harness.toml")


def milestone_index(cfg: dict, name: str) -> int:
    order = cfg["milestone"]["order"]
    if name not in order:
        raise HarnessError(f"unknown milestone {name!r}; expected one of {order}")
    return order.index(name)


def delivered_milestones(cfg: dict) -> list[str]:
    """Milestones up to and including the current one."""
    order = cfg["milestone"]["order"]
    return order[: milestone_index(cfg, cfg["milestone"]["current"]) + 1]


@lru_cache(maxsize=None)
def _glob_regex(pattern: str) -> re.Pattern[str]:
    out = []
    i = 0
    while i < len(pattern):
        c = pattern[i]
        if pattern.startswith("**/", i):
            out.append("(?:.*/)?")
            i += 3
        elif pattern.startswith("**", i):
            out.append(".*")
            i += 2
        elif c == "*":
            out.append("[^/]*")
            i += 1
        elif c == "?":
            out.append("[^/]")
            i += 1
        else:
            out.append(re.escape(c))
            i += 1
    return re.compile("^" + "".join(out) + "$")


def glob_match(path: str, pattern: str) -> bool:
    """Match a repo-relative POSIX path against a glob with `**` support.

    A pattern ending in `/` matches everything below that directory.
    """
    if path.startswith("./"):
        path = path[2:]
    if pattern.endswith("/"):
        return path.startswith(pattern)
    return bool(_glob_regex(pattern).match(path))


def matches_any(path: str, patterns: list[str]) -> bool:
    return any(glob_match(path, p) for p in patterns)


def rel(path: str | Path, root: Path = ROOT) -> str:
    p = Path(path)
    if p.is_absolute():
        try:
            p = p.resolve().relative_to(root.resolve())
        except ValueError:
            return p.as_posix()
    return p.as_posix()


def git(*args: str, root: Path = ROOT) -> str:
    return subprocess.run(["git", *args], cwd=root, check=True, capture_output=True, text=True).stdout


def write_summary(markdown: str) -> None:
    """Print a report and append it to the GitHub step summary when in CI."""
    print(markdown)
    target = os.environ.get("GITHUB_STEP_SUMMARY")
    if target:
        with open(target, "a", encoding="utf-8") as f:
            f.write(markdown + "\n")


def pct(covered: int, total: int) -> float:
    """Coverage percentage; an empty denominator counts as fully covered."""
    return 100.0 if total == 0 else 100.0 * covered / total


def fail(msg: str) -> "NoReturn":  # type: ignore[name-defined]  # noqa: F821
    print(f"GATE FAILED: {msg}", file=sys.stderr)
    raise SystemExit(1)


def dump_json(path: Path, data: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")
