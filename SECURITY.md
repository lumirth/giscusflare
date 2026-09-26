# Security

This code has not had an independent security audit. [Verification](VERIFICATION.md) records which automated checks ran.

## Repository access

The service accepts configured public repositories. For each thread, comment, or reply, it checks the repository, category, and parent discussion. It checks GitHub's viewer permissions before an edit, deletion, or moderation action. GitHub also authorizes the write.

Schemas check data types and formats. They do not grant access. A valid comment ID can still belong to another discussion.

Browser writes require the comments service's exact Origin and reject cross-site fetch metadata. The body reader limits JSON while streaming. API routes expose specific operations rather than a general GitHub proxy.

## Sign-in

Sign-in starts in a first-party popup or page on the comments service. That page creates a random attempt and an HttpOnly cookie. The callback must return the same cookie.

The server creates a PKCE verifier for GitHub. The widget creates a separate verifier for the final handoff. Before navigating to GitHub, the popup sends its attempt ID to the widget and waits for acknowledgement. The widget can then poll for completion if the popup loses its opener.

The callback exchanges GitHub's authorization code. To receive an application session, the widget must present the original verifier, attempt ID, and one-use ticket. Abandoned authorizations expire without creating a long-lived session.

Full-page sign-in returns only to an approved page and requires the stored browser proof. When both popups and storage are unavailable, the widget reports an error instead of starting that flow.

## Sessions and keys

The browser receives an opaque session token scoped to its repository and website origin. GitHub access and refresh tokens stay encrypted on the server. AES-GCM authenticates the record key, purpose, and application identity. Web Crypto signs GitHub App JWTs with RSA.

The application session is a bearer credential. Code injected into the trusted blog could steal or use it. Server-side GitHub tokens reduce exposure but do not protect a compromised blog.

Sessions expire or can be revoked locally. Token refresh uses a lock. Changing `SESSION_SECRET` invalidates existing sessions. If a connection fails after GitHub rotates a refresh token, the reader may need to sign in again.

## Comment HTML

The renderer parses GitHub HTML in an inert template and builds new nodes from an allowlist. It excludes executable elements, forms, SVG, MathML, arbitrary styles, custom elements, event attributes, and embedded media. It prefixes IDs and restricts link protocols.

This renderer supports a subset of Markdown HTML. It does not render MathJax, Mermaid, raw SVG, or general embeds. Custom CSS is trusted operator configuration and must come from an approved origin.

Widget and callback responses set a Content Security Policy. The widget allows only configured frame ancestors. The parent loader checks both message origin and source.

## Interrupted writes

The service records a pending receipt before sending a write. The receipt contains an idempotency key and content fingerprint. If GitHub's response is incomplete, the service keeps the receipt pending rather than automatically resubmitting.

Inspect GitHub before trying the write again. For an unresolved discussion creation, use the existing discussion's number while search indexing catches up.

## Deployment and logs

Keep secrets out of source control and public assets. Do not enable shared caching for API or callback responses. These responses use `Cache-Control: no-store`.

Avoid logging request bodies, session tokens, or callback URLs. The supplied configuration disables Workers observability, but account-level settings can still collect request data.

Limit the App's installation to the intended public repositories. Review Cloudflare limits, GitHub API usage, and logging before exposing the service.
