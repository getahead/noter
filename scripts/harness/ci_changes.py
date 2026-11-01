#!/usr/bin/env python3
"""Which CI jobs a pull request needs (docs/HARNESS.md › What a pull request runs).

Reads the changed files, matches them against the areas in harness.toml [ci],
and prints, for one workflow, which of its jobs check something this change
can affect. A job no changed file can affect is skipped; the workflow's
aggregator (`gate`, `hygiene`) then accepts it as skipped, and fails if a job
that should have run did not pass.

Fails safe: a file in [ci].everything, or in no area and not in [ci].inert,
runs every job, and so does any run that is not a pull request (a push to
main, the nightly, a dispatch of main). A dispatched run on a PR branch (the
Release PR, the screenshot bot) is filtered like the PR, against its merge
base with main. If the changed files cannot be read, every job runs.

  ci_changes.py --workflow ci --event pull_request          # merge commit HEAD against HEAD^1
  ci_changes.py --workflow ci --event workflow_dispatch --ref lane/ui/x   # HEAD against its merge base with origin/main
  ci_changes.py --workflow ci --files a.ts b.rs             # explain a list of files

With GITHUB_OUTPUT set it writes `jobs` (JSON object job -> bool; for codeql,
language -> analyse it rather than carry main's result forward), and for ci the
facts the macOS and E2E jobs need (`engine`, `tauri`, `core_harness`, `native_tests`), the UI
flows to re-run (`e2e_specs`: "all", the specs of the touched features, or "") and the run of main
whose E2E logs judge the rest (`e2e_baseline`, NOTER_E2E_BASELINE; none means every flow runs).

  ci_changes.py verdict    # in an aggregator: RESULTS=toJSON(needs), EXPECTED=the jobs output

fails unless `changes` succeeded, every job it switched on succeeded, and every
job it switched off was skipped (or passed anyway).
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path

from common import ROOT, HarnessError, fail, harness_config, matches_any, write_summary

ALWAYS = "always"


@dataclass
class Plan:
    workflow: str
    jobs: dict[str, bool]
    reason: str                                   # why everything runs, or "" when filtered
    files: list[str] = field(default_factory=list)
    areas: dict[str, list[str]] = field(default_factory=dict)  # area -> files that switched it on

    def summary(self) -> str:
        on = [j for j, run in self.jobs.items() if run]
        off = [j for j, run in self.jobs.items() if not run]
        rows = [f"### What this change runs ({self.workflow})", ""]
        if self.reason:
            rows.append(f"Every job: {self.reason}.")
        else:
            rows.append(f"{len(self.files)} changed file(s).")
            for area, files in sorted(self.areas.items()):
                more = f" and {len(files) - 3} more" if len(files) > 3 else ""
                rows.append(f"- **{area}**: " + ", ".join(f"`{f}`" for f in files[:3]) + more)
        rows += ["", "Runs: " + (", ".join(f"`{j}`" for j in on) or "nothing"),
                 "Skipped (nothing they check changed): " + (", ".join(f"`{j}`" for j in off) or "none")]
        return "\n".join(rows) + "\n"


def rules(cfg: dict, workflow: str) -> tuple[dict, dict[str, list[str]]]:
    ci = cfg.get("ci")
    if not ci or workflow not in ci.get("jobs", {}):
        raise HarnessError(f"harness.toml has no [ci.jobs.{workflow}]")
    jobs = ci["jobs"][workflow]
    known = set(ci.get("areas", {})) | {ALWAYS}
    for job, areas in jobs.items():
        unknown = [a for a in areas if a not in known]
        if unknown:
            raise HarnessError(f"[ci.jobs.{workflow}] {job}: unknown area(s) {unknown}")
    return ci, jobs


def classify(path: str, ci: dict) -> tuple[list[str] | None, bool]:
    """Areas a file belongs to; None means "everything". The bool says it is inert."""
    if matches_any(path, ci.get("everything", [])):
        return None, False
    areas = [a for a, pats in ci.get("areas", {}).items()
             if matches_any(path, pats) and not matches_any(path, ci.get("except", {}).get(a, []))]
    if areas:
        return areas, False
    if matches_any(path, ci.get("inert", [])):
        return [], True
    return None, False  # unknown: fail safe


def plan(files: list[str] | None, cfg: dict, workflow: str, reason: str = "") -> Plan:
    ci, jobs = rules(cfg, workflow)
    if files is None:
        return Plan(workflow, {j: True for j in jobs}, reason or "not a pull request")
    touched: dict[str, list[str]] = {}
    for f in files:
        areas, _ = classify(f, ci)
        if areas is None:
            why = "a harness file changed" if matches_any(f, ci.get("everything", [])) else "a file no rule knows changed"
            return Plan(workflow, {j: True for j in jobs}, f"{why} (`{f}`)", files)
        for a in areas:
            touched.setdefault(a, []).append(f)
    run = {j: ALWAYS in areas or any(a in touched for a in areas) for j, areas in jobs.items()}
    return Plan(workflow, run, "", files, touched)


@dataclass
class Repo:
    engine: bool
    tauri: bool
    core_harness: bool
    native_tests: bool

    @classmethod
    def at(cls, root: Path) -> "Repo":
        return cls(
            engine=(root / "engine/Package.swift").is_file(),
            tauri=(root / "apps/desktop/src-tauri/Cargo.toml").is_file(),
            core_harness=(root / "crates/noter-core-harness/Cargo.toml").is_file(),
            native_tests=(root / "apps/desktop/tests/native/NoterNativeTests.xcodeproj").is_dir(),
        )


def apply_repo(p: Plan, repo: Repo) -> Plan:
    """ci.yml only: the macOS job needs something to build, and with XCUITests the E2E bar
    is judged over the Linux and the macOS runs together: the XCUITests drive the built app
    (UI and core), so any E2E run brings the macOS run and the judgement with it. A skipped
    real-core run is judged on main's logs (e2e-coverage in ci.yml)."""
    jobs = dict(p.jobs)
    if repo.native_tests and any(jobs.get(j) for j in ("e2e-core", "e2e-ui", "e2e-coverage", "macos")):
        jobs.update({"e2e-coverage": True, "macos": True})
    if not (repo.engine or repo.tauri):
        jobs["macos"] = False
    return Plan(p.workflow, jobs, p.reason, p.files, p.areas)


