#!/usr/bin/env python3
"""Trace coverage gate (docs/ADR/0003): design elements implemented in code, never going down.

Constructor Studio's FULL traceability (`.cf-studio/config/artifacts.toml`) makes
`cfs validate` check that every `@cpt-*` marker in the registered codebase names an
ID that the design defines. This gate measures the other direction:

* traceable IDs: the IDs of the kinds in harness.toml [gates.trace].kinds that are
  defined (`**ID**: `cpt-…``) in the artifacts registered with traceability "FULL";
* covered: a scope marker (`@cpt-{kind}:{id}:p{N}`) or a block marker
  (`@cpt-begin:{id}:p{N}:inst-…`) for the ID exists in the registered codebase
  (its paths and extensions).

It reports total, covered and coverage. With `ratchet = true` it fails when, against
the base branch (--base, default NOTER_BASE_REF or origin/main; the base is read with
git, nothing is checked out):

a. an ID covered on the base and still defined on head is no longer covered, or
b. the coverage of the base's traceable IDs is lower on head than on the base.

IDs that a pull request adds to the design never fail the gate: design-first work
defines elements before the code exists. Without the base ref the gate only reports.
"""

from __future__ import annotations

import argparse
import os
import re
import subprocess
from dataclasses import dataclass, field
from pathlib import Path

from common import ROOT, HarnessError, fail, harness_config, pct, write_summary

try:
    import tomllib as _toml
except ModuleNotFoundError:  # pragma: no cover - depends on the interpreter
    import tomli as _toml  # type: ignore[no-redef]

REGISTRY = ".cf-studio/config/artifacts.toml"
ID_DEFINITION = re.compile(r"\*\*ID\*\*:\s*`(cpt-[a-z0-9][a-z0-9-]*)`")
# The marker grammar of the Constructor Studio traceability spec (Part II).
SCOPE_MARKER = re.compile(r"@cpt-(?!begin:)(?!end:)[a-z][a-z0-9-]*:(cpt-[a-z0-9][a-z0-9-]+):(?:p|ph-)\d+")
BLOCK_MARKER = re.compile(r"@cpt-begin:(cpt-[a-z0-9][a-z0-9-]+):(?:p|ph-)\d+:inst-[a-z0-9-]+")
# Directories cfs never scans, plus build output.
IGNORED_DIRS = frozenset({"node_modules", ".git", ".venv", "venv", "build", "dist", "vendor", ".tox", "__pycache__", "target"})
FENCE = re.compile(r"^\s*(```|~~~)")


class WorkTree:
    """The files as they are on disk (head)."""

    def __init__(self, root: Path) -> None:
        self.root = root
        self.label = "head"

    def read(self, path: str) -> str | None:
        p = self.root / path
        return p.read_text(encoding="utf-8", errors="replace") if p.is_file() else None

    def files_under(self, path: str) -> list[str]:
        p = self.root / path
        if p.is_file():
            return [path]
        if not p.is_dir():
            return []
        return sorted(f.relative_to(self.root).as_posix() for f in p.rglob("*") if f.is_file() and not f.is_symlink())

    def read_many(self, paths: list[str]) -> dict[str, str]:
        return {p: t for p in paths if (t := self.read(p)) is not None}


class GitRef:
    """The files at a git ref, read without a checkout."""

    def __init__(self, root: Path, ref: str) -> None:
        self.root = root
        self.ref = ref
        self.label = ref

    def _git(self, *args: str, stdin: bytes | None = None) -> bytes:
        return subprocess.run(["git", *args], cwd=self.root, input=stdin, capture_output=True, check=True).stdout

    def read(self, path: str) -> str | None:
        return self.read_many([path]).get(path)

    def files_under(self, path: str) -> list[str]:
        out = self._git("ls-tree", "-r", "--name-only", "-z", self.ref, "--", path).decode("utf-8")
        return sorted(p for p in out.split("\0") if p)

    def read_many(self, paths: list[str]) -> dict[str, str]:
        if not paths:
            return {}
        out = self._git("cat-file", "--batch", stdin="".join(f"{self.ref}:{p}\n" for p in paths).encode("utf-8"))
        found: dict[str, str] = {}
        pos = 0
        for path in paths:
            end = out.index(b"\n", pos)
            header = out[pos:end].split()
            pos = end + 1
            if header[-1] == b"missing" or header[1] != b"blob":
                if header[-1] != b"missing":
                    pos += int(header[2]) + 1
                continue
            size = int(header[2])
            found[path] = out[pos : pos + size].decode("utf-8", errors="replace")
            pos += size + 1
        return found


