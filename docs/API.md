# JavaScript API

The browser API exposes one conversation object. A presentation reads its state, subscribes to changes and calls its commands. Authentication and drafts belong to that same object.

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

const stop = conversation.subscribe(state => render(state));
render(conversation.state);

// When the component is removed:
stop();
conversation.dispose();
```

`createConversation` starts the initial load. `mountComments` adds the default interface. `mountPresentation` mounts a custom interface. Both mounting functions accept the same options and return the conversation with `updateAppearance` and `replacePage` methods.

## Options

`service` is the comments service's origin. `page` identifies the conversation:

| Page field | Meaning |
| --- | --- |
| `repo` | GitHub `owner/repository` |
| `origin` | Full embedding page URL, used for website policy and sign-in return |
| `term` | Stable discussion lookup term |
| `number` | Existing discussion number, instead of a lookup term |
| `strict` | Match the term's hash; defaults to false |
| `category`, `categoryId` | Optional category selectors checked against service policy |
| `repoId` | Optional verified GitHub repository ID |
| `backLink`, `description` | Page details used when creating its discussion |

Supply a term or a positive discussion number. A missing discussion selected by number is not replaced automatically.

| Appearance field | Default |
| --- | --- |
| `theme` | `preferred_color_scheme` |
| `lang` | `en` |
| `inputPosition` | `bottom` |
| `reactionsEnabled` | `true` |
| `emitMetadata` | `false` |

Appearance changes retain conversation state. Replacing the page saves its draft and creates a conversation for the new identity.

`fetching` accepts `onFocus`, `onReconnect`, `staleAfterMs` and `replyPrefetch`. Defaults enable focus and reconnect refresh after 60 seconds, with five replies prefetched per root. Set `fetching: false` to disable automatic focus/reconnect refresh. `refresh()` remains available. The server's cache lifetime and reply limit still apply.

`draftRecovery` accepts a retention time and an optional `DraftStore`. The default uses browser storage for five minutes. Set it to `false` to keep drafts only in memory.

## State

Read `conversation.state` as an immutable snapshot:

- `thread` holds the discussion's identity, URL, state, count and reactions.
- `comments` is the displayed root-comment collection. Each root has `replies.items`, `replies.count` and a reply cursor.
- `ready`, `loading`, `error` and `unavailable` describe the current read.
- `sorting` stays true while a reader-selected order loads, including ranking and comment hydration. Use it for sort feedback while keeping background refresh quiet.
- `viewer` identifies the signed-in reader. `canCompose` also accounts for discussion and repository state.
- `operations` records pending, failed and uncertain writes.

Comments have an ID, author, Markdown body, rendered HTML, dates, permission flags and keyed reactions. For example, `comment.reactions.HEART` is `{ count, selected }` when that reaction is present. Treat a missing key as zero and unselected.

`conversation.signedIn`, `signingIn` and `authenticationError` expose authentication status. Subscribers receive updates when it changes.

## Commands

| Command | Effect |
| --- | --- |
| `refresh()` | Reload the current conversation |
| `loadMore()` | Fetch another root-comment page |
| `setOrder('oldest' \| 'newest')` | Change chronological order |
| `setOrder({ profile: 'popular' })` | Select an operator-defined ranking profile |
| `revealReplies(rootId)` | Reveal or fetch earlier replies |
| `loadReplies(rootId)` | Fetch an earlier reply page |
| `signIn()`, `signOut()` | Start GitHub sign-in or end the service session |
| `draft(name)`, `setDraft(name, text)` | Read or change a composer draft |
| `beginReply(rootId)` | Open a reply editor and return its name |
| `beginEdit(comment)` | Open an edit form and return its name |
| `closeEditor(name)` | Close a reply or edit form |
| `submit(name)` | Submit that composer's current draft |
| `preview(markdown)` | Request rendered Markdown |
| `setReaction(id, reaction, selected)` | Set the reader's intended reaction state |
| `retryReaction(id)` | Retry a failed reaction intent |
| `removeComment(id)` | Delete a comment when the reader has permission |
| `moderateComment(id, minimized, reason)` | Hide or reveal a comment when permitted |
| `dispose()` | Release listeners and outstanding reads |

The main draft's name is `main`. `bindComposer` handles the usual form commands and exposes `submission` as `idle`, `pending`, `succeeded`, `failed` or `uncertain`. Close the submitted editor on `succeeded`; retain it while pending or when submission needs recovery.

A mutation returns its confirmed result or throws an error. Keep the original draft and retry identity after an uncertain result. The conversation object does this for its bound composers and reactions.

Reaction types are `THUMBS_UP`, `THUMBS_DOWN`, `LAUGH`, `HOORAY`, `CONFUSED`, `HEART`, `ROCKET` and `EYES`. These are GitHub emoji reactions, separate from GitHub Discussions upvotes.

## Ranked views

`state.profiles` lists the profiles enabled by the operator. Select a name rather than sending a formula:

```js
await conversation.setOrder({ profile: 'popular' });
```

Ranking covers the discussion's roots, including roots outside the currently displayed page. The browser retains that ordered ID list while it fetches content in bounded pages. A score change does not move an item across pages halfway through the same traversal.

`state.ranking` is null for chronological views. A ranked view reports `ready`, `preparing` or `paused`. A ready result's `observedAt` is its oldest required observation. A paused result provides a reason and an optional retry time. Use those values to offer a retry or return to chronological order. Active preparation checks stop after two minutes; an open tab does not wait indefinitely.

Enabling a profile consumes the operator's metadata-read and storage allocation. More ranking inputs can mean smaller upstream batches. See [ranking configuration](CONFIGURATION.md#enable-ranked-views).

## Versioned service protocol

Browser packages and Workers use the `/api/v2/` protocol. Deploy matching versions of the service and your custom browser build. Requests to a retired or unknown protocol receive HTTP 409 with `VERSION_MISMATCH` and an instruction to reload the page.

The JavaScript API sends reads as HTTP GET requests and mutations as POST requests. The service checks repository scope, browser origin and authorization regardless of which presentation sent the request.

## HTTP reads

A comment-data request selects a discussion separately from its presentation:

```js
const config = {
  repo: 'you/comments',
  origin: location.origin,
  term: 'my-post',
  strict: true,
};
const input = { config, order: 'oldest', replyPrefetch: 5 };
const response = await fetch(service + '/api/v2/thread?' +
  new URLSearchParams({ input: JSON.stringify(input) }));
```

`config` accepts `repo`, `origin`, `term`, `strict`, `number`, `repoId`, `category` and `categoryId`. Appearance settings belong to the browser presentation. Comment creation accepts a separate `creation` object with `description` and `backLink` for a new discussion. The JavaScript conversation API supplies these fields automatically.

For index-page counts, request `/api/v2/counts` with `{ repo, origin, strict, terms }`, with up to 20 terms. The response contains `counts`, `observedAt` and `expiresAt`, with timestamps in milliseconds since the Unix epoch. They describe the oldest count in the batch and its original expiry. A browser can retain these summaries, display them immediately on reload and fetch again after expiry. Bound retained entries and their age; an unavailable count is distinct from zero.
