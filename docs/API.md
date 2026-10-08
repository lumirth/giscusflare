# JavaScript API

This reference describes the public JavaScript and HTTP API. Use `mountComments` for the default interface, `mountPresentation` for a custom interface, or `createConversation` to render comments in your own framework.

`createConversation` returns one page's conversation. Mounting returns an owner whose `conversation` property exposes its current page. The owner replaces and disposes pages; the conversation is the actual page model with browser capabilities attached.

See [native integration](INTEGRATION.md#native-rendering) for the versioned package installation command.

## Create or mount

```js
import { createConversation } from 'giscusflare/headless';

const conversation = createConversation({
  service: 'https://your-comments.workers.dev',
  page: {
    repo: 'you/comments',
    origin: location.href,
    term: 'post:hello-world',
    strict: true,
  },
});

const renderPage = () => render(conversation.document);
const stop = conversation.subscribe(renderPage);
renderPage();

// When the component is removed:
stop();
conversation.dispose();
```

`createConversation` starts the initial load. `mountComments` adds the default interface. `mountPresentation` mounts a custom interface. Both mounting functions accept the same options and return an owner with `conversation`, `replacePage`, `replacePresentation` and `dispose`.

## Options

`service` is the comments service's origin. `page` identifies the conversation:

| Page field | Meaning |
| --- | --- |
| `repo` | GitHub `owner/repository` |
| `origin` | Full embedding page URL, used for website policy and sign-in return |
| `term` | Stable discussion lookup term |
| `number` | Existing discussion number, instead of a lookup term |
| `strict` | Match the term's hash; defaults to false |
| `backLink`, `description` | Page details used when creating its discussion |

Supply a term or a positive discussion number. A missing discussion selected by number is not replaced automatically.

| Appearance field | Default |
| --- | --- |
| `theme` | `preferred_color_scheme` |
| `lang` | `en` |
| `inputPosition` | `bottom` |
| `reactionsEnabled` | `true` |
| `emitMetadata` | `false` |

Appearance changes retain conversation state. Replacing the page saves its draft and retires that conversation before creating the next one. Each presentation receives that page's conversation. A retained old conversation keeps its original identity and cannot act on the replacement page.

Subscribe to the actual page. Navigation code owns rebinding its observer when it replaces that page:

```js
const renderCurrent = () => render(mounted.conversation.document);
let stop = mounted.conversation.subscribe(renderCurrent);
function navigate(page) {
  stop();
  mounted.replacePage(page);
  stop = mounted.conversation.subscribe(renderCurrent);
  renderCurrent();
}
// Event handlers read the current owner when invoked.
button.onclick = () => mounted.conversation.refresh();
```

The mount has no second state stream. A page subscription ends with that page. Commands are instance methods; call them through the conversation rather than detaching them.

`fetching` accepts `onFocus`, `onReconnect`, `staleAfterMs` and `replyPrefetch`. Defaults enable focus and reconnect refresh after 60 seconds, with five replies prefetched per root. Set `fetching: false` to disable automatic focus/reconnect refresh. `refresh()` remains available. The server's cache lifetime and reply limit still apply. An optional `bootstrap: { view, expires }` installs an unexpired anonymous `WindowPage` from the server without a second anonymous fetch.

`draftRecovery` accepts `{ retentionMs, store }`, where `store` is an optional `DraftStore`. The default uses browser storage for five minutes. Set it to `false` to keep drafts only in memory. Version 3 stores whole contribution records, including text, editor and retry identity. Retry identities remain attached to their text.

## Document and owners

Read `conversation.document` and treat its contents as read-only:

| Field | Meaning |
| --- | --- |
| `nodes[id]` | One canonical comment, with `parentId` null for a root |
| `roots` | Root reading window: ordered `ids`, continuation `cursor`, observed `total` |
| `replies[parentId]` | A reply reading window with the same three fields |
| `metadata.thread` | Discussion identity, title, URL, locked/closed flags, answer ID and confirmed reactions |
| `metadata.viewer` | Current GitHub reader or null |
| `metadata.archived`, `metadata.unavailable` | Repository/discussion availability |
| `metadata.profiles` | Operator-enabled ranking names |

Window IDs resolve through `nodes`. The service supplies their reader order; clients do not reverse or rebuild nested comment trees. `total: null` means no authoritative count has been observed. It does not establish zero.

`ready`, `error`, `order`, `ranking` and `lastRefresh` belong directly to the page. `reading()` reports a root acquisition; `reading(parentId)` reports a reply acquisition. `canCompose` derives the actual availability and lock state. `refresh()` replaces the reading windows, including previously loaded replies. Changing order also starts a fresh traversal. It does not destroy draft records or an editor component's DOM.

Comments carry author, Markdown/HTML bodies, dates, permission flags, upvotes and confirmed reactions. `reactions(id)` adds the current optimistic reaction intent. A reaction group is `{ count, selected }`; a missing key means zero and unselected. `metadata.thread.answerId` identifies the answered comment.

`conversation.drafts` owns each contribution's `text`, optional retry `key`, optional `editor: { kind, id }`, `pending` promise and `error: { status, message }`. `kind` is `reply` or `edit`. Render active editors from those records, independently of whether their target is in the current reading window. Confirmed submission removes its draft. An uncertain result retains the original text and key.

Authentication belongs to `conversation.session`: read `signedIn`, `pending` and `error`, and call `signIn()` or `signOut()` there. Appearance belongs to `conversation.appearance`; page identity is `conversation.config`. There is no projected `.state` object or authentication forwarding façade.

One page subscription covers domain, authentication, appearance and draft notifications. Text/key-only changes retain the same `document` identity. Row renderers can skip that unchanged document while editor and persistence consumers process the notification. Keep native editor nodes mounted; rebuilding unrelated DOM during every keystroke can disrupt native undo even if the textarea itself survives.

## Commands

| Command | Effect |
| --- | --- |
| `refresh()` | Replace the current root and reply reading windows |
| `updateAppearance(appearance)` | Update theme, language or layout through the same subscriptions |
| `refresh(true)` | Fetch another root-comment page |
| `setOrder('oldest' \| 'newest')` | Change chronological order |
| `setOrder({ profile: 'popular' })` | Select an operator-defined ranking profile |
| `loadReplies(rootId)` | Fetch an earlier reply page |
| `session.signIn()`, `session.signOut()` | Start GitHub sign-in or end the service session |
| `draft(name)`, `setDraft(name, text)` | Read or change a composer draft |
| `beginReply(rootId)` | Open a reply editor and return its name |
| `beginEdit(comment)` | Open an edit form and return its name |
| `closeEditor(name)` | Close a reply or edit form |
| `submit(name)` | Submit that composer's current draft |
| `preview(markdown, signal?)` | Request rendered Markdown under an optional shorter lifetime |
| `setReaction(id, reaction, selected)` | Set the reader's intended reaction state |
| `retryReaction(id)` | Retry a failed reaction intent |
| `removeComment(id)` | Delete a comment when the reader has permission |
| `moderateComment(id, minimized, reason)` | Hide or reveal a comment when permitted |
| `signal` | Page lifetime signal for asynchronous descendants |
| `own(cleanup)` | Register cleanup immediately; returns an idempotent early-release function |
| `dispose()` | Retire the page, release children and cancel outstanding reads |
| `settled()` | Wait for already issued work to settle |

The main draft's name is `main`. `createEditor(conversation, name, { signal, render })` owns a form, textarea, preview element, native shortcuts and their lifetime. Its rendering hook receives the actual editor; insert `editor.textarea` and `editor.previewElement` into `editor.form`, and project `mode`, `fixedWidth`, `pending`, `previewPending` and `error` into your controls. Call `write()`, `preview()`, `toggleFixedWidth()`, `submit()` and `cancel()` for commands. The component owns preview cancellation and content enhancement; custom renderers do not retain a second preview response or subscription. `dispose()` removes the component and retires its resources. The provided signal also disposes it automatically.

Pass `draftWhileSignedOut: true` to allow local writing before authentication. Both configurations respect locked, archived or unavailable discussions. Submitting while signed out starts authentication and retains the draft without automatically posting after sign-in. Recovery across a full-page return requires enabled, working draft storage. Markdown preview requires an authenticated service session. The standard textarea retains its reference geometry: input-time measurement grows it within 100–500px, and reader-selected manual height remains in effect. The geometry hook lives on the actual editor textarea and retires with it.

In the standard interface, `inputPosition` controls the main editor's visual layout. Logical DOM and keyboard reading order remain comments followed by the main editor in both layouts, preserving the actual editor, focus, selection and native text history. Custom slots are rendering callbacks: return declarative templates or the same owned imperative Node per instance. A fresh HTMLElement replaces its predecessor; arbitrary new custom nodes are not covered by the history guarantee.

Draft text, editor identity and retry key remain page-owned even if a reading window removes their target. The default presentation renders reply/edit forms inline and retires their DOM when their row leaves; reopening restores the saved draft. The main editor keeps one permanent node across refresh and visual top/bottom placement. Custom presentations choose their own placement and editor DOM lifetimes without retaining stale reading nodes.

`session.signIn()` defaults to full-page return; pass `'popup'` for a popup with redirect fallback when blocked. The page retains its future capability while the service authorizes its hashed proof; custom presentations call the session rather than constructing authorization URLs. A matching callback return installs that same capability. Return acceptance expires after ten minutes. There is no completion polling; start a new sign-in if the return is lost. Failed navigation or a denied return updates `session.error` without discarding an unrelated session. Full-page return requires working session storage. If persistent storage writes fail, the current window can retain its installed session across mounted page changes; reloading cannot recover a value that was never stored.

A mutation returns its confirmed result or throws an error. Keep the original draft and retry identity after an uncertain result. The conversation object does this for its bound composers and reactions.

Reaction types are `THUMBS_UP`, `THUMBS_DOWN`, `LAUGH`, `HOORAY`, `CONFUSED`, `HEART`, `ROCKET` and `EYES`. These are GitHub emoji reactions, separate from GitHub Discussions upvotes.

## Ranked views

`document.metadata.profiles` lists the profiles enabled by the operator. Select a name rather than sending a formula:

```js
await conversation.setOrder({ profile: 'popular' });
```

Ranking covers the discussion's roots, including roots outside the currently displayed page. The browser retains that ordered ID list while it fetches content in bounded pages. A score change does not move an item across pages halfway through the same traversal.

`conversation.ranking` is null for chronological views. A ranked view reports `ready`, `preparing` or `paused`. A ready result's `observedAt` is its oldest required observation. A paused result provides a reason and an optional retry time. Use those values to offer a retry or return to chronological order. Active preparation checks stop after two minutes; an open tab does not wait indefinitely.

Enabling a profile consumes the operator's metadata-read and storage allocation. More ranking inputs can mean smaller upstream batches. See [ranking configuration](CONFIGURATION.md#sort-by-reactions-or-reply-counts).

## Versioned service protocol

Browser packages and Workers use the `/api/v3/` protocol. Deploy matching versions of the service and your custom browser build. Requests to a retired or unknown protocol receive HTTP 409 with `VERSION_MISMATCH` and an instruction to reload the page.

The JavaScript API sends reads as HTTP GET requests and mutations as POST requests. The service checks repository scope, browser origin and authorization regardless of which presentation sent the request.

## HTTP reads

Use these endpoints for comment counts outside the widget or a client that does not use the JavaScript package. The package calls them for you when you mount comments.

To fetch a comment page:

```js
const config = {
  repo: 'you/comments',
  origin: location.origin,
  term: 'my-post',
  strict: true,
};
const input = { config, order: 'oldest', replyPrefetch: 5 };
const response = await fetch(service + '/api/v3/page?' +
  new URLSearchParams({ input: JSON.stringify(input) }));
```

`config` accepts only `repo`, `origin`, `term`, `strict` and `number`. The Worker resolves the immutable repository ID; operator policy selects the category. Appearance settings belong to the browser presentation. Comment creation accepts a separate `creation` object with `description` and `backLink` for a new discussion. The JavaScript conversation API supplies these fields automatically.

For comment counts beside posts on an index or archive page, request `/api/v3/counts` with `{ repo, origin, strict, terms }` serialized in the `input` query parameter, as above. Batch up to 20 terms in one request. The response contains `counts`, `observedAt` and `expiresAt`, with timestamps in milliseconds since the Unix epoch. They describe the oldest count in the batch and its original expiry. A browser can retain these summaries, display them immediately on reload and fetch again after expiry. Set a maximum number of stored summaries and discard old entries. Display a count of zero only when the response contains zero; a failed request does not establish that a post has no comments.

## HTTP contributions

All comment, edit, delete, moderation and reaction effects use `POST /api/v3/contribute` with a service bearer capability. The request is `{ config, key, action, creation? }`; `action.type` selects `comment`, `edit`, `delete`, `moderate` or `reaction`. A comment has `body` and optional `replyToId`; an edit has `id` and `body`; a reaction has `id`, `reaction` and `add`; moderation has `id`, `minimized` and optional `reason`.

The page owner manages receipt keys and serializes effect dispatch and adoption. A confirmed result contains `id`, discussion `number`, optional `parentId` and an optional canonical `patch`. The patch carries observed nodes, window changes and metadata. An observation failure does not turn a confirmed GitHub effect into a failed write or invent count changes. Preserve the same key when retrying unchanged intent; a new key represents a new effect. If the result is uncertain, inspect GitHub before intentionally creating another intent.
