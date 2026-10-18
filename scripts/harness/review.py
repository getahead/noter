#!/usr/bin/env python3
"""Self-review gate: no pull request merges before its author's review passes.

The agent that delivers a pull request reviews it with Constructor Studio
(`/cf-sdlc-pr-review <N>`, which writes .prs/<N>/review.md), then publishes
the verdict (docs/HARNESS.md › The agent loop):

    just review-publish [N]

`publish` refuses a review that does not cover the PR as it is now (the
reviewed diff must equal the PR's current diff, the checkout must be the
pushed PR head with nothing uncommitted). It posts or updates one PR comment
with the review and a marker naming the head commit, a fingerprint of the
reviewed diff and the verdict, and,
when the verdict passes, turns on auto-merge (squash). Exit 0: passed.
Exit 1: changes requested, so fix the blocking findings, push, review again.
Exit 2: nothing was published (see the message).

`evaluate` runs in CI (.github/workflows/review.yml): it reads that comment
and sets the commit status `review` on the PR head. Success only for a
passing verdict on that commit or on one with the same diff (an "Update branch"
from main keeps the review; any change to the PR's own changes does not),
posted by someone with write access. The `Default ruleset` requires `review`.

`stop_check` is used by the Claude Code Stop hook (stop_gate.py): while the
branch's open PR has no passing review for its head, the agent keeps working.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

from common import ROOT

CONTEXT = "review"
MARKER_RE = re.compile(r"<!--\s*noter-self-review\s+head=([0-9a-f]{40})\s+verdict=(APPROVE|COMMENT|REQUEST_CHANGES)\s*-->")
# A separate comment, so an evaluator that predates fingerprints still reads the marker above.
DIFF_MARKER_RE = re.compile(r"<!--\s*noter-self-review-diff\s+([0-9a-f]{64})\s*-->")
VERDICT_RE = re.compile(r"^##\s*Verdict:\s*(?:\S+\s+)?(APPROVE|REQUEST CHANGES|COMMENT)\b", re.MULTILINE)
PASSING = ("APPROVE", "COMMENT")
WRITERS = ("OWNER", "MEMBER", "COLLABORATOR")
# PRs no agent delivered: Dependabot updates and the release-please Release PR.
# They still need gate, hygiene and CodeQL.
BOT_AUTHORS = ("dependabot[bot]", "github-actions[bot]")
BOT_BRANCH_PREFIXES = ("release-please--", "dependabot/")
COMMENT_LIMIT = 60000
GH_TIMEOUT_S = 30


@dataclass(frozen=True)
class Status:
    state: str  # success | failure | pending
    description: str
    target_url: str = ""


# ── pure logic (unit-tested) ──────────────────────────────────────────


def parse_verdict(review_md: str) -> str | None:
    """APPROVE, COMMENT or REQUEST_CHANGES from the template's `## Verdict:` line."""
    m = VERDICT_RE.search(review_md)
    return m.group(1).replace(" ", "_") if m else None


def diff_fingerprint(diff: str) -> str:
    """Identity of a PR's changes: its diff without blob IDs (`index …` lines) or trailing spaces.

    Updating the branch from main leaves it unchanged unless the PR's own changes or their
    context move, so a review stays valid across "Update branch" but not across a real change.
    """
    lines = [line.rstrip() for line in diff.strip().splitlines() if not line.startswith("index ")]
    return hashlib.sha256("\n".join(lines).encode()).hexdigest()


def marker(head: str, verdict: str, diff: str = "") -> str:
    fp = f"\n<!-- noter-self-review-diff {diff_fingerprint(diff)} -->" if diff else ""
    return f"<!-- noter-self-review head={head} verdict={verdict} -->{fp}"


def comment_body(review_md: str, head: str, verdict: str, diff: str = "") -> str:
    text = review_md.strip()
    if len(text) > COMMENT_LIMIT:
        text = text[:COMMENT_LIMIT] + "\n\n… (truncated; the full review is in the author's .prs/ folder)"
    return (
        f"{marker(head, verdict, diff)}\n"
        f"**Self-review** (Constructor Studio `cf-sdlc-pr-review`) of `{head[:12]}`. "
        "Merging needs a passing verdict on the PR's current changes; any change to them needs a new review.\n\n"
        f"{text}\n"
    )


