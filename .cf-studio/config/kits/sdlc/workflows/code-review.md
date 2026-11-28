---
cf-studio: true
type: workflow
name: cf-sdlc-code-review
description: Invoke for standalone Noter code review, including a request for cf-review. Returns findings without applying fixes.
version: 1.0
---

# cf-sdlc-code-review

<!-- @cpt-flow:cpt-noter-flow-developer-workflow-skills-scoped-work:p2 -->
```pdsl
UNIT NoterReadOnlyCodeReview
PURPOSE: Review the scoped diff and return findings without dispatching a fix.
DO:
  LOAD {cf-studio-path}/.core/skills/studio/modules/runtime/workflow-bootstrap.md WHEN WorkflowBootstrapContextOnly is not loaded
  RUN WorkflowBootstrapContextOnly
  LOAD {cf-studio-path}/config/rules/code-skills.md
  LOAD {cf-studio-path}/.core/skills/studio/modules/subagents/dispatch.md
  RUN resolve the requested paths and current diff when the caller did not supply review scope
  REQUIRE the review scope resolves to a concrete diff and changed paths
  CONTINUE NoterPrepareReview
```

```pdsl
UNIT NoterPrepareReview
PURPOSE: Load the shared read-only review methodology and approval gates.
DO:
  LOAD {cf-studio-path}/.core/skills/studio/modules/coding-bootstrap-methodologies.md
  RUN CodingReviewReferenceLoad
  LOAD {cf-studio-path}/.core/skills/studio/modules/review/finding-contract.md
  LOAD {cf-studio-path}/.core/skills/studio/modules/review/semantic-loop-skeleton.md
  RUN SemanticReviewNoSpinRules
  LOAD {cf-studio-path}/.core/skills/studio/modules/coding-review-setup-run.md
  CONTINUE NoterReviewDispatch
```

```pdsl
UNIT NoterReviewDispatch
PURPOSE: Apply the existing review depth and dispatch approvals.
STATE:
  SET REVIEW_GRANULARITY: single-pass | per-methodology | per-layer | unset (default unset, scope workflow_run)
DO:
  SET REVIEW_GRANULARITY_SCOPE = code checklist, bug finding, and consistency review
  RUN SemanticReviewGranularityGate WHEN REVIEW_GRANULARITY == unset
  RUN CodingReviewerDispatchPolicy
  RUN SubAgentDispatch for SELECTED_REVIEWER_DISPATCH_GROUP before launching reviewer instances
  RUN SELECTED_REVIEWER_DISPATCH_GROUP with REVIEWER_SCOPE_MANIFEST, the scoped diff and paths, and the FEATURE and CODE checklist when supplied
  CONTINUE NoterReviewResults
RULES:
  ALWAYS resolve the relevant skills before reviewer launch and pass the same applicable criteria to inline and delegated reviewers
  ALWAYS keep standalone and delegated review read-only
```

```pdsl
UNIT NoterReviewResults
PURPOSE: Return consolidated review findings to the caller.
DO:
  RUN AggregateReviewFindings including the scoped Ponytail review findings
  EMIT the scoped findings report with severity, evidence, and suggested fixes
  RETURN ReviewFindingsReport
RULES:
  ALWAYS report blocking Ponytail findings before closing a FEATURE
  NEVER enter the shared review fix gate from this entry
```
