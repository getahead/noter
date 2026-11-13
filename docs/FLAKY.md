# Flaky and slow checks: global registry

One place to look up a check that failed intermittently, or a check that is slower than it should be, before filing a new issue. Source: the CI history audit of 17 Oct to 7 Nov 2026 (issue #404, 1,824 CI runs, 391 pull requests). Counts are *matching failing job attempts / those with a later passing attempt on the same run and commit*; they are not per-test failure rates.

Native XCUITests run once per job so a failed first attempt stays visible to the required gate. A later pass on the same commit is evidence of intermittency and belongs in the matching issue; the XCUITest suite itself does not retry failures. Playwright tests also use `retries: 0` (`playwright.config.ts`).

Rules: a new occurrence goes into the matching issue (failing job, commit, attempt, assertion, same-commit recovery), not into a new one. Fix flakiness at its cause (explicit waits on state, deterministic clocks and fixtures, completion handshakes) with the same assertions; never skip a test or lower a threshold. A closed record reopens when a commit that contains its fix reproduces the signature. When the issue or fix state below changes, update this file in the same pull request that closes it.

## Flaky checks

| Issue | Check | Seen | Fix | State |
| --- | --- | ---: | --- | --- |
| [#667](https://github.com/getahead/noter/issues/667) | MCP tool router reads the launch before the adapter receives it | 4 / 80 under 16-process local load | pending PR | [#799](https://github.com/getahead/noter/pull/799) |
| [#392](https://github.com/getahead/noter/issues/392) | First-run self-test lifecycle (E2E, visual) | 83 / 33 | [#423](https://github.com/getahead/noter/pull/423) | open |
| [#398](https://github.com/getahead/noter/issues/398) | Call-page navigation, missing-call Back | 36 / 4 | [#430](https://github.com/getahead/noter/pull/430) | open |
| [#396](https://github.com/getahead/noter/issues/396) | Native menu and record prompt | 33 / 14 | #558 and this PR | closed |
| [#399](https://github.com/getahead/noter/issues/399) | Live and stored transcript navigation, replay | 31 / 3 | none yet | open |
| [#394](https://github.com/getahead/noter/issues/394) | Core model lifecycle: immediate pause/resume, seeded state | 12 / 4 | none yet | open |
| [#397](https://github.com/getahead/noter/issues/397) | Native Hide for Presenting query timeouts | 11 / 5 | [#558](https://github.com/getahead/noter/pull/558), #431 and this PR | closed |
| [#562](https://github.com/getahead/noter/issues/562) | WebView recovery test initial-load timeout | 2 / 0 | this PR | closed |
| [#393](https://github.com/getahead/noter/issues/393) | First-run Checking screenshot | 10 / 4 | [#390](https://github.com/getahead/noter/pull/390) (merged), #423 | open |
| [#401](https://github.com/getahead/noter/issues/401) | Tab and Shift+Tab reachability | 5 / 1 | none yet | open |
| [#400](https://github.com/getahead/noter/issues/400) | Speaker naming Undo restoration | 3 / 1 | [#429](https://github.com/getahead/noter/pull/429) | open |
| [#438](https://github.com/getahead/noter/issues/438) | Undo on Rejected reads `lastChange` before `item_review` lands (`m2-items-ui.spec.ts`) | 1 / 0 | none yet | open |
| [#395](https://github.com/getahead/noter/issues/395) | MCP token revocation after closing a run | 1 / 1 | none yet | open |
| [#414](https://github.com/getahead/noter/issues/414) | Knowledge token-revocation event count | local | [#423](https://github.com/getahead/noter/pull/423) | open |
| [#418](https://github.com/getahead/noter/issues/418) | Independent account sign-in progress ordering | local | none yet | open |
| [#669](https://github.com/getahead/noter/issues/669) | Sign-in deadline tests racing scripted CLI delays | local | explicit hold/release control | open |
| [#402](https://github.com/getahead/noter/issues/402) | Calls loading skeleton screenshot | 10 / 2 | [#227](https://github.com/getahead/noter/pull/227) | closed |
| [#403](https://github.com/getahead/noter/issues/403) | Outputs load and command-log races | 14 / 2 | [#377](https://github.com/getahead/noter/pull/377) | closed |

## Slow checks

| Issue | Check | Cost | Fix | State |
| --- | --- | --- | --- | --- |
| [#405](https://github.com/getahead/noter/issues/405) | Native pause reminder wall-clock wait | 314s | [#417](https://github.com/getahead/noter/pull/417) | closed |
| [#411](https://github.com/getahead/noter/issues/411) | Standalone Tauri target built cold | median 224s | [#425](https://github.com/getahead/noter/pull/425) | closed |
| [#412](https://github.com/getahead/noter/issues/412) | Swift engine built twice, cold | about 156s | [#426](https://github.com/getahead/noter/pull/426) | closed |
| [#413](https://github.com/getahead/noter/issues/413) | WebKit setup in both E2E jobs | 28-42s each | [#432](https://github.com/getahead/noter/pull/432) | open |
| [#406](https://github.com/getahead/noter/issues/406) | Duplicate native delete-dialog tests | about 8s | [#424](https://github.com/getahead/noter/pull/424) | closed |
| [#407](https://github.com/getahead/noter/issues/407) | 10 s feedback expiry waited in real time | 13-14s each | [#428](https://github.com/getahead/noter/pull/428) | closed |
| [#410](https://github.com/getahead/noter/issues/410) | Blanket 4 s fake-command latency in screenshots | 5.5-6.6s per case | [#427](https://github.com/getahead/noter/pull/427) | open |
| [#408](https://github.com/getahead/noter/issues/408) | All-command probe, fresh real core per command | 53.6s | none yet | open |
| [#409](https://github.com/getahead/noter/issues/409) | Archive fixture delays | 24-27s per file | none yet | open |

Measured costs come from the audit (six successful main runs); a saving is a proposal until a run after the fix shows it, and parallel jobs' savings are never added up as one.
