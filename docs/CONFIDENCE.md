# Bounded acceptance — 2026-09-26

This is the historical bounded pass that allowed Kukas presentation work to proceed. The user subsequently approved and deployed Kukas comments; see [current status](STATUS.md). These measurements remain dated staging evidence, not a declaration of complete browser coverage or Cloudflare Free-plan readiness.

## Checked

- Real GitHub App sign-in and same-window return, writing, Preview/Write, grouped native undo/redo, posting and author editing.
- Existing retained fixture: Markdown emphasis, code/copy controls, tasks, table, math, long URLs and nine-reply folding. No new corpus was needed.
- 390px desktop WebKit: zero document overflow and 8px host gutters after fixing the native CSS scoper. The summary and sorting controls now wrap intentionally.
- Core: 89 automated tests passing. The previous 11 workerd checks remain applicable; runtime service behavior did not change in this pass.
- Consumer TypeScript build and a check of the shipped Kukas import graph: it reaches no standard-presentation or native-mount modules.

The separate Kukas browser pass covers Toast/undo, reaction picker, reply expansion and focus, Preview/Write with grouped undo, light/dark surfaces and footer wrapping. Kukas presentation review subsequently completed; the user approved production activation.

## Resource sample

[Sanitized samples](evidence/bounded-worker-samples.json) retain only operation paths, execution model, CPU, wall time and outcome. No headers, credentials, query strings or user identifiers are retained. These are an interactive staging sample, not a load test or percentile estimate.

Most sampled stateless requests used 1–9ms CPU. Outliers reached 12–14ms, including thread, replies and authentication-window requests. Durable Object operations used 0–10ms. Multi-second wall times include upstream network waits and are not CPU time. Cold starts may contribute, but this sample does not identify isolates and cannot establish that explanation.

Cloudflare's [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) list 10ms CPU per Free-plan invocation. The observed outliers therefore leave Free-plan qualification open. Before claiming that support, profile those paths and repeat a bounded cold/warm sample on the intended configuration. The later production rollout does not resolve that measurement gap.

The build measured during this pass reported approximately 28KiB gzip for the Worker, 52KiB for the standard widget's initial JavaScript graph, and 664KiB including lazy math. These are build estimates, not transferred-byte measurements; CSS and fonts are separate. Math remains a configurable rendering capability and lazy import. No polling was enabled for this pass.

## Remaining qualification

The actionable checklist lives in [broader release work](IMPLEMENTATION.md). Physical-device/browser, moderation, optional-authentication and Free-plan coverage remain separate from the completed Kukas rollout. Preserve the limits above when reporting confidence; no additional qualification was performed during documentation closeout.
