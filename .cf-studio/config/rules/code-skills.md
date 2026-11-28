# Skill guidance for code generation and review

<!-- @cpt-algo:cpt-noter-algo-developer-workflow-skills-resolve:p2 -->
The workflow controller selects guidance for the workflow and the behaviors affected by the approved change.

| Skill | When to apply |
| --- | --- |
| `macos-design-guidelines` | Mac-facing interface behavior governed by the macOS Human Interface Guidelines, including relevant desktop webview work. |
| `macos-development` | Swift, Apple frameworks, and macOS platform architecture. Select child modules only for the behavior that needs them. |
| `macos-patterns` | Native macOS system integration. |
| `ponytail` | Code authoring. Make the smallest complete change while preserving validation, error handling, security, and accessibility. |
| `ponytail-review` | Semantic code review and the delivering agent’s local PR self-review. |

Platform-neutral behavior receives the Ponytail guidance for the workflow. For mixed changes, apply macOS guidance only to the relevant changed behavior.

<!-- @cpt-state:cpt-noter-state-developer-workflow-skills-readiness:p2 -->
Before launch, use the current host’s skill catalog and supported resolver to load the canonical content for each applicable skill by its portable identifier. Resolve Codex availability independently of Claude Code and verify both Ponytail skills against the project’s pinned release. If required guidance is missing or incompatible, stop before any affected inline or delegated launch. Report the host, skill, and expected version when defined, then retry after resolution.

<!-- @cpt-flow:cpt-noter-flow-developer-workflow-skills-scoped-work:p2 -->
The controller includes the same applicable guidance and evidence references in self-contained inline and delegated prompts. Workers use those prompts without reopening skill or workflow files as instructions. Keep the governing FEATURE, CODE checklist, traceability checks, deterministic gates, and semantic review on the FEATURE route.

<!-- @cpt-flow:cpt-noter-flow-developer-workflow-skills-pr-review:p2 -->
The delivering agent runs semantic review and `ponytail-review` locally against the same fresh PR diff. Merge and deduplicate the findings. Treat each Ponytail **Must fix** as a **Minimum** finding and set the verdict to `REQUEST CHANGES` when a Minimum finding exists. Refresh and review again if the diff changes before publication. Keep the existing delivery gates.
