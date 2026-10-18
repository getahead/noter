# Noter delivery — from a merged pull request to an installed app

[HARNESS.md](HARNESS.md) decides whether a change is good enough (`just gate`). This page covers everything around it: how `main` is protected, what else a pull request is checked for, how dependencies stay current, how the app is packaged, and how a release reaches users.

## The flow

1. Work happens on a branch (`lane/<lane>/<topic>` for agents) and goes to `main` only through a pull request.
2. The PR title is a Conventional Commit (`feat(ui): show the speaker split`). It becomes the squash commit on `main` and the changelog line.
3. Required to merge: `gate` (the harness, `ci.yml`), `hygiene` (`pr.yml`), `review` (the delivering agent's Constructor Studio self-review, `review.yml`) and CodeQL with no new error-level or high/critical security alert. The branch must be up to date with `main`, and review threads resolved. No approving GitHub review is required: the owner and the agents work under one account. The agent self-reviews with `/cf-sdlc-pr-review <N>`, fixes and repeats until the verdict passes, and `just review-publish <N>` turns on auto-merge, so GitHub merges when everything is green (HARNESS.md › The agent loop).
4. Every commit on `main` builds a preview DMG (`preview.yml`) once the app exists.
5. release-please keeps a Release PR open with the next version and its changelog. Merging it tags `vX.Y.Z`, creates the GitHub release and attaches the signed (or ad-hoc signed) DMG, the updater archive and `latest.json`, the contracts bundle and an SBOM, each with build provenance.

## Rules on GitHub

The rulesets are files in `.github/rulesets/`; `scripts/ci/github-setup.sh` applies them (idempotent, `--dry-run` shows the plan). Change the file, run the script; nobody edits rules in the GitHub UI.

| Ruleset | Applies to | Rules |
| --- | --- | --- |
| `Default ruleset` | the default branch (`main`) | no deletion, no force push, linear history; changes only through a pull request, squash merge only, conversations resolved; required checks `gate`, `hygiene` and `review` on an up-to-date branch; CodeQL: no new error-level alerts and no new high or critical security alerts. No bypass, admins included |
| `Release tags` | tags `v*` | a release tag cannot be deleted, moved or force-updated |

The same script sets: squash merge only with the PR title and body as the commit; auto-merge, "update branch" and deleting merged branches on; Dependabot alerts and security updates, secret scanning with push protection, private vulnerability reporting; `GITHUB_TOKEN` read-only by default and every action pinned to a full commit SHA (Actions policy); the labels the workflows read. It removes the classic branch protection that `protect-main.sh` used to create, since the ruleset replaces it.

## Checks besides the gate

| Workflow | When | What |
| --- | --- | --- |
| `pr.yml` → `hygiene` | every PR, and when its title changes | PR title is a Conventional Commit; dependency review (fails on a new dependency with a high or critical advisory or a GPL/AGPL/SSPL license); `cargo deny check licenses bans sources` (`deny.toml`); workflow lint with actionlint and zizmor |
| `codeql.yml` | every PR, `main`, weekly | CodeQL for Rust, TypeScript and the workflows themselves (`security-and-quality` queries) |
| `security.yml` | nightly, and when a lockfile changes on `main` | known advisories against `Cargo.lock` (cargo-deny) and `pnpm-lock.yaml` (`pnpm audit`, high and above). A failure mails the owner and blocks nothing, so a new advisory never turns an unrelated PR red |
| `review.yml` → `review` | every push to a PR, and every self-review comment | sets the commit status `review` on the PR head from the delivering agent's published `cf-sdlc-pr-review` verdict: success for `APPROVE` or `COMMENT` on that commit or on one with the same diff, posted by someone with write access; pending until then; Dependabot and release-please PRs pass by themselves. The evaluator runs from `main`, never from the PR |
| `scorecard.yml` | weekly and on `main` | OpenSSF Scorecard of the repository's practices, published to code scanning |

Every action in every workflow is pinned to a commit SHA with the version in a comment, checkouts do not keep credentials unless the job pushes, and jobs get only the permissions they use. zizmor enforces this on every PR; `.github/zizmor.yml` lists the one rule switched off and why.

## Dependencies

Dependabot (`.github/dependabot.yml`) opens grouped PRs every Monday at 06:00 Berlin time for Cargo, npm (pnpm workspace) and GitHub Actions, after a 7-day cooldown so a compromised release has time to be pulled first. Major versions come one PR per dependency. Not updated automatically, on purpose: `specta*` (pinned RC, ADR-0001), `@playwright/test` (moves with the pinned container and the screenshot baselines: bump the image in `justfile` and `ci.yml`, run `just visual-update`), and the Rust toolchain (`rust-toolchain.toml`, its own PR).

Action updates touch `.github/`, which is harness: the config guard fails them until the owner adds `harness-change-approved`. Dependabot security updates arrive whenever an advisory appears, outside the weekly schedule.

## Packages

`package-macos.yml` builds the app for Apple Silicon with the Tauri CLI (`pnpm --dir apps/desktop exec tauri build`), producing `Noter_<version>_aarch64.dmg`, the updater archive `.app.tar.gz` and `SHA256SUMS.txt`, and attests their build provenance (`gh attestation verify Noter_….dmg -R getahead/noter` checks a download). Until `apps/desktop/src-tauri/tauri.conf.json` exists the workflow says so in the run summary and does nothing else.

When the Tauri host lands (M0), it needs: `@tauri-apps/cli` in `apps/desktop` devDependencies; `"version": "../package.json"` in `tauri.conf.json`, so release-please's version bump reaches the app; `bundle.createUpdaterArtifacts: true` and the updater endpoint `https://github.com/getahead/noter/releases/latest/download/latest.json` with the public key, if the in-app updater is wanted.

| Where | Trigger | Result |
| --- | --- | --- |
| `preview.yml` | every commit on `main`; a PR with the label `build-preview`; by hand | DMG and archive attached to the workflow run for 14 days |
| `release.yml` | a release created by release-please | the same files on the GitHub release, plus `latest.json` when the updater archive is signed |

Release builds start from an empty cache: nothing from an earlier run reaches a shipped binary.

### Signing

Without secrets the app is ad-hoc signed: it runs, but Gatekeeper asks for right-click → Open on first launch. Add these repository secrets and the next build signs and notarizes by itself:

| Secret | What |
| --- | --- |
| `APPLE_CERTIFICATE` | the Developer ID Application certificate with its key, exported as `.p12`, base64 encoded (`base64 -i cert.p12 \| pbcopy`) |
| `APPLE_CERTIFICATE_PASSWORD` | the password of that `.p12` |
| `APPLE_SIGNING_IDENTITY` | e.g. `Developer ID Application: Mikhail Petrov (TEAMID)` |
| `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` | notarization: the Apple ID, an app-specific password for it, the team ID |
| `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | updater signing key from `pnpm tauri signer generate`; the public key goes into `tauri.conf.json` |

Signing secrets are passed to the packaging job only, and only the ones that are set reach the Tauri bundler.

## Releases

Versions follow SemVer from the commit types since the last release: `fix` → patch, `feat` → minor, a breaking change (`feat!:` or a `BREAKING CHANGE:` footer) → minor while the version is 0.x, major from 1.0. `perf` and `revert` appear in the changelog too; `docs`, `test`, `ci`, `build`, `chore` and `refactor` do not trigger a release. The version lives in `package.json` and `apps/desktop/package.json` (`.release-please-manifest.json` remembers the last one); the Rust crates are internal (`publish = false`) and keep `0.1.0`.

No personal access token is involved (owner decision, 18 Oct 2026: no API tokens in the pipeline). release-please opens and updates the Release PR with the workflow's own token, and what that token pushes starts no workflows. A `workflow_dispatch` is the one exception, so the same `release.yml` run then dispatches `ci.yml`, `codeql.yml`, `pr.yml` and `review.yml` on the Release PR's branch, once per head commit; they report `gate`, CodeQL, `hygiene` and `review` (which passes by itself for a Release PR) on its head. If a Release PR still shows no checks, push one commit to its branch (`git commit --allow-empty -m "ci: run checks" && git push`).

To ship: merge the Release PR when its checks are green, or turn on auto-merge (`gh pr merge <N> --auto --squash`). To release a specific version, put `Release-As: 1.0.0` in the body of a commit on `main`.

## First-time setup

1. Merge the PR that adds this page (it changes `.github/`, so it needs `harness-change-approved`).
2. `scripts/ci/github-setup.sh` from the owner's Mac (GitHub CLI signed in as an admin). It ends by listing which optional secrets are set.
3. Optional: the Apple and updater secrets once there is an app to sign.
4. The Mac runner for the nightly wall-clock job: docs/DEVELOPMENT.md › The Mac runner. Because this repository is public, `github-setup.sh` makes every workflow from someone outside the repository wait for the owner's approval, so nobody else's code reaches that Mac.
