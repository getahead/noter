# Changelog

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
