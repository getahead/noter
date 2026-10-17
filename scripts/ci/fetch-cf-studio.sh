#!/usr/bin/env bash
# Fetch the Constructor Studio core pinned in .cf-studio/version.toml into
# .cf-studio/.core (gitignored locally, so CI has to fetch it).
set -euo pipefail
if [ -f .cf-studio/.core/skills/studio/scripts/studio.py ]; then exit 0; fi
ver=$(python3 -c 'import tomllib; print(tomllib.load(open(".cf-studio/version.toml","rb"))["cfs"]["version"])')
src=$(python3 -c 'import tomllib; print(tomllib.load(open(".cf-studio/version.toml","rb"))["cfs"]["canonical_source"])')
repo=${src#https://api.github.com/repos/}
tmp=$(mktemp -d)
if [ -n "${CF_STUDIO_TOKEN:-}" ]; then
  # Private repository: the API tarball endpoint accepts a token (archive URLs do not).
  url="https://api.github.com/repos/${repo}/tarball/${ver}"
  get() { curl -fsSL -H "Authorization: Bearer ${CF_STUDIO_TOKEN}" -H "Accept: application/vnd.github+json" "$url" -o "$tmp/cfs.tgz"; }
else
  url="https://github.com/${repo}/archive/refs/tags/${ver}.tar.gz"
  get() { curl -fsSL "$url" -o "$tmp/cfs.tgz"; }
fi
if ! get; then
  echo "::error::Could not download Constructor Studio ${ver} from github.com/${repo}. If the repository is private, add a CF_STUDIO_TOKEN secret; or commit .cf-studio/.core."
  exit 1
fi
tar xzf "$tmp/cfs.tgz" -C "$tmp"
studio=$(find "$tmp" -path '*/skills/studio/scripts/studio.py' | head -1)
if [ -z "$studio" ]; then
  echo "::error::studio.py not found in the Constructor Studio ${ver} archive; update scripts/ci/fetch-cf-studio.sh to its layout."
  exit 1
fi
core=$(dirname "$(dirname "$(dirname "$(dirname "$studio")")")")
mkdir -p .cf-studio/.core
cp -R "$core"/. .cf-studio/.core/
echo "Constructor Studio ${ver} core installed from ${repo}."
