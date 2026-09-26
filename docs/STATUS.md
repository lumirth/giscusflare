# Implementation status

Updated 2026-09-26. This is a development core, not a production parity certification.

## Shared model and interaction cleanup

- Framework-independent controller with typed actions, canonical reconciliation, optimistic reaction intent, pending/failure/uncertain states and durable submission identities.
- Late replies from an earlier authenticated identity cannot restore its personalized state or erase new writing.
- Browser runtime owns no presentation selectors. Optional composer/menu/focus bindings operate on consumer-owned markup.
- Native/iframe storage namespace and draft identity are shared. Five-minute optional recovery, in-memory continuity, cancellation and preview are separate concerns.
- Fetching policy is validated and shared, with request coalescing, background backoff, hidden/offline/editor suspension, and independent server prefetch limits.
- Removed arbitrary public mutation payloads, ineffective folding actions, legacy draft fallback, copy-era lexical tests, obsolete Python component harnesses and ZIP packaging scripts. Source provenance is retained in Git/docs.
- Independent public-API example implements a live custom presentation; no default UI/style dependency.

## Evidence so far

- 84 automated tests cover the cleaned architecture and replacement presentation: strict type checks, domain/security behavior, response loss and recovery, optimistic toggle ordering, identity changes, DOM continuity and storage expiry. Browser interaction tests use JSDOM, not a layout engine.
- 11 real local workerd checks passed (simulated GitHub): RPC, SQLite restart, encrypted sessions, proof/cookie authentication and rate-limit bindings.
- Real staging App authentication, posting, editing and reply publication previously verified using the retained development discussion. Those observations do not establish every moderation action or every rendering state.
- The replacement was deployed and inspected on staging at version `deae1637-1e70-4111-a26e-e5ea69833697`. See [presentation evidence](PRESENTATION.md) for behavior, intentional differences and verification limits.

## Presentation work

The previous attempt has been deleted and replaced with modular standard-view parts over the public shared model and bindings. Giscus CSS is compiled from pinned upstream sources; generated declarations are cleaned before each build. The independent example and the default remain separate consumers. Kukas design remains deferred. Production Kukas comments remain paused.

## Limits

The Cloudflare account is paid. Bundle/startup measurements and local runtime checks do not certify the Free plan's per-request CPU limit. iOS hardware, all 24 themes, every locale and full real-token moderation need distinct evidence; do not infer them from the test count.
