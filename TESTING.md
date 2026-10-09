# Verification

Use Node 22.16 or newer and `npm ci`. Run the complete release gate before proposing a release; use focused checks while implementing a change. Use current PR/run artifacts for executed gates; a scope description or historical result does not qualify the current contracts.

| Command | Evidence |
| --- | --- |
| `npm test` | TypeScript, public examples, builds and native/browser workflows |
| `npm run test:runtime` | Actual Worker/DO RPC, SQLite persistence, encrypted sessions, website policy and interrupted remote writes in local workerd |
| `npm run test:ranking` | Actual service SQL costs, refresh cadence, observations and resource-budget boundaries |
| `npm run test:browser` | Chromium/WebKit native/iframe editing, sign-in, contributions, rich content and custom views |
| `npm run test:package` | Extracted archive, independent browser/Worker consumers and public assets |
| `npm run check:release` | Complete local release gate |
| `npm run deploy:check` | Release gate, public configuration and Wrangler dry run |

The shared provider fixture validates actual GraphQL documents and variables against the recorded official GitHub schema. This establishes the recorded schema shape; real App permissions remain a deployed check.

Native and browser workflows use the actual production Worker and SQLite Durable Object in local workerd. The shared fixture keeps remote GitHub effects outside workerd so they survive its restart. An uncertain mutation must not become a second contribution after retry. Chromium and WebKit load the built browser modules and use real DOM parsing, AbortSignal, storage, dialogs, editing and layout. GitHub is explicitly simulated; these checks do not establish actual GitHub permissions or production Cloudflare costs.

## Local use

`npm run demo` prints iframe and native URLs. Comments and sign-in are simulated. `test:browser` starts and stops its own fixture and records the source/runtime conditions in `test-results/evidence/browser-acceptance.json`.

The browser portfolio must exercise native and iframe embedding, future-capability sign-in, actual typing and undo/redo, preview, reading continuity, appearance and contributions. Cohesive custom-view workflows must cover explicit source/prepared/stock content profiles, complete feature replacement, independent public/account/content/count availability, rich-content safety and readable failures, detached current-only content commits, installed-resource lifetime, independent persisted writing records and same-destination recovery, retained writing destination and unresolved outcomes, forum switching and editing, and setup/configuration. Use the current receipt for executed scenarios and engines; a fixed case count is not an acceptance target.

CI runs the complete gate on [macOS 26](https://docs.github.com/en/actions/reference/runners/github-hosted-runners) to exercise WebKit's native controls on the Apple port. The Linux Playwright GTK build used during qualification did not enter resize mode through the mouse driver even for isolated plain textareas with fixed or content sizing. That observation does not establish behavior in a deployed GTK browser. The gate retains actual resize, subsequent typing and native undo assertions on macOS; it has no programmatic resize substitute or engine-specific skip.

Browser fixtures navigate an actual local HTTP document served by the native service and load the same built assets as consumers. The resource command measures native SQLite counters across the complete repository service. Its controlled clock delivers due alarms; its receipt distinguishes actual SQL use, admitted HTTP allowance, and upstream requests from unmeasured ingress CPU, object billing and production latency.

For manual editor checks, compare real typing, undo and redo with a plain textarea. Repeat after Preview/Write, theme changes, refresh and an asynchronous contribution completion. Verify the intended text, selection and focus; DOM identity alone is supporting evidence.

## Visual reference

Current qualification compares successful default states with an independently frozen pre-change build outside Git. Exercise Chromium and WebKit, native and iframe modes, narrow and wide layouts, published rich content and normal composer states. Use equal deterministic inputs and complete pixels; record the actual comparison outcome in its run artifact.

The demo/default presentation must retain its established appearance. Capture reading/editing states before mutating journeys so freshness cannot change fixture data; capture contribution/edit/delete states after real local fixture sign-in and writes.

The comparison uses complete RGBA pixels and equal image dimensions, without masking or tolerance. Both versions receive the same deterministic avatar, display date, focus/hover state and settled fonts. These controlled inputs establish the recorded visual states; they do not turn historical DOM structure or ownership into a contract. The reference runner is a qualification artifact, not a second maintained runtime or a source-shape regression suite.

## Independent behavior

Tautological tests and change detectors are harmful. Unit tests are presumed unnecessary in most cases. These rules apply to existing tests as well as new ones. Retained workflows must independently establish valuable user behavior or a real boundary; neither an old expectation nor a historic bug earns a test by itself. Avoid assertions about source spelling, prose, chosen maps/tables, dependency identity or a copy of the implementation’s calculation. A bug fix needs a new test only when existing behavior coverage has a genuine gap.

Use controlled interleavings for asynchronous behavior: retirement during a read, identity change during authentication, a correction during ranking acquisition, and a response lost after a remote effect commits. Compare with independent remote state or physical storage counters rather than internal bookkeeping.

## Deployed acceptance

Use a disposable discussion and a real GitHub App. Record version, browser, embedding mode and results. Check allowed and rejected origins; existing mappings and first contribution; sign-in by popup and full-page return; comments, replies, edits, deletion, reactions and moderation against GitHub readback; pagination and ranked traversal; Markdown, code, math and failed enhancements; and narrow layouts and native editor behavior.

Include Safari, Firefox and physical iOS where available. Local Chromium/WebKit results do not establish those environments. Exercise fresh-account setup and the generated App callback/configuration separately from an existing deployment.

## Release evidence

Test commands write generated reports to ignored `test-results/evidence/`. CI uploads them as the `verification-reports` artifact, including partial reports on failure. Detailed results, screenshots and one-time source ledgers belong in run or PR artifacts, not tracked source. Measure deployed CPU, duration and SQL usage using the [usage guide](FREE-TIER.md#check-your-deployment). Verify the extracted package in an independent website, then check the deployed assets and actual contribution flow after any authorized deployment. Preserve deployment bindings, platform migration history and secrets across updates.

## Historical evidence and limits

Local checks simulate GitHub and do not establish production latency/CPU distributions, object duration, billing, real App permissions, fresh-account deployment, Safari, Firefox or physical iOS. Package checks establish an extracted consumer, not a deployed service. Deployed acceptance requires matching versions and independent GitHub readback.

The [version 3 visual qualification](https://github.com/lumirth/giscusflare/pull/2) recorded 168 paired renders: 167 pixel-identical and one differing at five SVG antialiasing pixels. Its source build was `b39375bbba0b8249c3bc661c63150b5917b31d80`; the pinned giscus presentation inputs are `3d6430237108ca4ee3eb6a1a20595201c09c72d5`. [Provenance](docs/PROVENANCE.md) distinguishes those inputs. This history does not replace the current independent comparison described above.

A September 27, 2026 workload recorded 12,100 requests, 6.85 ms p99 Worker CPU, 20.57 GB-s object duration and 3,071 SQLite writes. It predates current cache/ranking representations and is not a current capacity guarantee. Measure declared cold/warm workloads and actual platform metrics. Ranking acquisition intervals and cadence do not establish atomic remote snapshots or a universal source-age bound.

Source accounting includes complete replacements, defaults, examples, downstream consumers and verification support, with generated/vendor data reported separately. Moving work between repositories or categories is not a saving. Claims about cold paths need actual necessary-request measurements, including credential renewal, separately from warm traffic.
