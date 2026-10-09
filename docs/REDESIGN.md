# Preparation, effects and recovery ownership

Version 5 separates service content delivery from browser rendering, exposes the actual portable page model, and makes contribution completion and persistent writing follow their own identities. GitHub remains authoritative for stored Markdown and permissions; repository Durable Object addresses, sessions and durable receipt identities remain stable. [Design](DESIGN.md) describes the complete ownership model; [API](API.md) specifies the public contracts.

| Responsibility | Owner |
| --- | --- |
| Canonical discussion source and permission decisions | GitHub |
| Website policy, HTTP protocol and immutable repository resolution | Worker |
| Trusted portable preparation and bounded result reuse | Host producer inside the existing repository Durable Object |
| Content delivery selection | Explicit `contentSource`: source, GitHub or prepared |
| Safe prepared HTML and required resource installation | Selected browser content renderer |
| Reading, operation intent and scoped adoption | Portable `PageModel`, shared by browser and other transports |
| Authentication, persistent record storage and native interactions | Browser adapters |
| One independently recoverable draft or issued contribution | Persistent writing record, distinct from its destination |
| Layout, controls and recovery choices | Standard or host presentation |

A host can prepare both published comments and anonymous previews with its own commenter-safe Markdown pipeline. Producer revision identifies interpretation changes; styles and module resources accompany the prepared result. Readers can install that output without downloading the host compiler. A source renderer remains available when browser preparation is the desired choice, and the default GitHub renderer supplies code and math.

Preparation is detached from installed content. Generation cancellation stops obsolete work, while installed-view lifetime keeps the current output functional until replacement is committed. Mounted framework updates prepare a commit callback. Presentation layout and selected content styling have separate owners.

Contributions return operation-owned changes. Independent effects dispatch independently; repeated desired states coalesce only within the same author, subject and reaction. Narrow comment/reaction patches preserve other accepted facts. A confirmed GitHub effect remains confirmed if optional display preparation or ranking observation fails.

Persistent writing uses independent record IDs. Several contexts can retain drafts for the same destination, and an ordinary or idle context cannot erase another context's intent. Readers explicitly choose which recovered record to restore. Unresolved submissions retain their original author, body, target and key until recovery succeeds or the reader deliberately abandons recovery.

## Qualification and accounting

[Verification](../TESTING.md) defines required behavior and release checks. [Confidence](CONFIDENCE.md) distinguishes what local checks can establish from deployed acceptance. Current gate, release and deployment results belong in the relevant PR and run artifacts; this maintained design document does not substitute for those results.

Count the complete replacement, including defaults, examples, downstream producer/adapters and verification support. Report physical lines, consistently formatted authored lines and bytes, and disclose generated dependencies separately. Moving a responsibility between repositories does not establish savings. Measure the actual reader resource graph and server cold/warm preparation costs.

Detailed ledgers, screenshots and JSON receipts belong in ignored run artifacts. Preserve the established successful default visuals using an independent pre-change baseline; behavioral recovery and failure states need their own observable journeys.
