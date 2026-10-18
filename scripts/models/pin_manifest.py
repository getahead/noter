#!/usr/bin/env python3
"""Pins the model bundles Noter downloads (decision D12, option A).

A bundle is the set of files of one Hugging Face folder at a pinned commit. For each file
this writes its download URL, size and sha256 (the LFS oid; small non-LFS files are
downloaded once and hashed, since their git oid is not a sha256). The core's download task
verifies every file against it; nothing here is ever edited by hand.

    scripts/models/pin_manifest.py              # write scripts/models/manifest.json
    scripts/models/pin_manifest.py --check      # also check where each LFS file redirects

`--check` fails when a download would leave the model-download hosts of
contracts/egress-hosts.json; the fix is an owner change to that list, never a wider fetcher.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "scripts" / "models" / "manifest.json"
API = "https://huggingface.co/api/models"

# What Noter downloads: one entry per bundle, each at a pinned commit.
BUNDLES = [
    {
        "bundle": "whisper-turbo",
        "repo": "argmaxinc/whisperkit-coreml",
        "commit": "0f63a7800b00dd0226abd051b906c246e1907482",
        "folder": "openai_whisper-large-v3-v20240930_turbo",
        "required_for_capture": True,
    },
]


def get_json(url: str):
    with urllib.request.urlopen(url, timeout=60) as r:  # noqa: S310 (https constants only)
        return json.load(r)


def resolve_url(repo: str, commit: str, path: str) -> str:
    return f"https://huggingface.co/{repo}/resolve/{commit}/{urllib.parse.quote(path)}"


def sha256_of(url: str) -> str:
    h = hashlib.sha256()
    with urllib.request.urlopen(url, timeout=120) as r:  # noqa: S310
        for chunk in iter(lambda: r.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def files_of(spec: dict) -> list[dict]:
    tree = get_json(f"{API}/{spec['repo']}/tree/{spec['commit']}/{spec['folder']}?recursive=true")
    out = []
    for entry in sorted(tree, key=lambda e: e["path"]):
        if entry["type"] != "file":
            continue
        url = resolve_url(spec["repo"], spec["commit"], entry["path"])
        lfs = entry.get("lfs") or {}
        out.append({
            "bundle": spec["bundle"],
            "path": entry["path"][len(spec["folder"]) + 1:],
            "url": url,
            "size_bytes": entry["size"],
            "sha256": lfs.get("oid") or sha256_of(url),
            "required_for_capture": spec["required_for_capture"],
        })
    return out


def allowed_hosts() -> set[str]:
    hosts = json.loads((ROOT / "contracts" / "egress-hosts.json").read_text())
    return set(hosts["allow_without_audit"]["model_downloads"]["hosts"])


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def redirect_host(url: str) -> str:
    opener = urllib.request.build_opener(NoRedirect)
    request = urllib.request.Request(url, method="HEAD")
    try:
        opener.open(request, timeout=60)
    except urllib.error.HTTPError as e:  # 3xx surfaces as an error without a redirect handler
        location = urllib.parse.urljoin(url, e.headers.get("Location", ""))
        return urllib.parse.urlsplit(location).hostname or ""
    return urllib.parse.urlsplit(url).hostname or ""


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--check", action="store_true", help="check every LFS redirect host against the allow-list")
    args = parser.parse_args(argv)

    files = [f for spec in BUNDLES for f in files_of(spec)]
    allowed = allowed_hosts()
    bad = sorted({urllib.parse.urlsplit(f["url"]).hostname for f in files} - allowed)
    if bad:
        print(f"download URLs leave the allow-list: {bad}", file=sys.stderr)
        return 1
    OUT.write_text(json.dumps({"files": files}, indent=1) + "\n")
    print(f"wrote {len(files)} files of {len(BUNDLES)} bundle(s) to {OUT.relative_to(ROOT)}")
    if args.check:
        redirects = {redirect_host(f["url"]) for f in files if f["size_bytes"] > 1_000_000}
        off = sorted(redirects - allowed)
        if off:
            print(
                "LFS downloads redirect to hosts not in contracts/egress-hosts.json "
                f"allow_without_audit.model_downloads: {off} (owner change needed)",
                file=sys.stderr,
            )
            return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
