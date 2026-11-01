# Offline diarization: licences of the pinned checkpoints (2.14, D-32 option 2)

Checked 1 Nov 2026 by be-eng-2 before pinning (task_4532d3121e88). Verdict: **every file Noter
pins may ship in a commercial app**; CC-BY-4.0 requires attribution (below). Nothing is unclear
enough to stop on.

## What Noter pins

All from `FluidInference/speaker-diarization-coreml` at commit
`7eab74f3463c736418d0eb10296261ae581146c9` (Hugging Face card: `license: other`,
`license_name: scoped-cc-by-4.0`, `license_link: NOTICE.md`), bundle `wespeaker` in
`scripts/models/manifest.json`, each file by sha256, `required_for_capture: false`:

| File | Role | Upstream | Licence |
|---|---|---|---|
| `Segmentation.mlmodelc/` (new) | pyannote powerset segmentation, 10 s windows | `pyannote/speaker-diarization-community-1` `segmentation/pytorch_model.bin` | CC-BY-4.0 |
| `FBank.mlmodelc/` (since #236) | WeSpeaker filterbank front end | configured from the embedding checkpoint, no weights of its own | CC-BY-4.0 |
| `Embedding.mlmodelc/` (since #236) | WeSpeaker ResNet34 speaker embedding (256) | community-1 `embedding/pytorch_model.bin` (WeSpeaker VoxCeleb ResNet34) | CC-BY-4.0 |
| `plda-parameters.json`, `xvector-transform.json` (new) | VBx's PLDA and x-vector transform | BUT Speech@FIT `plda.npz`, `xvec_transform.npz` (via community-1) | CC-BY-4.0, commercial use stated by the rights holder |
| `NOTICE.md` (since #236) | the repo's attribution and licence scope | — | — |

Why the community-1 set rather than the legacy `pyannote_segmentation.mlmodelc` /
`wespeaker*.mlmodelc` in the same repo: FBank and Embedding pinned in #236 are already
community-1, the segmentation must come from the same release ("same bundle family"), and only the
community-1 artifacts carry recorded hashes (`provenance.json`) and a published conversion
reference. They are prebuilt CoreML: no conversion step enters Noter's supply chain.

## Licence texts (quoted from the pinned commit)

`NOTICE.md`:

> Fluid Inference intends the included CC-BY-4.0 license text to cover only the following exact
> Community-1-derived artifacts …: `Segmentation.mlmodelc`, `FBank.mlmodelc`, `Embedding.mlmodelc`,
> `PLDA.mlmodelc`, `PldaRho.mlmodelc`, `plda-parameters.json`, `xvector-transform.json`.
> The underlying Community-1 pipeline is published by pyannote under CC-BY-4.0.
> The PLDA parameters originate from Brno University of Technology / BUT Speech@FIT. The rights
> holder explicitly licenses `plda.npz` and `xvec_transform.npz` under CC-BY-4.0, including
> commercial use.
> Appropriate attribution should identify pyannote, WeSpeaker, BUT Speech@FIT, and Fluid
> Inference, retain the citations in README.md, link CC-BY-4.0, and indicate that the files are
> modified Core ML conversions.

`LICENSE` at the same commit: the full Creative Commons Attribution 4.0 International text
(permissions: commercial use, modification, distribution; conditions: credit, licence notice,
indicate changes).

Upstream model cards (Hugging Face API, 1 Nov 2026):

- `pyannote/speaker-diarization-community-1` @ `3533c8cf8e369892e6b79ff1bf80f7b0286a54ee`:
  `license: cc-by-4.0`, gated ("This pipeline is released under the CC-BY-4.0 license and will
  always remain freely accessible. By providing your details, you agree that we may email you…").
  The gate is a contact form for downloading from pyannote, not a licence term; Noter downloads
  the converted files from Fluid Inference's ungated repo.
- `pyannote/wespeaker-voxceleb-resnet34-LM` @ `837717ddb9ff5507820346191109dc79c958d614`:
  `license: cc-by-4.0`, a wrapper of WeSpeaker's `wespeaker-voxceleb-resnet34-LM`.
  WeSpeaker `docs/pretrained.md`: "The pretrained model in WeNet follows the license of its
  corresponding dataset … the pretrained model on VoxCeleb follows Creative Commons Attribution
  4.0 International License". WeSpeaker code itself is Apache-2.0 (not shipped).
- `pyannote/segmentation-3.0` @ `e66f3d3b9eb0873085418a7b813d3b369bf160bb`: `license: mit`
  (Copyright (c) 2023 CNRS), gated by a contact form. Only relevant to the legacy
  `pyannote_segmentation.mlmodelc`, which Noter does **not** pin; if it ever is, the MIT notice
  reproduced in `NOTICE.md` must ship with it.

## What Noter must do (attribution)

CC-BY-4.0 §3(a): credit the creators, link the licence, say the files were modified. The pinned
`NOTICE.md` travels in the model folder, but the app should also say it where users see it:

1. An acknowledgements entry (About/Settings › Licences, or a repo `NOTICE`; owner's choice of
   place, outside the engine lane):

   > Speaker diarization uses Core ML conversions by Fluid Inference
   > (huggingface.co/FluidInference/speaker-diarization-coreml) of pyannote
   > speaker-diarization-community-1 (pyannote, CC-BY-4.0), the WeSpeaker ResNet34 speaker
   > embedding (WeSpeaker, trained on VoxCeleb, CC-BY-4.0) and the VBx PLDA parameters of
   > BUT Speech@FIT (CC-BY-4.0). The files were converted to Core ML and compiled; Noter runs them
   > unchanged. Licence: https://creativecommons.org/licenses/by/4.0/

2. Keep `NOTICE.md` in the pinned bundle (it is).

No NOTICE entry is legally required for the MIT segmentation-3.0 because it is not pinned.

## Caveats, none blocking

- Provenance: Fluid Inference says the 2025 segmentation and embedding exports are "historically
  reconstructed, not build-attested" (exact converter commit not recorded). Hash pinning covers
  integrity; it does not prove the conversion. Golden-set quality (TL-17) is the practical check.
- Patents and trademarks are not granted by CC-BY-4.0 (standard; no known claims).
- The other bundles (Whisper, bge-m3) are outside this note.
