#!/usr/bin/env bash
# GitHub settings for Noter's continuous delivery (docs/DELIVERY.md). Idempotent:
# run it again after changing a ruleset in .github/rulesets/ or anything below.
#
#   scripts/ci/github-setup.sh            # apply to the repo of the `origin` remote
#   scripts/ci/github-setup.sh --dry-run  # print what would change
#
# Needs the GitHub CLI signed in with admin rights on the repository. It
# replaces the classic branch protection on main (scripts/ci/protect-main.sh,
# removed) with repository rulesets, which are versioned in .github/rulesets/.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

dry=false
[ "${1:-}" = "--dry-run" ] && dry=true
repo=$(gh repo view --json nameWithOwner -q .nameWithOwner)
echo "Configuring $repo$($dry && echo ' (dry run)')"

run() {  # run a gh call, or print it in dry-run mode
  if $dry; then printf '  would run: gh %s\n' "$*"; else gh "$@" >/dev/null; fi
}
try() {  # same, but a refusal (plan, feature not available) is a warning, not a failure
  if $dry; then printf '  would run: gh %s\n' "$*"; return 0; fi
  gh "$@" >/dev/null 2>&1 || echo "  ! skipped (GitHub refused): gh $*"
}

echo "• Merging: squash only, PR title as the commit subject, auto-merge, branches deleted after merge"
run api -X PATCH "repos/$repo" \
  -F allow_squash_merge=true -F allow_merge_commit=false -F allow_rebase_merge=false \
  -f squash_merge_commit_title=PR_TITLE -f squash_merge_commit_message=PR_BODY \
  -F allow_auto_merge=true -F allow_update_branch=true -F delete_branch_on_merge=true

echo "• Security: Dependabot alerts and security updates, secret scanning with push protection, private vulnerability reporting"
try api -X PUT "repos/$repo/vulnerability-alerts"
try api -X PUT "repos/$repo/automated-security-fixes"
try api -X PUT "repos/$repo/private-vulnerability-reporting"
try api -X PATCH "repos/$repo" --input - <<'JSON'
{"security_and_analysis": {
  "secret_scanning": {"status": "enabled"},
  "secret_scanning_push_protection": {"status": "enabled"},
  "secret_scanning_non_provider_patterns": {"status": "enabled"}
}}
JSON

echo "• Actions: read-only GITHUB_TOKEN by default, actions pinned to a full commit SHA"
# can_approve_pull_request_reviews also lets release-please open its Release PR with GITHUB_TOKEN.
# No ruleset requires approvals, so it grants nothing more.
run api -X PUT "repos/$repo/actions/permissions/workflow" \
  -f default_workflow_permissions=read -F can_approve_pull_request_reviews=true
try api -X PUT "repos/$repo/actions/permissions" -F enabled=true -f allowed_actions=all -F sha_pinning_required=true

# A self-hosted runner (the Mac, label `noter`) serves this public repository: a workflow from
# anyone outside the repository runs only after the owner approves it.
try api -X PUT "repos/$repo/actions/permissions/fork-pr-contributor-approval" -f approval_policy=all_external_contributors

echo "• Labels"
label() { run label create "$1" --repo "$repo" --color "$2" --description "$3" --force; }
label harness-change-approved B60205 "Owner approves loosening a quality gate or changing the harness"
label visual-change-approved FBCA04 "Owner reviewed and accepts changed screenshot baselines"
label update-screenshots 0E8A16 "Bot: re-render screenshot baselines for this PR"
label build-preview 1D76DB "Build the macOS app for this PR and attach it to the run"
label dependencies 0366D6 "Dependency updates (Dependabot)"

echo "• Rulesets (.github/rulesets/*.json)"
existing=$(gh api "repos/$repo/rulesets?includes_parents=false" --jq '.[] | "\(.id)\t\(.name)"')
for f in .github/rulesets/*.json; do
  name=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["name"])' "$f")
  id=$(printf '%s\n' "$existing" | awk -F'\t' -v n="$name" '$2 == n {print $1; exit}')
  if [ -n "$id" ]; then
    echo "  update '$name' (#$id) from $f"
    run api -X PUT "repos/$repo/rulesets/$id" --input "$f"
  else
    echo "  create '$name' from $f"
    run api -X POST "repos/$repo/rulesets" --input "$f"
  fi
done

echo "• Classic branch protection on main (superseded by the 'Default ruleset')"
if gh api "repos/$repo/branches/main/protection" >/dev/null 2>&1; then
  run api -X DELETE "repos/$repo/branches/main/protection"
  $dry || echo "  removed"
else
  echo "  none"
fi

echo "• Optional secrets (names only; values are never read)"
have=$(gh secret list --repo "$repo" --json name -q '.[].name' 2>/dev/null || true)
for s in CF_STUDIO_TOKEN \
         APPLE_CERTIFICATE APPLE_CERTIFICATE_PASSWORD APPLE_SIGNING_IDENTITY APPLE_ID APPLE_PASSWORD APPLE_TEAM_ID \
         TAURI_SIGNING_PRIVATE_KEY TAURI_SIGNING_PRIVATE_KEY_PASSWORD; do
  if printf '%s\n' "$have" | grep -qx "$s"; then echo "  ✓ $s"; else echo "  - $s (not set; see docs/DELIVERY.md)"; fi
done
echo "Done."
