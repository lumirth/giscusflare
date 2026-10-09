# Customize comments

Use `mountComments` for the standard interface and optional component replacements. Use `mountPresentation` or `createConversation` from `giscusflare/headless` for a custom interface, explicitly selecting a complete content profile. `giscusflare/model` supplies the portable owner without browser APIs.

## Choose a content profile

| Selection | Responsibility |
| --- | --- |
| `stockContent({ service })` from `giscusflare/content/stock` | Standard GitHub interpretation, rich code/math, required styles and copy controls |
| `preparedContent()` from `giscusflare/content` | Your deployed safe interpretation and declared resources |
| `browserContent(renderer)` from `giscusflare/content` | Deliberate commenter-safe browser interpretation |

Canonical GitHub Markdown stays authoritative. The profile pairs acquisition with rendering; custom presentations consume its content owner rather than constructing requests or deciding which data to retain.

## Prepare content in your deployment

Keep the API and Repository coordinator separate from interpretation:

```js
// comments-worker.js
export { default, Repository } from 'giscusflare/worker';
```

```js
// content-worker.js
import { createContentWorker } from 'giscusflare/content/worker';
import { prepareComment } from './site-comments.js';
import resources from './comment-resources.js';

const revision = 'comments-2026-10-08';
export default createContentWorker({
  revision,
  async prepare(input, signal) {
    return {
      html: await prepareComment(input.markdown, { signal }),
      revision,
      resources: resources.revision,
      // Declare only generated anchors that must be unique for each installed mount.
      anchorPrefixes: ['comment-footnote-'],
    };
  },
});
```

Deploy the producer as an internal Worker with no public route, then bind it as `CONTENT` in the comments Worker's Wrangler configuration:

```json
"services": [{ "binding": "CONTENT", "service": "your-comment-content" }]
```

The producer receives canonical rendering input, never commenter credentials. It owns safe interpretation, URLs and extensions: trusted article-author capabilities must not become commenter permissions. The factory bounds batch input/output, execution concurrency and disposable completed-artifact reuse. Its hot store retains at most 256 items and 8 MiB; individual retained results are at most 2 MB. It has no Repository SQLite artifact store. A cold isolate prepares again, and retention failure does not invalidate otherwise usable output.

Change `revision` when interpretation, trust policy or required resources change. Publish immutable resource URLs, the producer and its consuming website together. Required styles finish before safe HTML is installed; optional module enhancements load independently. A failed enhancement does not erase readable HTML. Declared anchors are rebound per installed mount without rewriting unrelated control identifiers. Select this deployment capability with a manifest produced by the same compiler/resource build:

```js
import { preparedContent } from 'giscusflare/content';
import resources from './comment-resources.js';
const content = preparedContent({ resources });
```

The manifest contains its `revision` fingerprint and styles/scripts URL arrays once. Hash the actual immutable resource graph and share this value between the producer and consuming website. Producer output uses `resources: resources.revision` only when its actual generated markup needs that manifest; omit it for prose or other output that needs none. Interpretation revision remains separate, since changing sanitizer or compiler policy need not change the resource graph. An old open page rejects a different resource fingerprint before installing incompatible HTML, preserves installed output or readable source, and offers Reload to acquire the matching website. Known styles start while content is acquired, but unrelated prose does not await them. Script-dependent generated buttons can carry data-content-enhancement: the shared renderer keeps them disabled until modules and enhancement setup finish, retains readable HTML if setup fails, and never reactivates a retired control. Controls deliberately disabled by the producer remain disabled.

For the stock profile, the internal producer can simply export the default from `giscusflare/content/worker/stock`. The supplied source config and `npm run deploy:content` deploy that producer. Keep its service name consistent with the API's `CONTENT` binding.

## Render in the browser

```js
import { browserContent } from 'giscusflare/content';

const content = browserContent(async (input, { signal, lifetime }) => {
  const node = await siteMarkdown.renderComment(input.markdown, { signal });
  signal.throwIfAborted();
  bindCopyControls(node, lifetime);
  return node;
});
const comments = mountComments(target, { service, page, content });
```

Returned DOM is not sanitized again. This renderer owns commenter-safe interpretation and resources. Canonical source can be previewed locally before sign-in. Context methods expose explicitly selected provider HTML or prepared content when a custom profile needs them; they do not switch delivery implicitly.

