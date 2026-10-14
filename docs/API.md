# JavaScript and HTTP API

`giscusflare/model` supplies the portable `PageModel`. `giscusflare/headless` attaches browser authentication, persistence, native interactions and a selected content owner. `giscusflare` adds the standard presentation and stock rich-content profile. All use the same reading and intent owners.

## Browser construction and mounting

Embedding examples are in [integration](INTEGRATION.md); a complete producer/consumer customization is in [extending](EXTENDING.md).

Headless construction requires `content: ContentProfile`, pairing delivery with rendering. `mountComments` supplies the stock profile by default. `stockContent({ service })` selects standard GitHub interpretation; `preparedContent({ resources })` consumes the internal producer; `browserContent(renderer, delivery?)` selects deliberate browser interpretation (`source` by default).

| Option | Meaning |
| --- | --- |
| `service` | Comments service origin |
| `page.repo` | Registered public discussion repository |
| `page.selector` | `{ kind: 'page', key }` or `{ kind: 'discussion', number, id? }` |
| `page.origin` | Exact authorized website origin |
| `page.pageURL`, `page.returnURL` | Canonical rendering/backlink URL and current authentication return URL; the return URL stays on the authorized origin |
| `page.registration` | Open-hosting registration reference, when required |
| `page.description` | Optional first-discussion description |
| `content` | Selected complete content profile |
| `appearance` | Theme, language, reactions, input position and emitted metadata |
| `order` | `oldest`, `newest` or `{ profile }` |
| `fetching` | Focus/reconnect freshness and reply prefetch |
| `writingRecovery` | Retention/store settings, or false |
| `bootstrap` | Unexpired public `{ view, expires }` observation |
| `host` | Typed browser host for navigation, persistence and record restoration |

`mountPresentation(target, options, presentation)` and `mountComments` return `conversation`, `replacePage(page)`, `replacePresentation(view)` and `dispose()`. Page replacement retires the current owner and creates another; rebind subscriptions. Presentation replacement retains reading and writing. `updateAppearance()` changes appearance without replacing their owners.

`fetching` accepts `onFocus`, `onReconnect`, `staleAfterMs` and `replyPrefetch`; defaults revalidate after 60 seconds on focus/reconnect and prefetch five replies per root. `false` disables automatic revalidation. There is no polling timer. Default appearance is preferred color scheme, English, enabled reactions, bottom input and disabled emitted metadata.

## Portable model

`new PageModel(page, transport, order?, lifetime?, { counts?, writingChanged? })` uses exact page selection without browser dependencies. Supply a shared pure `CountFacts` owner when models reuse count observations, and `writingChanged` for direct persistence notifications. The lifetime owns retirement. `Transport` exposes optional immutable-account `principal: string | null` and `request<T>(operation, input, signal?, method?)`. The host supplies protocol and authentication. Subscribe before `start()`, retire with `dispose()`, and await the promises returned by the operations you issue. A dispatched external effect can finish after retirement but cannot publish into a replacement owner.

## Reading document

Treat `document` as read-only. `nodes[id]` contains canonical Markdown, author/dates, public moderation facts, reaction totals and upvotes; it contains no account permissions or selected reactions. `roots` and `replies[parentId]` hold ordered IDs, continuation cursor and `count: CountObservation | null`. Metadata contains public thread identity/state, repository availability and enabled ranking profiles. Public page requests omit commenter credentials; `/access` supplies the separate `AccessResult` exported by `giscusflare/model`.

```ts
interface CountTarget {
  selector: { kind: 'page'; key: string } | { kind: 'discussion'; number: number; id?: string };
  window: { kind: 'roots' } | { kind: 'replies'; parentId: string };
}
interface CountObservation {
  target: CountTarget;
  count: number;
  discussion: { id: string; number: number } | null;
  observedAt: number;
  expiresAt: number;
}
```

Null means no authoritative count has been observed. Preserve original observation time and reuse deadline; receiving cached data or replaying a receipt does not make it fresh. Loaded membership is the captured reading traversal, not a source from which to invent a total.

