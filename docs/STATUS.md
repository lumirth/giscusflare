# Status

Updated 2026-09-26. Development is on `main`.

## Implemented

- Framework-independent conversation controller with typed commands, drafts, pagination, optimistic reactions and canonical reconciliation.
- Shared browser runtime, configurable fetching, optional five-minute draft recovery and reusable interactions.
- Native and iframe embedding, App-token authentication and a shared rich-content renderer.
- Replaceable standard presentation and an independent headless example.
- Giscus themes, Octicons, loading animation and persistent editor DOM.

## Verified

- 87 automated tests: TypeScript/build checks, domain behavior, response-loss recovery, identity changes, draft expiry, DOM continuity, initial loading and presentation boundaries.
- 11 workerd checks with simulated GitHub: RPC, SQLite persistence, encrypted sessions, authentication handoff and rate limiting.
- Real staging App sign-in, posting, editing, replies and reaction toggles in the retained development discussion.
- Direct Giscus comparisons across seven themes, plus native grouped undo before and after Preview. See [presentation evidence](PRESENTATION.md).

JSDOM tests establish DOM and event behavior. Layout and native editing require browser checks.

## Release gaps

Physical iOS, Firefox, all themes/locales and the full moderation permission matrix need further coverage. The paid staging account and local tests do not establish Cloudflare Free-plan CPU capacity.

Kukas's custom presentation remains deferred. Production Kukas comments remain disabled pending design approval.

Current staging deployment: `a7c78467-6093-4149-a0f1-2e1e2a695258`.
