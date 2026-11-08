#!/usr/bin/env python3
"""Make every retried XCUITest visible (owner, 8 Nov: a retried test is a flaky test).

`just native` retries a failed test up to twice, so a flake leaves a green job and no trace.

* detect:   reads coverage/native/xcuitest-results.json, writes the Test Cases that ran again
            (a Repetition that did not pass, or more than one) to coverage/native/retried.json
            and prints a GitHub warning annotation each. Never changes the job's result.
* register: on main only (ci.yml), opens an issue `flaky: <test id>` labelled `flaky`, or comments
            the run link on the open one. The issues are the registry (docs/FLAKY.md).
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
from pathlib import Path

from common import ROOT

RESULTS = ROOT / "coverage/native/xcuitest-results.json"
RETRIED = ROOT / "coverage/native/retried.json"


def _failures(node: dict) -> list[str]:
    own = [node.get("name", "")] if node.get("nodeType") == "Failure Message" else []
    return own + [t for c in node.get("children", []) for t in _failures(c)]


def retried(results: dict) -> list[dict]:
    found: list[dict] = []

    def walk(nodes: list[dict]) -> None:
        for n in nodes:
            if n.get("nodeType") != "Test Case":
                walk(n.get("children", []))
                continue
            reps = [c for c in n.get("children", []) if c.get("nodeType") == "Repetition"]
            if len(reps) > 1 or any(r.get("result") != "Passed" for r in reps):
                found.append({"id": n.get("nodeIdentifier") or n.get("name", "?"), "attempts": len(reps),
                              "failures": [t for r in reps if r.get("result") != "Passed" for t in _failures(r)]})

    walk(results.get("testNodes", []))
    return found


def detect(src: Path = RESULTS, out: Path = RETRIED) -> None:
    entries = retried(json.loads(src.read_text(encoding="utf-8"))) if src.exists() else []
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(entries, indent=2), encoding="utf-8")
    for e in entries:
        msg = f"{e['id']} ran {e['attempts']} times: " + (" | ".join(e["failures"]) or "no failure text")
        # A workflow command ends at a newline: escape it as GitHub documents.
        print("::warning title=Flaky XCUITest (retried)::" + msg.replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A"))


def _gh(*args: str) -> str:
    return subprocess.run(["gh", *args], check=True, capture_output=True, text=True).stdout


def register(entries: list[dict], run_url: str, gh=_gh) -> None:
    if not entries:
        return
    try:
        gh("label", "create", "flaky", "--color", "d93f0b", "--description", "Passed only on a retry or failed intermittently")
    except subprocess.CalledProcessError:
        pass  # already exists
    for e in entries:
        title = f"flaky: {e['id']}"
        body = f"Retried in {run_url}: {e['attempts']} attempts.\n\n```\n" + "\n---\n".join(e["failures"])[:2000] + "\n```"
        open_ = json.loads(gh("issue", "list", "--state", "open", "--label", "flaky", "--search", f'"{title}" in:title',
                              "--json", "number,title", "--limit", "50"))
        match = [i for i in open_ if i["title"] == title]
        if match:
            gh("issue", "comment", str(match[0]["number"]), "--body", body)
        else:
            gh("issue", "create", "--title", title, "--label", "flaky", "--body", body)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("action", choices=["detect", "register"])
    if ap.parse_args().action == "detect":
        detect()
        return
    run = f"{os.environ['GITHUB_SERVER_URL']}/{os.environ['GITHUB_REPOSITORY']}/actions/runs/{os.environ['GITHUB_RUN_ID']}"
    register(json.loads(RETRIED.read_text(encoding="utf-8")) if RETRIED.exists() else [], run)


if __name__ == "__main__":
    main()
