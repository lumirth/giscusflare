# Giscusflare

A customizable GitHub Discussions comments system for Cloudflare Workers and SQLite Durable Objects.

**In development.** This repository contains the adopted implementation and the first shared conversation/embedding refactor. It is not yet a production release or a claim of Giscus capability parity. See [status and acceptance gaps](docs/STATUS.md).

## Repositories

- `giscusflare` owns GitHub transport, authorization, persistence, conversation state, content processing and the standard interface.
- `kukas-giscusflare` is a separate consumer for Kukas presentation and deployment choices. It depends on this package; it must not copy its engine or authentication.

The core starts from the owner-supplied `giscus-workers-v2` source. The untouched import is commit `5e62a02`; [provenance](docs/PROVENANCE.md) records attribution. Development takes place here, not in the Downloads archive.

## Development

Use Node 22.16 or newer.

```sh
npm ci
npm test
npm run test:runtime
npm run demo
```

`npm test` checks both TypeScript environments, builds artifacts and exercises simulated GitHub operations. `test:runtime` adds real local workerd, SQLite and RPC checks, with simulated GitHub. Neither proves real GitHub App permissions or deployed performance.

The demo provides an iframe page at `http://127.0.0.1:8788/article` and a native page at `/native` on the same host. Read the URLs printed by the command if overriding its ports. Demo comments stay in the local simulated service.

## Architecture

The repository engine owns external transitions and durable retry receipts. The browser `ConversationController` owns draft, editor, pagination and mutation continuity. `BrowserSession` supplies the same explicit bearer transport and OAuth handoff for iframe and native embedding. Presentations consume these APIs, rather than duplicating them.

Native integration is exported from `giscusflare`, with scoped standard styles from `giscusflare/styles.css`. The public API is provisional until the standard and Kukas interfaces exercise it fully. Build-time presentation replacement is the intended customization boundary.

## Design and release gates

- [Implementation plan](docs/IMPLEMENTATION.md)
- [Pinned upstream capability inventory](docs/CAPABILITIES.md)
- [GitHub API and token constraints](docs/GITHUB-API.md)
- [Verification status](docs/STATUS.md)

Existing deployment/security instructions came from the imported candidate and require reconciliation with the new integration contracts before a release. No production cutover is implied by a passing local build.