PLAYWRIGHT = ("rust", "ui", "protocol", "e2e-suites")   # areas whose files can change a UI flow's result
SPEC_DIR = "apps/desktop/tests/e2e/"
NOT_FLOWS = ["apps/desktop/tests/conformance/**", "apps/desktop/tests/visual/**", "apps/desktop/vitest.conformance.config.ts"]


def touched_specs(files: list[str], ci: dict, root: Path = ROOT) -> str:
    """The UI flows a change must re-run: "all", or the space-separated specs (relative to apps/desktop)
    of the features it touches (harness.toml [ci.features]); "" when it touches no flow."""
    every = sorted(p.relative_to(root).as_posix() for p in (root / SPEC_DIR).glob("*.spec.ts"))
    features = ci.get("features", {}).values()
    specs: set[str] = set()
    for f in files:
        areas, _ = classify(f, ci)
        if areas is None:
            return "all"
        if not any(a in PLAYWRIGHT for a in areas) or matches_any(f, NOT_FLOWS):
            continue
        if f.startswith(SPEC_DIR) and f.endswith(".spec.ts"):
            specs.add(f)  # a deleted spec too: nothing runs (--pass-with-no-tests) and main's results for it are dropped
            continue
        owners = [feat for feat in features if matches_any(f, feat["code"])]
        if not owners:
            return "all"
        specs.update(s for feat in owners for s in every if matches_any(s, feat["specs"]))
    return " ".join(sorted(s.removeprefix("apps/desktop/") for s in specs))


def e2e_selection(p: Plan, ci: dict, baseline: str, root: Path = ROOT) -> tuple[Plan, str, str]:
    """ci.yml only: which UI flows run (`e2e_specs`) and which run of main's logs judge the rest
    (`e2e_baseline`). Without a baseline the change runs everything against the real core."""
    jobs = dict(p.jobs)
    if not any(jobs.get(j) for j in ("e2e-core", "e2e-ui", "e2e-coverage")):
        return p, "", ""
    specs = "all" if p.reason else touched_specs(p.files, ci, root)
    if specs == "all" and jobs.get("e2e-core"):
        return p, "all", ""
    if not baseline:
        jobs["e2e-core"] = True
        return Plan(p.workflow, jobs, p.reason, p.files, p.areas), "all", ""
    return p, specs, baseline


def git(*args: str, root: Path = ROOT) -> str:
    out = subprocess.run(["git", *args], cwd=root, capture_output=True, text=True)
    if out.returncode != 0:
        raise HarnessError(f"git {' '.join(args)}: {out.stderr.strip()}")
    return out.stdout


