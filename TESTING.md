# Verification

Use Node 22.16 or newer and `npm ci`. Run the complete release gate before proposing a release; use focused checks while implementing a change.

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

`npm run demo` prints iframe and native URLs. Comments and sign-in are simulated. `test:browser` starts and stops its own fixture and records the source/runtime conditions in `docs/evidence/browser-acceptance.json`.

The browser portfolio exercises native and iframe embedding, future-capability sign-in, actual typing and undo/redo, preview, refresh, appearance and contributions. Cohesive custom-view workflows cover rich-content sanitization and failed enhancements, acquired-resource retirement, forum switching and editing, and local setup/configuration. Use the current receipt for executed scenarios and engines; a fixed case count is not an acceptance target.

Browser fixtures navigate an actual local HTTP document served by the native service and load the same built assets as consumers. The resource command measures native SQLite counters across the complete repository service. Its controlled clock delivers due alarms; its receipt distinguishes actual SQL use, admitted HTTP allowance, and upstream requests from unmeasured ingress CPU, object billing and production latency.

For manual editor checks, compare real typing, undo and redo with a plain textarea. Repeat after Preview/Write, theme changes, refresh and an asynchronous contribution completion. Verify the intended text, selection and focus; DOM identity alone is supporting evidence.

## Independent behavior

Tautological tests and change detectors are harmful. Unit tests are presumed unnecessary in most cases. These rules apply to existing tests as well as new ones. Retained workflows must independently establish valuable user behavior or a real boundary; neither an old expectation nor a historic bug earns a test by itself. Avoid assertions about source spelling, prose, chosen maps/tables, dependency identity or a copy of the implementation’s calculation. A bug fix needs a new test only when existing behavior coverage has a genuine gap.

Use controlled interleavings for asynchronous behavior: retirement during a read, identity change during authentication, a correction during ranking acquisition, and a response lost after a remote effect commits. Compare with independent remote state or physical storage counters rather than internal bookkeeping.

## Deployed acceptance

Use a disposable discussion and a real GitHub App. Record version, browser, embedding mode and results. Check allowed and rejected origins; existing mappings and first contribution; sign-in by popup and full-page return; comments, replies, edits, deletion, reactions and moderation against GitHub readback; pagination and ranked traversal; Markdown, code, math and failed enhancements; and narrow layouts and native editor behavior.

Include Safari, Firefox and physical iOS where available. Local Chromium/WebKit results do not establish those environments. Exercise fresh-account setup and the generated App callback/configuration separately from an existing deployment.

## Release evidence

Record completed checks and their conditions in [verification results](docs/CONFIDENCE.md). Measure deployed CPU, duration and SQL usage using the [usage guide](FREE-TIER.md#check-your-deployment). Verify the extracted package in an independent website, then check the deployed assets and actual contribution flow after any authorized deployment. Version 3 uses fresh coordination namespaces; follow [migration instructions](docs/MIGRATION.md#rollout-and-recovery).
