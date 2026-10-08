# Customize comments

Choose your presentation and your content rendering independently. `mountComments` supplies the standard interface. `mountPresentation` supplies your interface. `createConversation` supplies the page owner for a framework. Headless construction requires an explicit content renderer; the standard mount supplies `githubContent()` unless you replace it.

## Choose content rendering

A `ContentRenderer` receives the original source for both published comments and previews:

```ts
interface ContentInput {
  markdown: string;
  html?: string;
  purpose: 'comment' | 'preview';
  repo: string;
  comment?: { id: string; url: string; parentId: string | null };
  draft?: string;
  revision?: string | number;
}
```

The second argument supplies `signal` and a lazy `providerHTML()` function. Published comments can carry requested GitHub HTML; otherwise this function requests provider rendering lazily. Previews request it only if the renderer calls that function. A local Markdown pipeline therefore previews without a provider request or sign-in. GitHub remains the source of stored Markdown; a host dialect can display differently from GitHub.

Set `renderer.providerHTML = true` if your renderer needs provider HTML included in reading and post-contribution observations. `githubContent()` sets this marker itself; wrappers must carry it if they need the same input. Source-only renderers omit it, so the service does not acquire unused HTML. The context’s `providerHTML()` remains available for a lazy rendering request when HTML was not supplied.

Return a `Node`, a promise of a `Node`, or mounted output `{ node, update?, dispose? }`. Asynchronous renderers must respect generation cancellation. Mounted frameworks can retain their tree and update it without remounting; release their tree/resources through `dispose()`, because an update aborts the previous generation signal without retiring the mounted tree. `revision` identifies changes in external inputs, such as a theme; otherwise unchanged input retains the mounted content. Complete content replacement adds no default code frame, copy button, math renderer or stylesheet.

```js
import { mountComments } from 'giscusflare';
import 'giscusflare/styles.css';

const content = async (input, { signal }) => {
  // Your pipeline must be configured for untrusted commenter input.
  const node = await siteMarkdown.render(input.markdown, { signal });
  signal.throwIfAborted();
  return node;
};
const comments = mountComments(document.querySelector('#comments'), {
  service: 'https://your-comments.workers.dev',
  page: { repo: 'you/comments', origin: location.href, term: 'post:hello-world' },
  content,
});
```

The same contract works with a server renderer or a mounted framework. A server renderer owns its endpoint, authorization and costs. Raw Markdown is untrusted input: a custom pipeline must constrain URLs, raw HTML and executable extensions before returning DOM. Giscusflare does not sanitize a custom renderer's returned nodes or install its styles. Keep safe source interpretation, presentation and required resources together in your selected renderer.

## Use or replace built-in features

```js
import { githubContent } from 'giscusflare/content/github';
import 'giscusflare/content.css';

const content = githubContent({
  code({ source, language, origin, file }, { signal }) {
    return siteCode.render({ source, language, origin, file, signal });
  },
  math: false,
});
```

`githubContent()` sanitizes provider HTML, keeps readable fallback content, and supplies code copy controls and math by default. A `code` replacement receives fence source/language or a GitHub file preview with source-link metadata. It owns the complete feature, including its frame and controls; no default code shell or copy button is imposed. A `math` replacement owns the complete expression and receives `{ source, display }`. Replacements accept asynchronous or mounted output through the same lifetime contract. Failed feature enhancement leaves sanitized source.

Set `code: false` to retain sanitized code without default frames/controls. Set `math: false` to retain readable TeX without loading the built-in math renderer. `copy: false` disables the default copy control without replacing code output. Custom code renderers choose their own copy behavior. Optional `labels` supplies `copy`, `copied`, `copyFailed` and `mathFailed` text.

Built-in content styling is independent of the standard layout: import `giscusflare/content.css` and apply `.markdown` to the content mount target. It supplies structural code/copy, image, math overflow and fallback rules. Website typography remains yours. The rules use Primer variables `--color-canvas-default`, `--color-border-default`, `--color-fg-muted`, `--color-canvas-subtle`, `--color-danger-muted`, `--color-danger-subtle` and their giscus theme aliases. A complete host renderer can omit this stylesheet. The standard stylesheet includes it.

## Mount published bodies

