#!/usr/bin/env python3
"""Which Dependabot PRs may merge by themselves (.github/workflows/dependabot-automerge.yml, docs/DELIVERY.md).

compatible: reads dependabot/fetch-metadata's `updated-dependencies-json` from $DEPS and exits 0
            when every update is semver-compatible as Cargo and npm read it (same major; on 0.x the
            same minor; on 0.0.x the same patch), 1 otherwise. The workflow then turns auto-merge on
            or off; either way the PR merges only after gate, hygiene, review and CodeQL pass.
            Anything it cannot read is not compatible: the owner decides.
"""

from __future__ import annotations

import json
import os
import re
import sys

VERSION_RE = re.compile(r"^v?(\d+)\.(\d+)\.(\d+)")


def _parts(version: str | None) -> tuple[int, int, int] | None:
    m = VERSION_RE.match(version or "")
    return (int(m[1]), int(m[2]), int(m[3])) if m else None


def compatible(prev: str | None, new: str | None) -> bool:
    a, b = _parts(prev), _parts(new)
    if a is None or b is None or b < a:
        return False
    # The leftmost non-zero component is the breaking one (Cargo's caret, npm's ^).
    width = 1 if a[0] else 2 if a[1] else 3
    return a[:width] == b[:width]


def all_compatible(deps: list[dict]) -> bool:
    return bool(deps) and all(compatible(d.get("prevVersion"), d.get("newVersion")) for d in deps)


def main(argv: list[str]) -> int:
    if argv[1:] != ["compatible"]:
        print(__doc__, file=sys.stderr)
        return 2
    deps = json.loads(os.environ.get("DEPS") or "[]")
    for d in deps:
        verdict = "compatible" if compatible(d.get("prevVersion"), d.get("newVersion")) else "breaking"
        print(f"{d.get('dependencyName')} {d.get('prevVersion')} -> {d.get('newVersion')}: {verdict}")
    return 0 if all_compatible(deps) else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