def changed_files(event: str, ref: str, base_ref: str, root: Path = ROOT) -> tuple[list[str] | None, str]:
    """Files the run's change touches, or None (with the reason) when every job must run."""
    if event == "pull_request":
        # actions/checkout checks out refs/pull/N/merge: its first parent is main as merged.
        parents = git("rev-list", "--parents", "-n", "1", "HEAD", root=root).split()
        if len(parents) != 3:
            return None, "the checkout is not the pull request's merge commit"
        old, new = parents[1], "HEAD"
    elif event == "workflow_dispatch" and ref and ref != "main":
        old, new = git("merge-base", base_ref, "HEAD", root=root).strip(), "HEAD"
    else:
        return None, f"a {event or 'local'} run{' of ' + ref if ref else ''} checks everything"
    out = git("diff", "--name-only", "--no-renames", old, new, root=root)
    return [line for line in out.splitlines() if line.strip()], ""


def verdict(needs: dict, expected_json: str) -> list[str]:
    """Errors of an aggregator job (`gate`, `hygiene`) over its `needs` results."""
    needs = dict(needs)
    changes = needs.pop("changes", {"result": "missing"})
    if changes.get("result") != "success":
        return [f"changes: {changes.get('result')}: could not tell which jobs this change needs"]
    try:
        expected = json.loads(expected_json)
    except (TypeError, ValueError):
        return ["changes: its jobs output is not JSON"]
    errors = []
    if set(expected) != set(needs):
        errors.append(f"the changes job and the aggregator list different jobs: {sorted(set(expected) ^ set(needs))}")
    for job in sorted(needs):
        result = needs[job].get("result")
        if expected.get(job, True):
            if result != "success":
                errors.append(f"{job}: {result}")
        elif result not in ("skipped", "success"):
            errors.append(f"{job}: {result}")
    return errors


def main(argv: list[str] | None = None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    if argv[:1] == ["verdict"]:
        errors = verdict(json.loads(os.environ.get("RESULTS") or "{}"), os.environ.get("EXPECTED", ""))
        for e in errors:
            print(f"::error::{e}")
        return 1 if errors else 0
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--workflow", required=True, choices=["ci", "hygiene", "codeql"])
    ap.add_argument("--event", default=os.environ.get("GITHUB_EVENT_NAME", ""))
    ap.add_argument("--ref", default=os.environ.get("GITHUB_REF_NAME", ""))
    ap.add_argument("--base", default=os.environ.get("NOTER_BASE_REF", "origin/main"))
    ap.add_argument("--files", nargs="*", help="explain these files instead of reading git")
    ap.add_argument("--baseline", default=os.environ.get("NOTER_E2E_BASELINE", ""),
                    help="id of main's latest successful CI run, whose E2E logs judge the flows not re-run")
    args = ap.parse_args(argv)
    try:
        cfg = harness_config()
        if args.files is not None:
            files, reason = args.files, ""
        else:
            try:
                files, reason = changed_files(args.event, args.ref, args.base)
            except HarnessError as e:
                files, reason = None, f"the changed files could not be read ({e})"
        p = plan(files, cfg, args.workflow, reason)
        repo = Repo.at(ROOT)
        specs = baseline = ""
        if args.workflow == "ci":
            # Explaining a list of files assumes main has a run to take the logs from.
            p, specs, baseline = e2e_selection(apply_repo(p, repo), cfg["ci"], args.baseline or ("main" if args.files is not None else ""))
    except HarnessError as e:
        return fail(str(e))
    flows = "" if args.workflow != "ci" or not any(p.jobs.get(j) for j in ("e2e-core", "e2e-ui", "e2e-coverage")) else (
        f"\nUI flows re-run: {'every spec' if specs == 'all' else specs or 'none'}"
        + (f"; the rest judged on main's logs (run {baseline})" if baseline else "") + "\n")
    write_summary(p.summary() + flows)
    out = os.environ.get("GITHUB_OUTPUT")
    if out:
        with open(out, "a", encoding="utf-8") as f:
            f.write(f"jobs={json.dumps(p.jobs, separators=(',', ':'))}\n")
            if args.workflow == "ci":
                for k, v in vars(repo).items():
                    f.write(f"{k}={'true' if v else 'false'}\n")
                f.write(f"e2e_specs={specs}\ne2e_baseline={baseline}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