```js
import { mountContent } from 'giscusflare/content';

const body = mountContent(target, conversation.content, {
  signal: scope.signal,
  providerHTML: (input, signal) => conversation.preview(input.markdown, signal),
});
await body.update({
  markdown: comment.body, html: comment.bodyHTML,
  purpose: 'comment', repo: conversation.config.repo,
  comment: { id: comment.id, url: comment.url, parentId: comment.parentId },
});
// Update this owner for changed content; retire it when removing the body.
body.dispose();
```

`mountContent` is the shared owner used by both bodies and editor previews. Each changed input aborts its previous generation. Unchanged input retains output. A mounted output's `update()` receives the next input and cancellation context; `dispose()` retires it. Late output cannot install after replacement, and late mounted output is disposed. `clear()` cancels and removes current content. Failure leaves the original Markdown as readable text and rejects the update so the host can report it. Dispose the mount when its body leaves, even if the whole view remains active.

## Build a presentation

A `Presentation` is `(target, conversation, scope) => void`:

```js
import { mountPresentation } from 'giscusflare/headless';

const presentation = (target, conversation, scope) => {
  const status = document.createElement('p');
  target.append(status);
  scope.own(() => status.remove());
  const render = () => { status.textContent = conversation.error || conversation.session.error; };
  scope.own(conversation.subscribe(render));
  render();
};
const comments = mountPresentation(target, { ...options, content }, presentation);
```

Register cleanup when resources are acquired; construction can fail before the presentation finishes. `scope.own()` returns an idempotent early release. `scope.signal` cancels view work. `conversation.own()` and `conversation.signal` cover whole-page resources. `replacePresentation()` retires the old view without replacing the page. `replacePage()` retires both; observers must rebind to the new `comments.conversation`. Event handlers should read the current owner when invoked.

The [forum example](https://github.com/lumirth/giscusflare/blob/main/examples/forum.ts) uses the same page, writing, content and action contracts as the standard interface. Hosts choose control appearance and placement. `actions(id)` reports availability, sign-in requirements, pending work and recovery; `acquisition()` reports why reading is loading. Hosts do not need a second operation registry.

## Add a composer

```js
import { createEditor } from 'giscusflare/interactions';

const writing = conversation.writing({ kind: 'reply', id: rootId }).show();
const submit = document.createElement('button');
submit.type = 'submit';
submit.textContent = 'Publish';
const error = document.createElement('p');
const editor = createEditor(conversation, writing, {
  signal: scope.signal,
  render(editor) {
    if (!editor.form.hasChildNodes()) {
      editor.form.append(editor.textarea, editor.previewElement, error, submit);
    }
    submit.disabled = !(writing.actions.submit || writing.actions.retry || writing.actions.signIn);
    error.textContent = editor.error;
    editor.textarea.hidden = editor.mode === 'preview';
    editor.previewElement.hidden = editor.mode === 'write';
  },
});
host.append(editor.form);
```

The editor owns input, shortcuts, submission and preview resources. Insert `previewElement` directly; it uses the selected content renderer. Keep the textarea mounted while switching modes or updating unrelated content to preserve native selection and undo. `write()`, `preview()`, `clear()` and `undoClear()` control the actual component. A framework can instead use the writing owner without this DOM editor.

Writing identity survives hiding, reading changes and recovery. Render open owners from `conversation.writings`; rows do not determine their destination. An unresolved issued submission stays protected, retains its original body/target/key/author and can retry after reopening. `hide()` preserves it; `abandon()` deliberately releases recovery and can permit a duplicate contribution if the previous attempt already succeeded. Protected snapshots survive sign-out and ordinary writing retention, subject to working storage. `writing.actions.signIn` exposes authentication requirements without reconstructing permissions. Presentations decide how to explain and confirm abandonment. See [writing commands](API.md#writing).

## Replace standard controls

`mountComments` accepts header, composer and reaction slots through `StandardParts`. Slots return text, a DOM node or a supported `lit-html` template:

```js
import { html } from 'lit-html';

const comments = mountComments(target, options, {
  header(context, comment) {
    return html`<a href=${comment.author?.url ?? comment.url}>${comment.author?.login ?? 'Deleted user'}</a>`;
  },
});
```

Templates retain their nodes. An imperative slot must return the same owned node per logical instance when native history matters; a fresh node replaces its predecessor. Use `context.scope.own(cleanup)` for acquired view resources, and give bodies their own earlier retirement when removed. Appearance changes use `conversation.updateAppearance()` and retain writing and reading state. Native styles follow the host CSP; custom iframe themes must use an [allowed CSS origin](CONFIGURATION.md#custom-theme-css).
