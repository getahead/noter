#!/usr/bin/env python3
"""Performance gate (docs/ADR/0003).

    perf_gate.py coverage                      registry entries due by the milestone that have a scenario
    perf_gate.py ab --base origin/main --mode ir    build and measure base and head in this job, compare
    perf_gate.py measure --mode wall --out f.json   measure the current checkout only
    perf_gate.py compare --base b.json --head h.json

Modes:
* ir   — instructions executed (valgrind cachegrind). Deterministic to well under
         1%, so the 5% limit is a hard gate on every pull request (Linux).
* wall — median of N timed runs after warm-ups. A regression fails only when it is
         above the limit *and* larger than twice the run-to-run spread (MAD); use
         --report-only on shared runners, where wall time is not trustworthy.

Base and head are measured in the same job (A/B) so toolchain or machine drift
between runs cannot produce false regressions.
"""

from __future__ import annotations

import argparse
import os
import re
import shutil
import statistics
import tempfile
import subprocess
import sys
import time
from pathlib import Path

from common import (
    ROOT,
    HarnessError,
    delivered_milestones,
    dump_json,
    fail,
    harness_config,
    load_toml,
    pct,
    write_summary,
)

IREFS = re.compile(r"I\s+refs:\s+([\d,]+)")


def perf_config(root: Path = ROOT) -> dict:
    return load_toml(root / "harness" / "perf.toml")


# ---------------------------------------------------------------- coverage


def coverage(cfg: dict, perf: dict) -> tuple[list[str], str]:
    delivered = set(delivered_milestones(cfg))
    due = [r for r in perf.get("registry", []) if r["milestone"] in delivered]
    scenarios = perf.get("scenarios", {})
    covered = [r for r in due if r.get("scenario") in scenarios]
    value = pct(len(covered), len(due))
    need = float(cfg["gates"]["perf"]["scenario_coverage_min"])
    ok = value + 1e-9 >= need
    rows = [
        "### Performance scenario coverage",
        "",
        f"Milestone **{cfg['milestone']['current']}**: {len(covered)} of {len(due)} due registry entries have a scenario "
        f"({value:.1f}%, gate ≥ {need:.0f}% {'✅' if ok else '❌'}).",
    ]
    missing = [f"{r['id']} ({r['milestone']}, scenario `{r.get('scenario')}`)" for r in due if r not in covered]
    if missing:
        rows.append("\nMissing: " + ", ".join(missing))
    errors = [] if ok else [f"perf scenario coverage {value:.1f}% < {need:.0f}%"]
    return errors, "\n".join(rows) + "\n"


# ---------------------------------------------------------------- measuring


def _expand(argv: list[str], target: Path) -> list[str]:
    return [a.replace("{target}", str(target)) for a in argv]


def measure_ir(cmd: list[str], cwd: Path) -> float:
    if not shutil.which("valgrind"):
        raise HarnessError("ir mode needs valgrind (Linux): apt-get install valgrind")
    proc = subprocess.run(
        ["valgrind", "--tool=cachegrind", "--cache-sim=no", "--cachegrind-out-file=/dev/null", "--trace-children=yes", *cmd],
        cwd=cwd, capture_output=True, text=True,
    )
    if proc.returncode != 0:
        raise HarnessError(f"scenario failed under valgrind: {' '.join(cmd)}\n{proc.stderr[-2000:]}")
    found = IREFS.findall(proc.stderr)
    if not found:
        raise HarnessError(f"no 'I refs' in valgrind output for {' '.join(cmd)}")
    return float(sum(int(x.replace(",", "")) for x in found))


