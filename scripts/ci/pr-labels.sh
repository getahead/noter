#!/usr/bin/env bash
# Print the labels of the pull request this run belongs to (comma separated).
# On pull_request events they come from the event; on a workflow_dispatch of a
# PR branch (e.g. after the update-screenshots bot commit) they are looked up,
# so label-gated checks cannot be skipped by dispatching CI instead.
set -euo pipefail
if [ -n "${EVENT_LABELS:-}" ] || [ "${GITHUB_EVENT_NAME:-}" = "pull_request" ]; then
  echo "${EVENT_LABELS:-}"; exit 0
fi
branch="${GITHUB_REF_NAME:-}"
if [ -z "$branch" ] || [ "$branch" = "main" ]; then echo ""; exit 0; fi
owner="${GITHUB_REPOSITORY%%/*}"
curl -fsS -H "Authorization: Bearer ${GH_TOKEN}" -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/${GITHUB_REPOSITORY}/pulls?state=open&head=${owner}:${branch}" |
  node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const p=JSON.parse(s)[0];console.log(p?p.labels.map(l=>l.name).join(","):"")})'
