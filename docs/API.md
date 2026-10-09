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

Acquisition purposes are initial, restart, continue, revalidate and change-order. Background observation does not discover new membership or continuously update every loaded body. Changed discussion identity or invalid continuation requires deliberate restart. Adoption compares ownership and original observation age so delayed broad reads cannot overwrite newer accepted facts.

Ranked reading captures root IDs from a completed order and hydrates bounded windows without reordering that traversal. Results report ready, preparing or paused; ready includes the acquisition interval and next-refresh time. It does not promise an atomic remote snapshot or uniform source age. See [ranking configuration](CONFIGURATION.md#sort-by-reactions-or-reply-counts).

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

`conversation.content.mount(target, comment, { signal, onReady })` binds canonical source once. The owner supplies rendering context, batches acquisition, accepts source/metadata/provider-hint changes and retains installed output during replacement. Explicit preview/custom input uses `{ markdown, purpose, draft? }` through the same method. Mounts expose ready, pending, update, clear and dispose. Preview pending state comes from this same current preparation owner. `createContentWorker({ revision, prepare })` from `giscusflare/content/worker` is the isolated producer factory. Its preparer returns HTML and optional resource/anchor requirements; the factory stamps the configured revision. Its sole completed-artifact store is the shared bounded LRU: at most 256 entries/8 MiB, accounting for input keys and results, with individual retained results at most 2 MB. Reuse is optional; cold isolates prepare again. Producer input/output bounds and concurrency apply independently of retention.

`mountContent(target, renderer, { signal?, onReady?, acquire? })` exposes the same preparation primitive independently.

A renderer returns `Node`, `Promise<Node>` or `{ node, update?, dispose? }`. Preparation uses `context.signal`; installed controls/resources use `context.lifetime`. Optional mounted `update(input, context)` prepares without touching the live tree and returns a commit callback invoked only while current. Failure retains installed output or safe source with Retry; retirement releases installed resources. An explicit `input.revision` changes interpretation when external renderer inputs change. `context.providerHTML()` and `preparedContent()` request the selected capability; they do not switch delivery implicitly. Returned DOM belongs to the renderer's commenter-safe trust policy.

A resource manifest has `revision`, `styles` and `scripts`. Body output declares only its required manifest fingerprint and optional generated `anchorPrefixes`; omit the fingerprint when the output needs none. Required styles start concurrently with acquisition and finish before affected HTML installs. Optional enhancements leave HTML readable on failure. Script-dependent generated controls can use `data-content-enhancement`; producer-disabled controls stay disabled. A different manifest fingerprint rejects incompatible HTML and offers Reload. Resolve immutable resource paths at the consumer's intended origin.

`githubContent({ code?, math?, copy?, labels? })` from `giscusflare/content/github` replaces complete code/math features of deliberate `github` delivery. Code callbacks receive source, language and optional GitHub file metadata; math receives source/display mode. Its `FeatureOutput` is `Node` or `Pick<MountedContent, 'node' | 'dispose'>`: node and optional cleanup, retired with its containing body. `false` disables that feature; whole-body mounted updates belong to the renderer contract above.

`mountComments(target, options, parts)` accepts header/composer/reactions slots returning text, owned nodes or lit-html templates. Their `context.scope` owns cleanup; appearance updates preserve reading/writing. A custom presentation receives `(target, conversation, scope)`, uses `scope.own(cleanup)`, and publishes `conversation.readingLayout.publish()` after required DOM is installed. [Forum](../examples/forum.ts) is the complete presentation example.

`createCounts({ service, repo, origin, registration?, storage? })` from `giscusflare/counts` returns subscribe, read, observe, invalidate and dispose. Subscribing to an exact page key (root count) or typed `CountTarget` batches missing/expired observations automatically. `countKey(target)` is the shared stable map identity for explicit selectors and root/reply windows. Optional same-tab storage and conversation observations use the same scoped owner; null explicitly disables storage. Hosts retain stale useful labels while refreshing and never infer zero from failure.

## Browser session and initialization

Locally verified session identity includes the last verified display profile independently of discussion discovery and permissions. When that fact is missing, `/identity` acquires it directly while reading continues. `/access` supplies the immutable principal, current permissions/selections and narrow participation availability, never the account label.

`session.signIn()` uses full-page return; `signIn('popup')` explicitly requests a popup. `signOut()` ends local capability use immediately and separately removes the server session. A future capability is generated before OAuth; verified return adoption requires no polling. Return acceptance expires after ten minutes. Full-page recovery depends on browser session storage.

Native hosts call `initialize(ConversationInitialization)` with typed session, handoff, fetching, writing restoration or return position. `ConversationHost` exposes direct `saveSession`, `pendingLogin`, `clearPending`, `saveWriting`, `removeWriting`, `selectWriting`, `records`, `restoreWriting` and `navigate` operations; serialization belongs only to storage and iframe boundaries. The iframe adapter decodes messages into this same initialization. Storage and login envelopes retain their version 5 identities independently of protocol 7. No runtime legacy importer is involved. `readingLayout.publish()` reports necessary installed reading for return positioning; native reader interaction cancels automatic repositioning.

## HTTP protocol

Matching browser and Worker packages use `/api/v7/`. Unknown/retired protocols return 409 VERSION_MISMATCH. GET JSON is in the input query parameter; POST JSON is in the body. Website policy applies independently of presentation. Selection is the page object shown above, without appearance or description; clients do not supply repository/installation/category authority IDs.

| Endpoint | Request |
| --- | --- |
| GET `/api/v7/page` | `{ config, read, fresh?, providerHTML? }` |
| GET or POST `/api/v7/counts` | `{ repo, origin, targets, registration?, fresh? }`, at most 20 typed count targets |
| GET `/api/v7/ranking` | `{ config, profile }` |
| POST `/api/v7/session` | `{ repo, origin, registration? }`; returns local `{ principal, profile, needsAuthorization }` without provider or discussion work |
| POST `/api/v7/identity` | `{ repo, origin, registration? }`; bearer required; fetches a genuinely missing display profile directly |
| POST `/api/v7/access` | `{ config, ids? }`; bearer capability required |
| POST `/api/v7/content` | `{ config, inputs, content? }`; at most 20 canonical inputs |
| POST `/api/v7/contribute` | `{ config, key, action, creation?, providerHTML? }`; bearer capability required |
| POST `/api/v7/logout` | `{ repo, origin, registration? }`; bearer capability required |
| POST `/api/v7/registration` | `{ repo, origin, category }`; setup or explicit open-hosting registration |

`read` selects roots with order/cursor/replyPrefetch, replies with parentId/cursor, observe with up to 100 loaded IDs, or selected with captured IDs and optional replyPrefetch. These are explicit request intents rather than a flag combination.

Local source profiles make no content request. The content endpoint selects github for provider HTML interpreted by a chosen browser renderer, prepared for the host producer, or stock for the service’s default rich interpretation. Public reading and contribution requests select only whether provider HTML is needed with providerHTML; they do not carry renderer choices. GitHub and stock previews use the service’s installation-token provider interpreter; all content requests omit commenter credentials. Prepared/source profiles need no provider calls. The browser GitHub choice bypasses the stock producer, so it does not compile output that the selected renderer would discard.

Public pages carry canonical source and optional reusable content hints, never expensive completed interpretation. Count results contain observations by `countKey(target)`, with each observation retaining its exact selector and root/reply window identity. The shared client uses GET when encoded input fits the service URL limit, otherwise POST with text/plain JSON to avoid an extra native preflight. Content results preserve input order as `{ results: [{ prepared?, html? } | { error }] }`; one failed body does not discard other results. Prepared output includes HTML, revision, optional resources manifest fingerprint requirement and declared anchor prefixes. The selected profile owns the one manifest with its resource revision and required stylesheet/optional module URLs; bodies do not repeat those arrays. The internal producer binding receives only `{ inputs }`, without commenter credentials.

Contributions describe comment/reply, edit, delete, moderate or selected-state reaction intent. A confirmed result has phase confirmed, ID, discussion number, optional parent and narrow patch. Patches establish only their owned node fields, reaction groups, window membership/counts and metadata. They do not redefine unrelated accepted facts. Command preflight acquires scope and required authority without loading public headers or reaction totals. Only an actual discussion creation returns full thread metadata; its separate `metadataObservedAt` preserves creation age when the following contribution completes.

Preflight errors report not-issued; lost/ambiguous issued effects report unknown. A durable receipt binds original principal/key to exact selection and action. Retry unchanged with its original key; a new key means a new effect. The retained `3.` key format and Repository addresses are independent of protocol 7.
