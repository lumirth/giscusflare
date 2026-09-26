# Bounded acceptance — 2026-09-26

This pass is sufficient to start the Kukas presentation on the existing paid staging deployment. It is not a declaration of complete browser coverage or Cloudflare Free-plan readiness.

## Checked

- Real GitHub App sign-in and same-window return, writing, Preview/Write, grouped native undo/redo, posting and author editing.
- Existing retained fixture: Markdown emphasis, code/copy controls, tasks, table, math, long URLs and nine-reply folding. No new corpus was needed.
- 390px desktop WebKit: zero document overflow and 8px host gutters after fixing the native CSS scoper. The summary and sorting controls now wrap intentionally.
- Core: 89 automated tests passing. The previous 11 workerd checks remain applicable; runtime service behavior did not change in this pass.
- Consumer TypeScript build and a check of the shipped Kukas import graph: it reaches no standard-presentation or native-mount modules.

The separate Kukas browser pass covers Toast/undo, reaction picker, reply expansion and focus, Preview/Write with grouped undo, light/dark surfaces and footer wrapping. Presentation review remains open.

## Resource sample

[Sanitized samples](evidence/bounded-worker-samples.json) retain only operation paths, execution model, CPU, wall time and outcome. No headers, credentials, query strings or user identifiers are retained. These are an interactive staging sample, not a load test or percentile estimate.

Most sampled stateless requests used 1–9ms CPU. Outliers reached 12–14ms, including thread, replies and authentication-window requests. Durable Object operations used 0–10ms. Multi-second wall times include upstream network waits and are not CPU time. Cold starts may contribute, but this sample does not identify isolates and cannot establish that explanation.

Cloudflare's [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) list 10ms CPU per Free-plan invocation. The observed outliers therefore leave Free-plan qualification open. Before claiming that support, profile those paths and repeat a bounded cold/warm sample on the intended configuration. Paid staging is suitable for continuing design work.

The current build reports approximately 28KiB gzip for the Worker, 52KiB for the standard widget's initial JavaScript graph, and 664KiB including lazy math. These are build estimates, not transferred-byte measurements; CSS and fonts are separate. Math remains a configurable rendering capability and lazy import. No polling was enabled for this pass.

## Deferred public-release coverage

Physical iOS/Firefox, optional popup authentication, every theme/locale, the complete real-token moderation matrix, and Free-tier traffic/storage qualification. Tests already cover response-loss recovery and permission boundaries; this pass did not repeat all of them manually.