## Mount published bodies

```js
const body = conversation.content.mount(target, comment, {
  signal: scope.signal,
  onReady(ready) { card.hidden = !ready; },
});
// Accepted source/metadata/hint changes update this binding automatically.
// When this body leaves the view:
body.dispose();
```

The selected `ContentOwner` supplies repository, rendering URL, profile, batching, accepted content hints and recovery. Consumers bind a canonical comment once and supply their attachment lifetime. Accepted source, identity metadata and hint changes update its installed mount without redraw-driven update calls. Explicit preview or custom writing input uses the same mount with `{ markdown, purpose, draft? }`. Each mount owns detached current-only preparation and installed output. It retains unchanged content and keeps the installed view usable while a replacement prepares. Failure retains that output or exposes readable source with an owned retry control. `ready` and `onReady` report that mount's installed output; do not make an unrelated count or composer depend on every body being ready.

A `ContentRenderer` returns a node, an asynchronous node, or `{ node, update?, dispose? }`. `context.signal` cancels one preparation generation; `context.lifetime` owns installed controls and resources. Mounted framework `update(input, context)` prepares without mutating the installed tree and returns a commit callback. The shared mount invokes it only while current. Changing `revision` forces interpretation when external browser inputs changed.

## Replace rich-content features

The deliberate browser GitHub renderer supports complete code/math replacements:

```js
import { browserContent } from 'giscusflare/content';
import { githubContent } from 'giscusflare/content/github';
import 'giscusflare/content.css';

const content = browserContent(githubContent({
  code(input, { signal, lifetime }) {
    return siteCode.render({ ...input, signal, lifetime });
  },
  math: false,
}), 'github');
```

Code replacements receive source, language and optional GitHub file metadata. Math replacements receive source and display mode. Each owns the complete feature, including frames and controls, through the same asynchronous installed-output contract. `code: false`, `math: false` and `copy: false` disable the respective default feature; `labels` controls copy/failure text. The stock service profile remains the default when no replacement is selected.

## Build a presentation

A presentation is `(target, conversation, scope) => void`. Subscribe to the shared owner, render public reading from `document`, account information from `viewer`, and use `actions(id)` and `reaction(id, name)` for controls. The [forum example](https://github.com/lumirth/giscusflare/blob/main/examples/forum.ts) demonstrates a complete custom interface.

Register resources with `scope.own(cleanup)` as you acquire them; it returns an idempotent early release. `scope.signal` retires the view independently of reading and writing. `replacePresentation()` preserves those owners; `replacePage()` retires them. Publish `conversation.readingLayout.publish()` after the necessary reading DOM is installed to support authentication return positioning. That milestone does not freeze native focus or gate unrelated UI.

## Add a composer

```js
import { createEditor } from 'giscusflare/interactions';

const writing = conversation.writing({ kind: 'reply', id: rootId }).show();
const submit = document.createElement('button');
submit.type = 'submit';
submit.textContent = 'Publish';
const editor = createEditor(conversation, writing, {
  signal: scope.signal,
  writeWhileSignedOut: true,
  render(editor) {
    if (!editor.form.hasChildNodes())
      editor.form.append(editor.textarea, editor.previewElement, submit);
    submit.disabled = !(writing.actions.submit || writing.actions.retry || writing.actions.signIn);
    editor.textarea.hidden = editor.mode === 'preview';
    editor.previewElement.hidden = editor.mode === 'write';
  },
});
host.append(editor.form);
```

The shared editor owns the actual textarea, form, preview, native shortcuts, submission and recovery. Retain its nodes through unrelated redraws to preserve selection and undo history. Folding, focus restoration, placement and labels remain presentation decisions. Persistent intent outlives editor DOM. Recovery selection uses `conversation.recovery.records()` and `restore(id)`; initialization starts reading and identity independently of storage recovery.

## Replace standard controls

`mountComments(target, options, parts)` accepts `header`, `composer` and `reactions` slots. They return text, owned DOM nodes or `lit-html` templates. Retain logical nodes when native history matters, and acquire cleanup through `context.scope`. Use `updateAppearance()` for theme changes without rebuilding reading or writing. Native styles follow the website CSP; iframe themes need an [allowed origin](CONFIGURATION.md#custom-theme-css).
