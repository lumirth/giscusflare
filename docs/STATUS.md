# Status

Updated 2026-09-26. Development is on `main`.

## Implemented

- Framework-independent conversation controller with typed commands, drafts, pagination, optimistic reactions and canonical reconciliation.
- Shared browser runtime, configurable fetching, optional five-minute draft recovery and reusable interactions.
- Native and iframe embedding, App-token authentication and a shared rich-content renderer.
- Replaceable standard presentation and an independent headless example.
- Giscus themes, Octicons, loading animation and persistent editor DOM.

## Verified

- 91 automated tests: TypeScript/build checks, domain behavior, response-loss recovery, identity changes, draft expiry, DOM continuity, initial loading and presentation boundaries.
- 11 workerd checks with simulated GitHub: RPC, SQLite persistence, encrypted sessions, authentication handoff and rate limiting.
- Real staging App sign-in, posting, editing, replies and reaction toggles in the retained development discussion.
- Direct Giscus comparisons across seven themes, plus native grouped undo before and after Preview. See [presentation evidence](PRESENTATION.md).

JSDOM tests establish DOM and event behavior. Layout and native editing require browser checks.

## Kukas production adoption

Kukas approved and enabled its separate native presentation on 2026-09-26. Eligible Posts and Notes at [kukas.me](https://kukas.me) use it; the site and Worker workshops are removed. The service is `kukas-giscusflare`, maintained by the separate consumer repository. The former `kukas-giscusflare-staging` Worker was retired after transferring its existing Repository storage and updating the public Kukas Comments GitHub App callback.

The cutover browser check loaded existing comments and completed GitHub sign-in back to an authenticated composer. This establishes that deployed integration; it does not expand the earlier browser/content or resource samples.

## Broader release qualification

[Release work](IMPLEMENTATION.md) is the remaining qualification checklist. [Bounded confidence](CONFIDENCE.md) preserves the dated evidence and its limits. Kukas adoption is complete; a stable general-purpose release and Free-plan capacity claims remain separate work.