def blocking_findings(review_md: str) -> str:
    """The 'Minimum (blocking)' part of the Recommendation section, for the Stop hook message."""
    m = re.search(r"\*\*Minimum\*\*.*?(?=\n\s*\d+\.\s*\*\*Recommended|\n## |\Z)", review_md, re.S)
    return m.group(0).strip() if m else ""


def evaluate(pr: dict, comments: list[dict], diff: str = "") -> Status:
    """The `review` status for the PR head, from the PR, its issue comments (GitHub REST shapes)
    and its current diff: a review counts for the head it names, or for any head with the same diff."""
    head = pr["head"]["sha"]
    short = head[:7]
    n = pr["number"]
    if pr["user"]["login"] in BOT_AUTHORS or pr["head"]["ref"].startswith(BOT_BRANCH_PREFIXES):
        return Status("success", "Bot PR, no delivering agent: gate, hygiene and CodeQL apply")
    fp = diff_fingerprint(diff) if diff else None
    found = []
    for c in comments:
        body = c.get("body") or ""
        m, d = MARKER_RE.search(body), DIFF_MARKER_RE.search(body)
        same_diff = bool(fp and d and d.group(1) == fp)
        if m and (m.group(1) == head or same_diff) and c.get("author_association") in WRITERS:
            found.append((c.get("updated_at") or "", m.group(2), c))
    if not found:
        return Status("pending", f"Self-review missing for {short}: /cf-sdlc-pr-review {n}, then just review-publish {n}")
    _, verdict, c = max(found, key=lambda t: t[0])
    url = c.get("html_url", "")
    if parse_verdict(c.get("body") or "") != verdict:
        return Status("failure", f"Self-review comment for {short} is inconsistent: its Verdict line and marker disagree", url)
    if verdict in PASSING:
        return Status("success", f"Self-review {verdict} at {short}", url)
    return Status("failure", f"Self-review requests changes at {short}: fix, push, review again", url)


# ── GitHub and git helpers ────────────────────────────────────────────


class Unavailable(Exception):
    """gh or git could not answer (offline, signed out, no PR)."""


def _run(cmd: list[str], *, stdin: str | None = None) -> str:
    try:
        p = subprocess.run(cmd, cwd=ROOT, input=stdin, capture_output=True, text=True, timeout=GH_TIMEOUT_S)
    except (OSError, subprocess.TimeoutExpired) as e:
        raise Unavailable(f"{cmd[0]}: {e}") from e
    if p.returncode != 0:
        raise Unavailable(f"{' '.join(cmd[:3])}: {p.stderr.strip()[:300]}")
    return p.stdout


def _gh_json(*args: str) -> object:
    out = _run(["gh", *args])
    try:
        return json.loads(out or "null")
    except ValueError as e:
        raise Unavailable(f"gh {' '.join(args[:2])}: not JSON ({e})") from e


def _gh_text(*args: str) -> str:
    """A `gh … -q <jq>` answer that is a plain string, not JSON."""
    return _run(["gh", *args]).strip()


def _repo() -> str:
    return os.environ.get("GITHUB_REPOSITORY") or _gh_text("repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner")


def _issue_comments(repo: str, n: int) -> list[dict]:
    pages = _run(["gh", "api", f"repos/{repo}/issues/{n}/comments", "--paginate", "--slurp"])
    return [c for page in json.loads(pages) for c in page]


def _state_dir() -> Path:
    d = Path(_run(["git", "rev-parse", "--git-path", "noter-harness"]).strip())
    d = d if d.is_absolute() else ROOT / d
    d.mkdir(parents=True, exist_ok=True)
    return d


