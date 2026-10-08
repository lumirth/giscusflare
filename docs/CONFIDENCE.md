# Verification results

Version 3.0 replaces browser ownership, internal service transport and ranking persistence. Earlier release results establish historical behavior and workloads; they do not qualify this replacement. Follow [verification](https://github.com/lumirth/giscusflare/blob/main/TESTING.md) to reproduce the current checks.

## Current verification

The release commands produce receipts identifying the source commit/content hash, runtime, conditions and result. Reports are ignored local output and CI artifacts, not committed evidence. Inspect each report’s status rather than treating the presence of a file as a passing check:

| Receipt | Evidence |
| --- | --- |
| `test-results/evidence/native-runtime.json` | Actual workerd/SQLite, RPC, encrypted-session restart and an independent simulated remote effect |
| `test-results/evidence/browser-acceptance.json` | Chromium/WebKit native/iframe and custom-view workflows against the actual local Worker/DO service |
| `test-results/evidence/ranking-service-runtime.json` | Actual repository, credentials, provider transport and due native alarms for the warm full-day workload and divided allowance pause |

GitHub is explicitly simulated in the native/browser receipts. Both use the production Worker and SQLite Durable Object in local workerd; the browser loads production built modules and actual browser resources. Provider effects remain outside workerd across restart. The resource receipt records complete-service native SQL and due alarms under its declared clock and workload. Package checks build consumers from an extracted archive. [Verification](https://github.com/lumirth/giscusflare/blob/main/TESTING.md) defines the full gate and separately required deployed checks.

The replacement removed DOM-identity and mutation-count proxies for native undo. Actual typing exposed failures despite stable editor nodes, and typing/undo/redo remains the oracle. Retiring a page, view or authentication flow must prevent late publication even when already-issued remote work completes. Check each receipt for the interleavings actually exercised; passing a happy-path journey alone does not establish those obligations.

Local evidence does not establish production latency, CPU distributions, real GitHub permissions, fresh-account deployment, Firefox, Safari or physical iOS behavior. These local receipts do not establish a deployed service.

## Historical observations

A September 27, 2026 deployed workload sent 12,100 requests across 100 discussions with simulated 80 ms upstream latency. It recorded 6.85 ms p99 Worker CPU, 20.57 GB-s object duration and 3,071 SQLite writes. That workload preceded both the v2 cache changes and v3 typed ranking storage.

Earlier real GitHub query checks exercised discussion access, comment hydration, permissions, replies and counts. Desktop Chromium/WebKit checks covered native and iframe presentation, editor undo and OAuth flows. These observations guide acceptance coverage but must be repeated when their boundary changes.

The one-time [version 3 visual qualification](https://github.com/lumirth/giscusflare/pull/2) compared 168 paired renders: 167 were pixel-identical; one differed at five SVG antialiasing pixels. Detailed comparison output remains qualification material, not a maintained source dependency.

The giscus presentation reference remains pinned at `3d6430237108ca4ee3eb6a1a20595201c09c72d5`; [source provenance](PROVENANCE.md) identifies its attribution. Measure actual behavior instead of requiring the replacement to reproduce historical DOM structure or storage groups.

## Capacity evidence

Use actual SQL cursor counters for rows, platform metrics for CPU and object duration, and independent request/remote-effect observations. Record cold restoration, unchanged refresh, changed observations, correction during acquisition, multiple active discussions, every configured profile and membership reconciliation. [Cloudflare usage](../FREE-TIER.md) explains the constraints.

Old grouped-JSON row counts, earlier freshness-fenced proofs and warm-cache limits are not current v3 capacity claims. The replacement exposes refresh cadence and acquisition intervals; a ready traversal does not promise an atomic remote snapshot or that every observation is younger than one age cutoff. Qualify the current representation and configured budgets directly.