def ref_exists(root: Path, ref: str) -> bool:
    return subprocess.run(["git", "rev-parse", "--verify", "--quiet", f"{ref}^{{commit}}"], cwd=root, capture_output=True).returncode == 0


def _systems(registry: dict) -> list[tuple[str, dict]]:
    """(hierarchy prefix, system table) for every registered system, children included."""
    out: list[tuple[str, dict]] = []

    def walk(items: list[dict] | None, parent: str) -> None:
        for system in items or []:
            prefix = f"{parent}-{system['slug']}" if parent else system["slug"]
            out.append((prefix, system))
            walk(system.get("children"), prefix)

    walk(registry.get("systems"), "")
    return out


def id_kind(cpt_id: str, prefix: str) -> str | None:
    """`cpt-{prefix}-{kind}-{slug}` → kind."""
    head = f"cpt-{prefix}-"
    return cpt_id[len(head):].split("-", 1)[0] if cpt_id.startswith(head) else None


def defined_ids(text: str) -> list[str]:
    """IDs defined in an artifact, skipping fenced examples."""
    ids: list[str] = []
    fenced = False
    for line in text.splitlines():
        if FENCE.match(line):
            fenced = not fenced
            continue
        if not fenced:
            ids.extend(ID_DEFINITION.findall(line))
    return ids


def marked_ids(text: str) -> set[str]:
    return set(SCOPE_MARKER.findall(text)) | set(BLOCK_MARKER.findall(text))


@dataclass
class Trace:
    ids: dict[str, str] = field(default_factory=dict)  # traceable id -> kind
    marked: set[str] = field(default_factory=set)  # every id a marker in the codebase names
    artifacts: list[str] = field(default_factory=list)  # FULL artifacts read

    @property
    def covered(self) -> set[str]:
        return set(self.ids) & self.marked

    @property
    def value(self) -> float:
        return pct(len(self.covered), len(self.ids))


def measure(source: WorkTree | GitRef, kinds: list[str]) -> Trace:
    text = source.read(REGISTRY)
    if text is None:
        return Trace()
    registry = _toml.loads(text)
    trace = Trace()
    code: list[tuple[str, set[str]]] = []
    for prefix, system in _systems(registry):
        for art in system.get("artifacts", []):
            if str(art.get("traceability", "")).upper() != "FULL":
                continue
            body = source.read(art["path"])
            if body is None:
                raise HarnessError(f"{source.label}: artifact registered as FULL not found: {art['path']}")
            trace.artifacts.append(art["path"])
            for cpt_id in defined_ids(body):
                kind = id_kind(cpt_id, prefix)
                if kind in kinds:
                    trace.ids[cpt_id] = kind
        for entry in system.get("codebase", []):
            exts = {e if e.startswith(".") else f".{e}" for e in entry.get("extensions", [])}
            code.append((entry["path"].rstrip("/"), exts))
    paths: set[str] = set()
    for path, exts in code:
        for f in source.files_under(path):
            parts = f.split("/")
            if any(p in IGNORED_DIRS for p in parts[:-1]):
                continue
            if not exts or Path(f).suffix in exts:
                paths.add(f)
    for body in source.read_many(sorted(paths)).values():
        trace.marked |= marked_ids(body)
    return trace


