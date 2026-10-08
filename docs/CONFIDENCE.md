# Verification scope

Version 4 changes content customization, writing recovery, reading continuity and public action availability. It is a release candidate. Earlier release results do not qualify these replacements, and this document does not claim a completed current gate or deployment. Use the PR and current run artifacts for execution results; follow [verification](../TESTING.md) to reproduce them.

## Local evidence

| Check | What it can establish |
| --- | --- |
| Worker/DO workflows in actual local workerd and SQLite | RPC, encrypted-session persistence, website policy, contribution replay and interrupted external effects |
| Chromium/WebKit journeys against production built browser modules | Native/iframe editing, content rendering, lifecycle retirement, writing recovery, reading continuity and custom presentations |
| Ranking service with native SQL cursor counters and controlled due alarms | Complete-service row work, configured admission, cadence and budget pauses under the recorded workload |
| Independent consumers built from an extracted archive | Published export shape, packaged browser/Worker entry points and assets |

The simulated GitHub fixture validates GraphQL against the recorded official schema and holds remote effects outside workerd so they survive its restart. Schema agreement does not establish actual App permissions. Contribution recovery needs independent remote effect/readback oracles, not receipt identity alone. Writing tests need the correct destination and original issued body/key after hide/reload/account changes. Content tests need observable output, no unnecessary preview request, readable failure and retirement of mounted resources. Continuity tests need preserved accumulated reading and explicit invalidation, not an internal flag copied from implementation.

Native typing, selection, undo and redo are behavioral oracles. Stable DOM alone is insufficient. Retiring page/view/content must prevent late publication even when already issued work finishes. Default visual fidelity remains required, without making historical DOM structure an architectural constraint.

Generated reports live in ignored `test-results/evidence/`; CI uploads them, including partial failure reports. Each identifies its source/runtime/conditions/status. A report file is not automatically a passing result. One-time visual comparisons and source accounting belong in run or PR artifacts.

## Boundaries and historical evidence

Local checks do not establish production latency, CPU distributions, object duration, Cloudflare billing, real GitHub permissions, fresh-account deployment, Firefox, Safari or physical iOS. GitHub is simulated in local service/browser workflows. Extracted-package checks do not establish a deployed service. Actual deployed acceptance uses matching browser/Worker versions and independent GitHub readback.

The [version 3 visual qualification](https://github.com/lumirth/giscusflare/pull/2) compared 168 paired renders: 167 were pixel-identical; one differed at five SVG antialiasing pixels. It is historical evidence. The default reference remains pinned at `3d6430237108ca4ee3eb6a1a20595201c09c72d5`; [provenance](PROVENANCE.md) records source and licenses.

A September 27, 2026 workload recorded 12,100 requests, 6.85 ms p99 Worker CPU, 20.57 GB-s object duration and 3,071 SQLite writes. It predates the current cache/ranking representations and is not a current capacity guarantee. Measure native SQL counters and actual platform metrics under declared cold/warm, acquisition and correction workloads. [Cloudflare usage](../FREE-TIER.md) explains limits and measurement.

Ranking ready results describe acquisition intervals and cadence, not atomic remote snapshots or a universal source-age bound. Bounded background observation retains traversal; it does not promise continuous freshness of all loaded comments. Qualify those actual contracts rather than restoring older guarantees through tests.
