# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.6.2](https://github.com/semi-column/tmdb-discover-plus/compare/v2.6.1...v2.6.2) (2026-01-29)


### Bug Fixes

* infinite looping ([4d3823b](https://github.com/semi-column/tmdb-discover-plus/commit/4d3823b6db1e43a6016f06b0211985a554d97f20))

## [2.6.1](https://github.com/semi-column/tmdb-discover-plus/compare/v2.6.0...v2.6.1) (2026-01-29)


### Bug Fixes

* manifest version upgrades with releases ([346ecf4](https://github.com/semi-column/tmdb-discover-plus/commit/346ecf44d8a520978897622a1d636c4ac45c55cd))
* optimized logo for faster loading ([070b713](https://github.com/semi-column/tmdb-discover-plus/commit/070b7133686f151458e800c6f7e0c7152d7af923))
* Original networks incorrect selected count ([72852a7](https://github.com/semi-column/tmdb-discover-plus/commit/72852a7e00e59c621981af8fde0c3615f61b2f14))

## [2.6.0](https://github.com/semi-column/tmdb-discover-plus/compare/v2.5.0...v2.6.0) (2026-01-28)


### Features

* add future date presets for upcoming content ([c539cb6](https://github.com/semi-column/tmdb-discover-plus/commit/c539cb6f9099a4555f463ea3e3d24633c638b883)), closes [#16](https://github.com/semi-column/tmdb-discover-plus/issues/16)
* implement catalog and global configuration import/export ([a7f241f](https://github.com/semi-column/tmdb-discover-plus/commit/a7f241fc3b919bcd8675c50dd5dd95a232fb25f3)), closes [#17](https://github.com/semi-column/tmdb-discover-plus/issues/17)
* update date filters to rolling windows ([08610c6](https://github.com/semi-column/tmdb-discover-plus/commit/08610c6c1dedf3d08f8fbb4e8d41faa0879a99e2)), closes [#20](https://github.com/semi-column/tmdb-discover-plus/issues/20)


### Bug Fixes

* persist disableSearch preference in user config schema ([426aee7](https://github.com/semi-column/tmdb-discover-plus/commit/426aee7698cf02c7ba9708de95d48b7d5e2b239f)), closes [#25](https://github.com/semi-column/tmdb-discover-plus/issues/25)
* resolve release region persistence and localization issues ([#21](https://github.com/semi-column/tmdb-discover-plus/issues/21), [#23](https://github.com/semi-column/tmdb-discover-plus/issues/23)) ([7bb439f](https://github.com/semi-column/tmdb-discover-plus/commit/7bb439fd7ac815c16a742b3e4d4cb10315aec520))

## [2.5.0](https://github.com/semi-column/tmdb-discover-plus/compare/v2.4.0...v2.5.0) (2026-01-28)


### Features

* add behaviorHints.configurable to static manifest ([173ffb2](https://github.com/semi-column/tmdb-discover-plus/commit/173ffb29212f4e80a395ec8147290a34c6ddc9e1))
* add Buy Me a Coffee button component and integrate into header ([adbf5e9](https://github.com/semi-column/tmdb-discover-plus/commit/adbf5e98b9ac2315f5487ed8b7e6b7653caa9551))
* add option to disable search catalogs ([a65cdc0](https://github.com/semi-column/tmdb-discover-plus/commit/a65cdc00d8eff40e46b4f99385af1489c2c97a57)), closes [#22](https://github.com/semi-column/tmdb-discover-plus/issues/22)
* add support for Stremio URLs in install modal and user config response ([0dc76ff](https://github.com/semi-column/tmdb-discover-plus/commit/0dc76ff72907830f33de5f5e97b7584cd4ee330c))
* Added Discover Only Option [ fixes  [#4](https://github.com/semi-column/tmdb-discover-plus/issues/4) ] ([eaef93d](https://github.com/semi-column/tmdb-discover-plus/commit/eaef93d9d70c7854f77452bd8a068d0161a8b373))
* Added Paypal for support ([9c6e6be](https://github.com/semi-column/tmdb-discover-plus/commit/9c6e6be8a2497c2d61935a3fea6aa2bd2adadc8c))
* Added postgres and redis support ([a431d8a](https://github.com/semi-column/tmdb-discover-plus/commit/a431d8a383424fccafe6db3b7e4d9f8b0b03aa62))
* Added release-please support ([949ab19](https://github.com/semi-column/tmdb-discover-plus/commit/949ab195287225c78efc66ef18dd8bd87a41991c))
* Added Shuffle Catalogs & Copy Catalog ([ca6398a](https://github.com/semi-column/tmdb-discover-plus/commit/ca6398a58f988e236d86076ddf511a56c9b5691f))
* enhance API rate limiting for frontend endpoints and update CI/CD permissions ([66d7dab](https://github.com/semi-column/tmdb-discover-plus/commit/66d7dabc1a7857251a531c931e5692682f32967f))
* enhance range slider with editable inputs and improve meta handling ([7942c0a](https://github.com/semi-column/tmdb-discover-plus/commit/7942c0af08e4c55725a476db789063f33bf639c1))
* enhance TMDB API request handling with URL normalization and validation ([24ee96b](https://github.com/semi-column/tmdb-discover-plus/commit/24ee96bdb7f59e222260580d7b1fe8e2a118c1ba))
* enhance user config handling with input validation and sanitization ([5f6928e](https://github.com/semi-column/tmdb-discover-plus/commit/5f6928e7ca43a25f154509ed4619ed575cf7713d))
* Improve User Experience ([4974704](https://github.com/semi-column/tmdb-discover-plus/commit/49747045cb84c6f8dc9a67caf2bd4359c3033711))
* Poster Integration, User Count & Quality fixes ([9590acb](https://github.com/semi-column/tmdb-discover-plus/commit/9590acbd6b47e3f4151da260aa5415c363737673))
* userConfig Loading fix ([0be5bc5](https://github.com/semi-column/tmdb-discover-plus/commit/0be5bc5b04bc773e87d1497c7d48f6d4e3d29fae))


### Bug Fixes

* add "All" genre option to discover-only catalogs ([5927b26](https://github.com/semi-column/tmdb-discover-plus/commit/5927b269acb7bcf726bd0ec6396d06142c7a10cd)), closes [#12](https://github.com/semi-column/tmdb-discover-plus/issues/12)
* Added Random Check to Config ([829edb7](https://github.com/semi-column/tmdb-discover-plus/commit/829edb7efe2c59a7bc255e2ce91297547e405450))
* Alot of Fix Actually! ([e5957ac](https://github.com/semi-column/tmdb-discover-plus/commit/e5957ace50c3539c2ac09f878cca28ee45d9eafa))
* background posters not loading ([7420986](https://github.com/semi-column/tmdb-discover-plus/commit/7420986617b4abb2b09a564ed5b7d90039679e63))
* Config Issue ([169cfae](https://github.com/semi-column/tmdb-discover-plus/commit/169cfae130fc147b0f95e7b21539843e2afd185f))
* Config Load Failures ([4e1596a](https://github.com/semi-column/tmdb-discover-plus/commit/4e1596a095c2a91631cd450a4e0a51e2595c688e))
* Deploy ([e06953a](https://github.com/semi-column/tmdb-discover-plus/commit/e06953aa647d2f32bfcf06cfb6c1e46e4a87d837))
* Deploy ([0098685](https://github.com/semi-column/tmdb-discover-plus/commit/00986855a56d0e9e72daa8f66a593e9123cc090b))
* Deploy ([ea957a6](https://github.com/semi-column/tmdb-discover-plus/commit/ea957a60c1860ee2435a6c2ef1431a5f3c0725c6))
* **deploy:** Switch to Buildpack with Explicit Procfile ([3e8c0df](https://github.com/semi-column/tmdb-discover-plus/commit/3e8c0df4eeb79984ddc6ecfdac04f0bfd07ca748))
* Dynamic DatePreset Not bieng saved to database ([91a468a](https://github.com/semi-column/tmdb-discover-plus/commit/91a468a083950a8718655f0a984fe083096f38af))
* enhance touch event handling to prevent ghost clicks on genre selection ([238317f](https://github.com/semi-column/tmdb-discover-plus/commit/238317fc8653d397e973aaf017ef46f059c6c036))
* Final Fixes ([a536d6f](https://github.com/semi-column/tmdb-discover-plus/commit/a536d6f2e6a221fd4127a52e03fd305b366d0950))
* Fix DB issue ([8ff1b20](https://github.com/semi-column/tmdb-discover-plus/commit/8ff1b202fcbaf28228b2fa436fb1625b00064d58))
* Fix Worfklow ([39dbd25](https://github.com/semi-column/tmdb-discover-plus/commit/39dbd25025c77851261beb54b8831e941147c531))
* fixed imdbRatings to be fetched from rpdb instead of using tmdb ratings for metadata ([c23ad0e](https://github.com/semi-column/tmdb-discover-plus/commit/c23ad0e793c55f5cd2f2b775ebadbb06c584a0bf))
* force OR logic for multi-value filters ([6f73176](https://github.com/semi-column/tmdb-discover-plus/commit/6f73176776b7681846f04909cedee32d8acc1bbc)), closes [#14](https://github.com/semi-column/tmdb-discover-plus/issues/14)
* Improve install modal scrolling and layout ([6ad78b0](https://github.com/semi-column/tmdb-discover-plus/commit/6ad78b0f6f3ac25a66110eba2e69424b271846b6))
* Improve Mobile UI for better experience ([d68b1d6](https://github.com/semi-column/tmdb-discover-plus/commit/d68b1d65066976f4fde4059072937e9920f0115d))
* improve touch event detection for better compatibility across devices ([54bdf5d](https://github.com/semi-column/tmdb-discover-plus/commit/54bdf5d2e04459f00792ad8a4b43383db522ced6))
* Improved UX ([6431e10](https://github.com/semi-column/tmdb-discover-plus/commit/6431e102f7a3b3209b476f868a1d1affb217d084))
* Lint Fix ([1ca25a5](https://github.com/semi-column/tmdb-discover-plus/commit/1ca25a506989648632d57427b4c0bbf244a4ed63))
* Login Break from Session Expired Page ([dab22fc](https://github.com/semi-column/tmdb-discover-plus/commit/dab22fc647f6dccdcf307489d927ec8a659658fc))
* Memory Leak & Crashing ([dcf8d5b](https://github.com/semi-column/tmdb-discover-plus/commit/dcf8d5bc8c3543ba97452ec22bb7958143113896))
* Metadata Updates ([f9a3696](https://github.com/semi-column/tmdb-discover-plus/commit/f9a369623f24bc15716ace1234a6ad931ebff6b3))
* Mobile UI FIxes ([6ce1fec](https://github.com/semi-column/tmdb-discover-plus/commit/6ce1fec4701ecff89959a430bc3eebeeb9924417))
* More Fixes ([d2e0db5](https://github.com/semi-column/tmdb-discover-plus/commit/d2e0db5df6dae1f496f2aea1157f26802171518f))
* Networks Search & Genre Filterin gFor Preset Catalogs ([712afa3](https://github.com/semi-column/tmdb-discover-plus/commit/712afa3691bbf8136a8fbb6f9df680385dd1be18))
* prioritize IMDb IDs in catalog items ([d2ea3ec](https://github.com/semi-column/tmdb-discover-plus/commit/d2ea3ec0e3521ce14b447e4f33bfefcd9a18ed3b)), closes [#13](https://github.com/semi-column/tmdb-discover-plus/issues/13)
* remove cache on config api ([90264d3](https://github.com/semi-column/tmdb-discover-plus/commit/90264d3796bfecb6b1f4a2542daf5dace258b470))
* Remove Caching from Randomized Catalogs ([99b2f68](https://github.com/semi-column/tmdb-discover-plus/commit/99b2f6819cd462a3bf8cd816fbddd4dadd76a2bb))
* Remove Caching from Randomized Catalogs ([4ab964c](https://github.com/semi-column/tmdb-discover-plus/commit/4ab964c2592a4e72084fd054068493ce6f0402e4))
* Remove Duplicate manifest Url ([a0d251c](https://github.com/semi-column/tmdb-discover-plus/commit/a0d251c5f94ecbcef28a902b4aaceb389b93e8ab))
* Save Config API fix ([54af95b](https://github.com/semi-column/tmdb-discover-plus/commit/54af95b2a873c9797aebe33bd624b6caa1f47e5e))
* standardize all redirects to use /?userId= format ([97e2a50](https://github.com/semi-column/tmdb-discover-plus/commit/97e2a50975b9a9a8fee0a6ba2bb38210be0634e6))
* sync manifest version wit actual release ([d5a2866](https://github.com/semi-column/tmdb-discover-plus/commit/d5a2866b668ab01dd89e6984dee22e7c4ac290fd))
* Test Failure ([38c4265](https://github.com/semi-column/tmdb-discover-plus/commit/38c42656645bd002964fd6a1f9c2fbbf7aa26b6e))
* Test Failure ([20beed8](https://github.com/semi-column/tmdb-discover-plus/commit/20beed8798643d4ff9ce9ca5b9b9812b9600b8eb))
* Test Failures ([71b2dad](https://github.com/semi-column/tmdb-discover-plus/commit/71b2dadeb007aef3df076debda2873437643a1c5))
* Test Failures ([aecb2d0](https://github.com/semi-column/tmdb-discover-plus/commit/aecb2d05acd7df85d39d7ec8e62e73cd0f11821d))
* Tests fix ([b3470ce](https://github.com/semi-column/tmdb-discover-plus/commit/b3470cef3cf0369b99a3de09b7f73bc40ca3a8fc))
* update logo image ([69ca4bf](https://github.com/semi-column/tmdb-discover-plus/commit/69ca4bfa921f76fd6decfac0f72ca3a683e98416))
* update logo URL in manifest.json ([00f7790](https://github.com/semi-column/tmdb-discover-plus/commit/00f7790d25b540757c3323ec5964f5fc7ffd8a73))
* Updated workflow to only deploy on releases ([5793fa5](https://github.com/semi-column/tmdb-discover-plus/commit/5793fa5f22faa81efc70c78a916262ea6a7f2621))

## [2.4.0](https://github.com/semi-column/tmdb-discover-plus/compare/tmdb-discover-plus-v2.3.0...tmdb-discover-plus-v2.4.0) (2026-01-26)


### Features

* add behaviorHints.configurable to static manifest ([173ffb2](https://github.com/semi-column/tmdb-discover-plus/commit/173ffb29212f4e80a395ec8147290a34c6ddc9e1))
* add Buy Me a Coffee button component and integrate into header ([adbf5e9](https://github.com/semi-column/tmdb-discover-plus/commit/adbf5e98b9ac2315f5487ed8b7e6b7653caa9551))
* add support for Stremio URLs in install modal and user config response ([0dc76ff](https://github.com/semi-column/tmdb-discover-plus/commit/0dc76ff72907830f33de5f5e97b7584cd4ee330c))
* Added Discover Only Option [ fixes  [#4](https://github.com/semi-column/tmdb-discover-plus/issues/4) ] ([eaef93d](https://github.com/semi-column/tmdb-discover-plus/commit/eaef93d9d70c7854f77452bd8a068d0161a8b373))
* Added Paypal for support ([9c6e6be](https://github.com/semi-column/tmdb-discover-plus/commit/9c6e6be8a2497c2d61935a3fea6aa2bd2adadc8c))
* Added postgres and redis support ([a431d8a](https://github.com/semi-column/tmdb-discover-plus/commit/a431d8a383424fccafe6db3b7e4d9f8b0b03aa62))
* Added release-please support ([949ab19](https://github.com/semi-column/tmdb-discover-plus/commit/949ab195287225c78efc66ef18dd8bd87a41991c))
* Added Shuffle Catalogs & Copy Catalog ([ca6398a](https://github.com/semi-column/tmdb-discover-plus/commit/ca6398a58f988e236d86076ddf511a56c9b5691f))
* enhance API rate limiting for frontend endpoints and update CI/CD permissions ([66d7dab](https://github.com/semi-column/tmdb-discover-plus/commit/66d7dabc1a7857251a531c931e5692682f32967f))
* enhance range slider with editable inputs and improve meta handling ([7942c0a](https://github.com/semi-column/tmdb-discover-plus/commit/7942c0af08e4c55725a476db789063f33bf639c1))
* enhance TMDB API request handling with URL normalization and validation ([24ee96b](https://github.com/semi-column/tmdb-discover-plus/commit/24ee96bdb7f59e222260580d7b1fe8e2a118c1ba))
* enhance user config handling with input validation and sanitization ([5f6928e](https://github.com/semi-column/tmdb-discover-plus/commit/5f6928e7ca43a25f154509ed4619ed575cf7713d))
* Improve User Experience ([4974704](https://github.com/semi-column/tmdb-discover-plus/commit/49747045cb84c6f8dc9a67caf2bd4359c3033711))
* Poster Integration, User Count & Quality fixes ([9590acb](https://github.com/semi-column/tmdb-discover-plus/commit/9590acbd6b47e3f4151da260aa5415c363737673))
* userConfig Loading fix ([0be5bc5](https://github.com/semi-column/tmdb-discover-plus/commit/0be5bc5b04bc773e87d1497c7d48f6d4e3d29fae))


### Bug Fixes

* Added Random Check to Config ([829edb7](https://github.com/semi-column/tmdb-discover-plus/commit/829edb7efe2c59a7bc255e2ce91297547e405450))
* Alot of Fix Actually! ([e5957ac](https://github.com/semi-column/tmdb-discover-plus/commit/e5957ace50c3539c2ac09f878cca28ee45d9eafa))
* background posters not loading ([7420986](https://github.com/semi-column/tmdb-discover-plus/commit/7420986617b4abb2b09a564ed5b7d90039679e63))
* Config Issue ([169cfae](https://github.com/semi-column/tmdb-discover-plus/commit/169cfae130fc147b0f95e7b21539843e2afd185f))
* Config Load Failures ([4e1596a](https://github.com/semi-column/tmdb-discover-plus/commit/4e1596a095c2a91631cd450a4e0a51e2595c688e))
* Deploy ([e06953a](https://github.com/semi-column/tmdb-discover-plus/commit/e06953aa647d2f32bfcf06cfb6c1e46e4a87d837))
* Deploy ([0098685](https://github.com/semi-column/tmdb-discover-plus/commit/00986855a56d0e9e72daa8f66a593e9123cc090b))
* Deploy ([ea957a6](https://github.com/semi-column/tmdb-discover-plus/commit/ea957a60c1860ee2435a6c2ef1431a5f3c0725c6))
* **deploy:** Switch to Buildpack with Explicit Procfile ([3e8c0df](https://github.com/semi-column/tmdb-discover-plus/commit/3e8c0df4eeb79984ddc6ecfdac04f0bfd07ca748))
* Dynamic DatePreset Not bieng saved to database ([91a468a](https://github.com/semi-column/tmdb-discover-plus/commit/91a468a083950a8718655f0a984fe083096f38af))
* enhance touch event handling to prevent ghost clicks on genre selection ([238317f](https://github.com/semi-column/tmdb-discover-plus/commit/238317fc8653d397e973aaf017ef46f059c6c036))
* Final Fixes ([a536d6f](https://github.com/semi-column/tmdb-discover-plus/commit/a536d6f2e6a221fd4127a52e03fd305b366d0950))
* Fix DB issue ([8ff1b20](https://github.com/semi-column/tmdb-discover-plus/commit/8ff1b202fcbaf28228b2fa436fb1625b00064d58))
* Fix Worfklow ([39dbd25](https://github.com/semi-column/tmdb-discover-plus/commit/39dbd25025c77851261beb54b8831e941147c531))
* Improve install modal scrolling and layout ([6ad78b0](https://github.com/semi-column/tmdb-discover-plus/commit/6ad78b0f6f3ac25a66110eba2e69424b271846b6))
* Improve Mobile UI for better experience ([d68b1d6](https://github.com/semi-column/tmdb-discover-plus/commit/d68b1d65066976f4fde4059072937e9920f0115d))
* improve touch event detection for better compatibility across devices ([54bdf5d](https://github.com/semi-column/tmdb-discover-plus/commit/54bdf5d2e04459f00792ad8a4b43383db522ced6))
* Improved UX ([6431e10](https://github.com/semi-column/tmdb-discover-plus/commit/6431e102f7a3b3209b476f868a1d1affb217d084))
* Lint Fix ([1ca25a5](https://github.com/semi-column/tmdb-discover-plus/commit/1ca25a506989648632d57427b4c0bbf244a4ed63))
* Login Break from Session Expired Page ([dab22fc](https://github.com/semi-column/tmdb-discover-plus/commit/dab22fc647f6dccdcf307489d927ec8a659658fc))
* Memory Leak & Crashing ([dcf8d5b](https://github.com/semi-column/tmdb-discover-plus/commit/dcf8d5bc8c3543ba97452ec22bb7958143113896))
* Metadata Updates ([f9a3696](https://github.com/semi-column/tmdb-discover-plus/commit/f9a369623f24bc15716ace1234a6ad931ebff6b3))
* Mobile UI FIxes ([6ce1fec](https://github.com/semi-column/tmdb-discover-plus/commit/6ce1fec4701ecff89959a430bc3eebeeb9924417))
* More Fixes ([d2e0db5](https://github.com/semi-column/tmdb-discover-plus/commit/d2e0db5df6dae1f496f2aea1157f26802171518f))
* Networks Search & Genre Filterin gFor Preset Catalogs ([712afa3](https://github.com/semi-column/tmdb-discover-plus/commit/712afa3691bbf8136a8fbb6f9df680385dd1be18))
* remove cache on config api ([90264d3](https://github.com/semi-column/tmdb-discover-plus/commit/90264d3796bfecb6b1f4a2542daf5dace258b470))
* Remove Caching from Randomized Catalogs ([99b2f68](https://github.com/semi-column/tmdb-discover-plus/commit/99b2f6819cd462a3bf8cd816fbddd4dadd76a2bb))
* Remove Caching from Randomized Catalogs ([4ab964c](https://github.com/semi-column/tmdb-discover-plus/commit/4ab964c2592a4e72084fd054068493ce6f0402e4))
* Remove Duplicate manifest Url ([a0d251c](https://github.com/semi-column/tmdb-discover-plus/commit/a0d251c5f94ecbcef28a902b4aaceb389b93e8ab))
* Save Config API fix ([54af95b](https://github.com/semi-column/tmdb-discover-plus/commit/54af95b2a873c9797aebe33bd624b6caa1f47e5e))
* standardize all redirects to use /?userId= format ([97e2a50](https://github.com/semi-column/tmdb-discover-plus/commit/97e2a50975b9a9a8fee0a6ba2bb38210be0634e6))
* Test Failure ([38c4265](https://github.com/semi-column/tmdb-discover-plus/commit/38c42656645bd002964fd6a1f9c2fbbf7aa26b6e))
* Test Failure ([20beed8](https://github.com/semi-column/tmdb-discover-plus/commit/20beed8798643d4ff9ce9ca5b9b9812b9600b8eb))
* Test Failures ([71b2dad](https://github.com/semi-column/tmdb-discover-plus/commit/71b2dadeb007aef3df076debda2873437643a1c5))
* Test Failures ([aecb2d0](https://github.com/semi-column/tmdb-discover-plus/commit/aecb2d05acd7df85d39d7ec8e62e73cd0f11821d))
* Tests fix ([b3470ce](https://github.com/semi-column/tmdb-discover-plus/commit/b3470cef3cf0369b99a3de09b7f73bc40ca3a8fc))
* update logo image ([69ca4bf](https://github.com/semi-column/tmdb-discover-plus/commit/69ca4bfa921f76fd6decfac0f72ca3a683e98416))
* update logo URL in manifest.json ([00f7790](https://github.com/semi-column/tmdb-discover-plus/commit/00f7790d25b540757c3323ec5964f5fc7ffd8a73))

## [2.3.0] - 2026-01-18

### Added

- **Security & Authentication** - Implemented TMDB API key encryption and session-based authentication for improved security.
- **Test Architecture Overhaul** - Restructured integration tests into a unified `server/tests` directory with shared helpers.
- **Randomize Results Toggle** - Moved "Random" from a sort option to a separate toggle, allowing randomization to be combined with any sort order (e.g., Highest Rated + Randomized).
- **Keyboard Navigation** - Full support for Arrow Up/Down and Enter in all filter dropdowns for better accessibility and faster navigation.
- **Discover Only Filter** - New option to force "Custom Discover" mode, bypassing preset lists for more granular control over results.
- **Shuffle Catalog** - Enhanced catalog management with the ability to shuffle Catalogs every time you open stremio.
- **Copy Catalog** - Enhanced catalog management with the ability to duplicate Catalogs and Edit On the go.
- **Verification Workflow** - Added comprehensive verification steps for Docker and CI/CD pipelines.

### Changed

- **Preview Consistency** - Resolved discrepancies between live preview results and Stremio catalog results.
- **Relaxed Rate Limits** - Significantly increased API rate limits (Strict: 60/min, API: 300/min, Addon: 1000/min) to better align with TMDB's policy and support heavy Stremio usage.
- **Deep Code Cleanup** - Removed unused code, legacy comments, and redundant files across the project.

## [2.2.0] - 2026-01-14

### Added

- Comprehensive E2E test suite (32 tests covering filters, Stremio protocol, and localization)

### Changed

- Refactored components for better separation of concerns and maintainability

## [2.1.0] - 2026-01-10

### Added

- Display language selection (localize titles/metadata via TMDB `language=`) while preserving original-language filtering
- Improved filter UX: tooltips, active-filters summary chips, per-section filter-count badges
- Genre improvements: tri-state include/exclude/neutral selection and optional match mode (ANY vs ALL)
- Desktop split layout with a dedicated preview panel
- Drag & drop catalog reordering is added

### Changed

- Filters accordion behavior improved (collapsed by default, single-section open)
- Responsive layout improved across breakpoints

### Fixed

- Preview header alignment and padding consistency
- Streaming providers list now shows all available services for the selected region (previously capped) and includes a quick search
- TV network search improved to discover networks via TMDB TV results

## [2.0.0] - 2026-01-05

### Added

- **Configuration Manager** - New dropdown to list, switch between, edit, and delete saved configurations
- **Multi-Config Support** - Easily manage multiple addon configurations with different API keys
- **API Key Switching** - Seamlessly switch between different TMDB API keys with automatic config loading
- **Long-Press Genre Exclusion** - Long-press (or right-click) on genre chips to toggle exclusion - works on desktop and mobile
- **Runtime Filtering** - Filter movies/TV by runtime with interactive range slider and quick presets (Short, Standard, Long, Epic)
- **Exclude Keywords Filter** - Exclude content containing specific keywords (e.g., "remake", "sequel")
- **Exclude Companies Filter** - Exclude content from specific production companies
- **Region Filter** - Filter movies by regional release dates (theatrical releases in specific countries)
- **First Air Date Filter** - Filter TV shows by premiere date (when the show first aired vs episode air dates)
- **Dynamic Date Presets** - Date presets (Last 30/90 days, This Year, etc.) now calculate dates at request time, ensuring catalogs always show fresh content relative to the current date
- **Clickable Preview Cards** - Preview tiles now link directly to TMDB pages, making it easy to explore content details and keywords
- **CI/CD Pipeline** - GitHub Actions workflow for automated linting, testing, and deployment to BeamUp

### Changed

- Date presets now store preset type instead of static dates, resolving dynamically when catalog is fetched
- Improved date preset UI with active state indicator
- Enhanced filter architecture for better extensibility
- Improved config retrieval and deletion logic for better reliability
- Added cache control headers to prevent stale config responses

### Fixed

- iOS/Safari compatibility for touch events on genre chips
- Long-press detection on mobile devices with proper touch event handling
- Config deletion now properly handles fallback scenarios

### Technical

- Added `ConfigDropdown` component for configuration management
- Added `resolveDynamicDatePreset()` helper in addon routes and preview endpoint
- Extended TMDB service with `region`, `firstAirDateFrom/To`, and `excludeCompanies` parameters
- Runtime slider component with dual-handle range selection
- Improved touch event management for cross-browser compatibility

## [1.5.0] - 2026-01-04

### Added

- Docker support with multi-stage build for easy self-hosting
- Docker Compose configuration for quick deployment
- Health check endpoint (`/health`) for monitoring and container orchestration
- Graceful shutdown handling for clean container stops
- Structured logging with configurable log levels
- Rate limiting on API endpoints (100 req/min)
- Input validation for all API endpoints
- `.env.example` template for easy configuration

### Changed

- Consolidated utility functions into shared modules
- Replaced all `console.log` statements with structured logger
- TLS verification now configurable via environment variable
- Improved error handling throughout the codebase

### Removed

- Unused `stremio-addon-sdk` dependency (addon uses raw Express routes)
- Unused `uuid` dependency (replaced with `nanoid`)
- Unused `react-router-dom` dependency
- Test files and development scripts from production

### Security

- Added API key format validation before external requests
- Protected debug endpoint in production mode
- Sensitive data sanitization in logs
- Rate limiting to prevent abuse

## [1.4.0] - Previous Release

### Added

- Exclude genres filter
- Random sort option
- Watch provider filtering
- People, companies, and keywords search

### Changed

- Improved pagination with proper `pageSize` in manifest
- Better IMDB ID resolution

## [1.3.0] - Previous Release

### Added

- Preset catalog support (Trending, Popular, Top Rated, etc.)
- Multiple catalog support per user
- Live preview functionality

### Changed

- Redesigned configuration UI
- Improved mobile responsiveness

## [1.2.0] - Previous Release

### Added

- MongoDB support for persistent configuration storage
- In-memory fallback when MongoDB is unavailable

### Changed

- Improved error handling
- Better CORS configuration

## [1.1.0] - Previous Release

### Added

- Basic filtering (genres, year, rating)
- Sorting options
- IMDB ID integration

## [1.0.0] - Initial Release

### Added

- Basic Stremio addon functionality
- TMDB API integration
- Simple configuration UI
