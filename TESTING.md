# Verification

Use Node 22.16 or newer and `npm ci`. Run the complete release gate before proposing a release; use focused checks while implementing a change. Use current PR/run artifacts for executed gates; a scope description or historical result does not qualify the current contracts.

| Command | Evidence |
| --- | --- |
| `npm test` | TypeScript, public examples, builds and native/browser workflows |
| `npm run test:runtime` | Actual Worker/DO RPC, SQLite persistence, encrypted sessions, website policy and interrupted remote writes in local workerd |
| `npm run test:browser` | Chromium/WebKit native/iframe editing, sign-in, contributions, rich content and custom views |
| `npm run check:package` | Extracted archive typechecks, browser/Worker consumer builds and deployment asset copying |
| `npm run check:release` | Complete local release gate |
| `npm run deploy:check` | Release gate, public configuration and Wrangler dry run |

The surrounding-world fixture stores independently authored discussions, comment bodies, replies and reactions. It validates GraphQL documents and variables against the recorded official GitHub schema, then executes the selected fields over that state. Unrequested fields cannot conceal an incomplete application query. This establishes the recorded schema contract; real GitHub App permissions remain a deployed check.

Native and browser workflows use the actual production Worker and SQLite Durable Object in local workerd. The shared fixture keeps remote GitHub effects outside workerd so they survive its restart. An uncertain mutation must not become a second contribution after retry. Chromium and WebKit each qualify a fresh service/provider environment with the configured deployment limits and distinct reader ingress identities; qualification does not disable account throttling. They load the built browser modules and use real DOM parsing, AbortSignal, storage, dialogs, editing and layout. GitHub is explicitly simulated; these checks do not establish actual GitHub permissions or production Cloudflare costs.

## Local use

`npm run demo` prints iframe and native URLs. Comments and sign-in are simulated. `test:browser` starts and stops its own fixture and records the source/runtime conditions in `test-results/evidence/browser-acceptance.json`.

The retained journeys demonstrate these outcomes through the production Worker and public clients:

| Supported outcome | Independent observation |
| --- | --- |
| Reading and chronological/ranked traversal | Authored provider bodies, replies and votes reach the rendered conversation; pagination has no duplicates, score changes preserve captured traversal, and deliberately changing order observes the new ranking |
| Native writing and publication | Actual typing/undo survives preview, resizing and appearance changes; a fresh browser document reacquires submitted comments and replies |
| Interrupted contributions | Provider effects survive lost responses and workerd restart; retained author/body/destination/receipt identity prevents duplicate publication |
| Changed custom content | Published edits receive separate anonymous readback; controlled website interpretation preserves usable installed content, rejects late older output and recovers through visible Retry |
| Independent authority | Real session revocation preserves protected writing; transport failure during identity/account acquisition preserves reading and local drafts |
| Shared reading and recovery | Concurrent readers share acquisition; workerd restart preserves original-age observations and cooldown; signed external changes reconcile; temporary OAuth refusal preserves a single-use renewal for concurrent recovery; private scope withdraws reading |
| Safe rich reading | The stock producer and browser keep authored code/tables/task lists readable while rejecting executable provider markup |

Typechecks, builds and extracted consumer compilation are separate evidence. These workflows do not qualify every custom producer or renderer. Custom manifest-mismatch/failed-resource paths, physical-device behavior and production permissions/capacity need their own bounded acceptance when those environments are changed or released.

CI runs the complete gate on [macOS 26](https://docs.github.com/en/actions/reference/runners/github-hosted-runners) to exercise WebKit's native controls on the Apple port. The Linux Playwright GTK build used during qualification did not enter resize mode through the mouse driver even for isolated plain textareas with fixed or content sizing. That observation does not establish behavior in a deployed GTK browser. The gate retains actual resize, subsequent typing and native undo assertions on macOS; it has no programmatic resize substitute or engine-specific skip.

Browser fixtures navigate an actual local HTTP document served by the native service and load the same built assets as consumers. Typechecks, builds, package qualification and deployment dry runs establish compile and artifact validity separately from behavior coverage. Local qualification does not establish production CPU, billing or capacity.

For manual editor checks, compare real typing, undo and redo with a plain textarea. Repeat after Preview/Write, theme changes, refresh and an asynchronous contribution completion. Verify the intended text, selection and focus; DOM identity alone is supporting evidence.

## Visual reference

Review the default presentation in Chromium and WebKit, native and iframe modes, narrow and wide layouts, published rich content and normal composer states. Screenshots support visual review; fixed pixels, geometry and historical DOM structure are not behavior contracts.

## Independent behavior

Tautological tests, change detectors, unit tests and integration tests are harmful. This policy applies retroactively. Retain only justified end-to-end workflows that demonstrate important supported outcomes through the application and independent observations. A browser or real local runtime does not turn an isolated helper test into end-to-end coverage. Default cleanup to deletion and consolidation; do not replace each deleted assertion, archive rejected suites or move them into diagnostics. Remove orphaned machinery after checking its consumers. A bug fix needs a new regression test only when it closes a genuine gap in behavior coverage; prefer an existing workflow. Typechecks, lint, builds and artifact validation remain distinct from behavior tests.

Use controlled interleavings for asynchronous behavior: retirement during a read, identity change during authentication, a correction during ranking acquisition, and a response lost after a remote effect commits. Compare with independent remote state or physical storage counters rather than internal bookkeeping.

## Deployed acceptance

Use a disposable discussion and a real GitHub App. Record version, browser, embedding mode and results. Check allowed and rejected origins; existing mappings and first contribution; sign-in by popup and full-page return; comments, replies, edits, deletion, reactions and moderation against GitHub readback; pagination and ranked traversal; Markdown, code, math and failed enhancements; and narrow layouts and native editor behavior.

Include Safari, Firefox and physical iOS where available. Local Chromium/WebKit results do not establish those environments. Exercise fresh-account setup and the generated App callback/configuration separately from an existing deployment.

## Release evidence

Test commands write generated reports to ignored `test-results/evidence/`. CI uploads them as the `verification-reports` artifact, including partial reports on failure. Detailed results, screenshots and one-time source ledgers belong in run or PR artifacts, not tracked source. Measure deployed CPU, duration and SQL usage using the [usage guide](FREE-TIER.md#check-your-deployment). Verify the extracted package in an independent website, then check the deployed assets and actual contribution flow after any authorized deployment. Preserve deployment bindings, platform migration history and secrets across updates.

## Historical evidence and limits

The [archived visual/workload receipts](https://github.com/lumirth/giscusflare/blob/bc5e342214f8357d699bab97a7fdf5182b398580/TESTING.md#historical-evidence-and-limits) do not qualify the current release or establish current capacity. [Provenance](docs/PROVENANCE.md) owns pinned-source history and regeneration; use current run artifacts and deployed measurements for current claims.

Source accounting includes complete replacements, defaults, examples, downstream consumers and verification support, with generated/vendor data reported separately. Moving work between repositories or categories is not a saving.
