# Release history

Use the [GitHub releases](https://github.com/lumirth/giscusflare/releases) for package downloads and release notes. [Verification results](CONFIDENCE.md) records the checks behind these releases; the [release procedure](IMPLEMENTATION.md) describes what to repeat.

## 2.0.0

Pages on the same website now share more cached work. A contribution invalidates its discussion's cached reads while leaving other discussions cached. Overlapping count requests reuse individual results and check GitHub access in the same query. Ranked views retain data for several discussions, reducing repeated reads when visitors move between them.

Update the Worker and your browser package together. Version 2.0 uses `/api/v2/`. For a direct HTTP integration, remove presentation settings from data requests and put new-discussion metadata in `creation`. Existing discussion mappings, sessions and write receipts stay in place.

## 1.0.2

The September 28 rendering update preserves GitHub code previews and line numbers, shows the source of malformed math, and keeps code-copy controls outside horizontal scrolling. The default and forum presentations were checked against the complete giscus example comment on desktop and at mobile width in light and dark modes.

## Initial 1.0 release

The September 27 release introduced the shared conversation API, default and custom presentations, Cloudflare setup page and optional ranking profiles. Validation covered package isolation, native workerd storage and RPC, real GitHub queries, and the deployed demo's sign-in and contribution flows.

The [usage guide](../FREE-TIER.md) includes deployed traffic measurements and ranking storage measurements for operators choosing cache and resource settings.
