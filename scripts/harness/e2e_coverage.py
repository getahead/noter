#!/usr/bin/env python3
"""End-to-end coverage gate (docs/ADR/0003).

"Coverage" for end-to-end tests is measured against what has been delivered,
not in source lines (the macOS WebView cannot be instrumented reliably):

* commands: frozen IPC commands of the delivered milestones (harness/milestones.toml,
  up to harness.toml [milestone].current) that the E2E suites invoked. The suites
  record every command they send through the recording transport into
  coverage/e2e/commands-*.json.
* stories: DESIGN.md stories (`cpt-noter-seq-*`) of the delivered milestones named
  in the title of an E2E test that passed (recorded by the Vitest setup and the
  Playwright story reporter into the same logs).

Runs against the fake core are not counted: end-to-end means the real core.

Both must reach gates.e2e.*_min. It also checks that milestones.toml places every
command of the manifest and every story of DESIGN.md exactly once.
"""

from __future__ import annotations

import argparse
import glob
import json
import re
from pathlib import Path

from common import ROOT, HarnessError, delivered_milestones, fail, harness_config, load_toml, pct, write_summary

STORY_ID = re.compile(r"cpt-noter-seq-[a-z0-9-]+[a-z0-9]")
DEFAULT_TEST_DIRS = ["apps/desktop/tests/conformance", "apps/desktop/tests/e2e", "crates"]
TEST_SUFFIXES = (".ts", ".tsx", ".rs", ".swift")


def manifest_commands(root: Path) -> dict[str, dict]:
    data = json.loads((root / "contracts" / "ipc.manifest.json").read_text(encoding="utf-8"))
    return {c["name"]: c for c in data["commands"]}


def design_stories(root: Path) -> set[str]:
    text = (root / "docs" / "DESIGN.md").read_text(encoding="utf-8")
    return set(re.findall(r"\*\*ID\*\*: `(cpt-noter-seq-[a-z0-9-]+)`", text))


def check_registry(milestones: dict, commands: set[str], stories: set[str]) -> list[str]:
    errors: list[str] = []
    for kind, universe in (("commands", commands), ("stories", stories)):
        placed: dict[str, str] = {}
        for ms, body in milestones.items():
            for item in body.get(kind, []):
                if item in placed:
                    errors.append(f"milestones.toml: {item} is listed in {placed[item]} and {ms}")
                placed[item] = ms
        missing = sorted(universe - placed.keys())
        unknown = sorted(placed.keys() - universe)
        if missing:
            errors.append(f"milestones.toml: {kind} not placed in any milestone: {', '.join(missing)}")
        if unknown:
            errors.append(f"milestones.toml: unknown {kind}: {', '.join(unknown)}")
    return errors


def read_logs(patterns: list[str], include_fake: bool = False) -> tuple[set[str], set[str]]:
    """Commands that succeeded and stories whose tests passed in the E2E runs.
    Runs against the fake core do not count unless asked: E2E means the real core."""
    commands: set[str] = set()
    stories: set[str] = set()
    for pattern in patterns:
        for path in glob.glob(pattern, recursive=True):
            data = json.loads(Path(path).read_text(encoding="utf-8"))
            if data.get("target") == "fake" and not include_fake:
                continue
            commands.update(data.get("commands", []))
            stories.update(data.get("stories", []))
    return commands, stories


def invoked_commands(patterns: list[str], include_fake: bool = False) -> set[str]:
    return read_logs(patterns, include_fake)[0]


def named_stories(root: Path, dirs: list[str]) -> set[str]:
    found: set[str] = set()
    for d in dirs:
        base = root / d
        if not base.exists():
            continue
        for path in base.rglob("*"):
            if path.is_file() and path.suffix in TEST_SUFFIXES and ("tests" in path.parts or "e2e" in path.parts):
                found.update(STORY_ID.findall(path.read_text(encoding="utf-8", errors="ignore")))
    return found


def evaluate(root: Path, cfg: dict, milestones: dict, invoked: set[str], named: set[str],
             mentioned: set[str] | None = None) -> tuple[list[str], str]:
    """`named`: stories proven by passing real-core E2E tests; `mentioned`: IDs merely found in test files."""
    manifest = manifest_commands(root)
    stories = design_stories(root)
    errors = check_registry(milestones, set(manifest), stories)
    delivered = [m for m in delivered_milestones(cfg) if m in milestones]
    due_cmds = {c for m in delivered for c in milestones[m]["commands"] if manifest.get(c, {}).get("stability") == "frozen"}
    due_stories = {s for m in delivered for s in milestones[m]["stories"]}
    gates = cfg["gates"]["e2e"]
    cmd_value = pct(len(due_cmds & invoked), len(due_cmds))
    story_value = pct(len(due_stories & named), len(due_stories))
    rows = [
        f"Milestone: **{cfg['milestone']['current']}** (delivered: {', '.join(delivered) or 'none yet'})",
        "",
        "| Measure | Exercised | Due | Coverage | Gate |",
        "| --- | ---: | ---: | ---: | ---: |",
    ]
    for label, value, hit, due, need in (
        ("frozen commands", cmd_value, len(due_cmds & invoked), len(due_cmds), float(gates["commands_min"])),
        ("stories", story_value, len(due_stories & named), len(due_stories), float(gates["stories_min"])),
    ):
        ok = value + 1e-9 >= need
        rows.append(f"| {label} | {hit} | {due} | {value:.1f}% | ≥ {need:.0f}% {'✅' if ok else '❌'} |")
        if not ok:
            errors.append(f"E2E {label} coverage {value:.1f}% < {need:.0f}%")
    if due_cmds - invoked:
        rows.append("\nNot exercised: " + ", ".join(sorted(due_cmds - invoked)[:40]))
    if due_stories - named:
        rows.append("\nStories without a passing real-core E2E test: " + ", ".join(sorted(due_stories - named)))
    pending = sorted((due_stories - named) & (mentioned or set()))
    if pending:
        rows.append("\nNamed in tests but not yet proven against the real core: " + ", ".join(pending))
    rows.append(f"\nAlso exercised ahead of schedule: {len(invoked - due_cmds)} commands.")
    return errors, "### End-to-end coverage\n\n" + "\n".join(rows) + "\n"


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--commands-log", action="append", default=None, help="glob of command logs (repeatable)")
    ap.add_argument("--tests", action="append", default=None, help="directories scanned for story IDs (report only)")
    ap.add_argument("--include-fake", action="store_true", help="also count runs against the fake core (local insight only)")
    args = ap.parse_args(argv)
    try:
        cfg = harness_config()
        milestones = load_toml(ROOT / "harness" / "milestones.toml")
        logs = args.commands_log or [str(ROOT / "coverage" / "e2e" / "commands-*.json")]
        commands, stories = read_logs(logs, args.include_fake)
        errors, report = evaluate(ROOT, cfg, milestones, commands, stories, named_stories(ROOT, args.tests or DEFAULT_TEST_DIRS))
    except HarnessError as e:
        fail(str(e))
    write_summary(report)
    if errors:
        fail("; ".join(errors))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
