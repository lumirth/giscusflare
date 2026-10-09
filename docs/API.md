# JavaScript and HTTP API

`giscusflare/model` exposes the actual portable page owner. `giscusflare/headless` attaches browser session, persistence, interactions and explicit content; `giscusflare` adds the standard presentation and GitHub defaults. These are layers around one model, not separate state projections.

## Portable model

```ts
import { PageModel, type Transport } from 'giscusflare/model';

const transport: Transport = {
  principal: null,
  request: (operation, input, signal, method) => appTransport.request(operation, input, signal, method),
};
const page = new PageModel({
  repo: 'you/comments',
  origin: 'https://your-site.example/posts/hello',
  term: 'post:hello-world',
  strict: true,
}, transport);
page.contentSource = 'source';
const stop = page.subscribe(() => render(page.document));
await page.start();
// Retire the owner when it is no longer used.
stop();
page.dispose();
```

`Transport` supplies optional immutable-account `principal: string | null` and `request<T>(operation, body, signal?, method?)`. It maps operations such as `page`, `contribute`, `preview` and `ranking` to the host's transport, including authorization. The constructor accepts `(config, transport, order?, lifetime?)`; `order` defaults to `oldest`. Config contains repository, full website URL, term/number, strictness and optional new-discussion details. No browser or DOM is needed. The package also exports writing, document, patch, reaction and action types.

## Browser construction and mounting

```js
import { createConversation } from 'giscusflare/headless';
import { githubContent } from 'giscusflare/content/github';

const conversation = createConversation({
  service: 'https://your-comments.workers.dev',
  page: { repo: 'you/comments', origin: location.href, term: 'post:hello-world', strict: true },
  contentSource: 'github',
  content: githubContent(),
});
const stop = conversation.subscribe(() => render(conversation.document));
// When the component is removed:
stop();
conversation.dispose();
```

`createConversation` and `mountPresentation` require `contentSource` and `content`. `mountComments` defaults to `github` delivery with `githubContent()` when neither is provided; supplying a custom renderer without a delivery selection defaults to `source`. Set both explicitly when using host-prepared output.

A mount returns `conversation`, `replacePage(page)`, `replacePresentation(presentation)` and `dispose()`. Replacing the page saves writing, retires its owner and creates a new one; retained old owners cannot act on the replacement. Replacing presentation retains reading and writing. Rebind subscriptions after page replacement.

| Option | Meaning |
| --- | --- |
| `service` | Comments service origin |
| `page.repo`, `page.origin` | GitHub repository and full embedding URL |
| `page.term` or `page.number` | Stable lookup term or positive existing discussion number |
| `page.strict` | Match term hash; default false |
| `page.backLink`, `page.description` | New-discussion details |
| `contentSource` | `source`, `github` or `prepared` service delivery |
| `content` | DOM renderer for published bodies and previews |
| `appearance` | Theme, language, reactions, input position and metadata |
| `order` | `oldest`, `newest` or `{ profile }` |
| `fetching` | Focus/reconnect freshness and reply prefetch |
| `writingRecovery` | Retention/store, or false to disable browser persistence |
| `bootstrap` | Unexpired anonymous `{ view, expires }` acquisition |
| `host` | Custom browser session host for navigation, persistence messages and `restoreWriting(id)` |

Number selection never creates a missing replacement discussion. Appearance defaults are `preferred_color_scheme`, `en`, enabled reactions, bottom input and disabled emitted metadata. `updateAppearance()` retains reading and writing.

`fetching` accepts `onFocus`, `onReconnect`, `staleAfterMs` and `replyPrefetch`. Defaults revalidate on focus/reconnect after 60 seconds and prefetch five replies per root. `fetching: false` disables automatic revalidation. There is no polling timer; server cache lifetime and reply bounds still apply.

## Reading document

