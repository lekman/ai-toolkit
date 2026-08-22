# Changelog

## [0.4.0](https://github.com/lekman/ai-toolkit/compare/rag-core@v0.3.2...rag-core@v0.4.0) (2026-08-22)


### Features

* **rag:** exclude scratch folders and guard the reconcile ([#43](https://github.com/lekman/ai-toolkit/issues/43)) ([c2521be](https://github.com/lekman/ai-toolkit/commit/c2521be8042c431c9d1b0cf2527c6c0c6e1dc377))

## [0.3.2](https://github.com/lekman/ai-toolkit/compare/rag-core@v0.3.1...rag-core@v0.3.2) (2026-08-19)


### Fixes

* **rag:** stop compacting unchanged stores, keep one hour of versions ([#31](https://github.com/lekman/ai-toolkit/issues/31)) ([f5c61d5](https://github.com/lekman/ai-toolkit/commit/f5c61d5debfa3e9d8ddf6e1cec61b57c9b7da9ae))

## [0.3.1](https://github.com/lekman/ai-toolkit/compare/rag-core@v0.3.0...rag-core@v0.3.1) (2026-08-18)


### Fixes

* **rag:** stop excluding notes whose title ends in a year ([#24](https://github.com/lekman/ai-toolkit/issues/24)) ([77242dd](https://github.com/lekman/ai-toolkit/commit/77242dd594e3849bbbddcd9bae500ddcbf76a785))

## [0.3.0](https://github.com/lekman/ai-toolkit/compare/rag-core@v0.2.1...rag-core@v0.3.0) (2026-08-18)


### Features

* **rag:** serve the index over MCP on a private interface ([#22](https://github.com/lekman/ai-toolkit/issues/22)) ([eb554c3](https://github.com/lekman/ai-toolkit/commit/eb554c308f5ec6dd331bd41b68e50fea23075ce3))

## [0.2.1](https://github.com/lekman/ai-toolkit/compare/rag-core@v0.2.0...rag-core@v0.2.1) (2026-08-18)


### Fixes

* resolve the code scanning alerts worth resolving ([#18](https://github.com/lekman/ai-toolkit/issues/18)) ([f6898c7](https://github.com/lekman/ai-toolkit/commit/f6898c7d9640ee8868078f39046212be71e31b90))

## [0.2.0](https://github.com/lekman/ai-toolkit/compare/rag-core@v0.1.0...rag-core@v0.2.0) (2026-08-18)


### Features

* **rag:** add scheduled maintenance, and fix the check it exposed ([59e52ad](https://github.com/lekman/ai-toolkit/commit/59e52ad0f30396a23a3188720a236739146b872e))


### Fixes

* **dependabot:** Bump @lancedb/lancedb from 0.33.0 to 0.37.1 ([#8](https://github.com/lekman/ai-toolkit/issues/8)) ([786edbe](https://github.com/lekman/ai-toolkit/commit/786edbeba671a0291c5272a721e4381c8f2c9614))
* **dependabot:** Bump @types/node from 22.20.1 to 26.2.0 ([#7](https://github.com/lekman/ai-toolkit/issues/7)) ([7b8fe18](https://github.com/lekman/ai-toolkit/commit/7b8fe185a263cccf7ad64ad230e7ba7b9b495bc9))
* **rag:** reclaim store versions after every scan ([e4af816](https://github.com/lekman/ai-toolkit/commit/e4af816a707f8438af4bdb6efbe1a9560968063b))
* **rag:** stop rewriting rows the store already holds ([f3dded9](https://github.com/lekman/ai-toolkit/commit/f3dded9080d1496ebd1882a1e36d053d3eabef16))
