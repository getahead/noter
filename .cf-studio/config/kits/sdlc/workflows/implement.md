---
cf-studio: true
type: workflow
name: cf-sdlc-implement
description: Invoke when the user asks to implement a registered FEATURE with code traceability, deterministic validation, and semantic review.
version: 1.1
purpose: Carry the FEATURE and CODE contracts through Noter's generation, validation, and review gates.
---

# cf-sdlc-implement

<!-- @cpt-flow:cpt-noter-flow-developer-workflow-skills-scoped-work:p2 -->
```pdsl
UNIT ImplementPreset
PURPOSE: Prepare authorized FEATURE implementation and delegate authorship.
DO:
  LOAD {cf-studio-path}/.core/skills/studio/modules/runtime/workflow-bootstrap.md
  RUN WorkflowBootstrapRouterPrelude
  RUN WorkflowBootstrapSimpleModeGate
  RUN WorkflowBootstrapStudioInstructionsMemory
  RUN WorkflowBootstrapCommandResolution
  CONTINUE NoterFeatureAuthoring
```

```pdsl
UNIT NoterFeatureAuthoring
PURPOSE: Resolve the registered FEATURE and its approved authoring inputs.
DO:
  RUN resolve the source FEATURE from the project artifact registry and retain its canonical repository-relative path as FEATURE_PATH
  REQUIRE FEATURE_PATH resolves to exactly one registered FEATURE in this project
  REQUIRE the approved phase plan, definition of done, acceptance criteria, and relevant files map are available
  SET ARTIFACT_KIND = CODE
  CONTINUE NoterFeatureAuthorDispatch
RULES:
  NEVER prepare or launch authoring before the FEATURE and scope prerequisites resolve
```

```pdsl
UNIT NoterFeatureAuthorDispatch
PURPOSE: Bind the CODE and skill rules and enter the shared author dispatch.
DO:
  RUN WorkflowBootstrapDispatchContext
  LOAD {codebase_rules} as the CODE authoring contract
  LOAD {codebase_checklist} as the CODE semantic review checklist
  LOAD {cf-studio-path}/config/rules/code-skills.md as the controller's skill guidance
  CONTINUE NoterDispatchFeatureAuthor
RULES:
  ALWAYS capture the pre-authoring diff and retain only the authorized phase's changes as the review scope
  ALWAYS include the source FEATURE, scoped inputs, CODE rules, and applicable skill criteria in the synthesized author prompt
  ALWAYS require the failing test first and apply the FEATURE's trace markers
  NEVER report completion on an empty or unverifiable author result
```

```pdsl
UNIT NoterDispatchFeatureAuthor
PURPOSE: Run the existing author-only coder before any validation or review.
DO:
  RUN GitWriteDispatchPolicyResolve
  LOAD {cf-studio-path}/.core/skills/studio/agents/cf-generate-author-worker.md as the shared author contract
  RUN SubAgentDispatch for cf-generate-coder-smart with mode=create, kind=code, the approved paths, governing FEATURE, and resolved Git policy
  RUN capture paths_written from the author manifest and confirm each path is within the approved scope and present in the authored diff
  CONTINUE NoterValidateFeature
RULES:
  ALWAYS synthesize the shared author contract, FEATURE, CODE rules, and scoped skill criteria before dispatch
  NEVER give the author ownership of validation or semantic review
```

```pdsl
UNIT NoterValidateFeature
PURPOSE: Gate the authored FEATURE changes before handing them to semantic review.
DO:
  REQUIRE the authorized author dispatch returned a concrete changed-path scope
  RUN `{cfs_cmd} validate --artifact <FEATURE_PATH>` with FEATURE_PATH as a single path argument and record its exact exit status
  RUN `just gate` in the implementation worktree and record its exact exit status
  EMIT the failed gate results WHEN either command did not exit zero
  STOP_TURN WHEN either command did not exit zero
  CONTINUE NoterFeatureReview
RULES:
  NEVER count validation against an unregistered source file or a different worktree
```

```pdsl
UNIT NoterFeatureReview
PURPOSE: Pass only the validated FEATURE diff to read-only semantic review.
DO:
  SET REVIEW_TARGET_PATHS = the authorized changed paths reported by the author and confirmed against the current diff
  REQUIRE REVIEW_TARGET_PATHS is not empty
  LOAD {cf-studio-path}/config/kits/sdlc/workflows/code-review.md
  CONTINUE NoterReadOnlyCodeReview
RULES:
  ALWAYS carry FEATURE_PATH, the CODE checklist, and the current reviewed diff into semantic review
  NEVER close a FEATURE before its deterministic results and semantic findings are resolved
```