Treat `document` as read-only. `nodes[id]` contains one canonical comment (`parentId: null` for a root). `roots` and `replies[parentId]` contain ordered IDs, continuation cursors and observed totals. `total: null` means no authoritative count was observed. `metadata` contains thread identity/title/URL/lock/closed/answer/reactions, viewer or null, repository availability and enabled ranking profiles.

Comments include canonical Markdown, author/dates, permission flags, upvotes and reactions. `github` delivery adds provider HTML; `prepared` delivery adds `{ html, revision, resources? }`. Reaction groups map names to `{ count, selected }`; absent groups mean zero and unselected. Window IDs resolve through `nodes`; consumers do not reconstruct nested canonical trees.

| Method/state | Meaning |
| --- | --- |
| `start()` | Acquire initial window when needed |
| `restart()` | Deliberately replace loaded traversal |
| `loadMore()` | Continue root reading |
| `loadReplies(rootId)` | Acquire earlier replies |
| `revalidate(staleAfterMs?, observedIds?)` | Observe loaded content while preserving traversal |
| `setOrder('oldest' \| 'newest' \| { profile })` | Start a new traversal in selected order |
| `acquisition(parentId?)` | Active `{ purpose, started }` or undefined |
| `continuity` | `current` or `restart-required` with reason |
| `preview(body, signal?, draft?)` | Obtain selected preview delivery |

Acquisition purposes are `initial`, `restart`, `continue`, `revalidate` and `change-order`. `ready`, `error`, `order`, `ranking` and `lastRefresh` belong to the page. Observation is bounded to 100 loaded IDs; automatic observations rotate through loaded content. Explicit `observedIds` prioritizes a bounded visible set. This does not discover new membership or continuously refresh all content. Changed discussion identity or invalid continuation requires deliberate restart. Reads started before accepted contributions cannot overwrite newer overlapping facts.

