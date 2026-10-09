# Customize comments

Choose service content delivery, browser rendering and presentation separately. `mountComments` supplies the standard interface and GitHub defaults. `mountPresentation` uses your interface; `createConversation` supplies the browser page owner for a framework. Both headless paths require explicit `contentSource` and `content`. `giscusflare/model` supplies the same portable owner without browser adapters.

## Choose content rendering

| Delivery | Browser renderer | Use |
| --- | --- | --- |
| `contentSource: 'github'` | `githubContent()` | Default safe GitHub HTML, code and math |
| `contentSource: 'prepared'` | `preparedHTML()` | Trusted deployed host's HTML and required resources |
| `contentSource: 'source'` | Your renderer | Browser preparation from canonical Markdown |

Delivery controls HTTP acquisition, independently of renderer implementation. The renderer receives original Markdown, `purpose: 'comment' | 'preview'`, repository, page URL and optional comment identity/draft, alongside delivered `html` or `prepared` data. `revision` can identify changed external browser inputs. Canonical GitHub Markdown stays authoritative even when a host dialect displays it differently.

## Prepare content in your deployment

A custom Worker can install a trusted portable producer in the existing repository Durable Object:

```js
import worker, { createRepository } from 'giscusflare/worker';
import { prepareComment } from './site-comments.js';

const revision = 'comments-2026-10-08';
export const Repository = createRepository({
  content: {
    revision,
    async prepare(input, signal) {
      // This pipeline constrains untrusted commenter HTML, URLs and extensions.
      const html = await prepareComment(input.markdown, { signal });
      return {
        html,
        revision,
        resources: {
          styles: ['https://your-site.example/assets/comments-content.css'],
          scripts: ['https://your-site.example/assets/comments-content.js'],
        },
      };
    },
  },
});
export default worker;
```

Keep the deployment's existing Durable Object class name, binding and migration history. The producer receives portable `ContentInputData`, not DOM or viewer credentials. It returns `{ html, revision, resources? }`, where optional resources contain `styles` and `scripts` URL arrays. The producer owns safe interpretation: do not reuse article-author permissions for commenter input. The browser trusts prepared HTML and resource references from this configured producer rather than reinterpreting its source.

Change the producer revision whenever interpretation or required resources change. The repository object validates the producer configuration before reuse, coalesces concurrent work and persists eligible artifacts for 24 hours in its existing store. Persistence is bounded to 8 MiB/256 items per object; an item is eligible only when its UTF-8 JSON fits 1 MiB. Valid output can still be delivered if it is too large to retain or cache storage fails. Preparation reuse is independent of viewer state. No additional service or cache platform is required. Prepared preview uses this same producer anonymously, subject to repository and website policy.

```js
import { mountComments } from 'giscusflare';
import { preparedHTML } from 'giscusflare/content';
import 'giscusflare/styles.css';

const comments = mountComments(target, {
  service: 'https://your-comments.workers.dev',
  page: { repo: 'you/comments', origin: location.href, term: 'post:hello-world' },
  contentSource: 'prepared',
  content: preparedHTML(),
});
```

The renderer loads required styles and module scripts before installing output. Resource references follow the host's CSP. Content styling belongs to the selected producer/renderer; standard presentation styling supplies surrounding layout and controls.

## Prepare source in the browser

```js
const content = async (input, { signal, lifetime }) => {
  const node = await siteMarkdown.renderComment(input.markdown, { signal });
  signal.throwIfAborted();
  // Bind persistent controls to lifetime, which ends when this output retires.
  bindCopyControls(node, lifetime);
  return node;
};
const comments = mountComments(target, {
  service: 'https://your-comments.workers.dev',
  page: { repo: 'you/comments', origin: location.href, term: 'post:hello-world' },
  contentSource: 'source',
  content,
});
```

Custom returned DOM is not sanitized again. The renderer owns commenter-safe source interpretation, styles and resources. Source rendering can preview locally without a provider request or sign-in. `context.providerHTML()` and `context.preparedContent()` expose the explicitly selected delivery when needed; they do not change the conversation's delivery mode.

## Preparation and installed lifetime

A `ContentRenderer` returns a `Node`, a promise of one, or `{ node, update?, dispose? }`. `context.signal` cancels one preparation generation. `context.lifetime` belongs to installed output and remains active while a newer generation prepares. Keep persistent controls/resources on the lifetime signal.

For a mounted framework, `update(input, context)` prepares the next revision without changing the live tree, then returns a commit callback (or a promise of one). `mountContent` invokes that callback only if the generation is still current. `dispose()` releases the mounted framework. Unchanged input retains output; changing `revision` forces preparation when external inputs changed. Late output cannot install after replacement or retirement.

