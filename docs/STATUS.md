# Release history

Use the [GitHub releases](https://github.com/lumirth/giscusflare/releases) for package downloads and release notes. [Verification results](CONFIDENCE.md) records the checks behind these releases; the [release procedure](IMPLEMENTATION.md) describes what to repeat.

## 2.0.0

Shared reads now belong to the repository and are keyed by discussion and data selection. Mutations invalidate their discussion, overlapping count batches share individual results, and count lookup verifies repository access in the same GitHub query. Ready rankings reuse access verification and retain several discussions in bounded memory.

The HTTP protocol is `/api/v2/`. Update the Worker and browser package together. Data requests no longer accept presentation settings; new-discussion metadata has its own `creation` field. Existing discussion mappings, sessions and write receipts stay in place.

## 1.0.2

The September 28 rendering update preserves GitHub code previews and line numbers, shows the source of malformed math, and keeps code-copy controls outside horizontal scrolling. The default and forum presentations were checked against the complete giscus example comment on desktop and at mobile width in light and dark modes.

## Initial 1.0 release

The September 27 release introduced the shared conversation API, default and custom presentations, Cloudflare setup page and optional ranking profiles. Validation covered package isolation, native workerd storage and RPC, real GitHub queries, and the deployed demo's sign-in and contribution flows.

The [usage guide](../FREE-TIER.md) includes deployed traffic measurements and ranking storage measurements for operators choosing cache and resource settings.