def _pr_diff(repo: str, n: int) -> str:
    """The PR's diff, or "" when GitHub will not serve it (too large): then only the head counts."""
    try:
        return _run(["gh", "api", f"repos/{repo}/pulls/{n}", "-H", "Accept: application/vnd.github.diff"])
    except Unavailable as e:
        print(f"PR #{n}: no diff from GitHub ({e}); matching reviews by head commit only.", file=sys.stderr)
        return ""


# ── commands ──────────────────────────────────────────────────────────


def publish(pr_arg: str | None, auto_merge: bool) -> int:
    try:
        view = ["pr", "view"] + ([pr_arg] if pr_arg else []) + ["--json", "number,state,headRefOid,url"]
        pr = _gh_json(*view)
        n, head = pr["number"], pr["headRefOid"]
        if pr["state"] != "OPEN":
            print(f"PR #{n} is {pr['state'].lower()}; nothing to review.", file=sys.stderr)
            return 2
        local = _run(["git", "rev-parse", "HEAD"]).strip()
        dirty = _run(["git", "status", "--porcelain"]).strip()
        if dirty or local != head:
            print(f"Commit and push first: the PR head is {head[:12]}, your checkout is {local[:12]}"
                  f"{' with uncommitted changes' if dirty else ''}. Then review again.", file=sys.stderr)
            return 2
        pr_dir = ROOT / ".prs" / str(n)
        review_path, diff_path = pr_dir / "review.md", pr_dir / "diff.patch"
        if not review_path.exists() or not diff_path.exists():
            print(f"No review yet: run /cf-sdlc-pr-review {n} (it writes .prs/{n}/review.md).", file=sys.stderr)
            return 2
        reviewed = diff_path.read_text(encoding="utf-8")
        if diff_fingerprint(reviewed) != diff_fingerprint(_run(["gh", "pr", "diff", str(n)])):
            print(f"The review covers an older diff of PR #{n}. Review it again: /cf-sdlc-pr-review {n}.", file=sys.stderr)
            return 2
        if review_path.stat().st_mtime < diff_path.stat().st_mtime:
            print(f".prs/{n}/review.md is older than the diff it should review. Finish /cf-sdlc-pr-review {n}.", file=sys.stderr)
            return 2
        review_md = review_path.read_text(encoding="utf-8")
        verdict = parse_verdict(review_md)
        if verdict is None:
            print(f".prs/{n}/review.md has no '## Verdict: APPROVE | REQUEST CHANGES | COMMENT' line (PR-CODE-REVIEW-TEMPLATE).", file=sys.stderr)
            return 2
        repo = _repo()
        me = _gh_text("api", "user", "-q", ".login")
        body = json.dumps({"body": comment_body(review_md, head, verdict, reviewed)})
        mine = [c for c in _issue_comments(repo, n) if c["user"]["login"] == me and MARKER_RE.search(c.get("body") or "")]
        if mine:
            _run(["gh", "api", "-X", "PATCH", f"repos/{repo}/issues/comments/{mine[-1]['id']}", "--input", "-"], stdin=body)
        else:
            _run(["gh", "api", "-X", "POST", f"repos/{repo}/issues/{n}/comments", "--input", "-"], stdin=body)
        (_state_dir() / "review-published").write_text(f"{head} {verdict}\n")
        if verdict not in PASSING:
            print(f"Self-review of PR #{n} requests changes. Fix the blocking findings in .prs/{n}/review.md, "
                  f"push, run /cf-sdlc-pr-review {n} again and publish again.")
            findings = blocking_findings(review_md)
            if findings:
                print("\n" + findings)
            return 1
        print(f"Self-review {verdict} published for PR #{n} at {head[:12]}; CI sets the `review` status.")
        if auto_merge:
            enable_auto_merge(n)
        return 0
    except Unavailable as e:
        print(f"Could not publish the review: {e}", file=sys.stderr)
        return 2