def measure_wall(cmd: list[str], cwd: Path, runs: int, warmups: int) -> tuple[float, float]:
    samples = []
    for i in range(warmups + runs):
        t0 = time.perf_counter()
        proc = subprocess.run(cmd, cwd=cwd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
        dt = time.perf_counter() - t0
        if proc.returncode != 0:
            raise HarnessError(f"scenario failed: {' '.join(cmd)}\n{proc.stderr[-2000:]}")
        if i >= warmups:
            samples.append(dt)
    med = statistics.median(samples)
    mad = statistics.median(abs(s - med) for s in samples)
    return med, mad


def pinned_toolchain(root: Path = ROOT) -> str | None:
    """The head's Rust toolchain, used for base and head alike so only the code differs."""
    path = root / "rust-toolchain.toml"
    return load_toml(path).get("toolchain", {}).get("channel") if path.exists() else None


def measure(checkout: Path, perf: dict, mode: str, runs: int, warmups: int, only: list[str] | None = None,
            expected: set[str] | None = None) -> dict:
    """Build and measure every scenario of `perf` (the head's definitions) in `checkout`.

    `expected`: scenarios that must exist in this checkout (the base's own perf.toml).
    One that is expected but does not build is "failed", not "unavailable", so a
    broken base can never turn a regression into a "new scenario".
    """
    target = Path(os.environ.get("CARGO_TARGET_DIR", checkout / "target"))
    env = dict(os.environ)
    if (channel := pinned_toolchain()) and "RUSTUP_TOOLCHAIN" not in env:
        env["RUSTUP_TOOLCHAIN"] = channel
    results: dict[str, dict] = {}
    for name, sc in perf.get("scenarios", {}).items():
        if mode not in sc.get("modes", []) or (only and name not in only):
            continue
        missing = "failed" if expected is not None and name in expected else "unavailable"
        if sc["build"][:1] == ["cargo"] and not (checkout / "Cargo.toml").exists():
            results[name] = {"status": missing, "why": "no Cargo workspace in this checkout"}
            continue
        build = subprocess.run(_expand(sc["build"], target), cwd=checkout, capture_output=True, text=True, env=env)
        if build.returncode != 0:
            results[name] = {"status": missing, "why": build.stderr[-500:]}
            continue
        cmd = _expand(sc["run"], target)
        if mode == "ir":
            results[name] = {"status": "ok", "value": measure_ir(cmd, checkout), "unit": "instructions"}
        else:
            med, mad = measure_wall(cmd, checkout, runs, warmups)
            results[name] = {"status": "ok", "value": med, "mad": mad, "unit": "seconds"}
    return {"mode": mode, "results": results}


# ---------------------------------------------------------------- comparing


def compare(base: dict, head: dict, max_regression: float, report_only: bool = False) -> tuple[list[str], str]:
    mode = head.get("mode", "ir")
    rows = [
        f"### Performance ({mode}{', report only' if report_only else ''})",
        "",
        "| Scenario | Base | Head | Change | Gate |",
        "| --- | ---: | ---: | ---: | ---: |",
    ]
    errors: list[str] = []
    for name, h in sorted(head.get("results", {}).items()):
        b = base.get("results", {}).get(name)
        if h.get("status") != "ok":
            errors.append(f"{name}: head scenario did not run ({h.get('why', '').strip()[:200]})")
            rows.append(f"| {name} | – | did not run | – | ❌ |")
            continue
        if b and b.get("status") == "failed":
            errors.append(f"{name}: exists on base but could not be measured there ({b.get('why', '').strip()[:200]})")
            rows.append(f"| {name} | failed on base | {h['value']:.6g} | – | ❌ |")
            continue
        if not b or b.get("status") != "ok":
            rows.append(f"| {name} | new | {h['value']:.6g} | – | new scenario |")
            continue
        change = 100.0 * (h["value"] - b["value"]) / b["value"] if b["value"] else 0.0
        regressed = change > max_regression
        if regressed and mode == "wall":
            noise = 2 * max(b.get("mad", 0.0), h.get("mad", 0.0))
            regressed = (h["value"] - b["value"]) > noise
        verdict = "❌" if regressed and not report_only else ("⚠️" if regressed else "✅")
        rows.append(f"| {name} | {b['value']:.6g} | {h['value']:.6g} | {change:+.2f}% | ≤ +{max_regression:.0f}% {verdict} |")
        if regressed and not report_only:
            errors.append(f"{name} is {change:.2f}% slower than base (limit {max_regression:.0f}%)")
    return errors, "\n".join(rows) + "\n"


def make_base_worktree(base_ref: str, root: Path = ROOT) -> Path:
    merge_base = subprocess.run(["git", "merge-base", base_ref, "HEAD"], cwd=root, capture_output=True, text=True, check=True).stdout.strip()
    # Outside the repository: cargo looks for Cargo.toml in parent directories, so a
    # base checkout inside this one would silently build the head's workspace.
    path = Path(os.environ.get("RUNNER_TEMP", tempfile.gettempdir())) / f"noter-perf-base-{merge_base[:12]}"
    if path.exists():
        subprocess.run(["git", "worktree", "remove", "--force", str(path)], cwd=root, capture_output=True)
        shutil.rmtree(path, ignore_errors=True)
    path.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(["git", "worktree", "add", "--detach", str(path), merge_base], cwd=root, check=True, capture_output=True)
    return path


# ---------------------------------------------------------------- CLI


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("coverage")
    m = sub.add_parser("measure")
    m.add_argument("--mode", choices=["ir", "wall"], default="ir")
    m.add_argument("--out", type=Path, required=True)
    m.add_argument("--checkout", type=Path, default=ROOT)
    c = sub.add_parser("compare")
    c.add_argument("--base", type=Path, required=True)
    c.add_argument("--head", type=Path, required=True)
    c.add_argument("--report-only", action="store_true")
    ab = sub.add_parser("ab")
    ab.add_argument("--base", default=os.environ.get("NOTER_BASE_REF", "origin/main"))
    ab.add_argument("--mode", choices=["ir", "wall"], default="ir")
    ab.add_argument("--report-only", action="store_true")
    ab.add_argument("--out-dir", type=Path, default=ROOT / "target" / "perf")
    args = ap.parse_args(argv)

    import json

    try:
        cfg = harness_config()
        perf = perf_config()
        gates = cfg["gates"]["perf"]
        runs, warmups = int(gates["wall_runs"]), int(gates["wall_warmups"])
        if args.cmd == "coverage":
            errors, report = coverage(cfg, perf)
        elif args.cmd == "measure":
            dump_json(args.out, measure(args.checkout, perf, args.mode, runs, warmups))
            return 0
        elif args.cmd == "compare":
            base = json.loads(args.base.read_text())
            head = json.loads(args.head.read_text())
            errors, report = compare(base, head, float(gates["max_regression_pct"]), args.report_only)
        else:
            base_dir = make_base_worktree(args.base)
            env_target = os.environ.pop("CARGO_TARGET_DIR", None)
            try:
                base_perf = base_dir / "harness" / "perf.toml"
                expected = set(load_toml(base_perf).get("scenarios", {})) if base_perf.exists() else set()
                base = measure(base_dir, perf, args.mode, runs, warmups, expected=expected)
                head = measure(ROOT, perf, args.mode, runs, warmups)
            finally:
                if env_target:
                    os.environ["CARGO_TARGET_DIR"] = env_target
            dump_json(args.out_dir / f"base-{args.mode}.json", base)
            dump_json(args.out_dir / f"head-{args.mode}.json", head)
            errors, report = compare(base, head, float(gates["max_regression_pct"]), args.report_only)
    except (HarnessError, subprocess.CalledProcessError) as e:
        fail(str(e) + (f"\n{e.stderr}" if isinstance(e, subprocess.CalledProcessError) and e.stderr else ""))
    write_summary(report)
    if errors:
        fail("; ".join(errors))
    return 0


if __name__ == "__main__":
    sys.exit(main())
