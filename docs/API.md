# JavaScript API

Use `mountComments` for the standard interface, `mountPresentation` for a custom interface, or `createConversation` in a framework. Each conversation is the actual page owner. A mount owns its current conversation and an independently replaceable presentation.

## Create or mount

Headless consumers choose their content renderer explicitly:

```js
import { createConversation } from 'giscusflare/headless';
import { githubContent } from 'giscusflare/content/github';

const conversation = createConversation({
  service: 'https://your-comments.workers.dev',
  page: { repo: 'you/comments', origin: location.href, term: 'post:hello-world', strict: true },
  content: githubContent(),
});
const renderPage = () => render(conversation.document);
const stop = conversation.subscribe(renderPage);
renderPage();
// When the component is removed:
stop();
conversation.dispose();
```

The standard `mountComments` supplies GitHub content rendering unless `content` is supplied. Headless construction and `mountPresentation` require `content`; they import no default renderer or presentation. See [content customization](EXTENDING.md#choose-content-rendering) for local, server and mounted framework output.

A mount returns `conversation`, `replacePage(page)`, `replacePresentation(presentation)` and `dispose()`. Replacing the page saves writing, retires the old owner and creates a new one. A retained old conversation cannot act on its replacement. Replacing the presentation preserves the same page, writing and reading progress.

## Options

| Option | Meaning |
| --- | --- |
| `service` | Comments service origin |
| `page.repo` | GitHub `owner/repository` |
| `page.origin` | Full embedding URL, used for website policy and sign-in return |
| `page.term` or `page.number` | Stable lookup term or positive existing discussion number |
| `page.strict` | Match the term hash; default false |
| `page.backLink`, `page.description` | Details used when creating a discussion |
| `content` | Renderer shared by published bodies and previews; optional `providerHTML: true` requests provider HTML with observations |
| `appearance` | Theme, language, reactions, input position and metadata settings |
| `fetching` | Focus/reconnect freshness policy and reply prefetch |
| `writingRecovery` | Optional retention and storage; false disables persistent recovery |
| `bootstrap` | Unexpired anonymous `{ view, expires }` acquisition |

A missing discussion selected by number is not created automatically. The default appearance is `theme: 'preferred_color_scheme'`, `lang: 'en'`, `inputPosition: 'bottom'`, `reactionsEnabled: true`, `emitMetadata: false`. `updateAppearance()` retains writing and reading progress.

`fetching` accepts `onFocus`, `onReconnect`, `staleAfterMs` and `replyPrefetch`. Defaults permit focus/reconnect revalidation after 60 seconds and prefetch five replies per root. `fetching: false` disables automatic revalidation. No polling timer is installed. Server cache lifetime and reply bounds still apply.

`writingRecovery` accepts `{ retentionMs, store }`. A `WritingStore` loads, saves and removes serialized strings by key; `save(key, value, protectedWriting?)` tells custom stores when the snapshot contains unresolved issued work. Custom stores must preserve those protected snapshots instead of applying ordinary draft expiry. The default browser store expires ordinary writing after five minutes. Protected snapshots use `expires: null`: they survive ordinary retention and sign-out until the outcome is known or recovery is explicitly abandoned. They then return to ordinary retention. Persistence is best effort: unavailable storage retains in-memory writing but cannot recover it after reload. `writingRecovery: false` explicitly disables storage. Saved writing includes destination, visibility, text, clear undo, and issued submission identity; a reload during dispatch recovers that identity as unresolved.

## Reading document

Treat `conversation.document` as read-only:

| Field | Meaning |
| --- | --- |
| `nodes[id]` | One canonical comment, with `parentId: null` for a root |
| `roots` | Ordered IDs, continuation cursor and observed total |
| `replies[parentId]` | Loaded reply IDs, cursor and total |
| `metadata.thread` | Discussion identity, title, URL, lock/closed state, answer ID and reactions |
| `metadata.viewer` | Current GitHub reader or null |
| `metadata.archived`, `metadata.unavailable` | Repository/discussion availability |
| `metadata.profiles` | Operator-enabled ranking names |

Window IDs resolve through `nodes`; consumers do not rebuild or reverse nested trees. `total: null` means no authoritative count has been observed. Comments include original Markdown, optional provider HTML, authors, dates, permission flags, upvotes and confirmed reactions. Provider HTML is requested only by renderers that opt into it. `reactions(id)` includes current optimistic intent; absent reaction keys mean zero and unselected.

| Reading operation/state | Meaning |
| --- | --- |
| `start()` | Acquire the initial window if not ready |
| `restart()` | Deliberately acquire a new traversal, replacing loaded windows |
| `loadMore()` | Continue root reading |
| `loadReplies(rootId)` | Acquire earlier replies |
| `revalidate(staleAfterMs?, observedIds?)` | Observe already loaded content without resetting membership, cursors or order |
| `setOrder('oldest' \| 'newest' \| { profile })` | Start a new traversal in the selected order |
| `acquisition(parentId?)` | Active `{ purpose, started }` or undefined |
| `continuity` | `current` or `restart-required`, with an explanatory reason |

Acquisition purposes are `initial`, `restart`, `continue`, `revalidate` and `change-order`. `ready`, `error`, `order`, `ranking` and `lastRefresh` belong to the page. Background observation is bounded to 100 loaded IDs; successive automatic observations rotate through loaded content. Supplying `observedIds` prioritizes a bounded set, such as visible comments. This does not discover new comments or continuously refresh every loaded item. Missing observed nodes are removed. A changed discussion identity or unusable continuation requires a deliberate restart rather than silent traversal replacement.

Ranked reading captures an ordered root ID list, including roots not yet displayed, and hydrates bounded pages. It does not reorder halfway through traversal. `ranking` is null for chronological reading; ranked results report `ready`, `preparing` or `paused`. Ready results report an acquisition interval and oldest required observation. Preparation stops after two minutes. See [ranking configuration](CONFIGURATION.md#sort-by-reactions-or-reply-counts) for budgets and cadence.

## Writing

`conversation.writing(target)` returns the stable writing owner for `{ kind: 'comment' }`, `{ kind: 'reply', id }` or `{ kind: 'edit', id }`. Editing initially uses the loaded comment source. `conversation.writings` exposes those owners as a read-only map. Their destination is independent of editor visibility and reading membership.

| Writing member | Meaning |
| --- | --- |
| `id`, `target` | Stable identity and immutable destination |
| `text`, `open`, `pending`, `error`, `protected` | Current writing and unresolved submission state |
| `actions` | Derived edit, hide, clear, undo-clear, sign-in, submit, retry and abandon permissions |
| `update(text)` | Change editable writing |
| `show()`, `hide()` | Change editor visibility without changing intent |
| `clear()`, `undoClear()` | Clear ordinary writing and restore it |
| `submit()` | Issue editable writing or retry the original unresolved submission |
| `abandon()` | Explicitly give up recovery of an issued outcome |

`submit()` returns `{ status: 'saved', result }`, `{ status: 'failed', error }` or `{ status: 'blocked', reason }`. An issued submission freezes its destination, body, receipt key and immutable author. Protected writing cannot be changed or cleared. Hiding does not discard it, and hidden writing cannot submit until reopened. `actions.signIn` identifies when authentication can enable submission or recovery; retry requires the original author. Confirmed saving clears text and closes reply/edit writing; a definite rejection of the initial attempt permits editing again. A failed recovery request does not establish what happened to the original effect: that writing remains protected. An uncertain outcome stays recoverable across persistence.

Abandonment is a deliberate host choice, not a cancellation of the remote effect: the original contribution might already exist. Explain that consequence and obtain the reader's decision before calling `abandon()`. Presentations choose whether protected writing remains expanded or can be hidden with a recovery indicator.

`createEditor(conversation, writing, { signal, render, writeWhileSignedOut, submitted })` supplies an optional native form, textarea and preview component. Its renderer receives the actual editor. Keep `textarea` and `previewElement` mounted inside `form`, and project `mode`, `fixedWidth`, `pending`, `previewPending` and `error` into controls. Commands are `write()`, `preview()`, `toggleFixedWidth()`, `submit()`, `clear()`, `undoClear()` and `dispose()`. `submitted` receives the writing outcome even when confirmed success hides the writing and retires its editor. The callback is suppressed when the conversation or caller-supplied signal has retired. The supplied signal retires the editor and its content resources automatically.

`writeWhileSignedOut: true` permits local editing before authentication. Submitting starts sign-in and retains writing without automatically publishing afterward. A local content renderer can preview without sign-in; the GitHub renderer requests authenticated provider preview only when it needs it. Native editing history requires retaining the actual editor nodes across unrelated updates. The standard main editor is permanent, with CSS controlling visual top/bottom placement.

## Actions, session and lifetime

`actions(subjectId)` derives `reply`, `edit`, `remove`, `moderate`, `react` and `recover` availability. Omit the ID, or use `'discussion'`, for discussion actions. Each result has `status: 'available' | 'sign-in' | 'pending' | 'recovery' | 'unavailable'` and an optional reason. Presentations choose wording, controls and placement; they need not inspect private operation records. `retryAction(id)` recovers pending reaction, deletion or moderation intent. Writing recovery uses its own owner.

Contribution commands are `setReaction(id, reaction, selected)`, `removeComment(id)` and `moderateComment(id, minimized, reason?)`. Reaction names are `THUMBS_UP`, `THUMBS_DOWN`, `LAUGH`, `HOORAY`, `CONFUSED`, `HEART`, `ROCKET` and `EYES`, separate from Discussions upvotes. One page queue serializes effects and canonical patch adoption. A confirmed effect with failed display observation remains saved; refresh reading rather than issuing another contribution.

Authentication belongs to `session`: read `signedIn`, `pending` and `error`; call `signIn()` or `signOut()`. Sign-in defaults to full-page return; `signIn('popup')` uses a popup with redirect fallback. The page keeps its future capability while the service authorizes its hashed proof. The callback installs that capability without polling. Return acceptance expires after ten minutes; a lost return requires a new sign-in. Full-page recovery requires working session storage.

`subscribe(listener)` observes the actual page, including session, appearance and writing changes. Rebind the observer after `replacePage()`. Commands are instance methods; call them through their owner. `signal` cancels page descendants; `own(cleanup)` registers acquired resources and returns an idempotent early release. `dispose()` retires the page, and `settled()` waits for already issued work. Remote effects already dispatched can finish after retirement, but cannot publish into a replacement page.

## HTTP protocol

Version 4 browser packages use `/api/v4/`. Deploy matching Worker and browser versions. Retired or unknown protocols receive HTTP 409 `VERSION_MISMATCH`. The Worker enforces repository scope, website policy and authorization independently of presentation. Repository names locate immutable GitHub repository IDs; clients do not supply category or repository authority hints.

GET `/api/v4/page` takes `{ config, order?, cursor?, parentId?, ids?, observe?, replyPrefetch?, html? }` serialized as the `input` query parameter. `config` contains only `repo`, `origin`, `term`, `strict` and `number`. `observe: true` observes requested IDs and metadata without starting a new ordered traversal. `html: true` requests provider HTML in acquired nodes; original Markdown is always available.

GET `/api/v4/counts` takes `{ repo, origin, strict, terms }` in `input`, up to 20 terms. Results contain `counts`, `observedAt` and `expiresAt` in Unix milliseconds. Retain bounded summaries until their original expiry; a failed request does not establish zero comments.

POST `/api/v4/contribute` requires a bearer capability and `{ config, key, action, creation?, html? }`. Actions are `comment` (`body`, optional `replyToId`), `edit` (`id`, `body`), `delete` (`id`), `moderate` (`id`, `minimized`, optional `reason`) or `reaction` (`id`, `reaction`, `add`). `creation` supplies `description` and `backLink` for a new discussion. Confirmed results contain external `id`, discussion `number`, optional `parentId` and canonical `patch`.

A receipt binds the original immutable author and key to normalized discussion selection plus action. Number selection uses repository/number; term selection uses repository/term/strict. Reusing the key with different selection or action returns a conflict. Origin remains subject to current website authorization; `html` selects current delivery content; creation title/details/backlink prepare a missing discussion. These are not contribution effect identity and may change without turning a retry into a new effect.

Retry the unchanged effect as its original author with its original key. A new key represents a new effect. The receipt-key prefix `3.` names the retained receipt format; it is not the HTTP or package version. Version 4 does not replace durable receipt identities merely to rename the package.
