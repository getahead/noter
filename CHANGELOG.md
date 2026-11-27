# Changelog

## [0.27.2](https://github.com/getahead/noter/compare/v0.27.1...v0.27.2) (2026-11-27)


### Bug fixes

* **diarization:** safely rerun a call archive ([#1289](https://github.com/getahead/noter/issues/1289)) ([9c4c67e](https://github.com/getahead/noter/commit/9c4c67e62ed1361fb14f960bbbd0bfa26b512c89))

## [0.27.1](https://github.com/getahead/noter/compare/v0.27.0...v0.27.1) (2026-11-27)


### Bug fixes

* address exploratory call workflow regressions ([#1287](https://github.com/getahead/noter/issues/1287)) ([cdbbfc1](https://github.com/getahead/noter/commit/cdbbfc1ce3eb71109b487beb4719928fc5d8ee70))

## [0.27.0](https://github.com/getahead/noter/compare/v0.26.3...v0.27.0) (2026-11-26)


### Features

* **people:** find a voice profile's voice in past calls ([#1284](https://github.com/getahead/noter/issues/1284)) ([8a8d39f](https://github.com/getahead/noter/commit/8a8d39f5a1a6eac19c1dafd278728e8a2bde7b44))


### Bug fixes

* **accounts:** a failed account check names its tool and what the provider answered in the log ([#1252](https://github.com/getahead/noter/issues/1252)) ([c54c0f1](https://github.com/getahead/noter/commit/c54c0f1aea083711071b9f1044ba4016cac8aad4))
* **accounts:** send Codex the output schema in OpenAI strict form ([#1283](https://github.com/getahead/noter/issues/1283)) ([bb193b5](https://github.com/getahead/noter/commit/bb193b5555aef650aebc73d20980a1df0aaf849a))
* **call-page:** the item rows follow the prototype's full row layout ([#1276](https://github.com/getahead/noter/issues/1276)) ([4e75580](https://github.com/getahead/noter/commit/4e7558068c5b6731224219d3283b2cd01e8de97c))
* **calls:** keep unconfirmed calendar guests on their call ([#1268](https://github.com/getahead/noter/issues/1268)) ([eed2269](https://github.com/getahead/noter/commit/eed22695bd9d95871744a51940b059821f2b79d4))
* **calls:** model call-type suggestion and Presentation/Demo instead of Retro ([#1275](https://github.com/getahead/noter/issues/1275)) ([86049b1](https://github.com/getahead/noter/commit/86049b173a65a5ceb0b55bb61966cffcaf72f354))
* **calls:** use calendar invitations and topic titles for recordings ([#1262](https://github.com/getahead/noter/issues/1262)) ([575688a](https://github.com/getahead/noter/commit/575688a00e948b16e14566951588bb8b537fb44d))
* **core:** detect call types locally when recording stops ([#1261](https://github.com/getahead/noter/issues/1261)) ([617ab38](https://github.com/getahead/noter/commit/617ab389b7676b5d9c7a23eaa4e32045a249e4a0))
* **diarization:** keep every archive voice its own speaker ([#1280](https://github.com/getahead/noter/issues/1280)) ([b13ca13](https://github.com/getahead/noter/commit/b13ca133d277fa7ec0d2ba1c9fbd04d0b0be20c6))
* **handoff:** explain the terminal launch when a repository is unmapped ([#1266](https://github.com/getahead/noter/issues/1266)) ([623ce25](https://github.com/getahead/noter/commit/623ce25198dd3bdb96539637404f0123cc69c0a4))
* **library:** show local call times and the languages actually spoken ([#1260](https://github.com/getahead/noter/issues/1260)) ([9c29d93](https://github.com/getahead/noter/commit/9c29d93309567a8a4050cb0a04c0ca2b0a02e800))
* **outputs:** explain regeneration holds and run once on battery ([#1253](https://github.com/getahead/noter/issues/1253)) ([115f5ac](https://github.com/getahead/noter/commit/115f5ac6ba5a44b6b1b376b2c7a514c39158056b))
* **outputs:** preserve regeneration choices and show the current run ([#1279](https://github.com/getahead/noter/issues/1279)) ([61f667b](https://github.com/getahead/noter/commit/61f667b6fcd13487b4cf3c37b044ad6788d85135))
* **settings:** the untested CLI version warning suggests a Noter update or the tested version, not the API key ([#1264](https://github.com/getahead/noter/issues/1264)) ([88ad670](https://github.com/getahead/noter/commit/88ad670ec36a199335c79092a56556bfe4ed7bfa))
* **shell:** open a section's root page on every section switch ([#1274](https://github.com/getahead/noter/issues/1274)) ([1402409](https://github.com/getahead/noter/commit/1402409ddaa102eda4e22e6d9f49694998939363))
* **ui:** refresh open views after a speaker rename ([#1250](https://github.com/getahead/noter/issues/1250)) ([f817f45](https://github.com/getahead/noter/commit/f817f459c60892072a52740e26eb9af26f74c91b))

## [0.26.3](https://github.com/getahead/noter/compare/v0.26.2...v0.26.3) (2026-11-25)


### Bug fixes

* **accounts:** the Claude sign-in passes its check on Claude Code 2.1.325, and a failed check says why in the log ([#1243](https://github.com/getahead/noter/issues/1243)) ([266fabe](https://github.com/getahead/noter/commit/266fabe7a226ef413661524696b6bc368d14953f))
* **accounts:** the sign-in sheet names a test request the tool refused or failed ([#1248](https://github.com/getahead/noter/issues/1248)) ([2a5724f](https://github.com/getahead/noter/commit/2a5724f9162f09d4d1af3fd393a3205d7ea775b2))
* **ui:** show the Call Screen when opened before recording ([#1245](https://github.com/getahead/noter/issues/1245)) ([2aff8f1](https://github.com/getahead/noter/commit/2aff8f1267ba84d552f1f0634315542d42325116))
* **ui:** wrap the live transcript and fill the floating call window ([#1244](https://github.com/getahead/noter/issues/1244)) ([51cb680](https://github.com/getahead/noter/commit/51cb6802e5b805304db55ac2a36f397bd3eee836))

## [0.26.2](https://github.com/getahead/noter/compare/v0.26.1...v0.26.2) (2026-11-25)


### Bug fixes

* **accounts:** the Claude sign-in works when Claude Code is already signed in, and a failed login names why ([#1236](https://github.com/getahead/noter/issues/1236)) ([2a54825](https://github.com/getahead/noter/commit/2a54825016878badc2c93ea8a00921691cf9f97f))

## [0.26.1](https://github.com/getahead/noter/compare/v0.26.0...v0.26.1) (2026-11-24)


### Bug fixes

* **test:** shut the core down before the event loop ends, so quit cannot deadlock ([#1233](https://github.com/getahead/noter/issues/1233)) ([c961392](https://github.com/getahead/noter/commit/c96139205a4169497f8f5154738b7e36c62a4e2d))

## [0.26.0](https://github.com/getahead/noter/compare/v0.25.1...v0.26.0) (2026-11-23)


### Features

* **accounts:** accept a Claude Team plan, confirmed by the Personal use box ([#1223](https://github.com/getahead/noter/issues/1223)) ([4e1718c](https://github.com/getahead/noter/commit/4e1718c7f021bbca95cb5c66484f77aa3b0a3db0))


### Bug fixes

* a newer, untested Codex or Claude Code runs with a warning, and a rejected lockdown flag fails closed ([#1219](https://github.com/getahead/noter/issues/1219)) ([#1227](https://github.com/getahead/noter/issues/1227)) ([6202f96](https://github.com/getahead/noter/commit/6202f96c31629386b057b54915c39e27f11dc2a7))
* **deps:** Bump rusqlite from 0.41.1 to 0.43.0 ([#1209](https://github.com/getahead/noter/issues/1209)) ([e197c6f](https://github.com/getahead/noter/commit/e197c6f67a72d3134f5ae114381739182f2fb8ad))
* the self-test's Play Test Clip proves system audio without another app playing ([#1217](https://github.com/getahead/noter/issues/1217)) ([#1222](https://github.com/getahead/noter/issues/1222)) ([8ff8d73](https://github.com/getahead/noter/commit/8ff8d73140f03a06cb02d0e9fdd653a35d795869))
* **ui:** a sheet never exceeds its window; the body scrolls, title and buttons stay in view ([#1224](https://github.com/getahead/noter/issues/1224)) ([2e5f7bb](https://github.com/getahead/noter/commit/2e5f7bba5d878ff6aaf1d945fcc9f766c67f11a9))
* **ui:** keep the Models & Runtimes pop-ups inside the card; dim footnote; local runtime status row ([#1229](https://github.com/getahead/noter/issues/1229)) ([cf7ac4d](https://github.com/getahead/noter/commit/cf7ac4dbb562bc0c4e74c78fead1693932eea615))
* **ui:** the Call display's Continue on a one-display Mac saves what it shows ([#1215](https://github.com/getahead/noter/issues/1215)) ([#1216](https://github.com/getahead/noter/issues/1216)) ([c2d4d4a](https://github.com/getahead/noter/commit/c2d4d4ad4bd02079e0b3ed16a4bbbcb51fcbca6c))

## [0.25.1](https://github.com/getahead/noter/compare/v0.25.0...v0.25.1) (2026-11-23)


### Bug fixes

* a self-test that gets no sound from macOS says so, ends on time and is logged ([#1211](https://github.com/getahead/noter/issues/1211)) ([#1212](https://github.com/getahead/noter/issues/1212)) ([8b0aa93](https://github.com/getahead/noter/commit/8b0aa93061a9f534e4fd6f913dfbfa309e688d7c))
* the self-test waits for macOS's permission prompts and for a running probe ([#1211](https://github.com/getahead/noter/issues/1211)) ([#1214](https://github.com/getahead/noter/issues/1214)) ([5ba7308](https://github.com/getahead/noter/commit/5ba7308f277fb83b72b3423eac6904d40e177bba))

## [0.25.0](https://github.com/getahead/noter/compare/v0.24.2...v0.25.0) (2026-11-22)


### Features

* **call-screen:** latency line and text size on the call screen ([#1181](https://github.com/getahead/noter/issues/1181)) ([7f81939](https://github.com/getahead/noter/commit/7f819397a93877d5d12e2f63f56f3e00fef36536))
* **contract:** contract 2.28 and the Claude sign-in code, from exploratory testing ([#1195](https://github.com/getahead/noter/issues/1195)) ([1edd076](https://github.com/getahead/noter/commit/1edd076e9b7cf2499d54b6c149d0a4ba411ddbc9))
* **contract:** device lists, transcription languages, latency and text size for Settings ([#1175](https://github.com/getahead/noter/issues/1175)) ([efb9779](https://github.com/getahead/noter/commit/efb977910ecdd8b774e2787dd5f115fa3f76473b))
* **contract:** pause hotkeys while recording a shortcut and audit key checks, from exploratory testing ([#1171](https://github.com/getahead/noter/issues/1171)) ([5deb79f](https://github.com/getahead/noter/commit/5deb79f93c0b36964175e2516d54deb300865c6e))
* **contract:** topic open questions and first-run API key removal from exploratory testing ([#1099](https://github.com/getahead/noter/issues/1099)) ([18e82f8](https://github.com/getahead/noter/commit/18e82f8181fc032dad0cc075f879bdd4b008bf76))


### Bug fixes

* **accounts:** sign in to Claude and ChatGPT through the real CLIs, and say why a sign-in is refused ([#1135](https://github.com/getahead/noter/issues/1135)) ([99e2bfe](https://github.com/getahead/noter/commit/99e2bfea59b679d1974548d4766b8a90bcb1e7c9))
* call page and export fixes from exploratory testing ([#1107](https://github.com/getahead/noter/issues/1107)) ([d0e90e5](https://github.com/getahead/noter/commit/d0e90e57ae69c4c101654e3f7c1b676777c2d377))
* capture clocks, pause and the call window from exploratory testing ([#1110](https://github.com/getahead/noter/issues/1110)) ([d304715](https://github.com/getahead/noter/commit/d3047154cf3beb6794bb22e6739c6d638942a145))
* capture warnings for silent system audio and a granted silent microphone, from exploratory testing ([#1192](https://github.com/getahead/noter/issues/1192)) ([407dd12](https://github.com/getahead/noter/commit/407dd12616061ecad225c461f5d9aaf539f84447))
* **core:** call length, first run, model resume and export fixes from exploratory testing ([#1176](https://github.com/getahead/noter/issues/1176)) ([095b995](https://github.com/getahead/noter/commit/095b995ee9e1644c615348d6fb0a8cfdeb0b85c3))
* **core:** read the accounts at launch so no_assistant is right from the start ([#1185](https://github.com/getahead/noter/issues/1185)) ([e8bc25d](https://github.com/getahead/noter/commit/e8bc25de64fae2bda215f4a3e8cdb4e9bec7e601))
* **core:** the setup window closes when Finish opens Today ([#1148](https://github.com/getahead/noter/issues/1148)) ([1e2bc50](https://github.com/getahead/noter/commit/1e2bc50283222cf02f6b83a9f3b087f0673e8508))
* **desktop:** ship the Voice to note app icon ([#1189](https://github.com/getahead/noter/issues/1189)) ([b4db2c7](https://github.com/getahead/noter/commit/b4db2c756c49433af4c41f711b28a16583d1a118))
* **engine:** keep engine paths under audio/, models/ and engine-io/ ([#1203](https://github.com/getahead/noter/issues/1203)) ([caf1aa3](https://github.com/getahead/noter/commit/caf1aa39bfdad283bf0e0cb2332541d22f80c02b))
* **engine:** never lose the first recording to a permission prompt ([#1168](https://github.com/getahead/noter/issues/1168)) ([f3ea019](https://github.com/getahead/noter/commit/f3ea0195e755201f6067a961d2230297aeff77e7))
* **export:** write a call as the PRD's folder with call.json, summary.md, transcript.md, SRT, JSON and audio ([#1202](https://github.com/getahead/noter/issues/1202)) ([75ab5e4](https://github.com/getahead/noter/commit/75ab5e4ab555585c17f96ac717ff93a3300466d6))
* **handoff:** pick the folder only on Choose…; Add Mapping saves the mapping ([#1174](https://github.com/getahead/noter/issues/1174)) ([3070bca](https://github.com/getahead/noter/commit/3070bca9621fe046166d58c6cef345eb5457bfba))
* **host:** a panel whose first load hung loads again after the watch restart ([#1178](https://github.com/getahead/noter/issues/1178)) ([2ff7f78](https://github.com/getahead/noter/commit/2ff7f784dd710e73e7aa76f14105743c1dbc0e7d))
* library and topics fixes from exploratory testing ([#1114](https://github.com/getahead/noter/issues/1114)) ([d70fc34](https://github.com/getahead/noter/commit/d70fc34a8a117e7aea3512fb5bf05e1fcd6cdd2e))
* library search item rows and people details from exploratory testing ([#1198](https://github.com/getahead/noter/issues/1198)) ([347c5f1](https://github.com/getahead/noter/commit/347c5f1f25d277214ff705d2579a694235f1012f))
* **llm:** make the CLI availability and lockdown tests deterministic under load ([#1182](https://github.com/getahead/noter/issues/1182)) ([b68ccca](https://github.com/getahead/noter/commit/b68ccca7aaadafd02d4ce31d90878c0bd14f6944))
* **macos:** ask for System Audio Recording in the app's Info.plist ([#1145](https://github.com/getahead/noter/issues/1145)) ([7bc5daa](https://github.com/getahead/noter/commit/7bc5daafa9e63d38dab88f44c577b595ff86a254))
* **macos:** drop the App Group and the engine sandbox for ad-hoc releases ([#1095](https://github.com/getahead/noter/issues/1095)) ([d7d4858](https://github.com/getahead/noter/commit/d7d485816f5595299b38373ce4ad12e7b171b452))
* **macos:** hide the call panel on close instead of destroying it ([#1108](https://github.com/getahead/noter/issues/1108)) ([06feb5e](https://github.com/getahead/noter/commit/06feb5e375b405b1f23cf7a7abd2a5a91b99a58c))
* **people:** count a person's topics the way Topics does ([#1177](https://github.com/getahead/noter/issues/1177)) ([f5dc7fd](https://github.com/getahead/noter/commit/f5dc7fd45f29de8dbbad10d26034bb35816de54e))
* shell, navigation, first-run and accessibility fixes from exploratory testing ([#1137](https://github.com/getahead/noter/issues/1137)) ([9cd2ab0](https://github.com/getahead/noter/commit/9cd2ab036df6dc7d46a70303247835df6faeecae))
* silent system audio for command-line players and launch at login in first run, from exploratory testing ([#1197](https://github.com/getahead/noter/issues/1197)) ([484c17c](https://github.com/getahead/noter/commit/484c17caeed87ada55dd5691fe39679d1ac37a4a))
* six verified exploratory-testing fixes that never reached main ([#1205](https://github.com/getahead/noter/issues/1205)) ([2d33e1f](https://github.com/getahead/noter/commit/2d33e1fc91df1848e534c58a2c4ad7ef2567ed83))
* speaker naming undo, no-assistant section and hotkey conflict label, from exploratory testing ([#1193](https://github.com/getahead/noter/issues/1193)) ([771ece8](https://github.com/getahead/noter/commit/771ece88af7797e8c77462e4d614506fc8e275f0))
* **test:** the model-download stall and bundle-resume tests wait on handshakes, not wall clock ([#1204](https://github.com/getahead/noter/issues/1204)) ([46394af](https://github.com/getahead/noter/commit/46394af2b54eae7c9cd95b60086b18fd43495bd5))
* **ui,native:** the first-run footer names the running macOS version ([#1199](https://github.com/getahead/noter/issues/1199)) ([c770605](https://github.com/getahead/noter/commit/c770605f7870af2c2378bc733f64c71024fbec03))
* **ui:** ⌘J reaches live even while the transcript view keeps re-rendering ([#1184](https://github.com/getahead/noter/issues/1184)) ([d811b4c](https://github.com/getahead/noter/commit/d811b4c1a49ac53f83d76d89b6b388d023b72f52))
* **ui:** add the Settings controls for microphone, output devices, languages, latency, text size, stages, release notes and model bundle ([#1179](https://github.com/getahead/noter/issues/1179)) ([5944518](https://github.com/getahead/noter/commit/594451810b9bdef63b8e3e6d6bcb434ac54c6a14))
* **ui:** delete-audio and key-removal follow-ups from exploratory testing ([#1165](https://github.com/getahead/noter/issues/1165)) ([a9cab42](https://github.com/getahead/noter/commit/a9cab42ae5689b08ff067f8b22d830d34f61e8db))
* **ui:** disable Library Export… while only calls still recording are selected ([#1206](https://github.com/getahead/noter/issues/1206)) ([63d37b1](https://github.com/getahead/noter/commit/63d37b1b11696fd451c1b143a35343b3e299e15c))
* **ui:** first run says Not verified yet before the self-test and names withheld system audio after it ([#1166](https://github.com/getahead/noter/issues/1166)) ([24f691d](https://github.com/getahead/noter/commit/24f691d881bc7fefafadca7227c293dddafe2769))
* **ui:** make item rows, Ask feedback and search hits match the approved prototype ([#1156](https://github.com/getahead/noter/issues/1156)) ([4d0adf9](https://github.com/getahead/noter/commit/4d0adf9bbe1fab2ad5a814e63ac36abe4e3cec3b))
* **ui:** make People, the Person page and the Ask toolbar match the approved prototype ([#1153](https://github.com/getahead/noter/issues/1153)) ([fbfa84c](https://github.com/getahead/noter/commit/fbfa84cc2e57320dedf48b29d90740898330ba6f))
* **ui:** make the Call page, Call info and page headings match the approved prototype ([#1147](https://github.com/getahead/noter/issues/1147)) ([8efec07](https://github.com/getahead/noter/commit/8efec072dfa1ed60992272564deca5fb7db3826e))
* **ui:** make the Calls page match the approved prototype ([#1105](https://github.com/getahead/noter/issues/1105)) ([30588a2](https://github.com/getahead/noter/commit/30588a2a51c895ea7f5ae2983fee4a8cb880918d))
* **ui:** make the Settings window match the approved prototype ([#1150](https://github.com/getahead/noter/issues/1150)) ([eb0be64](https://github.com/getahead/noter/commit/eb0be64023d80d58bf6b76899b1dc7808848d0cd))
* **ui:** make the Today page match the approved prototype ([#1101](https://github.com/getahead/noter/issues/1101)) ([7ad43c5](https://github.com/getahead/noter/commit/7ad43c5d5ad39a684409263c618a3126c375ba58))
* **ui:** match the Person overview, own-account tags and prototype to the design ([#1157](https://github.com/getahead/noter/issues/1157)) ([d9414b2](https://github.com/getahead/noter/commit/d9414b248bdf49552375f39360d54990c59449b0))
* **ui:** menus from the call window keep system size and stay inside the window at Text size 150 % ([#1191](https://github.com/getahead/noter/issues/1191)) ([9c74926](https://github.com/getahead/noter/commit/9c74926caa1a0869bc565021db92301f9e352785))
* **ui:** root error boundary, seeded self-test and steady account shots ([#1138](https://github.com/getahead/noter/issues/1138)) ([53c9d4a](https://github.com/getahead/noter/commit/53c9d4adb097237530110bbc28015c7e33029007))
* **ui:** scale the floating panel's header with Text size, like the call screen's ([#1187](https://github.com/getahead/noter/issues/1187)) ([7699720](https://github.com/getahead/noter/commit/7699720d56f747a2dac56903aefcce217e10987f))
* **ui:** toolbar inset and readable history from exploratory testing ([#1119](https://github.com/getahead/noter/issues/1119)) ([8cb116d](https://github.com/getahead/noter/commit/8cb116d2f57447848165a3c8993c4ede346a60a2))

## [0.24.2](https://github.com/getahead/noter/compare/v0.24.1...v0.24.2) (2026-11-21)


### Bug fixes

* **ui:** read minified hex colours so the native accent no longer blanks the window ([#1035](https://github.com/getahead/noter/issues/1035)) ([2116178](https://github.com/getahead/noter/commit/2116178183d0daacb49f079f5956960a17563957))

## [0.24.1](https://github.com/getahead/noter/compare/v0.24.0...v0.24.1) (2026-11-21)


### Bug fixes

* **core:** carry Library, Ask and People metadata ([#1031](https://github.com/getahead/noter/issues/1031)) ([7c1beb9](https://github.com/getahead/noter/commit/7c1beb9791699c55ca59e2313a0db83289df58fb))
* **macos:** recheck audio access and follow system accents ([#1032](https://github.com/getahead/noter/issues/1032)) ([85a0cee](https://github.com/getahead/noter/commit/85a0ceeb22b9f51dccbe497015832e59c994be19))
* **setup:** persist optional model downloads and await Welcome ([#1030](https://github.com/getahead/noter/issues/1030)) ([409da44](https://github.com/getahead/noter/commit/409da44530d539f6dc0dceffe4be6230c2a4bff7))

## [0.24.0](https://github.com/getahead/noter/compare/v0.23.0...v0.24.0) (2026-11-19)


### Features

* **contract:** account_use_existing carries the personal-use confirmation ([#1008](https://github.com/getahead/noter/issues/1008)) ([8089c09](https://github.com/getahead/noter/commit/8089c09f7a33eee0af8bc293037fadead706fa1a))


### Bug fixes

* **core:** a model file that cannot be written fails as internal, not disk_full, and is logged ([#1002](https://github.com/getahead/noter/issues/1002)) ([1f9d8e7](https://github.com/getahead/noter/commit/1f9d8e7b2dcec9acc0de8d60a4cbc4e5e1fc9723))
* **fake:** claude reuse needs the personal-use box, as on the real core ([#1014](https://github.com/getahead/noter/issues/1014)) ([77c13af](https://github.com/getahead/noter/commit/77c13afae753da199acda1585a95040543ba7979))
* **fake:** match the real core for people_merge, call_tags_set, search and ask not-found ([#994](https://github.com/getahead/noter/issues/994)) ([2f7bb55](https://github.com/getahead/noter/commit/2f7bb5565667ef7c5d9bd41341226615f759e771))
* resolve actionable desktop and engine bugs ([#1028](https://github.com/getahead/noter/issues/1028)) ([3ea0fef](https://github.com/getahead/noter/commit/3ea0fef4f2b76a2951ac326393cd57e9075c6796))
* **ui:** a failed model download gives models the error glyph, like a failed check ([#1010](https://github.com/getahead/noter/issues/1010)) ([9d9ba73](https://github.com/getahead/noter/commit/9d9ba73f977abccaae9c5e04e69f85651045fa0f))
* **ui:** first-run models say download failed apart from check failed, and no bundle reads 0 gb ([#1003](https://github.com/getahead/noter/issues/1003)) ([109a469](https://github.com/getahead/noter/commit/109a46902eb5c0a246095f4832f2d091d41e86b8))
* **ui:** use this account sends the personal-use box and shows a refusal ([#1012](https://github.com/getahead/noter/issues/1012)) ([1ee5e45](https://github.com/getahead/noter/commit/1ee5e452f9944aeb993663b1081f334108e1057a))

## [0.23.0](https://github.com/getahead/noter/compare/v0.22.16...v0.23.0) (2026-11-18)


### Features

* **contract:** mark a stopped Ask turn in the stored answer ([#899](https://github.com/getahead/noter/issues/899)) ([da7df3f](https://github.com/getahead/noter/commit/da7df3f8570cb854bcd4b875b947b4893a692f98))
* **contract:** person rows carry notes and the you-owe count ([#906](https://github.com/getahead/noter/issues/906)) ([cca9c64](https://github.com/getahead/noter/commit/cca9c6498a4bb4f7b685722a2488f2216bea684a))
* **contract:** the audit log filters by call and counts its range ([#911](https://github.com/getahead/noter/issues/911)) ([3fbd5fa](https://github.com/getahead/noter/commit/3fbd5faaddbfb519b7ae2a74545f2d464caf1af9))
* **contract:** the Settings window may read the people list ([#918](https://github.com/getahead/noter/issues/918)) ([d36d5b6](https://github.com/getahead/noter/commit/d36d5b6a107c64bf35b3be281d522bd9e5fb576b))
* **ui:** account rows with Test and Sign Out ([#894](https://github.com/getahead/noter/issues/894)) ([ac2705b](https://github.com/getahead/noter/commit/ac2705bd8299d5f3dc051c9baa7082fb8aa59d03))
* **ui:** add the Knowledge Sources pane with Add Folder and Add MCP Server ([#904](https://github.com/getahead/noter/issues/904)) ([e49d780](https://github.com/getahead/noter/commit/e49d780c8b167c1ac380c8d185530b64358abbe5))
* **ui:** add the people list with search, selection and unnamed speakers ([#896](https://github.com/getahead/noter/issues/896)) ([adc3b39](https://github.com/getahead/noter/commit/adc3b3923cb71873bd5d63fefca28fe9c6232c41))
* **ui:** add the person page with overview, calls and history ([#908](https://github.com/getahead/noter/issues/908)) ([1d54d4a](https://github.com/getahead/noter/commit/1d54d4a1c65ebec42ab8fb965586b70bfb224baf))
* **ui:** add the shared status row ([#898](https://github.com/getahead/noter/issues/898)) ([30bb651](https://github.com/getahead/noter/commit/30bb651d56ed0df4de50391b659c6cb09fc9b5f2))
* **ui:** add, edit, merge and delete a person ([#915](https://github.com/getahead/noter/issues/915)) ([8181d1e](https://github.com/getahead/noter/commit/8181d1e2cd4be91cf248904c008f8f5872c7a255))
* **ui:** ask — cited answers, sources, copy with citations, playback, recent-row menu (slice 2) ([#914](https://github.com/getahead/noter/issues/914)) ([9943d66](https://github.com/getahead/noter/commit/9943d66642cbd4c45d91ee853478c88390d457fa))
* **ui:** ask — new-topic:&lt;id&gt; route (Ask About This Thread) ([#936](https://github.com/getahead/noter/issues/936)) ([bfd9422](https://github.com/getahead/noter/commit/bfd942243123037eef08b37d0202de240ec33bf6))
* **ui:** ask — start the question a new:&lt;words&gt; route carries ([#923](https://github.com/getahead/noter/issues/923)) ([8fe4700](https://github.com/getahead/noter/commit/8fe47005bcd26d3393e702ee682d93a8fc98e419))
* **ui:** ask — started line, widen scope, gap recovery, topic scope option (2.23) ([#953](https://github.com/getahead/noter/issues/953)) ([e58e574](https://github.com/getahead/noter/commit/e58e5747c862ac78071ad23c9da79766b6687249))
* **ui:** ask page — recent questions, composer, streamed answer, stop (slice 1) ([#895](https://github.com/getahead/noter/issues/895)) ([7a3ef18](https://github.com/getahead/noter/commit/7a3ef1862027b4b1fd7032e12ab17682f43fbd14))
* **ui:** cdsl markers and ticks, CLI-missing note, stale Test line (2.25 slice 3) ([#929](https://github.com/getahead/noter/issues/929)) ([4d1175b](https://github.com/getahead/noter/commit/4d1175b2ee4ff7139be65ddaa4650e794340f4e4))
* **ui:** export the selected Calls with Export… and ⌘E ([#912](https://github.com/getahead/noter/issues/912)) ([1af82f8](https://github.com/getahead/noter/commit/1af82f8be7eb11958b23a7df7968b48c6dc3cf91))
* **ui:** filter the privacy audit by call and show the core's total ([#913](https://github.com/getahead/noter/issues/913)) ([4757f7d](https://github.com/getahead/noter/commit/4757f7d2e9a2d90c3c966f99c022367f028f4d60))
* **ui:** let a page move the main window to a route the core has no target for ([#905](https://github.com/getahead/noter/issues/905)) ([f869d9f](https://github.com/getahead/noter/commit/f869d9fa343c1b7f7759a3fcee3724ecfe26ba16))
* **ui:** library filter bar, filtered Calls and batch tags ([#902](https://github.com/getahead/noter/issues/902)) ([b118b61](https://github.com/getahead/noter/commit/b118b61a2a202a342c152b0a78c0d26f741625a9))
* **ui:** library search results, # tag suggestions and TopicChip (2.22) ([#922](https://github.com/getahead/noter/issues/922)) ([3a502ea](https://github.com/getahead/noter/commit/3a502ea037d52e03f18d62cd4c2d549cbc7a8911))
* **ui:** library search results, topics e2e, ask about a topic, cdsl markers and dod ticks (library 2.22) ([#941](https://github.com/getahead/noter/issues/941)) ([65188f9](https://github.com/getahead/noter/commit/65188f9bd75a0bf9acc0b7c880790f044b2d2439))
* **ui:** name unnamed speakers from People ([#930](https://github.com/getahead/noter/issues/930)) ([6bf0ef1](https://github.com/getahead/noter/commit/6bf0ef1caa1204c814be15dd3709cea51bd78683))
* **ui:** people pop-up search list, remove tag in the calls menu (library 2.22) ([#938](https://github.com/getahead/noter/issues/938)) ([b09a836](https://github.com/getahead/noter/commit/b09a836984a1f799553cc4e3f60fbbe4bd301026))
* **ui:** rename, merge and keep separate topics (library 2.22, slice 2) ([#926](https://github.com/getahead/noter/issues/926)) ([6fbefdc](https://github.com/getahead/noter/commit/6fbefdcf92f59a69944b267459c854078713869e))
* **ui:** share the person chip and let the person picker choose several people ([#909](https://github.com/getahead/noter/issues/909)) ([a01155e](https://github.com/getahead/noter/commit/a01155ee6589d515a97dffa0bc4b23db9baf9639))
* **ui:** show what left this Mac in Settings Privacy ([#893](https://github.com/getahead/noter/issues/893)) ([4605031](https://github.com/getahead/noter/commit/4605031a11b3e3bd96dfb43190fca7230694a33f))
* **ui:** sign-in sheet and session machine for own accounts (2.25 slice 2) ([#924](https://github.com/getahead/noter/issues/924)) ([944dbfc](https://github.com/getahead/noter/commit/944dbfc307dee43e3b6d8054cf7d56673e382419))
* **ui:** source details, update, revoke, remove, scope, and the privacy E2E stories ([#921](https://github.com/getahead/noter/issues/921)) ([a4c0829](https://github.com/getahead/noter/commit/a4c0829f28a1950ad8652589bdd99aab9631ac35))
* **ui:** topic suggestion row in search results, focusable thread rows (library 2.22) ([#935](https://github.com/getahead/noter/issues/935)) ([3187a49](https://github.com/getahead/noter/commit/3187a499af34be5f8cfe4387ae6c0dec9233700f))
* **ui:** topics list and topic thread (library 2.22, slice 1) ([#897](https://github.com/getahead/noter/issues/897)) ([0dcdc81](https://github.com/getahead/noter/commit/0dcdc8182fa99174b902ade147ec4e1184435468))
* **ui:** voice profile on the person page, naming follow-ups ([#947](https://github.com/getahead/noter/issues/947)) ([2b1722c](https://github.com/getahead/noter/commit/2b1722cbda392aaf499e24c8d312dc6011639e68))


### Bug fixes

* **core:** refuse a topic rename to a name another topic has ([#903](https://github.com/getahead/noter/issues/903)) ([1b22103](https://github.com/getahead/noter/commit/1b22103caa5e45568352d78a882802a66793b042))
* **core:** the account row reports the CLI its sign-in uses ([#900](https://github.com/getahead/noter/issues/900)) ([e268174](https://github.com/getahead/noter/commit/e268174f429a85f7f920c714ed37f18a6fddc00c))
* **core:** wait for the model download job to stop before refresh_models in its test ([#891](https://github.com/getahead/noter/issues/891)) ([e744272](https://github.com/getahead/noter/commit/e744272f864a18766bedfc9b5918a82c2f0f2ad1))
* **deps:** Bump the npm-minor group across 1 directory with 4 updates ([#871](https://github.com/getahead/noter/issues/871)) ([1ac1b76](https://github.com/getahead/noter/commit/1ac1b76ea98a49f94adc1aad06d65cdff100ab12))
* **desktop:** send native menu contexts in order ([#887](https://github.com/getahead/noter/issues/887)) ([ddd69e1](https://github.com/getahead/noter/commit/ddd69e19ef5872503ce2cf77d1c95b7f68ecb404))
* **engine-client:** a restart inside 1 ms still reports an engine_restart gap ([#883](https://github.com/getahead/noter/issues/883)) ([8ed1556](https://github.com/getahead/noter/commit/8ed15566ea015ca4194e45f5cc6e6c2b4a87e01b))
* **llm:** read the Claude sign-in from the CLI for own-account runs ([#889](https://github.com/getahead/noter/issues/889)) ([10c9f2e](https://github.com/getahead/noter/commit/10c9f2e3ba96185f2e903eadde3a973631bada74))
* synchronize completion and desktop navigation ([#966](https://github.com/getahead/noter/issues/966)) ([07d6dbe](https://github.com/getahead/noter/commit/07d6dbedc76077f5dad64fa27364b573e078d6ba)), closes [#917](https://github.com/getahead/noter/issues/917) [#919](https://github.com/getahead/noter/issues/919) [#928](https://github.com/getahead/noter/issues/928) [#939](https://github.com/getahead/noter/issues/939) [#945](https://github.com/getahead/noter/issues/945) [#955](https://github.com/getahead/noter/issues/955)
* **ui:** ask — recent in the toolbar below wide, focus hand-offs, citation speaker (2.23 qa) ([#969](https://github.com/getahead/noter/issues/969)) ([788f170](https://github.com/getahead/noter/commit/788f17050a283d8ec20e92ccbf8c4e90327428c4))
* **ui:** ask — toolbar title no longer squeezed at Medium ([#927](https://github.com/getahead/noter/issues/927)) ([43f5b32](https://github.com/getahead/noter/commit/43f5b323086cfdcb074c32c402b023d26e69183b))
* **ui:** esc closes a popover from anywhere and returns focus to its anchor (library 2.22) ([#971](https://github.com/getahead/noter/issues/971)) ([c53d8d2](https://github.com/getahead/noter/commit/c53d8d2e07694223806130f14552abc9d8a03684))
* **ui:** export is off while a call has no audit rows ([#925](https://github.com/getahead/noter/issues/925)) ([b8dc9f4](https://github.com/getahead/noter/commit/b8dc9f4189974c7a05574806b4ba0aec278cddc6))
* **ui:** focus is lost only on the body or region, failed naming reload forgets focus, merged render without profiles ([#967](https://github.com/getahead/noter/issues/967)) ([fb4aa22](https://github.com/getahead/noter/commit/fb4aa22e88c2d782f041c0dfc753ef51849a4033))
* **ui:** keep focus on the opener when a sheet or form closes after a mouse click ([#951](https://github.com/getahead/noter/issues/951)) ([109e9d5](https://github.com/getahead/noter/commit/109e9d518a3d25d3c3ef49c6b16c2bdc89d6e984))
* **ui:** one re-index in flight per source, and visual specs for all six status row variants ([#950](https://github.com/getahead/noter/issues/950)) ([a2b9e12](https://github.com/getahead/noter/commit/a2b9e12c30d26beb468b655a5bb1ff39613d4b9b))
* **ui:** people ac2: first-click cancel, focus returns to the opener with the mouse ([#964](https://github.com/getahead/noter/issues/964)) ([eb2ad6b](https://github.com/getahead/noter/commit/eb2ad6b83409f43e3eb7ccbccdfa8354f2a477c1))
* **ui:** restore focus after a Remove started by a mouse click ([#944](https://github.com/getahead/noter/issues/944)) ([8c99dd5](https://github.com/getahead/noter/commit/8c99dd582a74649227a901987f552b367a919f6b))
* **ui:** return focus to the control the mouse pressed when a sheet closes ([#943](https://github.com/getahead/noter/issues/943)) ([b75362e](https://github.com/getahead/noter/commit/b75362ec99a2b407caaed67be5deef5ace1e6440))
* **ui:** return focus to the row's sign in button after a confirmed sign out ([#957](https://github.com/getahead/noter/issues/957)) ([73dd47f](https://github.com/getahead/noter/commit/73dd47f16bf5a727e634ecc92735dc0518e0e23c))
* **ui:** storage Change says it is available in a later version, and small scope notes ([#931](https://github.com/getahead/noter/issues/931)) ([b9d1633](https://github.com/getahead/noter/commit/b9d1633936bf1c51d381517864aff0c12878da6c))
* **ui:** the toolbar search field shows the words of the search route it lands on ([#916](https://github.com/getahead/noter/issues/916)) ([790b5c7](https://github.com/getahead/noter/commit/790b5c7463ec61700d7cb276cc00a09df02f8c5b))
* **ui:** toolbar button focus rings, export menu order, no-matches announced, esc on show how returns focus (library 2.22) ([#960](https://github.com/getahead/noter/issues/960)) ([233fa5e](https://github.com/getahead/noter/commit/233fa5eec29fc8d6b715bafccf96a5025c4395c9))
* **ui:** topic rename, merge and keep separate polish (library 2.22) ([#932](https://github.com/getahead/noter/issues/932)) ([7b2c26d](https://github.com/getahead/noter/commit/7b2c26dc0d96de30b01efdc024c4d6e1a4535e9b))
* **ui:** turn off system text assists on search fields so the first Esc clears the text ([#875](https://github.com/getahead/noter/issues/875)) ([ca64c3d](https://github.com/getahead/noter/commit/ca64c3de1f4f292fc8f0c87611d509df6d6665d4))

## [0.22.16](https://github.com/getahead/noter/compare/v0.22.15...v0.22.16) (2026-11-16)


### Bug fixes

* **deps:** bump the cargo-minor group across 1 directory with 2 updates ([#873](https://github.com/getahead/noter/issues/873)) ([72c5052](https://github.com/getahead/noter/commit/72c50521f1e3b05fe6e20dd5280aacb1d289d42e))

## [0.22.15](https://github.com/getahead/noter/compare/v0.22.14...v0.22.15) (2026-11-14)


### Bug fixes

* **desktop:** deliver native navigation, menus, and window chrome ([#828](https://github.com/getahead/noter/issues/828)) ([9d743c6](https://github.com/getahead/noter/commit/9d743c629b75e957294cebf9404cffae824e4057))

## [0.22.14](https://github.com/getahead/noter/compare/v0.22.13...v0.22.14) (2026-11-14)


### Bug fixes

* **core:** publish local router failover state ([#861](https://github.com/getahead/noter/issues/861)) ([893e584](https://github.com/getahead/noter/commit/893e5849ca057c09efc80dd1c4c1009422f607f0))
* **core:** restore library and Today call details ([#851](https://github.com/getahead/noter/issues/851)) ([30779ca](https://github.com/getahead/noter/commit/30779ca923a5f18675f7e894963f8520e7afeef3))

## [0.22.13](https://github.com/getahead/noter/compare/v0.22.12...v0.22.13) (2026-11-14)


### Bug fixes

* **core-harness:** route capture sessions through scripted engine ([#845](https://github.com/getahead/noter/issues/845)) ([285b9bc](https://github.com/getahead/noter/commit/285b9bc21b7110b7411d1513b77c89c2416ff452))
* **core:** enforce scheduler battery admission ([#843](https://github.com/getahead/noter/issues/843)) ([c0dbcb2](https://github.com/getahead/noter/commit/c0dbcb23ab2eaa76d686c4906facf32b37859ed3))
* **native:** avoid transient status menu snapshot queries ([#839](https://github.com/getahead/noter/issues/839)) ([c004de7](https://github.com/getahead/noter/commit/c004de79a3d68341e52aa15486708cf354bbb904)), closes [#837](https://github.com/getahead/noter/issues/837)
* **ui:** keep Today current and localize messages ([#834](https://github.com/getahead/noter/issues/834)) ([ce6e7e3](https://github.com/getahead/noter/commit/ce6e7e333c3f86470b620ca97dfe3f2668ae3c6f))
* **ui:** remove duplicate glass style declaration ([#850](https://github.com/getahead/noter/issues/850)) ([cc2b9f7](https://github.com/getahead/noter/commit/cc2b9f702202a4d3e50668d4f026f38d6da6eb33))
* **ui:** wrap item inspector evidence quotes ([#846](https://github.com/getahead/noter/issues/846)) ([ec41555](https://github.com/getahead/noter/commit/ec415553734e560bec06d3d2d9091c469050bc85))

## [0.22.12](https://github.com/getahead/noter/compare/v0.22.11...v0.22.12) (2026-11-14)


### Performance

* **core:** bound reads and stream batch exports ([#830](https://github.com/getahead/noter/issues/830)) ([9fc05ed](https://github.com/getahead/noter/commit/9fc05ede450419403cba7b189a8928c0e65548e2))

## [0.22.11](https://github.com/getahead/noter/compare/v0.22.10...v0.22.11) (2026-11-14)


### Bug fixes

* **core:** improve scoped retrieval evidence quality ([#808](https://github.com/getahead/noter/issues/808)) ([d68dfc0](https://github.com/getahead/noter/commit/d68dfc0edbea0e7a789c931c6cd184201b236caa))
* **core:** isolate capture diagnostics and notices ([#791](https://github.com/getahead/noter/issues/791)) ([2b772e4](https://github.com/getahead/noter/commit/2b772e43e666578131eb08d611b2e8162449ab8a)), closes [#604](https://github.com/getahead/noter/issues/604) [#606](https://github.com/getahead/noter/issues/606) [#614](https://github.com/getahead/noter/issues/614) [#619](https://github.com/getahead/noter/issues/619)
* **core:** keep folder sync and source lifecycle current ([#812](https://github.com/getahead/noter/issues/812)) ([81b988a](https://github.com/getahead/noter/commit/81b988a2296793d22f10639a75a790f97026c482))
* **core:** make account probes and sign-in tests reliable ([#811](https://github.com/getahead/noter/issues/811)) ([4b00db6](https://github.com/getahead/noter/commit/4b00db654f05515676eea92c99c5296a0e1e60ef))
* **core:** order deferred job completion ([#818](https://github.com/getahead/noter/issues/818)) ([f72a4dc](https://github.com/getahead/noter/commit/f72a4dc41efde9fa8c7d0c906bf0d1515962dfef)), closes [#586](https://github.com/getahead/noter/issues/586) [#603](https://github.com/getahead/noter/issues/603) [#625](https://github.com/getahead/noter/issues/625)
* **core:** preserve archive and transcript state across stops ([#793](https://github.com/getahead/noter/issues/793)) ([2762169](https://github.com/getahead/noter/commit/2762169d242cfc98fd7c7d992f8c4a50056dbf05))
* **core:** preserve capture state across engine restarts ([#804](https://github.com/getahead/noter/issues/804)) ([07c3176](https://github.com/getahead/noter/commit/07c3176ef8a46a26d5723bb59215144eaf1e9df6))
* **core:** preserve recoverable call recordings and deletion ([#800](https://github.com/getahead/noter/issues/800)) ([16327c0](https://github.com/getahead/noter/commit/16327c05d0392b54d01642459da2d5b6b78625a7))
* **core:** prevent presenting deadlocks and stabilize native recovery ([#809](https://github.com/getahead/noter/issues/809)) ([540f64c](https://github.com/getahead/noter/commit/540f64c6c91aad5a9c3eb50d1d4d90208891bad4))
* **core:** protect model context, handoff evidence, and exports ([#802](https://github.com/getahead/noter/issues/802)) ([008d5ef](https://github.com/getahead/noter/commit/008d5efb58482d42d2fbde0473cb69c4bd8b9a6b))
* **engine:** preserve capture quality across sessions ([#814](https://github.com/getahead/noter/issues/814)) ([50c00e1](https://github.com/getahead/noter/commit/50c00e16103f92d848c1bdf0785c6036cd9409f2))
* **fake:** align history, handoff, and audio behavior ([#813](https://github.com/getahead/noter/issues/813)) ([195868c](https://github.com/getahead/noter/commit/195868c37a1fd5b4a6e19dce4942afb0c2952c64))
* **history:** show accurate authors and complete history efficiently ([#795](https://github.com/getahead/noter/issues/795)) ([3b32c11](https://github.com/getahead/noter/commit/3b32c11b379b0c6dfdd8d3044973bf594cff31de))
* **host:** place native call surfaces within display bounds ([#805](https://github.com/getahead/noter/issues/805)) ([78edf2d](https://github.com/getahead/noter/commit/78edf2dce64307fd1566c170b38547079be64b34)), closes [#489](https://github.com/getahead/noter/issues/489) [#490](https://github.com/getahead/noter/issues/490) [#686](https://github.com/getahead/noter/issues/686) [#707](https://github.com/getahead/noter/issues/707) [#751](https://github.com/getahead/noter/issues/751)
* **host:** repair native quit and window lifecycle ([#801](https://github.com/getahead/noter/issues/801)) ([a260883](https://github.com/getahead/noter/commit/a260883f8dd0b70b769ed54ae889d43175888509))
* **ui:** correct output views and sharing interactions ([#803](https://github.com/getahead/noter/issues/803)) ([cea3073](https://github.com/getahead/noter/commit/cea3073f7dc818976f39a993fe953ea54e9b6788))
* **ui:** correct transcript lines, terms and focus ([#796](https://github.com/getahead/noter/issues/796)) ([4f31b52](https://github.com/getahead/noter/commit/4f31b52454bffe9a7c6adfb9da86a0a2277fbfcf))
* **ui:** keep call flow failures visible ([#816](https://github.com/getahead/noter/issues/816)) ([6130d87](https://github.com/getahead/noter/commit/6130d87316ce5d7ec7b0ce99fb0131d089921802))
* **ui:** keep Calls paging and selection consistent ([#798](https://github.com/getahead/noter/issues/798)) ([4ab9328](https://github.com/getahead/noter/commit/4ab9328e9a36eabda3fe8eb28c1e17d8a60eb600))
* **ui:** keep item review flow current ([#790](https://github.com/getahead/noter/issues/790)) ([b6a76c1](https://github.com/getahead/noter/commit/b6a76c127fbc2876c91cdfdf5c8ca6ce7924473f))
* **ui:** keep speaker identity consistent across naming flows ([#806](https://github.com/getahead/noter/issues/806)) ([3958f2a](https://github.com/getahead/noter/commit/3958f2a2bb00ac3c14af1bb2881b1141110387d3))
* **ui:** recover Settings and first-run failures ([#797](https://github.com/getahead/noter/issues/797)) ([ce5d09c](https://github.com/getahead/noter/commit/ce5d09c13e5f9241eb7c5c8c1d81b090ed34e93b))
* **ui:** restore accessible announcements and focus ([#794](https://github.com/getahead/noter/issues/794)) ([aa6dcc9](https://github.com/getahead/noter/commit/aa6dcc97c203da285b2e026e8460ed1a6af67d13))
* **ui:** restore bridge streams and fake capture parity ([#792](https://github.com/getahead/noter/issues/792)) ([e7b24c8](https://github.com/getahead/noter/commit/e7b24c884b742ed1e290406b95da5ea1387ccd71)), closes [#710](https://github.com/getahead/noter/issues/710) [#715](https://github.com/getahead/noter/issues/715) [#728](https://github.com/getahead/noter/issues/728) [#732](https://github.com/getahead/noter/issues/732) [#733](https://github.com/getahead/noter/issues/733) [#734](https://github.com/getahead/noter/issues/734)
* **ui:** route shared keyboard and help tag behavior ([#810](https://github.com/getahead/noter/issues/810)) ([830af5a](https://github.com/getahead/noter/commit/830af5a74e0d632a77f0d37d70cbf037aab0dabe))


### Performance

* **engine:** reduce offline archive and file replay work ([#821](https://github.com/getahead/noter/issues/821)) ([fe6e263](https://github.com/getahead/noter/commit/fe6e263d9c48ba51b52394aaed16d13c861054dd))
* **ui:** streamline formatters and transcript updates ([#815](https://github.com/getahead/noter/issues/815)) ([b96caac](https://github.com/getahead/noter/commit/b96caac27b861261c1d1fab978b41fd92e163893))

## [0.22.10](https://github.com/getahead/noter/compare/v0.22.9...v0.22.10) (2026-11-13)


### Bug fixes

* **core:** prevent partial person-name leaks in cloud pseudonyms ([#761](https://github.com/getahead/noter/issues/761)) ([095c78a](https://github.com/getahead/noter/commit/095c78ac2222aafd01c5d1047c6e861e31b5ac3a))
* **host:** isolate core harness behind opt-in test hooks ([#770](https://github.com/getahead/noter/issues/770)) ([6096c37](https://github.com/getahead/noter/commit/6096c375eb76b4ffe26f0650bcbbe9ebce101ee0))

## [0.22.9](https://github.com/getahead/noter/compare/v0.22.8...v0.22.9) (2026-11-13)


### Bug fixes

* **core:** keep folder sync running past unreadable files ([#778](https://github.com/getahead/noter/issues/778)) ([4497669](https://github.com/getahead/noter/commit/44976692395a201f8f181e0cfb90040426365ba1))
* **core:** preserve levels sequence across subscriptions ([#787](https://github.com/getahead/noter/issues/787)) ([ef1f17e](https://github.com/getahead/noter/commit/ef1f17efdd69a2cfbd44a5f49316da21b284f96b))
* **core:** reject conflicting tags and handle unchanged writes ([#782](https://github.com/getahead/noter/issues/782)) ([f62954d](https://github.com/getahead/noter/commit/f62954daaa6e3cf7a63be1a4337e4cb84983a482))
* **core:** restrict account checks to their own runtime ([#774](https://github.com/getahead/noter/issues/774)) ([8deafa0](https://github.com/getahead/noter/commit/8deafa0e16ce8903894c721639719a4c2da6a851))
* **engine:** confine capture and replay paths to container ([#779](https://github.com/getahead/noter/issues/779)) ([52c604f](https://github.com/getahead/noter/commit/52c604f36bed0ae2c25a7394e3d8e565c6108df9))
* **engine:** preserve segments in other languages ([#776](https://github.com/getahead/noter/issues/776)) ([2197602](https://github.com/getahead/noter/commit/2197602689a7d7abf8127b815061269ddc531356))
* **host:** restrict window capabilities to bridge permissions ([#781](https://github.com/getahead/noter/issues/781)) ([56420a4](https://github.com/getahead/noter/commit/56420a42934b08d046c7e4524bc7f68198d72de7))
* **ui:** detach live transcript on the first upward pixel ([#784](https://github.com/getahead/noter/issues/784)) ([d6502ec](https://github.com/getahead/noter/commit/d6502ec118ee325bcb9a6009399fc428bd2e7693))

## [0.22.8](https://github.com/getahead/noter/compare/v0.22.7...v0.22.8) (2026-11-13)


### Bug fixes

* **ci:** temporarily vendor pinned Constructor Studio runtime ([#771](https://github.com/getahead/noter/issues/771)) ([59f0d39](https://github.com/getahead/noter/commit/59f0d390a1553d29bfdc11aa290b6bae64fa76ab))
* **core:** apply privacy changes to active model runs ([#763](https://github.com/getahead/noter/issues/763)) ([509f5e2](https://github.com/getahead/noter/commit/509f5e2ef965e60569dc158aa2b1eb0138a7f46d))
* **core:** bound idle OAuth callback connections ([#764](https://github.com/getahead/noter/issues/764)) ([b2e7cab](https://github.com/getahead/noter/commit/b2e7cabd545c1e06dcace9bff95d5a3eb32da64c))
* **core:** bound stream acknowledgements to published sequence ([#767](https://github.com/getahead/noter/issues/767)) ([61c8707](https://github.com/getahead/noter/commit/61c8707664b4f139a8435db4415450767074fcfa))
* **core:** delete stopped-call M4A recordings ([#762](https://github.com/getahead/noter/issues/762)) ([b78582f](https://github.com/getahead/noter/commit/b78582f19ce86df48f4b4b54a4f2b6c1bee9d13a))
* **core:** enforce people and call scopes for knowledge sources ([#765](https://github.com/getahead/noter/issues/765)) ([ef927eb](https://github.com/getahead/noter/commit/ef927eb40d91ddb3f8ba11fe7e047e337bbb6c2e))
* **core:** escape owner facts in Markdown shares ([#766](https://github.com/getahead/noter/issues/766)) ([7c4bd7b](https://github.com/getahead/noter/commit/7c4bd7b31f9023a54f8ebdd2b4850bd17506b233))
* **core:** match keyword words after punctuation ([#780](https://github.com/getahead/noter/issues/780)) ([c8bc3a6](https://github.com/getahead/noter/commit/c8bc3a65ef735b8e61e44458658b3df3acc8efc7))
* **core:** populate call participants and review counts ([#777](https://github.com/getahead/noter/issues/777)) ([f21c4c6](https://github.com/getahead/noter/commit/f21c4c6d9a6ec7339933c22c8c061a16817ffc8e))
* **core:** refresh live speaker names after corrections ([#775](https://github.com/getahead/noter/issues/775)) ([4a6b2ac](https://github.com/getahead/noter/commit/4a6b2acff4231600bfcc5be012430fbe93e6f914))
* **engine:** clear capture ring on clean stop ([#768](https://github.com/getahead/noter/issues/768)) ([c5ea061](https://github.com/getahead/noter/commit/c5ea061c7eed8297c634f579891f77b566b0e93a))
* **host:** declare microphone and calendar access in app bundle ([#773](https://github.com/getahead/noter/issues/773)) ([dbeb3c8](https://github.com/getahead/noter/commit/dbeb3c85467bbecd28dad3b8e52807c65ec6f983))
* **ui:** prevent overlapping item completion actions ([#769](https://github.com/getahead/noter/issues/769)) ([1780ec7](https://github.com/getahead/noter/commit/1780ec723a798c86a49e579fe6c80145d79b77f0))

## [0.22.7](https://github.com/getahead/noter/compare/v0.22.6...v0.22.7) (2026-11-10)


### Bug fixes

* **deps:** regenerate Cargo.lock after concurrent Dependabot merges ([#684](https://github.com/getahead/noter/issues/684)) ([de36d0c](https://github.com/getahead/noter/commit/de36d0c20dff4f2ae5fe710cfbbe09d705b30138))

## [0.22.6](https://github.com/getahead/noter/compare/v0.22.5...v0.22.6) (2026-11-09)


### Bug fixes

* **deps:** bump @tauri-apps/plugin-dialog from 2.8.3 to 2.8.4 in the npm-minor group across 1 directory ([#564](https://github.com/getahead/noter/issues/564)) ([4817dc6](https://github.com/getahead/noter/commit/4817dc640d4b8a9a33a9404763fdbeae766224a2))
* **deps:** bump base64 from 0.22.1 to 0.23.1 in /apps/desktop/src-tauri ([#573](https://github.com/getahead/noter/issues/573)) ([2dd8996](https://github.com/getahead/noter/commit/2dd89966fd89b396a433d8e0f770a695c278f029))
* **deps:** bump chacha20poly1305 from 0.10.1 to 0.11.0 ([#563](https://github.com/getahead/noter/issues/563)) ([885ea77](https://github.com/getahead/noter/commit/885ea77b43db9e62cb0dd990a7f1ba03742e74e6))
* **deps:** bump html2text from 0.15.5 to 0.17.4 ([#565](https://github.com/getahead/noter/issues/565)) ([8420c49](https://github.com/getahead/noter/commit/8420c4917b7b8d203c3de2a4e3a5c7ebf2fe0d5a))
* **deps:** bump minisign from 0.7.9 to 0.10.0 in /apps/desktop/src-tauri ([#574](https://github.com/getahead/noter/issues/574)) ([85c9c8c](https://github.com/getahead/noter/commit/85c9c8c31b2a0860fd260fa07b32a0439df4eb86))
* **deps:** bump the cargo-minor group across 2 directories with 6 updates ([#571](https://github.com/getahead/noter/issues/571)) ([76b6e52](https://github.com/getahead/noter/commit/76b6e5290e310e3cff1a07de3f25dba1e63e12b6))

## [0.22.5](https://github.com/getahead/noter/compare/v0.22.4...v0.22.5) (2026-11-08)


### Bug fixes

* **desktop:** a page that never finishes loading gets a new web process ([#558](https://github.com/getahead/noter/issues/558)) ([b9e2a36](https://github.com/getahead/noter/commit/b9e2a3649440ff9a4f70c0807d18c28ef29f0fff))

## [0.22.4](https://github.com/getahead/noter/compare/v0.22.3...v0.22.4) (2026-11-08)


### Bug fixes

* **ui:** a superseded transcript subscribe no longer clears the newer one's slow mark ([#548](https://github.com/getahead/noter/issues/548)) ([8ad5af9](https://github.com/getahead/noter/commit/8ad5af9eb31196d9516a632511022ef2094c4ac5))
* **ui:** the capture notice is a labelled group, not an alert dialog ([#553](https://github.com/getahead/noter/issues/553)) ([363501d](https://github.com/getahead/noter/commit/363501dcaae540c5b6febe301935ac6776b17ffc))
* **ui:** the live log stops following while a rename popover is open ([#550](https://github.com/getahead/noter/issues/550)) ([55f99bd](https://github.com/getahead/noter/commit/55f99bd6d2ff36e7d9ca891c0cdfb75b4225214c))
* **ui:** the main window opens at 1280x820 and cannot shrink below 900x600 ([#556](https://github.com/getahead/noter/issues/556)) ([c919b88](https://github.com/getahead/noter/commit/c919b88b1b229d569e4723027cf9e788a920f2ae))
* **ui:** the new person name field takes focus when it opens ([#551](https://github.com/getahead/noter/issues/551)) ([569f9f2](https://github.com/getahead/noter/commit/569f9f2f36a2bc062a877654f6369b477fb1b03b))

## [0.22.3](https://github.com/getahead/noter/compare/v0.22.2...v0.22.3) (2026-11-08)


### Bug fixes

* **ui:** a busy sheet ignores Return ([#516](https://github.com/getahead/noter/issues/516)) ([2169e01](https://github.com/getahead/noter/commit/2169e01c5b28680b096860b9b97db8637c02775f))
* **ui:** clock times follow the 12/24-hour and time-zone preferences from the core ([#530](https://github.com/getahead/noter/issues/530)) ([1609b2b](https://github.com/getahead/noter/commit/1609b2b80f9a84a65e627ce2af63d0a7107f8603))
* **ui:** closing the fix term popover returns focus to the line ([#528](https://github.com/getahead/noter/issues/528)) ([786f6d5](https://github.com/getahead/noter/commit/786f6d52b046122308e02a0498c237b828391919))
* **ui:** grant the message dialog to the windows that raise alerts ([#522](https://github.com/getahead/noter/issues/522)) ([77680bb](https://github.com/getahead/noter/commit/77680bb9fcc5305b375869026ed4cd79200abbe7))
* **ui:** keep only successful people reads and read again when the people change ([#547](https://github.com/getahead/noter/issues/547)) ([3dd138d](https://github.com/getahead/noter/commit/3dd138dee85b3406d35130a6b00ffd8b9faa9f9b))
* **ui:** manage on person pages is disabled with the reason instead of doing nothing ([#525](https://github.com/getahead/noter/issues/525)) ([39b0f31](https://github.com/getahead/noter/commit/39b0f31d00f402160ab112ae0b8cafeacfc1b6f3))
* **ui:** re-read keyboard focus after a view change that removes the focused button ([#540](https://github.com/getahead/noter/issues/540)) ([40060a5](https://github.com/getahead/noter/commit/40060a56ea162faca2446541dfd49f6fbf32d55e))
* **ui:** show noter skips surfaces the core closed and restores in a fixed order ([#523](https://github.com/getahead/noter/issues/523)) ([63fe7d4](https://github.com/getahead/noter/commit/63fe7d470684bfc48e40b968969134b196abd0a6))
* **ui:** the calls and glossary tables are one tab stop ([#520](https://github.com/getahead/noter/issues/520)) ([79e6d9d](https://github.com/getahead/noter/commit/79e6d9d778a03345ae171c345110ae4801d6497a))
* **ui:** the Calls subtitle shows hours and since only when every call is loaded ([#526](https://github.com/getahead/noter/issues/526)) ([908ca33](https://github.com/getahead/noter/commit/908ca3318d94c657c2a0ea1fb0ddfd578a748e83))
* **ui:** the evidence highlight expires after 3 s however often the window re-renders ([#538](https://github.com/getahead/noter/issues/538)) ([88bb45b](https://github.com/getahead/noter/commit/88bb45bb4683cba67e0cca865b41688dcc643d4b))
* **ui:** the transcript is one tab stop with up/down roving focus ([#543](https://github.com/getahead/noter/issues/543)) ([5709b2a](https://github.com/getahead/noter/commit/5709b2a866c580013c52553484e2f7d6e005c824))


### Performance

* **ui:** the live row owns the recording clock and diffview memoises its word diff ([#524](https://github.com/getahead/noter/issues/524)) ([cd74373](https://github.com/getahead/noter/commit/cd7437371cd06af976546cb4d2a6c2e88304b886))

## [0.22.2](https://github.com/getahead/noter/compare/v0.22.1...v0.22.2) (2026-11-08)


### Bug fixes

* **ui:** a record prompt drawn under the pointer starts with its timer paused ([#467](https://github.com/getahead/noter/issues/467)) ([f028d35](https://github.com/getahead/noter/commit/f028d35fd8968ac127be89582435b145aef638a7))
* **ui:** call info docks without taking focus, and the toolbar h1 is the heading fallback ([#517](https://github.com/getahead/noter/issues/517)) ([011bbd0](https://github.com/getahead/noter/commit/011bbd03d527516c5a565042102460bed59eca88))
* **ui:** ignore an entity:changed type the bindings do not know ([#515](https://github.com/getahead/noter/issues/515)) ([d51dc86](https://github.com/getahead/noter/commit/d51dc863a19e349dfa98e7c23ddaf0ccb9ec434b))
* **ui:** the live row keeps titles whose colon has no space after it ([#514](https://github.com/getahead/noter/issues/514)) ([5550ddb](https://github.com/getahead/noter/commit/5550ddb8d159beaf9229c06fe32d1fc2cd5e9ed3))
* **ui:** the people line drops a trailing initial in any script ([#518](https://github.com/getahead/noter/issues/518)) ([03e860c](https://github.com/getahead/noter/commit/03e860c62aa75f401a29cfbaae25303ca5592b51))
* **ui:** the transcript find highlight marks the matched characters when lower-casing changes the length ([#519](https://github.com/getahead/noter/issues/519)) ([c715506](https://github.com/getahead/noter/commit/c71550626aa27a7e7c0826ee9ccafe7cfb1e4dc6))

## [0.22.1](https://github.com/getahead/noter/compare/v0.22.0...v0.22.1) (2026-11-08)


### Bug fixes

* **knowledge:** the hourly pass joins an open sync instead of queuing another ([#457](https://github.com/getahead/noter/issues/457)) ([5fd3665](https://github.com/getahead/noter/commit/5fd3665a9b231d4170eaeb85c614c55a0b839a1d))

## [0.22.0](https://github.com/getahead/noter/compare/v0.21.0...v0.22.0) (2026-11-08)


### Features

* **core:** add Open Last Summary to the menu bar (2.18) ([#447](https://github.com/getahead/noter/issues/447)) ([2e1dc04](https://github.com/getahead/noter/commit/2e1dc0421ac1d3de80d6fcd5fe42e24db73a9d98))
* **ui:** add Fix Term to the native Edit menu (2.19) ([#422](https://github.com/getahead/noter/issues/422)) ([52cd0bb](https://github.com/getahead/noter/commit/52cd0bb54cd02a99f8b0e1d265ec39f510c2a6a2))
* **ui:** close today 2.20 markers and tick the feature ([#386](https://github.com/getahead/noter/issues/386)) ([10e5dbc](https://github.com/getahead/noter/commit/10e5dbc052fd42a640a10c1a942e9ddbbc2f301c))
* **ui:** count the rejected suggestions a regeneration will not suggest again (2.18) ([#420](https://github.com/getahead/noter/issues/420)) ([1b51bb3](https://github.com/getahead/noter/commit/1b51bb30d62dd806e59352b51ee9a20c0285e0fb))
* **ui:** mark the remaining 2.21 instruction blocks and tick the covered flows ([#437](https://github.com/getahead/noter/issues/437)) ([4cb482e](https://github.com/getahead/noter/commit/4cb482e77a96b247114912d6c5865ddfb89c1da1))
* **ui:** mount the naming panel on summary and show names updated (2.19) ([#388](https://github.com/getahead/noter/issues/388)) ([fba4ff3](https://github.com/getahead/noter/commit/fba4ff3669753b197722623afb08660980dcf57f))
* **ui:** trace the regenerate flow, show the local-model and names-updated notices (2.18) ([#379](https://github.com/getahead/noter/issues/379)) ([802454e](https://github.com/getahead/noter/commit/802454ee9dcb44adc21309e95df9df4849c67831))


### Bug fixes

* **mcp:** a closed run's connection answers nothing, not a racing refusal ([#442](https://github.com/getahead/noter/issues/442)) ([50f9e97](https://github.com/getahead/noter/commit/50f9e97781694bf5b705624227f9159a14afea3e))
* **mcp:** hybrid search on the socket path and one sign-in per run for live sources ([#419](https://github.com/getahead/noter/issues/419)) ([cd5cf83](https://github.com/getahead/noter/commit/cd5cf8398e91ea35b5b72823b25ce9ffbab24d40))
* **ui:** apply buffered channel messages before an entity write so Undo's restored rows stay ([#429](https://github.com/getahead/noter/issues/429)) ([762f060](https://github.com/getahead/noter/commit/762f0601a62bcaadf841215b50d8b8efbd39157c))
* **ui:** re-read the line when undo reverses a term fix (2.19) ([#444](https://github.com/getahead/noter/issues/444)) ([9056f8b](https://github.com/getahead/noter/commit/9056f8be8e13984bccc642064b2de28378bc47b1))


### Performance

* **ci:** cache the pinned WebKit for the browser test jobs ([#432](https://github.com/getahead/noter/issues/432)) ([8574edd](https://github.com/getahead/noter/commit/8574edddbc70c902d605d4cca5695f31ae8a21fc))
* **ci:** cache the Swift engine build in the macOS job ([#426](https://github.com/getahead/noter/issues/426)) ([1db49e0](https://github.com/getahead/noter/commit/1db49e0cb973b8edec4e5c156a470811908a25ef))
* **conformance:** probe the commands a few at a time, each in its own core ([#449](https://github.com/getahead/noter/issues/449)) ([48ef5b4](https://github.com/getahead/noter/commit/48ef5b4a0426fc888b029b97464d59bdbdccbd72))
* **conformance:** replace archive fixture delays with explicit completion handshakes ([#441](https://github.com/getahead/noter/issues/441)) ([9839451](https://github.com/getahead/noter/commit/98394511ebdf64c6fd719276dca38a1bfd5b5193))

## [0.21.0](https://github.com/getahead/noter/compare/v0.20.0...v0.21.0) (2026-11-08)


### Features

* **contract:** add suppressed_count to output sections ([#380](https://github.com/getahead/noter/issues/380)) ([9856408](https://github.com/getahead/noter/commit/98564081929ffa33cbaa36dd8a7b54eceaccffb3))
* **contract:** archive old-vs-new text in spanpreview and the transcript_upgraded case ([#359](https://github.com/getahead/noter/issues/359)) ([ee80fa3](https://github.com/getahead/noter/commit/ee80fa33d4a1fa8444f92a76d73bf24c5ce18127))
* **fake:** switch the section writer to the local model ([#381](https://github.com/getahead/noter/issues/381)) ([d723638](https://github.com/getahead/noter/commit/d72363873dec8a1686d2fd8a5f302cc9faddb7a7))
* **harness:** advance_clock control moves the core clock ([#360](https://github.com/getahead/noter/issues/360)) ([21e25cd](https://github.com/getahead/noter/commit/21e25cd6df7afe8857d7f7c0cdea43d4fe1dbb21))
* **harness:** hold the index rebuild and script the next ask-answer output ([#415](https://github.com/getahead/noter/issues/415)) ([e088d23](https://github.com/getahead/noter/commit/e088d2329f162f0d23778650dcded55ab32ffc81))
* **knowledge:** document hits in search through the source policy ([#362](https://github.com/getahead/noter/issues/362)) ([7f71fbd](https://github.com/getahead/noter/commit/7f71fbdef28d895099708863a9cf8deebdf7eb89))
* **knowledge:** real indexed-MCP transport over the egress gate with OAuth ([#376](https://github.com/getahead/noter/issues/376)) ([b319a20](https://github.com/getahead/noter/commit/b319a201a0f4a9b9e82b19adbb61afe67038e670))
* **mcp:** cloud result gate, staged pins and corrections, and the router's tool server ([#356](https://github.com/getahead/noter/issues/356)) ([f0628cb](https://github.com/getahead/noter/commit/f0628cbab031ea3c1d8a6cf56271a569c06d4624))
* **mcp:** search tools over shared retrieval and the D1 live-source relay ([#372](https://github.com/getahead/noter/issues/372)) ([5f969d3](https://github.com/getahead/noter/commit/5f969d31b72163e89f60d2fbc019d254654ab4fa))
* **retrieval:** ask threads, cited streamed answers, stop and delete ([#361](https://github.com/getahead/noter/issues/361)) ([7b944ab](https://github.com/getahead/noter/commit/7b944ab9f844de1c65d2dc98947516ee794f4392))
* **retrieval:** topics, post-call attachment and Ask tool refinement ([#375](https://github.com/getahead/noter/issues/375)) ([fc666a4](https://github.com/getahead/noter/commit/fc666a4ed8e1531d33b5f14fe9fafb01715cb0b3))
* **ui:** show/hide archive changes diff and archive-upgraded/pending evidence (2.17 archive) ([#369](https://github.com/getahead/noter/issues/369)) ([3419df0](https://github.com/getahead/noter/commit/3419df0abd8b09fb919d846f2f2e7f997897fd8c))
* **ui:** trace the audio sheet submit and the delete-audio return (2.18) ([#391](https://github.com/getahead/noter/issues/391)) ([011b1a8](https://github.com/getahead/noter/commit/011b1a83b8d6e75e1041404639981febdf48aee5))
* **ui:** trace the output section state machine and the share scope return (2.18) ([#383](https://github.com/getahead/noter/issues/383)) ([e66b4d6](https://github.com/getahead/noter/commit/e66b4d6dcc8fb1b33a2feacba94c1ca04b182a54))
* **ui:** trace the outputs notification flow steps (2.18 gaps) ([#358](https://github.com/getahead/noter/issues/358)) ([d18a641](https://github.com/getahead/noter/commit/d18a641259e30ece970e793ebc28b6bc2cb11292))


### Bug fixes

* **library:** count open items on call rows and filter calls by them ([#382](https://github.com/getahead/noter/issues/382)) ([e5e7080](https://github.com/getahead/noter/commit/e5e70804ff4bcbe7a1d75b92571c1d76ae4a9d27))
* **test:** settle first-run screenshots before interaction ([#390](https://github.com/getahead/noter/issues/390)) ([fd2052d](https://github.com/getahead/noter/commit/fd2052de841458abbe4c3970b6f7b33439a4a3e7))
* **ui:** inspector screenshots, Share/(i) kept together, deletion day in the Transcript header (2.17 gaps) ([#357](https://github.com/getahead/noter/issues/357)) ([d544ed7](https://github.com/getahead/noter/commit/d544ed7e94fb849dd6da22e668ae83b4a2c5a29a))


### Performance

* **ci:** cache the standalone Tauri target in the macOS job ([#425](https://github.com/getahead/noter/issues/425)) ([304430f](https://github.com/getahead/noter/commit/304430f98b1b47253bdfa0e9667af5bfd4f39324))
* **test:** avoid the native pause reminder wall-clock wait ([#417](https://github.com/getahead/noter/issues/417)) ([ad0cae8](https://github.com/getahead/noter/commit/ad0cae8f2b9a7d9fd6634ae343f175af104dccb0))

## [0.20.0](https://github.com/getahead/noter/compare/v0.19.0...v0.20.0) (2026-11-07)


### Features

* **core:** own-account sign-in sessions, agent binding, account test and sign-out ([#354](https://github.com/getahead/noter/issues/354)) ([136b0d2](https://github.com/getahead/noter/commit/136b0d29071c92788a9f6b4ddeb45a2a0fd40a0c))
* **core:** voice profiles with Keychain-encrypted centroids, speaker matching at archive install, and carry-forward ([#355](https://github.com/getahead/noter/issues/355)) ([d1805b8](https://github.com/getahead/noter/commit/d1805b8f53a272c7210386b951ce40ea1dd902d8))
* **knowledge:** indexed and live MCP sources over the McpSource seam and token revocation ([#351](https://github.com/getahead/noter/issues/351)) ([97fda4d](https://github.com/getahead/noter/commit/97fda4d70afcd3d9891a9a727e8f59a6d25575e3))
* **knowledge:** noter-knowledge crate, folder sources, extraction and sync jobs ([#331](https://github.com/getahead/noter/issues/331)) ([f9611dc](https://github.com/getahead/noter/commit/f9611dcfd96bd8ded66bab5a6393618deb092e7b))
* **mcp:** noter-mcp binary, core socket, per-run tokens and entity read tools ([#336](https://github.com/getahead/noter/issues/336)) ([d717c7f](https://github.com/getahead/noter/commit/d717c7fc8b8c9811b03417d842223d0eafd22139))
* **retrieval:** noter-retrieval crate, FTS5 and vector indexes, search and rebuild ([#332](https://github.com/getahead/noter/issues/332)) ([33d9c07](https://github.com/getahead/noter/commit/33d9c0769502d58b721adf17911c2a2c8e01516e))
* **ui:** add Mapping sheet, Repositories pane and Compare (2.21 S2) ([#350](https://github.com/getahead/noter/issues/350)) ([436fa2f](https://github.com/getahead/noter/commit/436fa2f4b403b59af6c96196fc73b19304acc609))
* **ui:** announce Summary ready once and mark the export return (2.18 gaps) ([#349](https://github.com/getahead/noter/issues/349)) ([2685bf0](https://github.com/getahead/noter/commit/2685bf09b9726f498adc6fc198eb850c1d91565b))
* **ui:** handoff drawer, prompt editor and launch controls (2.21 S1) ([#328](https://github.com/getahead/noter/issues/328)) ([554a25c](https://github.com/getahead/noter/commit/554a25c6b08ea589dd634677f1da4452e0dc1de9))
* **ui:** item evidence notes and inspector evidence E2E (2.17 gaps) ([#339](https://github.com/getahead/noter/issues/339)) ([395e78e](https://github.com/getahead/noter/commit/395e78ec3ab3f6473307a58a5f95b3e194e4118c))
* **ui:** show the next calendar event in the menu bar ([#334](https://github.com/getahead/noter/issues/334)) ([76cb1f9](https://github.com/getahead/noter/commit/76cb1f9017a30a3685d1209fc4a15b8e80be496f))
* **ui:** today item regions, card rows and review links (2.20 S2) ([#348](https://github.com/getahead/noter/issues/348)) ([6787b86](https://github.com/getahead/noter/commit/6787b869d9f805dcda4645a790710c703331c899))


### Bug fixes

* **core:** synchronize call panel native focus ([#337](https://github.com/getahead/noter/issues/337)) ([7538f50](https://github.com/getahead/noter/commit/7538f50a1adde404fdc2bd682898fa3a55563d6b))
* **ui:** show the next event time in the local time zone ([#352](https://github.com/getahead/noter/issues/352)) ([366c4a4](https://github.com/getahead/noter/commit/366c4a4e82ce91ae415f99039cfd82a84064d1cb))

## [0.19.0](https://github.com/getahead/noter/compare/v0.18.0...v0.19.0) (2026-11-07)


### Features

* **core:** add Today review links and fake regrouping (protocol 2.4) ([#338](https://github.com/getahead/noter/issues/338)) ([c961db0](https://github.com/getahead/noter/commit/c961db0c0e1f6fecb90ac0a8cffe5b96f6b41de7))
* **core:** api_key_remove, the Privacy pane audit reads and export, storage_move guard, sign-in prepare and cli_install ([#341](https://github.com/getahead/noter/issues/341)) ([69d8671](https://github.com/getahead/noter/commit/69d86712bf7ab311c882f6262074766d895a8b20))
* **core:** people tables, list, pages, create, update, merge and delete ([#335](https://github.com/getahead/noter/issues/335)) ([f62aca9](https://github.com/getahead/noter/commit/f62aca98bff1a5118a48249494600d728db9a6a3))

## [0.18.0](https://github.com/getahead/noter/compare/v0.17.0...v0.18.0) (2026-11-07)


### Features

* **ui:** item inspector, evidence navigation and add item (2.17 S2) ([#322](https://github.com/getahead/noter/issues/322)) ([86c8e52](https://github.com/getahead/noter/commit/86c8e52dc8ca804ebe53414dea461dec4e9b914c))


### Bug fixes

* **core:** track speaker name updates in output sections ([#325](https://github.com/getahead/noter/issues/325)) ([31895da](https://github.com/getahead/noter/commit/31895dafa6f66eeb55b1e3a28d68555ae7e055c1))

## [0.17.0](https://github.com/getahead/noter/compare/v0.16.1...v0.17.0) (2026-11-07)


### Features

* **ui:** add Today call cards, This week and calendar states (2.20 S1) ([#318](https://github.com/getahead/noter/issues/318)) ([6fad394](https://github.com/getahead/noter/commit/6fad394c80a4293c031399783c843fac02748587))
* **ui:** speaker naming panel, Fix Term and rename scopes (2.19 S2) ([#320](https://github.com/getahead/noter/issues/320)) ([b260606](https://github.com/getahead/noter/commit/b260606fe1749f89155225545e4de69d67097007))

## [0.16.1](https://github.com/getahead/noter/compare/v0.16.0...v0.16.1) (2026-11-06)


### Bug fixes

* **fake:** share only ready sections and never a rejected item; undo a batch around rows edited later ([#317](https://github.com/getahead/noter/issues/317)) ([13603fd](https://github.com/getahead/noter/commit/13603fd022e9b4cbe42f5a13df5b043f3cae1dd8))

## [0.16.0](https://github.com/getahead/noter/compare/v0.15.4...v0.16.0) (2026-11-06)


### Features

* **ui:** action item row, review banner and item commands (2.17 S1) ([#311](https://github.com/getahead/noter/issues/311)) ([7ba6bb9](https://github.com/getahead/noter/commit/7ba6bb96f30a2225e645ff55885ecd6a6f5bf00c))
* **ui:** add API keys and Runtime per task to Models & Runtimes and first-run step 6 ([#301](https://github.com/getahead/noter/issues/301)) ([d8c6263](https://github.com/getahead/noter/commit/d8c626356cc48063e3a2742d60e141c16e89bebe))
* **ui:** add the History timeline, change rows, Export Log sheet and undo on rows (2.16 S2) ([#306](https://github.com/getahead/noter/issues/306)) ([9f3dfeb](https://github.com/getahead/noter/commit/9f3dfeb04ddb0974b9d9cc020c257679eee3361f))
* **ui:** call page Share menu, Export sheet, Tags and Delete Audio wiring (2.18 S2) ([#313](https://github.com/getahead/noter/issues/313)) ([a4a08b5](https://github.com/getahead/noter/commit/a4a08b5eba229469f06063be65817b9c3a79391f))
* **ui:** call page Summary view, output sections, versions and regenerate (2.18 S1) ([#308](https://github.com/getahead/noter/issues/308)) ([dc94ded](https://github.com/getahead/noter/commit/dc94ded18bacf357d28c73380e40aab7d29a05b7))
* **ui:** person picker and live speaker rename (2.19 S1) ([#307](https://github.com/getahead/noter/issues/307)) ([bea4fce](https://github.com/getahead/noter/commit/bea4fce3a5e1064ca9944d0fc9b8ec902e315085))
* **ui:** undo strip, shared diff view and ⌘Z wiring (2.16 S1) ([#302](https://github.com/getahead/noter/issues/302)) ([8db5260](https://github.com/getahead/noter/commit/8db52608e09a14e284494db79b090dd6e6f0a2f9))


### Bug fixes

* **core:** a call switched to local is the effective privacy; harness world_set owns app.privacy ([#309](https://github.com/getahead/noter/issues/309)) ([0feed2c](https://github.com/getahead/noter/commit/0feed2c55abec9e1545086e0b91bf380b7bd9b39))
* **core:** item sections list their items; harness world_set owns outputs, today and changes ([#312](https://github.com/getahead/noter/issues/312)) ([a2b972a](https://github.com/getahead/noter/commit/a2b972a87b5c814a7f0ebaa30831818f930da9a0))
* **core:** read History past bookkeeping rows; a call's History lists its items and outputs ([#310](https://github.com/getahead/noter/issues/310)) ([6dd59f6](https://github.com/getahead/noter/commit/6dd59f6adc6710b6a8660a0bd744311c5bf2bd90))
* **fake:** align M2 versions, revisions and batch history ([#314](https://github.com/getahead/noter/issues/314)) ([db586d9](https://github.com/getahead/noter/commit/db586d9e1c6bfa98534d74b9653931ad192666f9))

## [0.15.4](https://github.com/getahead/noter/compare/v0.15.3...v0.15.4) (2026-11-05)


### Bug fixes

* **deps:** Bump rusqlite from 0.40.2 to 0.41.0 ([#295](https://github.com/getahead/noter/issues/295)) ([b28b236](https://github.com/getahead/noter/commit/b28b236b14e2092d91bfb5241b7f58c27c161e17))

## [0.15.3](https://github.com/getahead/noter/compare/v0.15.2...v0.15.3) (2026-11-05)


### Bug fixes

* **deps:** Bump the npm-minor group with 5 updates ([#296](https://github.com/getahead/noter/issues/296)) ([94ee881](https://github.com/getahead/noter/commit/94ee88161e1deee11b540c6f9ee53770dda3315e))

## [0.15.2](https://github.com/getahead/noter/compare/v0.15.1...v0.15.2) (2026-11-05)


### Bug fixes

* **deps:** Bump tokio from 1.53.3 to 1.54.1 in the cargo-minor group ([#294](https://github.com/getahead/noter/issues/294)) ([a8a4aef](https://github.com/getahead/noter/commit/a8a4aefc69bfdf796ef0112331a1956e2575c38b))

## [0.15.1](https://github.com/getahead/noter/compare/v0.15.0...v0.15.1) (2026-11-01)


### Bug fixes

* **core:** open Settings at 820x620 and first run at 760x560 ([#291](https://github.com/getahead/noter/issues/291)) ([2e08cb2](https://github.com/getahead/noter/commit/2e08cb261332685a228d7e1940a475e926b81508))
* **handoff:** open in the repository without the desktop apps' deep links ([#289](https://github.com/getahead/noter/issues/289)) ([b946516](https://github.com/getahead/noter/commit/b9465161dd1f0a35b7f763c153a1c05b50b63dde))
* **ui:** a Screen Recording answer that is not granted shows the refused row ([#292](https://github.com/getahead/noter/issues/292)) ([c84c39a](https://github.com/getahead/noter/commit/c84c39a4b3638a1cb0d725e3e8c010072c6fd5dc))

## [0.15.0](https://github.com/getahead/noter/compare/v0.14.0...v0.15.0) (2026-11-01)


### Features

* **core:** fit the record prompt to its content (window_fit) ([#285](https://github.com/getahead/noter/issues/285)) ([31b5895](https://github.com/getahead/noter/commit/31b589524c6fce844a079accc98d30a717cfa51d))
* **engine:** the VBx speaker clustering of the archive pass on pinned pyannote and WeSpeaker models ([#279](https://github.com/getahead/noter/issues/279)) ([dddd5c4](https://github.com/getahead/noter/commit/dddd5c4067ad17695ec63b306d9597f5d6074a2e))


### Bug fixes

* **ui:** the record prompt fits its window so Record lies inside the panel ([#287](https://github.com/getahead/noter/issues/287)) ([2d3506a](https://github.com/getahead/noter/commit/2d3506a6ca731413bfe80fd8f865947954d2a177))

## [0.14.0](https://github.com/getahead/noter/compare/v0.13.0...v0.14.0) (2026-11-01)


### Features

* **contract:** audio_deleted_at and audio_retention_days on call rows ([#261](https://github.com/getahead/noter/issues/261)) ([1e98db4](https://github.com/getahead/noter/commit/1e98db43f65c5ce9da4caad47469c11a0e55c65a))
* **contract:** summary entity change, output_invalid error and the archive result fields ([#254](https://github.com/getahead/noter/issues/254)) ([6866273](https://github.com/getahead/noter/commit/6866273ad56533e0f682411fd1cbb7ea7af92b43))
* **core:** accounts_get and api_key_set over a SecretStore ([#241](https://github.com/getahead/noter/issues/241)) ([4390bf9](https://github.com/getahead/noter/commit/4390bf94e078999c246b5d06813c47b0ccf86e51))
* **core:** archive install, chunks, regeneration merge and the summary-ready notification ([#257](https://github.com/getahead/noter/issues/257)) ([30bd517](https://github.com/getahead/noter/commit/30bd517f7cd5218cc991c7e4fb7b89a395bad8dc))
* **core:** audio_delete and audio_delete_older ([#263](https://github.com/getahead/noter/issues/263)) ([a21edbe](https://github.com/getahead/noter/commit/a21edbec211f712a59314b98a0dad360d40f753d))
* **core:** capture triggers, power source and model download on the scheduler ([#240](https://github.com/getahead/noter/issues/240)) ([ffd1898](https://github.com/getahead/noter/commit/ffd1898eb6b2450205f2cc15f6a689247b5bad22))
* **core:** carry-forward, Today and call tags ([#250](https://github.com/getahead/noter/issues/250)) ([e20a3bd](https://github.com/getahead/noter/commit/e20a3bdda5bd9aa920f8914b22ed510f57be3fc7))
* **core:** history_export over the NativeOps save panel ([#238](https://github.com/getahead/noter/issues/238)) ([43539f3](https://github.com/getahead/noter/commit/43539f3162135982d74c7734f465d228885914c6))
* **core:** history_list and the undo/redo replay ([#232](https://github.com/getahead/noter/issues/232)) ([63a429a](https://github.com/getahead/noter/commit/63a429ab0c1ed4bfbaed4ce553f94469e6658b58))
* **core:** items service, intents and evidence spans ([#245](https://github.com/getahead/noter/issues/245)) ([5b4ee9c](https://github.com/getahead/noter/commit/5b4ee9c97d682309d89193cb753b09d6394d5df6))
* **core:** post-call outputs from the live transcript ([#247](https://github.com/getahead/noter/issues/247)) ([9e0a32a](https://github.com/getahead/noter/commit/9e0a32aa572e84a9079addbedc6e651a75f75611))
* **core:** share_copy and calls_export over NativeOps ([#258](https://github.com/getahead/noter/issues/258)) ([5a3a9eb](https://github.com/getahead/noter/commit/5a3a9eb1d3440e6e02539577f75ebca924cc5010))
* **core:** speaker renames, term fixes and post-call naming ([#256](https://github.com/getahead/noter/issues/256)) ([41f143c](https://github.com/getahead/noter/commit/41f143cf907a543f5222a015232209591ef798b6))
* **core:** the MacOps host over noter-native and share_test_run ([#259](https://github.com/getahead/noter/issues/259)) ([7786005](https://github.com/getahead/noter/commit/778600553ce482ac290fadc1bda0562aaba12fb0))
* **engine:** offline Large v3 decode and local embeddings ([#236](https://github.com/getahead/noter/issues/236)) ([c9a4822](https://github.com/getahead/noter/commit/c9a4822fb28e284b51820adf54b31745ff1a255a))
* **engine:** offline_pass and embeddings over engine stdio ([#228](https://github.com/getahead/noter/issues/228)) ([4ad5466](https://github.com/getahead/noter/commit/4ad5466da183977ec15bc93c505718ed5436ca23))
* **handoff:** prompt generation, versions, repositories and the launch plan ([#251](https://github.com/getahead/noter/issues/251)) ([74646eb](https://github.com/getahead/noter/commit/74646ebead0612602667cc54812198a5e8cf16c6))
* **jobs:** noter-jobs scheduler, job_runs and jobs:progress ([#230](https://github.com/getahead/noter/issues/230)) ([b491513](https://github.com/getahead/noter/commit/b491513a6a4de8fcf5f27a500d9d9d74464560ab))
* **llm:** locked-down Claude Code, Codex and Ollama adapters ([#234](https://github.com/getahead/noter/issues/234)) ([ef8b58b](https://github.com/getahead/noter/commit/ef8b58b77709d240f4cd445d1f3e924739aed849))
* **llm:** the LlmRuntime router, egress gate and audit ([#229](https://github.com/getahead/noter/issues/229)) ([ccd520a](https://github.com/getahead/noter/commit/ccd520acaa17d98494e0f5888bb4caf3c81bb7d9))
* **native:** launch services, apple events, rich clipboard, save panels and the share visibility probe ([#243](https://github.com/getahead/noter/issues/243)) ([bc19a7a](https://github.com/getahead/noter/commit/bc19a7aabf344401e9b93dd67dacef5eca439938))


### Bug fixes

* **core:** make Return choose Cancel in the alerts shown as sheets ([#275](https://github.com/getahead/noter/issues/275)) ([649cb37](https://github.com/getahead/noter/commit/649cb37a332e60f5b5760b81f57b8a7e83fb210e))
* **core:** make Return choose Cancel in the native alerts ([#239](https://github.com/getahead/noter/issues/239)) ([57e72d9](https://github.com/getahead/noter/commit/57e72d997126f26f12184f858ed2bbfda34cda1f))
* **core:** show the tray only from the main thread so a launch cannot deadlock ([#233](https://github.com/getahead/noter/issues/233)) ([7b6360c](https://github.com/getahead/noter/commit/7b6360c7194728c2864153d779e5996ba52d9bdd))
* **core:** the launch hooks place windows on the Mac's own displays, and the quit alert is Noter's own ([#235](https://github.com/getahead/noter/issues/235)) ([90530b7](https://github.com/getahead/noter/commit/90530b78c250abba1529b49483bec11a5c23a472))

## [0.13.0](https://github.com/getahead/noter/compare/v0.12.0...v0.13.0) (2026-10-29)


### Features

* **core:** launch hooks run the built app on the harness seams ([#220](https://github.com/getahead/noter/issues/220)) ([d961eca](https://github.com/getahead/noter/commit/d961eca96c35ba975e7fc3852be34fa7321f4b44))
* **core:** menu bar tray content per menu-bar.md ([#219](https://github.com/getahead/noter/issues/219)) ([0c3b059](https://github.com/getahead/noter/commit/0c3b0594822c37778f1ac70e9cc5bdb37e7fbdca))
* **core:** quit-while-recording alert, menu bar flows, NT-3 click to the call window ([#222](https://github.com/getahead/noter/issues/222)) ([588b466](https://github.com/getahead/noter/commit/588b466bac311184d67c4ee9f6ae1109404982b2))
* **ui:** calls list acceptance tests and back keeps the scroll position (2.13) ([#223](https://github.com/getahead/noter/issues/223)) ([a6fda13](https://github.com/getahead/noter/commit/a6fda13fcabb5c89edf8971072fb8a308aea5eab))

## [0.12.0](https://github.com/getahead/noter/compare/v0.11.0...v0.12.0) (2026-10-25)


### Features

* **ui:** call page frame finish ([#214](https://github.com/getahead/noter/issues/214)) ([945df6e](https://github.com/getahead/noter/commit/945df6e5a2fe7631e04e4ee82af706a6e814b2f4))
* **ui:** dialogs host tick pass ([#213](https://github.com/getahead/noter/issues/213)) ([a856078](https://github.com/getahead/noter/commit/a85607874429f18315a0399866cd8992b78efd45))
* **ui:** library-calls live status and edit flow ([#212](https://github.com/getahead/noter/issues/212)) ([8ee8bea](https://github.com/getahead/noter/commit/8ee8bea76d62d22208a272ed33d8b554fcb63442))

## [0.11.0](https://github.com/getahead/noter/compare/v0.10.0...v0.11.0) (2026-10-25)


### Features

* **contract:** nav target for delete old audio, share-warning seen, call folder, transcript pushes (UI M1 asks 1, 2, 7, 11, 12) ([#198](https://github.com/getahead/noter/issues/198)) ([710bef0](https://github.com/getahead/noter/commit/710bef0d726e14aea3463645e3c693421cd7b54a))
* **ui:** call page frame and stored transcript ([#183](https://github.com/getahead/noter/issues/183)) ([a12b72b](https://github.com/getahead/noter/commit/a12b72b38c5b0c9607382f10ddfd5a363bdad3f5))
* **ui:** call window ([#188](https://github.com/getahead/noter/issues/188)) ([3ff0baa](https://github.com/getahead/noter/commit/3ff0baa432e131c311d0e447ec8f1780db066ae7))
* **ui:** call-window tick pass ([#208](https://github.com/getahead/noter/issues/208)) ([cd939a3](https://github.com/getahead/noter/commit/cd939a39211b08f4e849387653853e7385ed8178))
* **ui:** library calls list ([#197](https://github.com/getahead/noter/issues/197)) ([3e3de43](https://github.com/getahead/noter/commit/3e3de43035c41ccb61107b907c795acf2782eb74))
* **ui:** library-calls tick pass ([#207](https://github.com/getahead/noter/issues/207)) ([4e2a6de](https://github.com/getahead/noter/commit/4e2a6deb8056fc21078e22453299387e25555d31))
* **ui:** live and stored transcript ([#186](https://github.com/getahead/noter/issues/186)) ([b7994d4](https://github.com/getahead/noter/commit/b7994d4023282c1605a87d22978216e08a149f62))
* **ui:** notifications ([#202](https://github.com/getahead/noter/issues/202)) ([634c1a9](https://github.com/getahead/noter/commit/634c1a964c292cc80c05adc4bc1ac9621cff3108))
* **ui:** record prompt ([#191](https://github.com/getahead/noter/issues/191)) ([1646bb9](https://github.com/getahead/noter/commit/1646bb93e1b2d80052e4fbca4baf1d77fb5f7d5e))
* **ui:** record prompt tick pass ([#209](https://github.com/getahead/noter/issues/209)) ([82e45e0](https://github.com/getahead/noter/commit/82e45e06b1712cdf86c2a84819ce70a1195cf83d))


### Bug fixes

* **engine:** live ASR confirmations first on the decode queue; 10 s utterances; file mode loads the model (Q4 latency) ([#204](https://github.com/getahead/noter/issues/204)) ([a106c8d](https://github.com/getahead/noter/commit/a106c8d4b359f43c409cb52a9f08e5c3ac77abab))
* **ui:** live transcript follow is steady under CI wheel animation ([#206](https://github.com/getahead/noter/issues/206)) ([9fc7336](https://github.com/getahead/noter/commit/9fc7336df8cdeb32dabcf0830fac9854f7e95b03))

## [0.10.0](https://github.com/getahead/noter/compare/v0.9.0...v0.10.0) (2026-10-24)


### Features

* **host:** tauri-plugin-dialog for the M1 alerts in main and call-screen (UI M1 ask 6) ([#200](https://github.com/getahead/noter/issues/200)) ([bc8e6d3](https://github.com/getahead/noter/commit/bc8e6d310bf7f6552c24e8ba48ee86db97b39900))
* **ui:** dialogs host and the M1 alerts ([#182](https://github.com/getahead/noter/issues/182)) ([73c587f](https://github.com/getahead/noter/commit/73c587f5b8dc043d3ac04abaf03189bee2b67d33))


### Bug fixes

* **contract:** fake core mirrors capture_set_sensitive and start-as-new-call like the real core ([#192](https://github.com/getahead/noter/issues/192)) ([286a609](https://github.com/getahead/noter/commit/286a60926aa992d9ca2b5f8de7951b20dd5c0b84))

## [0.9.0](https://github.com/getahead/noter/compare/v0.8.0...v0.9.0) (2026-10-24)


### Features

* **harness:** world_set takes transcripts, degraded and detection; transcript pushes (UI M1 asks 3, 8, 9, 10) ([#193](https://github.com/getahead/noter/issues/193)) ([d80ef91](https://github.com/getahead/noter/commit/d80ef91ed55b2a9e1a46640be301d31edb023f84))

## [0.8.0](https://github.com/getahead/noter/compare/v0.7.0...v0.8.0) (2026-10-24)


### Features

* **core:** the call window and the record prompt are non-activating panels ([#189](https://github.com/getahead/noter/issues/189)) ([23c1b32](https://github.com/getahead/noter/commit/23c1b32ff6af9e3c9fdb825189a4013979cf88e6))

## [0.7.0](https://github.com/getahead/noter/compare/v0.6.0...v0.7.0) (2026-10-24)


### Features

* **contract:** fixture parity for the M1 read models ([#127](https://github.com/getahead/noter/issues/127)) ([c9fb986](https://github.com/getahead/noter/commit/c9fb9867e3c51ca9963256480405189a0b4a4ad1))
* **core:** call status ready after the transcript file is written ([#178](https://github.com/getahead/noter/issues/178)) ([96f3f48](https://github.com/getahead/noter/commit/96f3f481ce783b2d752d004a973bdeb007f26f1a))
* **core:** capture recovery, degraded states and the notification rule ([#151](https://github.com/getahead/noter/issues/151)) ([6cc7533](https://github.com/getahead/noter/commit/6cc7533059a78af3a78a03cf74620c47e7505430))
* **core:** capture session machine, call detection, notices and timers ([#141](https://github.com/getahead/noter/issues/141)) ([04c74e2](https://github.com/getahead/noter/commit/04c74e2db660d119859954f857314f2bc1fd6ad5))
* **core:** harness --engine-script, engine_fact and engine_kill controls ([#138](https://github.com/getahead/noter/issues/138)) ([b8a0c7a](https://github.com/getahead/noter/commit/b8a0c7a52a3c8653b8e9139dc373c43a0ebfafba))
* **core:** harness controls for the output route and free disk ([#125](https://github.com/getahead/noter/issues/125)) ([5aeacee](https://github.com/getahead/noter/commit/5aeacee1f7ef6d07622d96f5aa1567f6806d0c1f))
* **core:** harness seeds the M1 call tables from the fixture world ([#154](https://github.com/getahead/noter/issues/154)) ([b49fb0b](https://github.com/getahead/noter/commit/b49fb0bc6ca0e21e27a4c7ac9ebfb655dbbbd121))
* **core:** harness.data_dir control ([#174](https://github.com/getahead/noter/issues/174)) ([3dd9284](https://github.com/getahead/noter/commit/3dd92846fa93f39b2076421b481db9dfa8c1377d))
* **core:** host notifications, announcements, calendar and display frames through noter-native ([#175](https://github.com/getahead/noter/issues/175)) ([b333fbb](https://github.com/getahead/noter/commit/b333fbbc765dffb3fb131b3d1582789027636824))
* **core:** library call list and call records ([#148](https://github.com/getahead/noter/issues/148)) ([65ec5d7](https://github.com/getahead/noter/commit/65ec5d79ae066bb7171ac5069189de9657325f8d))
* **core:** library call status markers and ticks ([#176](https://github.com/getahead/noter/issues/176)) ([cea08f4](https://github.com/getahead/noter/commit/cea08f4940398d479b4340d0f1b2134f6a5501d3))
* **core:** live transcript persistence and streams ([#164](https://github.com/getahead/noter/issues/164)) ([180ef78](https://github.com/getahead/noter/commit/180ef78dc111f81786044191da85026da2085689))
* **core:** native surfaces in the tauri host ([#170](https://github.com/getahead/noter/issues/170)) ([f212b2f](https://github.com/getahead/noter/commit/f212b2f31a9443ec6bcf6f51d10a47d8e0dbd272))
* **core:** native surfaces: call window, presenting, tray model and window commands ([#155](https://github.com/getahead/noter/issues/155)) ([3598c16](https://github.com/getahead/noter/commit/3598c16326fdba6780709834f8fc8551c3e81a7e))
* **core:** noter-db M1 tables, insert_batch and delete ([#131](https://github.com/getahead/noter/issues/131)) ([daf3fb5](https://github.com/getahead/noter/commit/daf3fb587a2c02c3d36bb44fb9fc3527d844abde))
* **core:** replay route and playback ([#146](https://github.com/getahead/noter/issues/146)) ([226b0da](https://github.com/getahead/noter/commit/226b0da7a700c0a64bc88de9c1bd2de08bb33ba7))
* **core:** saved call-window frames and the native e2e command log ([#177](https://github.com/getahead/noter/issues/177)) ([c5d37d9](https://github.com/getahead/noter/commit/c5d37d91d21693268b14958bb76503428d082cce))
* **engine:** capture sessions in the Swift engine ([#139](https://github.com/getahead/noter/issues/139)) ([0e8031d](https://github.com/getahead/noter/commit/0e8031d31f56e84a5bedb513f07d5383e6da700d))
* **engine:** capture-first restart and degraded translation ([#132](https://github.com/getahead/noter/issues/132)) ([bcee6fe](https://github.com/getahead/noter/commit/bcee6fee0aee3f4e2bb58865713a48b16d07193a))
* **engine:** capture-first restart re-decodes the ring; supervisor start_session ([#160](https://github.com/getahead/noter/issues/160)) ([af66565](https://github.com/getahead/noter/commit/af665653a28c60071818aa4d32dea20e36fd2612))
* **engine:** detection facts, system audio silence and replay ([#150](https://github.com/getahead/noter/issues/150)) ([c8d5266](https://github.com/getahead/noter/commit/c8d52661081996d9c3b58f3bc136b1500eb5da3f))
* **engine:** live ASR on WhisperKit ([#153](https://github.com/getahead/noter/issues/153)) ([fb3c128](https://github.com/getahead/noter/commit/fb3c1285257f748309493c087833c0dda070e680))
* **engine:** one-clock capture, exclusions, device changes and the self-test clip ([#145](https://github.com/getahead/noter/issues/145)) ([234a999](https://github.com/getahead/noter/commit/234a999c8f82e54a21059a76fbbdc5c6240a4676))
* **engine:** scripted engine scripts and kill switch ([#126](https://github.com/getahead/noter/issues/126)) ([da5d4d6](https://github.com/getahead/noter/commit/da5d4d6274cc38e7d63f7ab20d5704e27ad95c09))
* **native:** notifications, announcements, display frames and calendar events ([#165](https://github.com/getahead/noter/issues/165)) ([01b9818](https://github.com/getahead/noter/commit/01b9818dd8d116e99decbfc35f7688381c78d9e4))


### Bug fixes

* **core:** no record prompt while hidden for presenting ([#169](https://github.com/getahead/noter/issues/169)) ([e827f17](https://github.com/getahead/noter/commit/e827f1725d84df1f33eeb84880757d48930fb8de))
* **core:** the transcript crash hook leaves no trace in a release build ([#168](https://github.com/getahead/noter/issues/168)) ([db597ea](https://github.com/getahead/noter/commit/db597ea15af5a20d8ccd4bd87b23f366b1885e30))
* **deps:** bump rustls-webpki and webpki-root-certs past the emSign distrust ([#137](https://github.com/getahead/noter/issues/137)) ([6a8c374](https://github.com/getahead/noter/commit/6a8c374eaaa9c88b0ad46a097baf496812edb117))
* **deps:** bump sha2 from 0.10.9 to 0.11.1 ([#93](https://github.com/getahead/noter/issues/93)) ([bfe2566](https://github.com/getahead/noter/commit/bfe2566236c0cdafcaccd09c659e5d80caea727e))
* **engine:** marker and runbook fixes from QA ([#157](https://github.com/getahead/noter/issues/157)) ([9a1da33](https://github.com/getahead/noter/commit/9a1da33eb0a96fa701ad1e08cd533627dfb66f65))

## [0.6.0](https://github.com/getahead/noter/compare/v0.5.0...v0.6.0) (2026-10-21)


### Features

* **contract:** fake core corruptNextDownload for the checksum_failed story ([#112](https://github.com/getahead/noter/issues/112)) ([bab767c](https://github.com/getahead/noter/commit/bab767c9671b48e0506ff559895492f65af11ee8))
* **ui:** first-run wizard ([#115](https://github.com/getahead/noter/issues/115)) ([c6bac50](https://github.com/getahead/noter/commit/c6bac508667c9d19e9115e18ac31cae6bd32e21c))
* **ui:** main window shell and navigation ([#114](https://github.com/getahead/noter/issues/114)) ([19fdf76](https://github.com/getahead/noter/commit/19fdf763b8480e6e22a4bd62f74a13cea7412640))
* **ui:** settings window ([#117](https://github.com/getahead/noter/issues/117)) ([6e3fce3](https://github.com/getahead/noter/commit/6e3fce345d15c8174d012436f3306deae97fdb58))


### Bug fixes

* **ui:** no literal colours in component CSS; tick the covered M0 UI spec items ([#113](https://github.com/getahead/noter/issues/113)) ([988a3f8](https://github.com/getahead/noter/commit/988a3f8143faf6bb45eaf4a9fd405f0b4afe4fcf))

## [0.5.0](https://github.com/getahead/noter/compare/v0.4.0...v0.5.0) (2026-10-19)


### Features

* **core:** model downloads, updater and bundled engine in the Tauri host ([#107](https://github.com/getahead/noter/issues/107)) ([9e1d922](https://github.com/getahead/noter/commit/9e1d9226b46d42ebb3debdd28915e74853f9db60))
* **core:** the Tauri host uses the App Group container and native services ([#106](https://github.com/getahead/noter/issues/106)) ([3482bc2](https://github.com/getahead/noter/commit/3482bc2def069bcc0c7ef4ad8f68e85efea7090f))
* **engine:** the App Group container and login-item approval in noter-native ([#104](https://github.com/getahead/noter/issues/104)) ([302d446](https://github.com/getahead/noter/commit/302d4464546e902a485d1885f6132e6fbc0811e5))


### Bug fixes

* **deps:** bump system-configuration from 0.6.1 to 0.8.0 ([#94](https://github.com/getahead/noter/issues/94)) ([1ec80f2](https://github.com/getahead/noter/commit/1ec80f25d79b54e8f64579e1cbba548d0f8ed005))

## [0.4.0](https://github.com/getahead/noter/compare/v0.3.0...v0.4.0) (2026-10-18)


### Features

* **core:** noter-core-harness on the real core ([#26](https://github.com/getahead/noter/issues/26)) ([b37a9b0](https://github.com/getahead/noter/commit/b37a9b0eb6bd3b9b2a032db630d996a0844372da))
* **ui:** accessibility, keyboard and localisation services ([#63](https://github.com/getahead/noter/issues/63)) ([58349ab](https://github.com/getahead/noter/commit/58349ab5c0bf983231c7697b313a8ce3d768c67c))
* **ui:** primitives and feedback components ([#64](https://github.com/getahead/noter/issues/64)) ([2a6978a](https://github.com/getahead/noter/commit/2a6978af8d98bc3f83cee390cb5ff72b1492ece3))


### Bug fixes

* **contract:** the fake refuses self_test_run until the speech model is ready (D-21) ([#89](https://github.com/getahead/noter/issues/89)) ([41791ad](https://github.com/getahead/noter/commit/41791ad88a25ef858ecfdc734fd58b8ab1820860))


### Performance

* **core:** M0 scenarios core_cold_start and core_app_snapshot ([#45](https://github.com/getahead/noter/issues/45)) ([f61e649](https://github.com/getahead/noter/commit/f61e649dde8c3a7467aa700acb8a880b3a292092))

## [0.3.0](https://github.com/getahead/noter/compare/v0.2.0...v0.3.0) (2026-10-18)


### Features

* **contract:** allow the Hugging Face xet CDN host for model downloads ([#61](https://github.com/getahead/noter/issues/61)) ([5a9f2b4](https://github.com/getahead/noter/commit/5a9f2b4e8214c8fc6737e821dc3d7f6235824438))
* **contract:** dispatch CoreApi by name and complete the contract tests ([#20](https://github.com/getahead/noter/issues/20)) ([7e9948b](https://github.com/getahead/noter/commit/7e9948bc95a4810c05ca336c231e78942c74cd11))
* **contract:** generated engine-protocol example lines for the Swift round-trip tests ([#74](https://github.com/getahead/noter/issues/74)) ([c62b754](https://github.com/getahead/noter/commit/c62b7548050309d2703657f7635c266120a545e9))
* **contract:** judge not_implemented by milestone in the conformance suite ([#25](https://github.com/getahead/noter/issues/25)) ([307552e](https://github.com/getahead/noter/commit/307552e1e0a8b3046e7e8f568af88f41572ab07e))
* **core:** first run — setup, permissions, self-test, model downloads, update install ([#43](https://github.com/getahead/noter/issues/43)) ([e9191b6](https://github.com/getahead/noter/commit/e9191b686f4d4af19d65519aac977601243a9768))
* **core:** noter-db storage and the change-log write path ([#21](https://github.com/getahead/noter/issues/21)) ([accf68b](https://github.com/getahead/noter/commit/accf68bfa668740e74f397b7bc840ebfd349b5c4))
* **core:** noter-llm egress allow-list and range fetcher for model downloads ([#49](https://github.com/getahead/noter/issues/49)) ([cbda26f](https://github.com/getahead/noter/commit/cbda26fe2340dc0f27848b35ccf2a9f599647273))
* **core:** settings, hotkeys and glossary ([#40](https://github.com/getahead/noter/issues/40)) ([813224a](https://github.com/getahead/noter/commit/813224aa296700ce7c8e5014bbec735383552f16))
* **core:** the IPC host, app snapshot, stream hub and the Tauri host ([#29](https://github.com/getahead/noter/issues/29)) ([651d434](https://github.com/getahead/noter/commit/651d434d194d061b8282d6f87a7c39e5c235c70b))
* **engine:** add the Swift engine package with self-test and file mode ([#38](https://github.com/getahead/noter/issues/38)) ([185b958](https://github.com/getahead/noter/commit/185b9588085d1e447869483b7cab4e4798dccbb7))
* **engine:** engine supervisor crate with the launcher seam ([#37](https://github.com/getahead/noter/issues/37)) ([86b0f3c](https://github.com/getahead/noter/commit/86b0f3c873b30d2a9b9504d961b1fcace70aa880))
* **engine:** native permissions, environment and login item ([#42](https://github.com/getahead/noter/issues/42)) ([9f6ac8f](https://github.com/getahead/noter/commit/9f6ac8f5bf513b54606c01b26b2165f103a380d4))
* **engine:** pin the model bundles from Hugging Face (manifest generator) ([#52](https://github.com/getahead/noter/issues/52)) ([0080617](https://github.com/getahead/noter/commit/00806173a70a0f5e51845fe29881d2c722284352))
* **engine:** scripted engine paces the self-test, says lines, injects events and follows system audio ([#67](https://github.com/getahead/noter/issues/67)) ([a895a5c](https://github.com/getahead/noter/commit/a895a5c31a7c35c13f948b3b67208ab336850b63))
* **ui:** core bridge and window stores ([#36](https://github.com/getahead/noter/issues/36)) ([6294987](https://github.com/getahead/noter/commit/629498742232d143917dfac166210899e3e6e9b6))
* **ui:** design tokens and theming ([#30](https://github.com/getahead/noter/issues/30)) ([3577c2b](https://github.com/getahead/noter/commit/3577c2b53a680ca36c5bcfb2ecbdbac2032f6de7))
* **ui:** first-run wizard steps and self-test logic ([#78](https://github.com/getahead/noter/issues/78)) ([4215b46](https://github.com/getahead/noter/commit/4215b461c97fe224224aa1aedff4fcadada34517))
* **ui:** main window history, collapse order and mode indicator logic ([#77](https://github.com/getahead/noter/issues/77)) ([d08a729](https://github.com/getahead/noter/commit/d08a729acf76afe03831adeaf4bfe7a36c2b0bdb))
* **ui:** settings search, hotkey recorder and chord checks ([#73](https://github.com/getahead/noter/issues/73)) ([6dc3ee0](https://github.com/getahead/noter/commit/6dc3ee0375afaeffbfaa57a1c68d79e25748bf86))


### Bug fixes

* **contract:** the fake answers update_install not_found without an update ([#85](https://github.com/getahead/noter/issues/85)) ([5e1e525](https://github.com/getahead/noter/commit/5e1e525a6f4d1c4064ff2d774ad4f4e86f7772f9))
* **contract:** the fake ends a Channel with ended { unsubscribed } on stream_unsubscribe ([#79](https://github.com/getahead/noter/issues/79)) ([f5bfcf8](https://github.com/getahead/noter/commit/f5bfcf8476ed1eba77de6731d6191624b1368b4b))
* **engine:** file mode reports installed models; Rust protocol lines round-trip ([#46](https://github.com/getahead/noter/issues/46)) ([95600c8](https://github.com/getahead/noter/commit/95600c8084f298777120d85767b5f0bbc15aca1b))
* **engine:** ignore partial downloads when listing installed models ([#51](https://github.com/getahead/noter/issues/51)) ([9610cf0](https://github.com/getahead/noter/commit/9610cf0225e98bc5d3c917f6c104e71aa7f7a3f5))
* **ui:** rebase nested settings drafts and wait for a complete chord ([#81](https://github.com/getahead/noter/issues/81)) ([e5b143d](https://github.com/getahead/noter/commit/e5b143d10114c49504e230fb84b59ee3142beab9))
* **ui:** style the document with the tokens ([#68](https://github.com/getahead/noter/issues/68)) ([904d732](https://github.com/getahead/noter/commit/904d732b1d5c4aa8136d25f9aa766ec4b8420c5a))


### Performance

* **ui:** ui_window_open scenario for the core bridge; run UI scenarios with --predictable ([#82](https://github.com/getahead/noter/issues/82)) ([8787b99](https://github.com/getahead/noter/commit/8787b99bf30285a6d5c6c601ed40d850ede18011))

## [0.2.0](https://github.com/getahead/noter/compare/v0.1.0...v0.2.0) (2026-10-18)


### Features

* **harness:** ponytail code-quality review ([#5](https://github.com/getahead/noter/issues/5)) ([189efd8](https://github.com/getahead/noter/commit/189efd863bba6e222259bc27c1d2fa218f7d63ed))


### Bug fixes

* **deps:** bump the npm-minor group across 2 directories with 1 update ([#7](https://github.com/getahead/noter/issues/7)) ([f08a3fd](https://github.com/getahead/noter/commit/f08a3fd0b91ebc428b8128adce16d27243a66fde))
