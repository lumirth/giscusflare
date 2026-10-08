# Security

giscusflare handles GitHub authorization and public discussion content. This document describes its access controls, session storage, and rendering rules.

## Repository and website access

The Worker accepts configured public repositories on github.com. It checks the repository, category, discussion, and parent comment before acting on an object ID. It checks the reader's permissions before edits, deletions, and moderation. GitHub also authorizes the write using the acting user's App-issued token.

Each repository has a website-origin list, or an explicit `"*"` policy for open hosting. Iframe responses restrict their ancestors through Content Security Policy. Native requests require an allowed browser Origin and a matching repository and page origin. Sessions belong to one repository and website. The iframe loader checks both the origin and source of messages.

These checks restrict browser embedding and API use. They do not make GitHub discussions private or stop a scripted client from forging an Origin header. Readers can still participate directly on GitHub. See [configuration](docs/CONFIGURATION.md).

## Request handling

Reads use GET with bounded input; writes use POST with a bounded JSON body. Schemas validate request structure, configuration, stored records, and GitHub responses.

Iframe API requests require the service's Origin and same-origin fetch metadata when supplied. Native requests use explicit bearer sessions. CORS does not grant access through ambient cookies. Authorization preparation runs on the comments service itself.

The service exposes specific discussion operations, not a general GitHub proxy. Per-IP rate limits apply at Cloudflare locations. They are not global usage or spending caps.

## GitHub sign-in

The browser creates its future opaque session capability before sign-in and retains it in the embedding page's memory or session storage. Its SHA-256 hash is a transient proof; hashing that proof produces the public attempt identity. The trusted `/auth/window` receives public context and attempt in the query, with only the proof in its fragment. Its script removes the fragment synchronously before asynchronous work and sends the proof in the `auth/prepare` POST body. Preparation claims one pending attempt bound to an HttpOnly cookie and refuses a proof belonging to an existing session. GitHub's callback must return that cookie; its separate authorization exchange uses PKCE.

HTTP request targets and referrers exclude fragments. The proof remains visible to the trusted auth page's JavaScript before removal, so that document is served directly and strips it before navigating elsewhere. The raw capability never enters an auth URL, callback document or provider exchange. Proofs, session credentials and callback query strings must stay out of logs and analytics. See [HTTP target URI rules](https://www.rfc-editor.org/rfc/rfc9110.html#section-7.1) and [Referrer Policy](https://w3c.github.io/webappsec-referrer-policy/#strip-url).

After GitHub authorizes, the callback creates the encrypted session at its capability-hash key and removes the pending attempt in one SQLite transaction. The callback is one-use. There is no subsequent credential handoff or completion endpoint. The browser adopts its own saved capability after a matching return. Pending server attempts and browser return acceptance expire after ten minutes.

Popup and full-page sign-in use the same saved capability. Popup notifications require the trusted service origin, the actual popup window and the current attempt. Return fragments contain only public attempt identity/status; a forged status cannot create server authority. A full-page return requires the saved capability to survive session storage. There is no completion polling: a lost callback return requires a fresh sign-in. An unsuccessful sign-in leaves an unrelated existing session intact; explicit sign-out retires pending capabilities.

## Sessions and encryption

The browser owns an opaque service capability. Its durable session holds the immutable GitHub principal, credentials, website origin and expiry. It does not retain a mutable display profile or duplicate repository name. Signed page reads obtain the current viewer profile alongside scoped discussion metadata. GitHub access and refresh tokens stay encrypted on the server with AES-GCM; authenticated encryption binds them to the App, client, canonical GitHub repository ID and record key. Repository aliases therefore share the same physical authority without making another repository's capability usable. Web Crypto signs GitHub App JWTs with RSA.

The service session is a bearer credential. JavaScript injected into a trusted site could steal or use it. Native embedding shares the site's JavaScript and storage context.

Sessions expire and can be revoked locally. Token refresh runs under a lock. A lost response after GitHub rotates a refresh token can require a new sign-in. Changing `SESSION_SECRET` makes existing encrypted sessions unreadable.

Version 3 sessions require the immutable GitHub user ID; 2.x capabilities require a new sign-in. Receipts bind to that ID rather than a mutable login or a particular service session. A login rename retains ownership; another account acquiring that name does not. Passive account expiry clears the browser capability while preserving saved writing and retry identity. Explicit sign-out separately removes saved writing.

## Comment rendering

The shared renderer rebuilds allowed HTML in an inert document fragment. It filters elements, attributes, link protocols, and IDs. It rejects executable markup, forms, arbitrary embedded media, event attributes, and untrusted styles.

Code controls and lazy MathJax rendering run after sanitization. Preview and posted comments use the same rendering contract.

Custom CSS comes from approved origins. Custom code, math, and full-content renderers are trusted application code and must return safe DOM. Review them as part of the site that installs them.

## Interrupted writes

Before sending a write, the service stores a receipt with a `3.<13-digit timestamp>.<nonce>` idempotency key, immutable account identity and content fingerprint. An incomplete response leaves an uncertain receipt. It does not trigger a new write automatically. Pending and completed receipts expire 24 hours after the later of the key's creation time and receipt write. A separate `OPERATION_EXPIRED` check rejects expired keys without receipts before remote dispatch, preserving replay safety after pruning. Earlier-protocol keys fail closed before authentication refresh or provider dispatch; they are not promoted into new receipts.

A completed receipt stores the confirmed effect. Fresh discussion and reply counts are observed separately on each comment/delete response, including replay, and validated against the same repository, discussion and affected root. Failure to obtain those observations cannot relabel a confirmed write as uncertain. Clients retain previously observed totals until another observation succeeds rather than deriving global counts from loaded comments.

Inspect GitHub before resubmitting an uncertain comment. Keep the existing retry identity. An unresolved discussion-creation record remains until recovery finds the discussion, so a retry does not create a second one.

## Deployment and reports

Keep credentials out of source control, browser assets, and embed code. Browser-facing API and callback responses use `Cache-Control: no-store`. The service caches validated anonymous reads internally with their original expiry; authenticated responses bypass those shared caches. Avoid logging bodies, bearer tokens, or authorization callback URLs.

Install the App only on intended repositories. Review Cloudflare logging and account controls separately from the application's settings.

For a security report, include the affected version, a minimal reproduction, and the expected permission boundary. Remove credentials, session values, and private user data before sharing a report. If a credential was exposed, revoke it through the service that issued it.
