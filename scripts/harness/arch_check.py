#!/usr/bin/env python3
"""Architecture fitness checks: DESIGN-core principles as failing tests (docs/ADR/0003).

Each rule names the principle or decision it enforces. Rules over crates that do
not exist yet pass trivially and start biting the day the crate appears.
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

from common import ROOT, write_summary

SQLITE_CRATES = {"rusqlite", "sqlx", "libsqlite3-sys", "sqlite", "diesel", "sea-orm", "sqlite-vec"}
NETWORK_CRATES = {
    "reqwest", "hyper", "hyper-util", "ureq", "isahc", "surf", "curl", "attohttpc",
    "tokio-tungstenite", "tungstenite", "async-tungstenite", "h2", "quinn", "awc",
}
TAURI_CRATES = {"tauri", "tauri-build", "tauri-runtime", "tauri-runtime-wry", "wry"}
PROTOCOL_ALLOWED = {"serde", "serde_json", "specta", "specta-typescript", "specta-serde", "schemars"}

# Which workspace crates may depend on what (by package name).
SQLITE_OWNERS = {"noter-db"}               # cpt-noter-principle-core-single-writer
NETWORK_OWNERS = {"noter-llm"}             # cpt-noter-principle-core-egress-gate, decision C12
TAURI_OWNERS = {"noter-desktop"}            # decision C11: only the thin host (apps/desktop/src-tauri, package noter-desktop)
NETWORK_ENTITLEMENTS = ("com.apple.security.network.client", "com.apple.security.network.server")


@dataclass
class Violation:
    rule: str
    detail: str


def workspace_packages(root: Path) -> list[dict]:
    out = subprocess.run(
        ["cargo", "metadata", "--format-version", "1", "--no-deps", "--offline"],
        cwd=root, capture_output=True, text=True,
    )
    if out.returncode != 0:  # --offline fails on a cold cache; retry online
        out = subprocess.run(["cargo", "metadata", "--format-version", "1", "--no-deps"], cwd=root, capture_output=True, text=True, check=True)
    return json.loads(out.stdout)["packages"]


def deps_of(pkg: dict) -> set[str]:
    return {d["name"] for d in pkg.get("dependencies", []) if d.get("kind") in (None, "normal", "build")}


def check_crates(packages: list[dict]) -> list[Violation]:
    v: list[Violation] = []
    for pkg in packages:
        name, deps = pkg["name"], deps_of(pkg)
        if (bad := deps & SQLITE_CRATES) and name not in SQLITE_OWNERS:
            v.append(Violation("single writer (cpt-noter-principle-core-single-writer)", f"{name} depends on {sorted(bad)}; only noter-db may touch SQLite"))
        if (bad := deps & NETWORK_CRATES) and name not in NETWORK_OWNERS:
            v.append(Violation("egress gate (cpt-noter-principle-core-egress-gate)", f"{name} depends on {sorted(bad)}; network access goes through noter-llm's gate only"))
        if (bad := deps & TAURI_CRATES) and name not in TAURI_OWNERS:
            v.append(Violation("Tauri-free core (decision C11)", f"{name} depends on {sorted(bad)}; only the src-tauri host may use Tauri"))
        if name == "noter-protocol" and (bad := deps - PROTOCOL_ALLOWED):
            v.append(Violation("contract crate is types only (ADR-0001)", f"noter-protocol depends on {sorted(bad)}; allowed: {sorted(PROTOCOL_ALLOWED)}"))
    return v


TAURI_IMPORT = re.compile(r"""from\s+["']@tauri-apps/|import\(\s*["']@tauri-apps/|require\(\s*["']@tauri-apps/""")
FAKE_IMPORT = re.compile(r"""from\s+["'][^"']*core/fake/|from\s+["']\./fake/|from\s+["']\.\./fake/""")
UI_SRC = "apps/desktop/src"
TAURI_IMPORT_ALLOWED = {"apps/desktop/src/core/tauri-transport.ts"}


def _fake_import_allowed(path: str) -> bool:
    return (
        path.startswith("apps/desktop/src/core/")
        or path == "apps/desktop/src/main.tsx"
        or ".test." in path
        or ".stories." in path
        or path.startswith("apps/desktop/src/dev/")
    )


