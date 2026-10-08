# Upgrade to 3.0

Version 3.0 is an unreleased breaking replacement. Update the Worker and custom browser build together. Build and pack the checkout as described in [integration](INTEGRATION.md#native-rendering); this guide does not imply a published package or deployment.

## Browser replacement

The mount owns navigation and its current conversation. The conversation is the actual page owner, with its normalized document and browser capabilities attached. Read `mounted.conversation` when a handler runs. Subscribe directly to that page, and rebind your observer after your own navigation replaces it. A retained old page is retired and cannot act on the replacement.

| Earlier interface | Version 3 |
| --- | --- |
| Mounted owner exposes commands/state | `mounted.conversation` exposes the actual page |
| Mount subscription relay | Subscribe to the actual conversation; navigation owns rebinding |
| Projected `conversation.state` and nested root/reply collections | `document.nodes`, `document.roots`, `document.replies` and `document.metadata` |
| `signedIn`, `signingIn`, authentication forwarding methods | Actual `conversation.session` with `signedIn`, `pending`, `error`, `signIn()` and `signOut()` |
| Generic operation/editor registries | Actual `drafts` records and per-subject reaction intent |
| Client repository/category ID hints | Worker-resolved canonical repository identity and operator-owned category policy |
| Client reply visibility/depth state | Ordered reading windows supplied by the service; `loadReplies(parentId)` |
| `load()` / `loadMore()` | `refresh()` / `refresh(true)` |
| Separate draft subscription | One page subscription; text-only changes retain document identity |
| Presentation object with mount/dispose methods | Function `(target, conversation, scope) => void` |
| Component element/update/dispose factories | Declarative header/composer/reaction slots |
| Header slot receives `{ comment, reply }` | Header slot receives the canonical `comment`; `parentId` determines root/reply |
| Composer binding and separate preview channel | `createEditor` owns actual form/textarea/preview nodes and one rendering hook |
| Unowned resourceful content rendering | `renderContent(html, body, signal)` with an explicit body lifetime |

A refresh deliberately replaces root and reply reading windows; previously loaded reply depth is not restored. Draft text, retry keys and editor identities belong to writing, independently of fetched rows. The default presentation places reply/edit forms inline; retiring a row retires its rendered editor while its draft remains recoverable. The main editor has one permanent logical insertion point; `inputPosition` changes its visual position through CSS.

Acquire view resources with `scope.own(cleanup)` and use `scope.signal` for asynchronous descendants. `replacePresentation` retires the old view while preserving the actual page, writing, order and loaded windows. Page replacement retires both. Register cleanup immediately, including during construction. Retire a replaced content body's own signal rather than waiting for the whole page to end.

`createEditor(conversation, name, { signal, render })` creates the actual form, textarea and preview element. Insert those nodes and project its readonly fields into controls. Remove binding subscriptions and preview-HTML caches. The default presentation applies its baseline input-time geometry directly to the owned textarea, preserving reader-selected manual height. This presentation hook adds no separate writing or preview state owner.

The default interface retains the pre-PR visual representation, including its root/reply cards, avatar timeline, controls and themes. A pinned generated stylesheet supplies the visual foundation, with project overrides maintained separately; ordinary builds need no utility compiler or source scanner. Slots are render callbacks. Return templates or the same owned imperative Node per instance when native history matters. A newly created editor HTMLElement intentionally replaces its predecessor.

Version 3 browser storage uses a new namespace for sessions, sign-in attempts and writing. Old namespace bytes remain intact, but there is no automatic journal or capability import. Copy unfinished writing from an existing version 2 editor before cutover, or manually recover its text from the old browser journal. The new recovery format stores each contribution's text, editor and retry key together.

A prior-protocol uncertain write must be reconciled on GitHub before cutover or a new submission. Version 2 receipt identity is not imported into the new service. Saving or editing a draft is not evidence that an earlier uncertain effect did not happen.

## Service cutover

The public protocol uses `/api/v3/page` for root, reply and ordered-ID windows, and `/api/v3/contribute` for all comment/edit/delete/moderation/reaction effects. Requests to retired protocols receive `VERSION_MISMATCH`. Custom clients must adopt canonical nodes/windows and patches; the nested thread/replies/hydrate response family is removed.

Sign-in now starts with a future capability generated and retained by the parent page. The service receives its hash as proof, and GitHub authorization installs the matching hashed session record. A trusted matching return lets the parent use its own capability. Polling, completion/consume RPCs, tickets and preparation acknowledgements are removed. Old capabilities and unfinished attempts require a fresh sign-in. Full-page return requires working session storage. See [API](API.md) and [security](https://github.com/lumirth/giscusflare/blob/main/SECURITY.md).

Both configured repositories and open hosting use a fresh Durable Object namespace keyed by version 3, GitHub App ID and the immutable GitHub repository ID. The old version 2 objects remain retained and inert under the new Worker. There is no compatibility migration of their identity coordination, page mappings, credentials, pending creations, receipts or ranking materialization.

GitHub discussions and comments remain authoritative and available. The new service discovers that content and builds its own fresh coordination and derived ranking data. Keep the existing Worker binding/class migration history and App/repository configuration; do not delete the old objects as part of cutover. Changing repository aliases still resolves through the immutable GitHub ID.

Before cutover, manually reconcile uncertain version 2 writes and unresolved discussion creation against GitHub. The new namespace cannot determine whether an old in-flight effect completed. Do not interpret missing new receipts or page mappings as permission to retry an old effect automatically. This is a deliberate compatibility break that removes the old recovery/migration protocol from the new implementation.

New contribution keys bind one durable effect to the immutable GitHub user ID and its request. Completed receipts return the confirmed effect without repeating it; fresh optional observation patches carry current nodes and counts. An unavailable observation does not make a confirmed effect uncertain or derive global counts from the loaded window. The page serializes issued effects and their adoption; optimistic reactions still reflect local intent immediately.

## Rollout and rollback

Run [release verification](https://github.com/lumirth/giscusflare/blob/main/TESTING.md), preserve configuration and old namespace data, deploy matching Worker/browser versions, and verify actual sign-in, reading and contributions. Deployment remains a separate authorized action.

A code rollback can address the retained version 2 namespace; it does not import version 3 coordination or replay protection. Reconcile effects made during the version 3 interval before intentionally retrying them through an older implementation. GitHub content survives either version. Restoring a database snapshot can discard receipts and credentials for later effects, so it is not an automatic safe-retry procedure.
