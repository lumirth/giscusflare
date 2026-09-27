# Verification evidence

Recorded checks and measurements from September 26, 2026. See [Testing](../TESTING.md) to repeat them and [Release checklist](IMPLEMENTATION.md) for remaining work.

## Automated checks

`npm run check:release` checks TypeScript, builds the distributable files, runs Node and workerd tests, and checks package contents. The tests cover request validation, origin policies, conversation state, rendering, and mutation behavior. Mocked GitHub responses cannot establish which operations GitHub permits for a real App user token.

## Browser observations

A bounded desktop WebKit pass on September 26, 2026 exercised GitHub sign-in, the return to the host page, writing, Preview/Write, posting, author editing, and grouped native undo and redo. A retained discussion supplied Markdown emphasis, code, tasks, a table, math, long URLs, and nine replies.

At a narrow viewport, the native widget had no document overflow and preserved the host's 8px gutter. The pass also checked reply folding, reaction controls, and several light and dark themes. [Presentation evidence](PRESENTATION.md) has the measurements and screenshots.

Physical iOS, Firefox, the full theme and locale matrix, optional authentication settings, and real-token moderation remain untested.

## Worker resource sample

[Sanitized samples](evidence/bounded-worker-samples.json) contain operation paths, execution model, CPU time, wall time, and outcome. They omit headers, credentials, query strings, and user identifiers. The sample came from interactive staging use, not a load test.

Most sampled stateless requests used 1 to 9 ms of CPU. Some thread, replies, and authentication-window requests used 12 to 14 ms. Durable Object operations used 0 to 10 ms. Multi-second wall times included network waits. The sample does not identify isolates, so it cannot establish whether cold starts caused the higher CPU times.

These outliers exceed the documented 10 ms Workers Free CPU allowance. Profile the affected paths and repeat cold and warm requests on the Free plan. [Free-tier estimates](../FREE-TIER.md) cover the other quotas.

The sampled build reported about 28 KiB gzip for the Worker, 52 KiB for the standard widget's initial JavaScript graph, and 664 KiB with lazy math included. These are historical build sizes, not measured transfers. CSS and fonts are separate. Use the current build's `dist/sizes.json` for current sizes.