def enable_auto_merge(n: int) -> bool:
    """Best effort: the review is already published, so a refusal (draft PR, auto-merge off) only warns."""
    try:
        _run(["gh", "pr", "merge", str(n), "--auto", "--squash"])
    except Unavailable as e:
        print(f"Warning: could not turn on auto-merge for PR #{n} ({e}). "
              f"Run `gh pr merge {n} --auto --squash` once the PR allows it.", file=sys.stderr)
        return False
    print("Auto-merge (squash) is on: GitHub merges once gate, hygiene, CodeQL and review pass.")
    return True


def evaluate_cmd(n: int, set_status: bool) -> int:
    repo = _repo()
    pr = _gh_json("api", f"repos/{repo}/pulls/{n}")
    if pr["state"] != "open":
        print(f"PR #{n} is {pr['state']}; no status set.")
        return 0
    status = evaluate(pr, _issue_comments(repo, n), _pr_diff(repo, n))
    print(json.dumps({"sha": pr["head"]["sha"], **status.__dict__}))
    if set_status:
        target = status.target_url or os.environ.get("RUN_URL", "")
        args = ["gh", "api", "-X", "POST", f"repos/{repo}/statuses/{pr['head']['sha']}",
                "-f", f"state={status.state}", "-f", f"context={CONTEXT}", "-f", f"description={status.description[:140]}"]
        if target:
            args += ["-f", f"target_url={target}"]
        _run(args)
    return 0


def stop_check() -> str | None:
    """A message that keeps the agent working, or None. Never raises; offline means no opinion."""
    try:
        branch = _run(["git", "rev-parse", "--abbrev-ref", "HEAD"]).strip()
        if branch in ("main", "HEAD"):
            return None
        pr = _gh_json("pr", "view", "--json", "number,state,headRefOid,autoMergeRequest")
        if not pr or pr.get("state") != "OPEN":
            return None
        n, head = pr["number"], pr["headRefOid"]
        local = _run(["git", "rev-parse", "HEAD"]).strip()
        if local != head or _run(["git", "status", "--porcelain"]).strip():
            return (f"PR #{n} does not contain your latest work. Commit and push, then self-review: "
                    f"/cf-sdlc-pr-review {n}, and `just review-publish {n}`.")
        statuses = _gh_json("api", f"repos/{_repo()}/commits/{head}/status", "-q", ".statuses") or []
        mine = [s for s in statuses if s.get("context") == CONTEXT]
        state = mine[0]["state"] if mine else "missing"
        published = _state_dir() / "review-published"
        just_published = published.exists() and published.read_text().split()[:1] == [head]
        if state == "success" or (state in ("pending", "missing") and just_published
                                  and published.read_text().split()[1] in PASSING):
            if not pr.get("autoMergeRequest"):
                return f"Self-review of PR #{n} passed; turn on auto-merge: `gh pr merge {n} --auto --squash`."
            return None
        if state == "failure":
            review = ROOT / ".prs" / str(n) / "review.md"
            findings = blocking_findings(review.read_text(encoding="utf-8")) if review.exists() else ""
            return (f"The self-review of PR #{n} requests changes. Fix the blocking findings, push, review again "
                    f"(/cf-sdlc-pr-review {n}) and `just review-publish {n}`.\n\n{findings}").strip()
        return (f"PR #{n} has no passing self-review for {head[:12]}. Run /cf-sdlc-pr-review {n}, fix what it "
                f"blocks on, then `just review-publish {n}` (it also turns on auto-merge).")
    except (Unavailable, KeyError, IndexError, ValueError, TypeError):
        return None


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("publish", help="publish .prs/<N>/review.md for the PR of this branch (or N)")
    p.add_argument("pr", nargs="?")
    p.add_argument("--no-auto-merge", action="store_true")
    e = sub.add_parser("evaluate", help="CI: compute (and set) the `review` status of PR N")
    e.add_argument("pr", type=int)
    e.add_argument("--set-status", action="store_true")
    args = ap.parse_args(argv)
    if args.cmd == "publish":
        return publish(args.pr or None, not args.no_auto_merge)
    return evaluate_cmd(args.pr, args.set_status)


if __name__ == "__main__":
    raise SystemExit(main())