def evaluate(head: Trace, base: Trace | None, ratchet: bool, base_label: str) -> tuple[list[str], str]:
    errors: list[str] = []
    rows = ["| Measured on | Covered | Traceable IDs | Trace coverage |", "| --- | ---: | ---: | ---: |"]
    rows.append(f"| head | {len(head.covered)} | {len(head.ids)} | {head.value:.2f}% |")
    notes: list[str] = []
    if base is None:
        notes.append(f"Base ref `{base_label}` not found: reported only, the ratchet was not applied.")
    else:
        base_ids = set(base.ids)
        kept = head.marked & base_ids
        head_on_base = pct(len(kept), len(base_ids))
        rows.append(f"| base `{base_label}` | {len(base.covered)} | {len(base_ids)} | {base.value:.2f}% |")
        rows.append(f"| head, over the base's IDs | {len(kept)} | {len(base_ids)} | {head_on_base:.2f}% |")
        lost = sorted((base.covered & set(head.ids)) - head.marked)
        dropped = sorted(base.covered - set(head.ids) - head.marked)
        new = sorted(set(head.ids) - base_ids)
        new_open = [i for i in new if i not in head.marked]
        if new:
            notes.append(
                f"{len(new)} traceable ID(s) are new since the base (added to the design, or in an artifact newly "
                f"registered as FULL), {len(new_open)} of them not implemented yet. New IDs never fail this gate: "
                "design-first work defines elements before the code exists."
            )
        if ratchet:
            if lost:
                errors.append(f"trace coverage lost: {', '.join(lost)} had a code marker on {base_label} and no longer has one")
            if head_on_base + 1e-9 < base.value:
                detail = f" (covered on base, removed with their markers: {', '.join(dropped)})" if dropped else ""
                errors.append(
                    f"trace coverage of the base's {len(base_ids)} IDs fell from {base.value:.2f}% to {head_on_base:.2f}%{detail}"
                )
        else:
            notes.append("Ratchet off (gates.trace.ratchet = false): reported only.")
    by_kind: dict[str, list[int]] = {}
    for cpt_id, kind in head.ids.items():
        c = by_kind.setdefault(kind, [0, 0])
        c[1] += 1
        c[0] += cpt_id in head.marked
    kind_rows = ["| Kind | Covered | Defined |", "| --- | ---: | ---: |"]
    kind_rows += [f"| {k} | {c} | {t} |" for k, (c, t) in sorted(by_kind.items())]
    verdict = "❌" if errors else "✅"
    sources = ", ".join(f"`{a}`" for a in head.artifacts) or "none: no artifact has FULL traceability"
    report = (
        f"### Trace coverage {verdict}\n\n"
        f"Design elements defined in the FULL-traceability artifacts ({sources}) that an `@cpt-*` marker "
        "implements in the registered codebase. Ratchet: never lower than on the base branch.\n\n"
        + "\n".join(rows) + "\n\n" + ("\n".join(kind_rows) if by_kind else "No traceable IDs.") + "\n"
        + ("".join(f"\n{n}\n" for n in notes))
        + (f"\nCovered: {', '.join(f'`{i}`' for i in sorted(head.covered))}\n" if head.covered else "")
    )
    return errors, report


def run(root: Path, base_ref: str, kinds: list[str], ratchet: bool) -> tuple[list[str], str]:
    head = measure(WorkTree(root), kinds)
    base = measure(GitRef(root, base_ref), kinds) if ref_exists(root, base_ref) else None
    return evaluate(head, base, ratchet, base_ref)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--base", default=os.environ.get("NOTER_BASE_REF", "origin/main"), help="git ref to compare with")
    args = ap.parse_args(argv)
    try:
        gate = harness_config().get("gates", {}).get("trace")
        if not gate or not gate.get("kinds"):
            raise HarnessError("harness.toml [gates.trace] with `kinds` is missing")
        errors, report = run(ROOT, args.base, list(gate["kinds"]), bool(gate.get("ratchet", True)))
    except (HarnessError, subprocess.CalledProcessError, KeyError, ValueError) as e:
        fail(f"trace coverage cannot be measured: {e}")
    write_summary(report)
    if errors:
        fail("; ".join(errors))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
