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

Sign-in begins on the comments service in a popup or full page. That page creates a random authorization attempt and an HttpOnly cookie. The GitHub callback must return the same cookie. GitHub authorization uses PKCE.

The browser has a separate verifier for the final handoff. It must present that verifier, the attempt ID, and a one-use ticket to receive a service session. An abandoned attempt expires without creating a long-lived session.

Full-page sign-in returns only to an approved website and requires the saved browser proof. Popup sign-in can poll for completion if it loses its opener. If neither the required storage nor popup flow is available, the application reports a sign-in failure.

## Sessions and encryption

The browser receives an opaque service session. GitHub access and refresh tokens stay encrypted on the server with AES-GCM. Encryption authenticates the record's purpose and identity. Web Crypto signs GitHub App JWTs with RSA.

The service session is a bearer credential. JavaScript injected into a trusted site could steal or use it. Native embedding shares the site's JavaScript and storage context.

Sessions expire and can be revoked locally. Token refresh runs under a lock. A lost response after GitHub rotates a refresh token can require a new sign-in. Changing `SESSION_SECRET` makes existing encrypted sessions unreadable.

## Comment rendering

The shared renderer rebuilds allowed HTML in an inert document fragment. It filters elements, attributes, link protocols, and IDs. It rejects executable markup, forms, arbitrary embedded media, event attributes, and untrusted styles.

Code controls and lazy MathJax rendering run after sanitization. Preview and posted comments use the same rendering contract.

Custom CSS comes from approved origins. Custom code, math, and full-content renderers are trusted application code and must return safe DOM. Review them as part of the site that installs them.

## Interrupted writes

Before sending a write, the service stores a receipt with an idempotency key and content fingerprint. An incomplete response leaves an uncertain receipt. It does not trigger a new write automatically.

Inspect GitHub before resubmitting an uncertain comment. Keep the existing retry identity. An unresolved discussion-creation record remains until recovery finds the discussion, so a retry does not create a second one.

## Deployment and reports

Keep credentials out of source control, browser assets, and embed code. Browser-facing API and callback responses use `Cache-Control: no-store`. The service caches validated anonymous reads internally with their original expiry; authenticated responses bypass those shared caches. Avoid logging bodies, bearer tokens, or authorization callback URLs.

Install the App only on intended repositories. Review Cloudflare logging and account controls separately from the application's settings.

For a security report, include the affected version, a minimal reproduction, and the expected permission boundary. Remove credentials, session values, and private user data before sharing a report. If a credential was exposed, revoke it through the service that issued it.
