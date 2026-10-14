# Security

giscusflare handles GitHub authorization and public discussion content. This document describes its access controls, session storage, and rendering rules.

## Repository and website access

The Worker accepts configured public repositories on github.com. It checks the repository, category, discussion, and parent comment before acting on an object ID. It checks the reader's permissions before edits, deletions, and moderation. GitHub also authorizes the write using the acting user's App-issued token.

Each repository has a website-origin list, or an explicit `"*"` policy for open hosting. Iframe responses restrict their ancestors through Content Security Policy. Native requests require an allowed browser Origin and a matching repository and page origin. Sessions belong to one repository and website. The iframe loader checks both the origin and source of messages.

These checks restrict browser embedding and API use. They do not make GitHub discussions private or stop a scripted client from forging an Origin header. Readers can still participate directly on GitHub. See [configuration](docs/CONFIGURATION.md).

## Request handling

Requests have bounded URLs or JSON bodies; schemas validate request structure, configuration, stored records and GitHub responses. The [API reference](docs/API.md#http-protocol) owns methods and payloads, including POST count reads.

Iframe API requests require the service's Origin and same-origin fetch metadata when supplied. Native requests use explicit bearer sessions. CORS does not grant access through ambient cookies. Authorization preparation runs on the comments service itself.

The service exposes specific discussion operations, not a general GitHub proxy. Per-IP rate limits apply at Cloudflare locations. They are not global usage or spending caps.

## GitHub sign-in

The browser creates its future opaque session capability before sign-in and retains it in the embedding page's memory or session storage. Its SHA-256 hash is a transient proof; hashing that proof produces the public attempt identity. The trusted `/auth/window` receives public context and attempt in the query, with only the proof in its fragment. Its script removes the fragment synchronously before asynchronous work and sends the proof in the `auth/prepare` POST body. Preparation claims one pending attempt bound to an HttpOnly cookie and refuses a proof belonging to an existing session. GitHub's callback must return that cookie; its separate authorization exchange uses PKCE.

HTTP request targets and referrers exclude fragments. The proof remains visible to the trusted auth page's JavaScript before removal, so that document is served directly and strips it before navigating elsewhere. The raw capability never enters an auth URL, callback document or provider exchange. Proofs, session credentials and callback query strings must stay out of logs and analytics. See [HTTP target URI rules](https://www.rfc-editor.org/rfc/rfc9110.html#section-7.1) and [Referrer Policy](https://w3c.github.io/webappsec-referrer-policy/#strip-url).

After GitHub authorizes, the callback creates the encrypted session at its capability-hash key and removes the pending attempt in one SQLite transaction. Session creation is one-use. Within the original ten-minute attempt, a temporary identity-read failure retains the encrypted issued credentials for an explicit retry. An upstream exchange refusal or uncertain exchange obtains a fresh authorization code rather than replaying the old one; a local admission refusal can resume the unsent code. There is no subsequent credential handoff or completion endpoint. The browser adopts its own saved capability after a matching return. Failed or expired returns can restore writing without adopting authority.

Popup and full-page sign-in use the same saved capability. Popup notifications require the trusted service origin, the actual popup window and the current attempt. Return fragments contain only public attempt identity/status; a forged status cannot create server authority. A full-page return requires the saved capability to survive session storage. There is no completion polling: a lost callback return requires a fresh sign-in. An unsuccessful sign-in leaves an unrelated existing session intact; explicit sign-out retires pending capabilities.

## Sessions and encryption

The durable session binds an opaque browser capability to an immutable GitHub principal, credentials, website origin and expiry. Public page acquisition can use an already usable commenter credential, but shared results exclude personal permissions and selections. Account labels and participation permissions come from separate [session, identity and access acquisitions](docs/API.md#browser-session-and-initialization). Display hints never grant authority.

GitHub access and refresh tokens stay encrypted on the server with AES-GCM, bound to the App, client, canonical GitHub repository ID and record key. Repository aliases share physical authority without making another repository's capability usable. Web Crypto signs GitHub App JWTs with RSA.

The service session is a bearer credential. JavaScript injected into a trusted site could steal or use it. Native embedding shares the site's JavaScript and storage context.

Sessions expire and can be revoked locally. Token refresh runs under a lock. A lost response after GitHub rotates a refresh token can require a new sign-in. Changing `SESSION_SECRET` makes existing encrypted sessions unreadable.

Receipts bind to the immutable user ID, not a mutable login or service session. A login rename retains ownership; another account acquiring that name does not. Expiry and explicit sign-out clear local authority, not saved writing. Ordinary drafts retain their configured deadline; unresolved issued writing remains protected for recovery as the original author. See [writing retention](docs/API.md#writing).

## Comment rendering

The stock GitHub interpreter reconstructs allowlisted markup, filters attributes and URL protocols, and namespaces local anchors. It discards executable markup, forms, arbitrary embedded media, event attributes and commenter-supplied styles. Math is prepared during interpretation; browser copy controls are added to the safe output. Preview and published bodies use the selected [content profile](docs/API.md#content-and-counts).

Custom CSS comes from approved origins. Custom producers and browser renderers are trusted application code responsible for commenter-safe output; prepared HTML is installed without another sanitizer. Review them as part of the site that installs them.

## Interrupted writes

Before dispatching a contribution, the service stores a receipt binding immutable account identity and content fingerprint to its idempotency key. Uncertain receipts do not automatically redispatch. Receipts expire 24 hours after the later of key creation and dispatch preparation; expired keys without receipts fail with `OPERATION_EXPIRED` before credential refresh or remote dispatch. The [API reference](docs/API.md#http-protocol) owns the accepted key format and retry contract.

A completed receipt replays its confirmed effect and retained observations without acquiring fresh counts or renewing their age. Missing count observations invalidate the affected count for separate acquisition; optional readback cannot relabel a confirmed effect as uncertain. Never infer a total from loaded comments.

Inspect GitHub before resubmitting an uncertain comment. Keep the existing retry identity. An unresolved discussion-creation record remains until recovery finds the discussion, so a retry does not create a second one.

## Deployment and reports

Keep credentials out of source control, browser assets and embed code. Cacheable public responses retain their original expiry and stay account-independent even if a caller supplies a bearer header. Account/contribution responses and auth/widget documents are no-store; content results do not use the public-read cache. See [HTTP caching and policy checks](docs/API.md#http-protocol). Avoid logging bodies, bearer tokens or authorization callback URLs.

Install the App only on intended repositories. Review Cloudflare logging and account controls separately from the application's settings.

For a security report, include the affected version, a minimal reproduction, and the expected permission boundary. Remove credentials, session values, and private user data before sharing a report. If a credential was exposed, revoke it through the service that issued it.
