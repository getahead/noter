# Temporary Constructor Studio runtime

CI's download of the pinned Constructor Studio release returns HTTP 404. Until
upstream downloads work again, `.core/` contains the runtime from
[`constructorfabric/studio` v1.8.0](https://github.com/constructorfabric/studio/tree/v1.8.0),
commit `3e73a118af4108fa45b306e02f20c9692d1bc1d6`.

The vendored scope is `architecture/specs/`, `requirements/`, `schemas/`,
`skills/`, `workflows/`, and the upstream README, LICENSE and NOTICE. All 443 files
were checked against the tag's Git blob hashes. The files are copied unchanged,
including the tag's older internal `__version__` string; `.cf-studio/version.toml`
remains the project's version pin. Local caches and Python bytecode are excluded.

`scripts/ci/fetch-cf-studio.sh` already exits without accessing the network when
`.core/skills/studio/scripts/studio.py` exists. Validation still runs normally;
no workflow or gate is bypassed.

Remove this temporary copy and the `.gitignore` exception once downloading the
pinned release works from a clean CI runner. Verify the download and run
`just docs` before removing it. Do not update vendored files individually; replace
the snapshot from a verified release when changing the pin.
