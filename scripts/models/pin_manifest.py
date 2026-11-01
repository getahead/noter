#!/usr/bin/env python3
"""Pins the model bundles Noter downloads (decision D12, option A).

A bundle is the set of files of one Hugging Face folder at a pinned commit. For each file
this writes its download URL, size and sha256 (the LFS oid; small non-LFS files are
downloaded once and hashed, since their git oid is not a sha256). The core's download task
verifies every file against it; nothing here is ever edited by hand.

    scripts/models/pin_manifest.py              # write scripts/models/manifest.json
    scripts/models/pin_manifest.py --check      # also check every download and redirect

`--check` fails when a download would leave the model-download hosts of
contracts/egress-hosts.json; the fix is an owner change to that list, never a wider fetcher.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "scripts" / "models" / "manifest.json"
API = "https://huggingface.co/api/models"

# What Noter downloads: one entry per source of a bundle, each at a pinned commit; `only` names
# the files to take (`name/` takes a folder). The capture model is required; the offline models
# (2.14: the archive decode, speaker and text vectors) download after it.
BUNDLES = [
    {
        "bundle": "whisper-turbo",
        "repo": "argmaxinc/whisperkit-coreml",
        "commit": "0f63a7800b00dd0226abd051b906c246e1907482",
        "folder": "openai_whisper-large-v3-v20240930_turbo",
        "required_for_capture": True,
    },
    # Its tokenizer, into the same folder: WhisperKit would fetch it from the Hub at load, and the
    # sandboxed engine has no network.
    {
        "bundle": "whisper-turbo",
        "repo": "openai/whisper-large-v3",
        "commit": "06f233fe06e710322aca913c1bc4249a0d71fce1",
        "folder": "",
        "only": ["tokenizer.json", "tokenizer_config.json"],
        "required_for_capture": True,
    },
    # The archive pass: full Large v3 and its tokenizer, as the live model is pinned.
    {
        "bundle": "whisper-large-v3",
        "repo": "argmaxinc/whisperkit-coreml",
        "commit": "0f63a7800b00dd0226abd051b906c246e1907482",
        "folder": "openai_whisper-large-v3",
        "required_for_capture": False,
    },
    {
        "bundle": "whisper-large-v3",
        "repo": "openai/whisper-large-v3",
        "commit": "06f233fe06e710322aca913c1bc4249a0d71fce1",
        "folder": "",
        "only": ["tokenizer.json", "tokenizer_config.json"],
        "required_for_capture": False,
    },
    # Speaker vectors and the archive's clustering: pyannote community-1's segmentation, WeSpeaker
    # ResNet34 as its FBank and Embedding CoreML conversions, and VBx's PLDA (CC-BY-4.0,
    # attribution in NOTICE.md; .plans/backend/m2-diarization-licences.md).
    {
        "bundle": "wespeaker",
        "repo": "FluidInference/speaker-diarization-coreml",
        "commit": "7eab74f3463c736418d0eb10296261ae581146c9",
        "folder": "",
        "only": [
            "Segmentation.mlmodelc/", "FBank.mlmodelc/", "Embedding.mlmodelc/", "plda-parameters.json",
            "xvector-transform.json", "NOTICE.md",
        ],
        "required_for_capture": False,
    },
    # Text vectors: bge-m3 as a CoreML conversion (MIT), with bge-m3's own tokenizer.
    {
        "bundle": "bge-m3",
        "repo": "JGKarlin/ohia-bge-m3-coreml",
        "commit": "cb67d6bcbdb0c68efc2448752717cbbf925034c6",
        "folder": "",
        "only": ["bge-m3.mlpackage/"],
        "required_for_capture": False,
    },
    {
        "bundle": "bge-m3",
        "repo": "BAAI/bge-m3",
        "commit": "5617a9f61b028005a4858fdac845db406aefb181",
        "folder": "",
        "only": ["tokenizer.json", "tokenizer_config.json"],
        "required_for_capture": False,
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


def wanted(path: str, only: list[str] | None) -> bool:
    """Every file without `only`; else a file it names, or one under a folder it names (`name/`)."""
    return only is None or any(path == o or (o.endswith("/") and path.startswith(o)) for o in only)


def files_of(spec: dict) -> list[dict]:
    """A source's files: everything under `folder` (the repo root when empty), or only those named."""
    folder = spec["folder"]
    tree = get_json(f"{API}/{spec['repo']}/tree/{spec['commit']}{'/' + folder if folder else ''}?recursive=true")
    out = []
    for entry in sorted(tree, key=lambda e: e["path"]):
        path = entry["path"][len(folder) + 1:] if folder else entry["path"]
        if entry["type"] != "file" or not wanted(path, spec.get("only")):
            continue
        url = resolve_url(spec["repo"], spec["commit"], entry["path"])
        lfs = entry.get("lfs") or {}
        out.append({
            "bundle": spec["bundle"],
            "path": path,
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


def redirect_host(url: str, allowed: set[str]) -> str:
    opener = urllib.request.build_opener(NoRedirect)
    for hop in range(11):
        parsed = urllib.parse.urlsplit(url)
        if (parsed.scheme != "https" or parsed.hostname not in allowed
                or parsed.username is not None or parsed.password is not None
                or parsed.port not in (None, 443)):
            raise ValueError("download URL leaves the HTTPS model-download allow-list")
        request = urllib.request.Request(url, method="HEAD")
        try:
            with opener.open(request, timeout=60):
                return parsed.hostname
        except urllib.error.HTTPError as error:
            try:
                if error.code not in (301, 302, 303, 307, 308):
                    raise ValueError(f"download returned HTTP {error.code}") from None
                location = error.headers.get("Location")
                if not location or not location.strip():
                    raise ValueError("download redirect has no Location")
                if hop == 10:
                    raise ValueError("download exceeded ten redirects")
                url = urllib.parse.urljoin(url, location)
            finally:
                error.close()
    raise ValueError("download exceeded ten redirects")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--check", action="store_true", help="check every download and redirect against the allow-list")
    args = parser.parse_args(argv)

    files = [f for spec in BUNDLES for f in files_of(spec)]
    allowed = allowed_hosts()
    bad = sorted({urllib.parse.urlsplit(f["url"]).hostname for f in files} - allowed)
    if bad:
        print(f"download URLs leave the allow-list: {bad}", file=sys.stderr)
        return 1
    if args.check:
        try:
            for file in files:
                redirect_host(file["url"], allowed)
        except (ValueError, urllib.error.URLError) as error:
            print(f"download URL check failed: {error}", file=sys.stderr)
            return 2
    OUT.write_text(json.dumps({"files": files}, indent=1) + "\n")
    print(f"wrote {len(files)} files of {len(BUNDLES)} bundle(s) to {OUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
