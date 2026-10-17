#!/usr/bin/env bash
# One-time GitHub setup for the quality gates (docs/HARNESS.md › CI). Run from
# the owner's Mac after the first push of the CI workflows:
#
#   scripts/ci/protect-main.sh            # uses the repo of the `origin` remote
#
# Needs the GitHub CLI signed in with admin rights on the repository. Branch
# protection on a private repository needs a paid GitHub plan (Pro, Team or
# Enterprise); on the free plan GitHub refuses the call and says so.
set -euo pipefail
repo=$(gh repo view --json nameWithOwner -q .nameWithOwner)
echo "Configuring $repo"

# Labels the gates read.
gh label create harness-change-approved --repo "$repo" --color B60205 --force \
  --description "Owner approves loosening a quality gate (harness/*.toml)"
gh label create visual-change-approved --repo "$repo" --color FBCA04 --force \
  --description "Owner reviewed and accepts changed screenshot baselines"
gh label create update-screenshots --repo "$repo" --color 0E8A16 --force \
  --description "Bot: re-render screenshot baselines for this PR"

# main: only through pull requests whose `gate` check passed on the latest commit.
gh api -X PUT "repos/$repo/branches/main/protection" --input - <<'JSON'
{
  "required_status_checks": { "strict": true, "contexts": ["gate"] },
  "enforce_admins": true,
  "required_pull_request_reviews": null,
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "required_conversation_resolution": true
}
JSON
echo "main now requires the 'gate' check on an up-to-date branch; direct pushes are refused."
