# Changelog

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
