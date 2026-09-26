# Implementation status

Updated 2026-09-26. The full design is approved; implementation is in progress.

## Established

- Independent Git repository with untouched source baseline, dependency lockfile and source provenance.
- Domain engine remains independent of the Cloudflare adapter; official generated Worker declarations are checked separately from browser DOM code.
- Canonical comment, deletion, moderation and reaction results travel through durable mutation receipts and reconcile in the shared browser conversation model.
- Conversation controller retains drafts, submission keys, editor state, sort and expanded replies across supported updates. Stale reads cannot overwrite a newer successful mutation.
- Rotating OAuth credentials are removed durably before external refresh, so uncertain refresh requires reauthentication instead of replaying a potentially consumed refresh token.
- Native and iframe presentations share session, transport and conversation code. Native CORS checks configured origin, repository and page; cookie-producing authentication preparation remains service-origin only.
- Native package entry and scoped styles are built. The current standard interface remains an intermediate implementation.

## Evidence

- 63 local automated tests passed, including lost response/retry after reload, wiped parents, expanded replies, stale reads and native origin boundaries.
- 11 real local workerd checks passed: RPC, SQLite persistence across restart, encrypted session persistence, cookie/proof authentication boundaries and native rate limiting. GitHub is simulated in these checks.
- Real GitHub authentication, App permissions and mutations have not been verified for this core.
- In-app browser smoke check passed for native mount, simulated sign-in, posting and expansion from three to seven replies. It caught and fixed a bundled component-registration omission. [Screenshot](evidence/native-fixture.png). Full browser acceptance remains open; neither the standard interface nor the Kukas presentation is visually accepted.

## Still required

- Complete the standard editor and rich-content pipeline: code-copy, math, rendering profiles/fallbacks, localization and themes; individually verify third-party licenses.
- Finish broader contextual moderation and GitHub handoffs, including exceptional discussion states and deletion mapping policy.
- Exercise deep customization through the separate Kukas consumer, without private imports.
- Complete configuration update/disposal behavior, refresh/resource measurements, browser interaction and rich-content adversarial tests.
- Verify real App-token authority and deployed Free-tier resource behavior; publish reproducible deployment instructions.

Production comments stay paused until visual approval. The imported candidate's deployment scripts are not a release certification.
