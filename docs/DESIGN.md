# Architecture and design boundaries

giscusflare is a GitHub Discussions client and Cloudflare service. The standard presentation is a replaceable interface matching Giscus. Kukas design, Toast semantics and site-specific icons do not belong in the core.

## Ownership

- **Repository engine:** authoritative permission/scope checks, encrypted App-user sessions, GitHub transport and durable mutation receipts.
- **Conversation controller:** canonical conversation data, drafts, editing, pagination, typed commands, optimistic reaction intents, operation status and reconciliation. No DOM or browser storage.
- **Browser runtime:** session and host adapters, configurable fetch scheduling, optional draft recovery and interaction registration. No selectors from a particular presentation.
- **Reusable interactions:** bind consumer-owned form/textarea elements to composing, preview, keyboard submission, cancellation and focus. Own their listeners, not their markup or CSS.
- **Content renderer:** sanitized GitHub Markdown HTML, code controls and lazy math. Preview and published content use the same replaceable contract.
- **Presentation:** owns DOM, styling and rendering subscriptions. Standard and custom presentations use the same public runtime and bindings. Presentation disposal never disposes a runtime owned by its host.
- **Embedding:** native lifecycle or origin-checked iframe bridge. GitHub tokens stay on the server; the browser holds an opaque service capability.

## Continuity

Canonical data and optimistic intent are separate. Reactions immediately project the latest desired state; writes are serialized per subject, and authoritative responses update the base. A definite rejection rolls back. An uncertain outcome keeps its receipt identity for explicit recovery. No automatic retry creates a new write identity.

Publishing keeps writing in the composer, then inserts the returned canonical comment. Cancel closes a reply without discarding writing. Preview hides the existing editor rather than replacing it; native undo across page navigation is not promised. Ordinary refresh preserves local drafts without a separate conflict-checking service.

Recovery is an optional storage adapter: five-minute local-browser expiry by default, configurable or disabled. Expiry concerns recovery after leaving; an active in-memory draft does not expire. Failed storage never prevents writing. Sign-out removes persisted recovery for the conversation.

## Fetching and resource controls

The shared runtime defaults to focus/reconnect refresh when at least 60 seconds stale, no polling, and five replies prefetched per root. Hosts can change those preferences. Background work pauses while hidden, offline, authenticating or interacting with a registered editor. Requests coalesce; failed background reads back off. Manual refresh and mutation reconciliation remain available.

Server policy independently clamps reply prefetch (20 by default, configurable through 100); a browser cannot relax it. Root pages remain bounded at 20, explicit reply pages at 50. Authentication polling has its own bounded security lifecycle and is not governed by feed freshness preferences. There is one engine for all Cloudflare tiers. These limits are conservative defaults, not a measured Free-tier capacity guarantee.

## Standard presentation

Standard-view parts use the public conversation and interaction APIs. Its CSS is compiled from the pinned Giscus base/global styles and exact named themes; original Octicons provide the icons. Lit supplies keyed template updates in this optional presentation only. The independent example demonstrates an alternative presentation using those APIs.

Intentional differences must be recorded with their reason and verification in the presentation evidence. Current capability and deployment evidence belong in [STATUS](STATUS.md).