Ranked reading captures a complete root ID sequence and hydrates bounded pages without reordering mid-traversal. `ranking` is null for chronological reading; otherwise results report `ready`, `preparing` or `paused`. Ready results report acquisition interval and oldest required observation. Preparation stops after two minutes. See [ranking configuration](CONFIGURATION.md#sort-by-reactions-or-reply-counts).

## Writing

A target is `{ kind: 'comment' }`, `{ kind: 'reply', id }` or `{ kind: 'edit', id }`. The target identifies destination; `Writing.id` identifies one independent intent. Editing begins with loaded canonical source. Several records can share a destination.

| Method/state | Meaning |
| --- | --- |
| `writing(target?)` | Active writer for destination, creating one when absent |
| `newWriting(target?)` | New independent writer, selected for its destination |
| `activeWriting(target?)` | Selected writer or undefined |
| `selectedWriting` | Selected record IDs across destinations |
| `selectWriting(id)` | Select an already attached record |
| `writings` | Read-only map keyed by persistent record ID |
| `saveWriting()` | Serialize current records/selections for explicit backup |
| `recoverWriting(raw)` | Attach validated backup records without replacing another record |

The default target is the main comment destination. Browser `conversation.recovery` exposes `ready: Promise<void>`, `records(): readonly SavedWriting[]`, `restore(id): Promise<Writing | undefined>`, `pending: boolean` and `error: string`. Await `ready` before presenting recovery choices. `records()` includes saved records and attached writers that are not currently selected. `restore(id)` selects and opens a local record or claims a stored record before attaching it; undefined means it could not restore that ID. A claim covers only that record, so another independent writer for the same destination remains possible. Closing its previous context releases the claim. Previously selected or unambiguous saved writing can recover automatically; additional same-destination records remain explicit choices.

| Writing member | Meaning |
| --- | --- |
| `id`, `target` | Persistent intent ID and immutable destination |
| `text`, `open`, `pending`, `error`, `protected` | Current text, visibility and issued state |
| `actions` | Derived edit/hide/clear/undo/sign-in/submit/retry/abandon permissions |
| `update(text)` | Change editable text |
| `show()`, `hide()` | Change editor visibility |
| `clear()`, `undoClear()` | Clear ordinary text and restore it |
| `submit()` | Issue editable intent or retry its original unresolved submission |
| `abandon()` | Deliberately release recovery of an issued outcome |

`submit()` returns `{ status: 'saved', result }`, `{ status: 'failed', error }` or `{ status: 'blocked', reason }`. Issuing freezes target/body/key/immutable author. Protected writing cannot be edited or cleared; hiding preserves it, and hidden writing must reopen before submitting. Retry requires the original author. Confirmed saving clears text and closes reply/edit writers. A definite initial rejection permits editing; failed recovery still cannot establish the original outcome and remains protected.

Abandonment cannot cancel the external effect: the contribution might already exist. Explain this consequence and obtain a deliberate reader decision before calling `abandon()`. Presentations choose the recovery indicator and whether protected editors can hide.

`writingRecovery` accepts `{ retentionMs, store }`. Default browser storage expires ordinary records after five minutes; issued unresolved records survive ordinary retention and sign-out until a known outcome or deliberate abandonment. Each intent has a separate durable key, and admission claims only the chosen record. Storage failure leaves in-memory writing available but cannot promise reload recovery. `writingRecovery: false` disables persistence.

Normal browser persistence sends record-level `writingRecord`, `writingRemoved` and `writingSelected` messages. Whole-page `saveWriting()`/`recoverWriting()` are backup/import APIs, not the normal persistence boundary. In iframe embedding the website parent owns storage and claims.

A custom `WritingStore` implements `load(scope): SavedWriting[]`, `acquire(scope, id, lifetime): Promise<boolean>`, `save(scope, writing)` and `remove(scope, id)`. Protect unresolved records from ordinary expiry, remove only the owned record, and keep claims until the supplied lifetime retires. A false acquisition means another context owns that record; do not restore or overwrite it.

`createEditor(conversation, writing, { signal, render, writeWhileSignedOut, submitted })` optionally supplies native form/textarea/preview. Keep actual nodes inside the form through unrelated updates. Project `mode`, `fixedWidth`, `pending`, `previewPending` and `error` into controls. Commands are `write()`, `preview()`, `toggleFixedWidth()`, `submit()`, `clear()`, `undoClear()` and `dispose()`. `submitted` receives the outcome even when saving retires the editor, but is suppressed after page/caller retirement.

`writeWhileSignedOut: true` permits local text before authentication. Submit starts sign-in and retains intent without automatically publishing on return. Source and prepared previews can work anonymously; GitHub preview requires sign-in. Standard main input retains its native nodes, with CSS controlling top/bottom placement.

## Actions, reactions and session

`actions(subjectId?)` derives `reply`, `edit`, `remove`, `moderate`, `react`, `recover` and `abandon`. Omit ID or use `discussion` for discussion actions. Availability is `available`, `sign-in`, `pending`, `recovery` or `unavailable`, with optional reason. `retryAction(id)` and `abandonAction(id)` operate on retained deletion/moderation intent. Writing and each reaction have their own recovery owners.

`setReaction(id, reaction, selected)`, `removeComment(id)` and `moderateComment(id, minimized, reason?)` issue contributions. Reaction names are `THUMBS_UP`, `THUMBS_DOWN`, `LAUGH`, `HOORAY`, `CONFUSED`, `HEART`, `ROCKET` and `EYES`; GitHub Discussions upvotes are separate.

`reaction(id, name)` returns `permission`, `confirmed: { count, selected }`, `desired`, projected `selected`/`count`, `pending`, optional `recovery`, derived `recover` availability and `abandon`. Use `retryReaction(id, name)` or `abandonReaction(id, name)` for that stream. `reactions(id)` returns projected groups. Independent streams dispatch independently; successive desired states coalesce within immutable author/subject/reaction identity. Optional observation/preparation does not reopen a confirmed effect. Narrow patches merge only their owned comment fields or reaction groups.

Browser authentication belongs to `session`: read `signedIn`, `pending`, `error`; call `signIn()` or `signOut()`. Sign-in defaults to full-page return; `signIn('popup')` uses popup with redirect fallback. Capability adoption needs no polling. Return acceptance expires after ten minutes; a lost return needs a new sign-in. Full-page return requires session storage.

`subscribe(listener)` observes the actual page including browser session/appearance/writing changes. Call instance methods through their owners. `signal` retires descendants; browser `own(cleanup)` registers acquired resources and returns an idempotent release. `dispose()` retires the owner; `settled()` waits for issued work. Dispatched external effects can finish afterward but cannot publish into replacement page/account identity.

## HTTP protocol

Matching version 5 browser and Worker packages use `/api/v5/`. Retired/unknown protocols return HTTP 409 `VERSION_MISMATCH`. The Worker enforces repository scope, website policy and authorization independently of presentation. Clients supply selection, not category or immutable repository authority hints.

GET inputs are JSON in the `input` query parameter. POST inputs are JSON bodies. `config` is `{ repo, origin, term?, strict?, number? }`; `origin` is a full embedding URL. Public policy remains required for anonymous requests.

| Endpoint | Request |
| --- | --- |
| GET `/api/v5/page` | `{ config, order?, cursor?, parentId?, ids?, observe?, replyPrefetch?, content? }` |
| GET `/api/v5/counts` | `{ repo, origin, strict?, terms }`, up to 20 terms |
| GET `/api/v5/ranking` | `{ config, profile }` |
| POST `/api/v5/preview` | `{ config, body, content?, draft? }` |
| POST `/api/v5/contribute` | `{ config, key, action, creation?, content? }`, bearer capability required |

Page and contribution `content` default to `source`; preview defaults to `github`. `source` delivers canonical Markdown, `github` adds provider HTML, and `prepared` adds trusted producer output. `observe: true` requires IDs, zero reply prefetch and no parent/cursor; it observes metadata and loaded IDs without a new traversal. Explicit IDs are bounded to 100. Counts return `counts`, `observedAt` and `expiresAt` in Unix milliseconds: preserve original expiry, and never turn acquisition failure into zero comments.

Preview returns `{ html? , prepared? }`. Prepared preview is anonymous and source preview needs no provider rendering; GitHub preview requires a valid capability. Prepared output is `{ html: string, revision: string, resources?: { styles: string[], scripts: string[] } }`.

Contribution actions are:

```ts
{ type: 'comment', body, replyToId? }
{ type: 'edit', id, body }
{ type: 'delete', id }
{ type: 'moderate', id, minimized, reason? }
{ type: 'reaction', subject: { kind: 'discussion' }, reaction, selected }
{ type: 'reaction', subject: { kind: 'comment', id }, reaction, selected }
```

Moderation reasons are `ABUSE`, `DUPLICATE`, `OFF_TOPIC`, `OUTDATED`, `RESOLVED` and `SPAM`. `creation` supplies optional `description` and `backLink` for a missing discussion. A reaction selects a tagged subject rather than inferring discussion/comment from an ID or sending add/remove toggles.

Confirmed results contain `id`, discussion `number`, optional `parentId` and operation-owned `patch`. A patch may contain partial `nodes` (null deletes), reaction groups by subject ID, root/reply window deltas and partial metadata. Merge partial node fields and individual reaction groups; do not replace unrelated canonical facts. Window deltas contain `add`, `remove`, `total` or `cursor` where established.

A receipt binds immutable original author/key to normalized discussion selection and action. Reusing a key with changed effect identity conflicts. Origin remains subject to current policy; content delivery and creation details do not redefine the effect. Retry the unchanged effect as its original author with its original key. A new key is a new effect. The retained `3.` key prefix identifies durable receipt format, independently of version 5 package/protocol naming.