```js
import { mountContent } from 'giscusflare/content';

const body = mountContent(target, conversation.content, {
  signal: scope.signal,
  preview: (input, signal) => conversation.preview(input.markdown, signal, input.draft),
});
await body.update({
  markdown: comment.body,
  html: comment.bodyHTML,
  prepared: comment.prepared,
  purpose: 'comment',
  repo: conversation.config.repo,
  pageURL: conversation.config.origin,
  comment: { id: comment.id, url: comment.url, parentId: comment.parentId },
});
// Retire this body when it leaves the presentation.
body.dispose();
```

`mountContent` serves both published bodies and previews. `clear()` cancels work and removes installed output. An update failure rejects so the host can report it; the last installed output stays available. When there is no installed output, original Markdown remains readable text.

## Replace built-in features

```js
import { githubContent } from 'giscusflare/content/github';
import 'giscusflare/content.css';

const content = githubContent({
  code({ source, language, origin, file }, { signal, lifetime }) {
    return siteCode.render({ source, language, origin, file, signal, lifetime });
  },
  math: false,
});
```

Use this with `contentSource: 'github'`. `githubContent()` sanitizes provider HTML and supplies code copy controls and math by default. Code replacements receive fence source/language or GitHub file source-link metadata. They own the whole feature, including frame and controls. Math replacements receive `{ source, display }` and own the expression. Both support asynchronous or mounted output through the same lifetime contract. Failed enhancement leaves sanitized readable source.

`code: false` retains sanitized code without default frames/controls; `math: false` retains readable TeX without loading the built-in math renderer; `copy: false` disables the default copy control. Custom feature renderers own their own copy behavior. `labels` supplies `copy`, `copied`, `copyFailed` and `mathFailed` text.

`giscusflare/content.css` supplies built-in structural code/copy, image, math overflow and fallback rules for `.markdown`; website typography remains yours. The standard default uses those rules. Complete host content does not require this stylesheet. The content rules use Primer variables and their giscus theme aliases; presentation layout does not choose your content compiler or typography.

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
const comments = mountPresentation(target, { ...options, contentSource: 'source', content }, presentation);
```

Register cleanup when acquiring resources, since construction can fail. `scope.own()` returns an idempotent early release; `scope.signal` retires presentation work. `conversation.own()` and `conversation.signal` cover the page. `replacePresentation()` preserves reading and writing; `replacePage()` retires both, so rebind observers to the new `comments.conversation`.

The [forum example](https://github.com/lumirth/giscusflare/blob/main/examples/forum.ts) uses the same owners as the standard interface. `actions(id)` supplies authority, pending and recovery availability. `reaction(id, name)` supplies confirmed and desired state for a reaction control. `acquisition()` identifies reading purpose. Hosts choose labels/icons/placement without rebuilding a private operation registry.

## Add a composer

```js
import { createEditor } from 'giscusflare/interactions';

const writing = conversation.writing({ kind: 'reply', id: rootId }).show();
const submit = document.createElement('button');
submit.type = 'submit';
submit.textContent = 'Publish';
const editor = createEditor(conversation, writing, {
  signal: scope.signal,
  render(editor) {
    if (!editor.form.hasChildNodes()) {
      editor.form.append(editor.textarea, editor.previewElement, submit);
    }
    submit.disabled = !(writing.actions.submit || writing.actions.retry || writing.actions.signIn);
    editor.textarea.hidden = editor.mode === 'preview';
    editor.previewElement.hidden = editor.mode === 'write';
  },
});
host.append(editor.form);
```

The editor owns native input, shortcuts, submission and preview. Keep its actual textarea and preview element in the form, and retain nodes through unrelated updates to preserve native selection/undo. A framework can use the writing owner directly instead. Persistent intent outlives editor DOM. Await `conversation.recovery.ready`, present `conversation.recovery.records()` and call `conversation.recovery.restore(id)` for the chosen record. That selects and opens the writer while respecting another context's record claim. See [writing commands](API.md#writing) for selection, original-author retry and deliberate abandonment.

## Replace standard controls

`mountComments` accepts `header`, `composer` and `reactions` slots through `StandardParts`. Slots return text, a DOM node or a supported `lit-html` template:

```js
import { html } from 'lit-html';

const comments = mountComments(target, options, {
  header(context, comment) {
    return html`<a href=${comment.author?.url ?? comment.url}>${comment.author?.login ?? 'Deleted user'}</a>`;
  },
});
```

Templates retain nodes. Imperative slots should return the same owned node per logical instance when native history matters. Use `context.scope.own(cleanup)` for acquired resources and retire removed bodies independently. `updateAppearance()` retains reading and writing. Native styles obey the website CSP; custom iframe themes need an [allowed CSS origin](CONFIGURATION.md#custom-theme-css).
