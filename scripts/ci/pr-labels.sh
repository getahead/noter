#!/usr/bin/env bash
# Print the labels of the pull request this run belongs to (comma separated).
# Read live from the API first, so a re-run sees a label added after the
# original event (an owner's harness-change-approved, say); the event's labels
# are only the fallback. On a workflow_dispatch of a PR branch (e.g. after the
# update-screenshots bot commit) the PR is looked up by branch, so label-gated
# checks cannot be skipped by dispatching CI instead.
set -euo pipefail
api() { curl -fsS -H "Authorization: Bearer ${GH_TOKEN}" -H "Accept: application/vnd.github+json" "$@"; }
names() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);const l=Array.isArray(j)?j:[];console.log(l.map(x=>x.name).join(","))})'; }

pr=""
if [ -n "${GITHUB_EVENT_PATH:-}" ] && [ -f "${GITHUB_EVENT_PATH}" ]; then
  pr=$(node -e 'const e=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log((e.pull_request&&e.pull_request.number)||"")' "$GITHUB_EVENT_PATH" 2>/dev/null || true)
fi
if [ -n "$pr" ] && [ -n "${GH_TOKEN:-}" ]; then
  if live=$(api "https://api.github.com/repos/${GITHUB_REPOSITORY}/issues/${pr}/labels?per_page=100" | names); then
    echo "$live"; exit 0
  fi
fi
if [ -n "${EVENT_LABELS:-}" ] || [ "${GITHUB_EVENT_NAME:-}" = "pull_request" ]; then
  echo "${EVENT_LABELS:-}"; exit 0
fi
branch="${GITHUB_REF_NAME:-}"
if [ -z "$branch" ] || [ "$branch" = "main" ]; then echo ""; exit 0; fi
owner="${GITHUB_REPOSITORY%%/*}"
api "https://api.github.com/repos/${GITHUB_REPOSITORY}/pulls?state=open&head=${owner}:${branch}" |
  node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const p=JSON.parse(s)[0];console.log(p?p.labels.map(l=>l.name).join(","):"")})'