| Method/state | Meaning |
| --- | --- |
| `start()` | Acquire the initial reading window |
| `restart()` | Deliberately replace traversal |
| `loadMore()`, `loadReplies(rootId)` | Continue the respective reading window |
| `revalidate(staleAfterMs?, observedIds?)` | Observe up to 100 loaded IDs while retaining traversal |
| `setOrder(order)` | Start a traversal in the chosen order |
| `acquisition(parentId?)` | Current `{ purpose, started }`, or undefined |
| `continuity` | Current traversal or explicit restart requirement |
| `ready`, `error`, `lastRefresh` | Public read acquisition state |
| `notice` | Confirmed effect whose optional observation needs refreshing |

Acquisition purposes are initial, restart, continue, revalidate and change-order. Background observation refreshes selected visible facts and samples recent roots and replies. A complete chronological reading can adopt new membership directly; partial or ranked reading retains its traversal and offers a notice when new comments appear. It does not continuously update every loaded body. Confirmed withdrawal clears affected reading while preserving writing. Changed discussion identity or invalid continuation requires deliberate restart. A failed order change restores the displayed order. Adoption compares ownership and original observation age so delayed broad reads cannot overwrite newer accepted facts.

Ranked reading captures root IDs from a completed order and hydrates bounded windows without reordering that traversal. Results report ready, preparing or paused; ready includes the acquisition interval and next-refresh time. It does not promise an atomic remote snapshot or uniform source age. See [ranking configuration](CONFIGURATION.md#sort-by-reactions-or-reply-counts).

<a id="actions-reactions-and-session"></a>

## Account, actions and reactions

`viewer` is an independently acquired account projection: immutable principal, comment permissions, selected reactions and relevant target state. `viewerPending`, `viewerError` and `refreshViewer()` manage its acquisition and retry. Account changes retire authority and incoming account work while retaining public reading. `session.viewer` supplies the locally verified display profile and immutable ID; `session.principal` retains that proof even when the profile is absent. `session.signedIn` means a capability is present; verified principal and usable permissions arrive independently. `session.needsAuthorization` asks the original author to reconnect GitHub while retaining their local session and protected issued writing.

`actions(subjectId?)` derives reply, edit, remove, moderate, react, recover and abandon availability. Status is available, sign-in, pending, recovery or unavailable, with an optional cause/reason. `composition` provides shared base participation availability independently of reading traversal: unknown target is pending; archive, lock and unavailable targets have distinct causes. Use these results rather than reconstructing permissions from public comments.

`reaction(id, name)` exposes confirmed count/selection, desired state, projected count/selection, pending work and recovery availability. `setReaction(id, name, selected)`, `retryReaction(id, name)` and `abandonReaction(id, name)` address that independent stream. `reactions(id)` supplies projected groups. `removeComment(id)` and `moderateComment(id, minimized, reason?)` use retained subject intent; `retryAction(id)` and `abandonAction(id)` manage it. Independent contributions dispatch independently; only conflicting streams serialize.

Reaction names are THUMBS_UP, THUMBS_DOWN, LAUGH, HOORAY, CONFUSED, HEART, ROCKET and EYES. GitHub upvotes are separate. Moderation reasons are ABUSE, DUPLICATE, OFF_TOPIC, OUTDATED, RESOLVED and SPAM.

## Writing

A destination is `{ kind: 'comment' }`, `{ kind: 'reply', id }` or `{ kind: 'edit', id }`. Each persistent writing record has its own immutable intent ID and destination; several records may share a destination.

| Member | Meaning |
| --- | --- |
| `writing(target?)`, `newWriting(target?)` | Selected writer or a new independent writer |
| `activeWriting(target?)`, `selectWriting(id)` | Read/select an attached record |
| `writings`, `selectedWriting` | Records and current destination selections |
| Writing `text`, `open`, `pending`, `error`, `protected`, `actions` | Derived writing and recovery state |
| Writing `update`, `show`, `hide`, `clear`, `undoClear` | Local writing/visibility commands |
| Writing `submit`, `abandon` | Issue/recover intent, or deliberately release uncertain recovery |

`submit()` returns saved with result, failed with error, or blocked with reason. Issuing freezes original body, destination, author and key. Unknown issued outcomes remain protected from editing and clearing. Retry uses that exact effect and original author. Preflight rejection before issue leaves ordinary editable writing. Confirmation clears text and closes reply/edit writing even if optional readback later fails.

Abandonment cannot cancel a remote effect. Explain that it might already be saved and obtain a deliberate reader decision before abandoning its recovery identity.

`conversation.recovery` exposes `ready`, `records()`, `restore(id)`, `pending` and `error`. Storage recovery starts independently of identity and reading. Restoration claims only the selected record, preserving separate same-destination writers. Ordinary browser records default to five-minute retention; unresolved issued records survive that retention and sign-out. Storage failure preserves current in-memory writing but cannot promise reload recovery.

`writingRecovery` accepts `{ retentionMs, store }` or false. A custom `WritingStore` implements load, acquire, save and remove for scoped records; keep a claim until its lifetime retires and remove only the owned record. `saveWriting()` returns typed records/selections; `recoverWriting(records, selected?)` attaches validated typed restoration. Normal persistence is record-level, not repeated whole-page snapshots.

`createEditor(conversation, writing, { signal, render, writeWhileSignedOut, submitted, elements? })` supplies the actual form, textarea and preview nodes. Retain them through redraws to preserve native selection/undo. Project its mode, pending states and error; commands include write, preview, font toggle, submit, clear/undo and disposal. Supplying `elements: { form, textarea, previewElement }` binds existing native markup, admitting an untouched field’s pre-hydration draft without replacing its selection, undo history or chosen height. Disposal releases bindings but retains supplied DOM. Local drafting can start before sign-in; sign-in never publishes automatically. Previews are independent of participation sign-in. Prepared/source profiles interpret locally; GitHub/stock profiles use the service’s selected provider interpreter without commenter credentials.

## Content and counts

`conversation.content.mount(target, comment, { signal, onReady })` binds canonical source once. The owner supplies rendering context, batches acquisition, accepts source/metadata/provider-hint changes and retains installed output during replacement. Explicit preview/custom input uses `{ markdown, purpose, draft? }` through the same method. Mounts expose ready, pending, update, clear and dispose. Preview pending state comes from this same current preparation owner. `createContentWorker({ revision, prepare })` from `giscusflare/content/worker` is the isolated producer factory. Its preparer returns HTML and optional resource/anchor requirements; the factory stamps the configured revision. Completed-artifact reuse is bounded to 256 entries/8 MiB, accounting for input keys and results, with individual retained results at most 2 MB. Reuse is optional; cold isolates prepare again. Producer input/output bounds and concurrency apply independently of retention.

`mountContent(target, renderer, { signal?, onReady?, acquire? })` exposes the same preparation primitive independently.

A renderer returns `Node`, `Promise<Node>` or `{ node, update?, dispose? }`. Preparation uses `context.signal`; installed controls/resources use `context.lifetime`. Optional mounted `update(input, context)` prepares without touching the live tree and returns a commit callback invoked only while current. Failure retains installed output or safe source with Retry; retirement releases installed resources. An explicit `input.revision` changes interpretation when external renderer inputs change. `context.providerHTML()` and `preparedContent()` request the selected capability; they do not switch delivery implicitly. Renderers and producers must enforce commenter-safe output; prepared HTML installs without a second sanitizer. See [security](../SECURITY.md#comment-rendering).

A resource manifest has `revision`, `styles` and `scripts`. Body output declares only its required manifest fingerprint and optional generated `anchorPrefixes`; omit the fingerprint when the output needs none. Required styles start concurrently with acquisition and finish before affected HTML installs. Optional enhancements leave HTML readable on failure. Script-dependent generated controls can use `data-content-enhancement`; producer-disabled controls stay disabled. A different manifest fingerprint rejects incompatible HTML and offers Reload. Resolve immutable resource paths at the consumer's intended origin.

`githubContent({ code?, math?, copy?, labels? })` from `giscusflare/content/github` replaces complete code/math features of deliberate `github` delivery. Code callbacks receive source, language and optional GitHub file metadata; math receives source/display mode. Its `FeatureOutput` is `Node` or `Pick<MountedContent, 'node' | 'dispose'>`: node and optional cleanup, retired with its containing body. `false` disables that feature; whole-body mounted updates belong to the renderer contract above.

`mountComments(target, options, parts)` accepts header/composer/reactions slots returning text, owned nodes or lit-html templates. Their `context.scope` owns cleanup; appearance updates preserve reading/writing. A custom presentation receives `(target, conversation, scope)`, uses `scope.own(cleanup)`, and publishes `conversation.readingLayout.publish()` after required DOM is installed. [Forum](../examples/forum.ts) is the complete presentation example.

`createCounts({ service, repo, origin, registration?, storage? })` from `giscusflare/counts` returns subscribe, read, observe, invalidate and dispose. Subscribing to an exact page key (root count) or typed `CountTarget` batches missing/expired observations automatically. `countKey(target)` is the shared stable map identity for explicit selectors and root/reply windows. Optional same-tab storage and conversation observations use the same scoped owner; null explicitly disables storage. Hosts retain stale useful labels while refreshing and never infer zero from failure.

## Browser session and initialization

Locally verified session identity includes the last verified display profile independently of discussion discovery and permissions. When that fact is missing, `/identity` acquires it directly while reading continues. `/access` supplies the immutable principal, current permissions/selections and narrow participation availability, never the account label.

`session.displayProfile` exposes the verified profile or a browser-retained display hint for the same session. It is label-only: it never establishes `session.principal`, `session.viewer`, permissions or reaction selections. Native and iframe hosts retain the hint with a capability fingerprint, discard it on sign-out or session replacement, and refresh it after verification. Account acquisition can begin as soon as public comment IDs arrive, without waiting for the independent `/session` response; a successful authenticated `/access` also proves its principal.

`session.signIn()` uses full-page return; `signIn('popup')` explicitly requests a popup. `signOut()` ends local capability use immediately and separately removes the server session. A future capability is generated before OAuth; verified return adoption requires no polling. Return acceptance expires after ten minutes. Full-page recovery depends on browser session storage.

When GitHub temporarily refuses sign-in, the authorization page offers Retry after its cooldown and Return to comments. A known OAuth cooldown stops new authorization trips before leaving the service. The encrypted ten-minute attempt retains an explicitly refused exchange or already issued credentials; retry continues from that stage. An interrupted exchange with an unknown outcome requires a new sign-in. Authorization codes are removed from the callback address, and returning without finishing clears the pending browser login without adopting a session.

Native hosts call `initialize(ConversationInitialization)` with typed session, optional displayProfile hint `{fingerprint, profile}`, handoff, fetching, writing restoration or return position. A fingerprint is the base64url SHA-256 digest of the capability; restoring a display hint checks it against the current session and never changes the session. `ConversationHost` exposes direct `saveSession`, optional `saveDisplayProfile(fingerprint, profile)`, `pendingLogin`, `clearPending`, `saveWriting`, `removeWriting`, `selectWriting`, `records`, `restoreWriting` and `navigate` operations; serialization belongs only to storage and iframe boundaries. The iframe adapter decodes messages into this same initialization. Storage and login envelopes retain their version 5 identities independently of protocol 7. No runtime legacy importer is involved. `readingLayout.publish()` reports necessary installed reading for return positioning; native reader interaction cancels automatic repositioning.

## HTTP protocol

Matching browser and Worker packages use `/api/v7/`. Unknown/retired protocols return 409 VERSION_MISMATCH. GET JSON is in the sole `input` query parameter; POST JSON is in the body with `Content-Type: application/json` (counts also accepts text/plain). Bearer operations use `Authorization: Bearer <capability>`. Native requests bind the declared origin to the browser Origin. `config` is `{ repo, selector, origin, pageURL, returnURL, registration? }`, without appearance or description; clients do not supply repository/installation/category authority IDs. Optional fields use `?` below; request schemas are defined in [requests](../src/contracts/requests.ts), and public records in [document](../src/contracts/document.ts).

| Endpoint | Request | Success response |
| --- | --- | --- |
| GET `/api/v7/config` | `{ repo, origin, registration? }` | `{ repo, repoId, category, categoryId, defaultCommentOrder, profiles }` |
| GET `/api/v7/page` | `{ config, read, fresh?, providerHTML? }` | `WindowPage` |
| GET or POST `/api/v7/counts` | `{ repo, origin, targets, registration?, fresh? }`, 1–20 typed targets | `{ observations: Record<string, CountObservation>, errors?: Record<string, Failure> }` |
| GET `/api/v7/ranking` | `{ config, profile }` | [OrderResult](../src/ranking/types.ts) |
| POST `/api/v7/session` | `{ repo, origin, registration? }`; optional bearer | `{ principal: string \| null, profile: Person \| null, needsAuthorization: boolean }`; local, no provider/discussion work |
| POST `/api/v7/identity` | `{ repo, origin, registration? }`; bearer required | `{ principal: string, profile: Person }`; direct provider identity |
| POST `/api/v7/access` | `{ config, ids? }`; bearer required; at most 100 IDs | `AccessResult` |
| POST `/api/v7/content` | `{ config, inputs, content? }`; 1–20 canonical inputs | `{ results: ContentResult[] }`, in input order |
| POST `/api/v7/contribute` | `{ config, key, action, creation?, providerHTML? }`; bearer required | `ContributionResult` |
| POST `/api/v7/logout` | `{ repo, origin, registration? }`; bearer required | `{ ok: true }` |
| POST `/api/v7/registration` | `{ repo, origin, category }`; setup or explicit open hosting | `{ repositoryId, installationId, categoryId, registration? }` |

`read` is one of `{ kind: 'roots', order?, cursor?, replyPrefetch? }`, `{ kind: 'replies', parentId, cursor? }`, `{ kind: 'observe', ids, replyPrefetch? }` or `{ kind: 'selected', ids, replyPrefetch? }`. IDs are bounded to 100; defaults are oldest order, empty cursor and five prefetched replies (0–100 allowed). `fresh` and `providerHTML` default to false. `action` is `{ type: 'comment', body, replyToId? }`, `{ type: 'edit', id, body }`, `{ type: 'delete', id }`, `{ type: 'moderate', id, minimized, reason? }` or `{ type: 'reaction', subject, reaction, selected }`; reaction subject is `{ kind: 'discussion' }` or `{ kind: 'comment', id }`. Empty/omitted replyToId means a root comment; moderation defaults to OFF_TOPIC. `creation` is `{ description? }`.

Local source profiles make no content request. The content endpoint selects github for provider HTML interpreted by a chosen browser renderer, prepared for the host producer, or stock for the service’s default rich interpretation. Public reading and contribution requests select only whether provider HTML is needed with providerHTML; they do not carry renderer choices. GitHub and stock previews use the service’s installation-token provider interpreter; all content requests omit commenter credentials. Prepared/source profiles need no provider calls. The browser GitHub choice bypasses the stock producer, so it does not compile output that the selected renderer would discard.

Public pages carry canonical source and optional reusable content hints, not completed interpretation. Count observations and per-target errors are keyed by `countKey(target)`. The shared count client uses GET when input fits the URL limit, otherwise text/plain POST to avoid an extra native preflight. [Content types](../src/contracts/content.ts) define inputs `{ markdown, purpose, repo, pageURL, html?, comment?, draft? }`, where purpose is comment or preview and comment is `{ id, url, parentId: string | null }`; results are `{ prepared?, html? }` or `{ error: string }`. One failed body does not discard others. Prepared output is `{ html, revision, resources?, anchorPrefixes? }`; resources is the required manifest fingerprint, not its arrays. The internal producer receives only `{ inputs }`, without commenter credentials.

A `ContributionResult` is `{ phase: 'confirmed', replayed, id, number, parentId?, account?, patch? }`. Patches establish only owned node fields, reaction groups, window membership/counts and metadata. They do not redefine unrelated accepted facts. Only actual discussion creation returns full thread metadata; its separate `metadataObservedAt` preserves creation age when the following contribution completes. Completed replay returns retained observations, not fresh counts.

Gateway errors return `{ error: { status, code, message, phase, retryAfter? }, requestId }`; [Failure](../src/domain/errors.ts) defines codes and fields. Preflight failures report not-issued; lost/ambiguous issued effects report unknown. Retry unchanged as the original principal with its original `3.<13-digit timestamp>.<16–86 character base64url nonce>` key; a new key means a new effect. Receipt keys and Repository addresses are independent of protocol 7.

Public page, count and configuration responses carry `X-Giscusflare-Expires` (epoch milliseconds) and `Cache-Control: public, max-age=<remaining seconds>` while reusable. Fresh requests use no-store and report acquisition failures instead of substituting retained observations; POST count reads bypass edge reuse. Ordinary reads can reuse expired retained observations with their original acquisition time and reuse deadline while the repository reconciles them. Other JSON API responses and auth/widget documents use no-store. Content producer errors can pass through their original response headers. Deployment policy is checked before edge reuse; receiving cached data never renews observation age. The browser can attach its local capability to public page requests to use an already usable user credential for acquisition; the result remains public. Count, ranking and content requests omit commenter credentials.