def check_ui(root: Path) -> list[Violation]:
    v: list[Violation] = []
    base = root / UI_SRC
    if not base.exists():
        return v
    for path in base.rglob("*"):
        if path.suffix not in (".ts", ".tsx") or "node_modules" in path.parts:
            continue
        relp = path.relative_to(root).as_posix()
        text = path.read_text(encoding="utf-8", errors="ignore")
        if TAURI_IMPORT.search(text) and relp not in TAURI_IMPORT_ALLOWED:
            v.append(Violation("only the core bridge talks to Tauri (DESIGN › Core bridge)", f"{relp} imports @tauri-apps; use createCore() from src/core"))
        if FAKE_IMPORT.search(text) and not _fake_import_allowed(relp):
            v.append(Violation("the fake core stays out of product code", f"{relp} imports the fake core; only main.tsx (behind VITE_FAKE_CORE), tests and stories may"))
    return v


def check_entitlements(root: Path) -> list[Violation]:
    v: list[Violation] = []
    engine = root / "engine"
    if not engine.exists():
        return v
    for path in engine.rglob("*.entitlements"):
        text = path.read_text(encoding="utf-8", errors="ignore")
        for key in NETWORK_ENTITLEMENTS:
            if key in text:
                v.append(Violation("engine is offline (cpt-noter-constraint-core-engine-offline)", f"{path.relative_to(root)} grants {key}"))
    return v


# Ways to pass a gate without meeting it: coverage opt-out pragmas, and tests
# that are skipped, focused or left as todo. Conditional skips are allowed only
# on the target core (`skipIf(isFake)` / `skipIf(!isFake)`).
OPT_OUTS = [
    (re.compile(r"\b(?:v8|c8|istanbul)\s+ignore\b"), "coverage pragma"),
    (re.compile(r"coverage\s*\(\s*off\s*\)|\bno_coverage\b"), "coverage attribute"),
    (re.compile(r"#\[\s*ignore\b"), "ignored Rust test"),
    (re.compile(r"\b(?:it|test|describe|suite|bench)\.(?:skip|only|todo|fixme)\s*\("), "skipped, focused or todo test"),
    (re.compile(r"\bx(?:it|test|describe)\s*\("), "skipped test"),
    (re.compile(r"\.(?:skipIf|runIf)\s*\((?!\s*!?isFake\s*\))"), "conditional skip not on the target core"),
    (re.compile(r"\bXCTSkip\b"), "skipped Swift test"),
]
OPT_OUT_DIRS = ["apps/desktop/src", "apps/desktop/tests", "crates", "engine"]
OPT_OUT_SUFFIXES = (".ts", ".tsx", ".rs", ".swift")


def check_opt_outs(root: Path) -> list[Violation]:
    v: list[Violation] = []
    for d in OPT_OUT_DIRS:
        base = root / d
        if not base.exists():
            continue
        for path in base.rglob("*"):
            if path.suffix not in OPT_OUT_SUFFIXES or {"node_modules", "target"} & set(path.parts):
                continue
            for n, line in enumerate(path.read_text(encoding="utf-8", errors="ignore").splitlines(), 1):
                for rx, what in OPT_OUTS:
                    if rx.search(line):
                        v.append(Violation("no gate bypass (ADR-0003)", f"{path.relative_to(root)}:{n}: {what}; fix the test or the code instead"))
    return v


def run(root: Path = ROOT) -> list[Violation]:
    return check_crates(workspace_packages(root)) + check_ui(root) + check_entitlements(root) + check_opt_outs(root)


def main() -> int:
    violations = run()
    if violations:
        rows = "\n".join(f"| {x.rule} | {x.detail} |" for x in violations)
        write_summary(f"### Architecture checks ❌\n\n| Rule | Violation |\n| --- | --- |\n{rows}\n")
        print(f"GATE FAILED: {len(violations)} architecture violation(s)", file=sys.stderr)
        return 1
    write_summary("### Architecture checks ✅\n\nSingle writer, egress gate, Tauri-free core, types-only contract, core bridge, offline engine, no gate bypass.\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
