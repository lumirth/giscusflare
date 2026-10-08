# Customize the interface

Use [native integration](INTEGRATION.md#native-rendering) to install the browser package. Appearance settings change themes, language, reactions and composer position. `mountComments` accepts replacements for its header, composer and reactions. `mountPresentation` supplies a complete custom interface; `createConversation` integrates with a framework’s lifecycle.

## Change appearance

```js
comments.conversation.updateAppearance({ theme: 'dark', inputPosition: 'top' });
```

Appearance changes use the same conversation subscription as content changes and retain the current editors. A custom iframe theme must come from an [allowed CSS origin](CONFIGURATION.md#custom-theme-css). Native styles follow the website’s own Content Security Policy.

## Replace a component

Standard slots return renderable values, rather than objects with separate element/update/dispose methods:

```js
import { mountComments } from 'giscusflare';
import { html } from 'lit-html';
import 'giscusflare/styles.css';

const comments = mountComments(document.querySelector('#comments'), options, {
  header(context, comment) {
    return html`<a href=${comment.author?.url ?? comment.url}>${comment.author?.login ?? 'Deleted user'}</a>`;
  },
});
```

Slots are rendering callbacks invoked on each view update, not once-created component factories. A `TemplateResult` lets the renderer retain its nodes; use `lit-html` as a direct application dependency when writing template slots. An imperative slot must return the same owned Node or `Editor.form` per logical instance when native history matters. Returning a fresh HTMLElement intentionally replaces it and does not preserve its editing history.

The exported `StandardParts` type describes each slot’s input. Return a DOM node, text or supported template value. Use `context.scope.own(cleanup)` for view resources. Elements removed earlier need their renderer’s own disposal path. Preserve an active composer’s DOM across updates so native typing, selection and undo continue to work.

## Build a presentation

A `Presentation` is a function `(target, conversation, scope) => void`. It subscribes to the actual page and registers acquired view resources with `scope`:

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
const comments = mountPresentation(document.querySelector('#comments'), options, presentation);
```

`scope.own()` returns an idempotent release function for early removal. Register cleanup immediately after acquisition: construction can fail before the presentation finishes. `scope.signal` cancels view work. `comments.replacePresentation(nextPresentation)` retires the old view while preserving the same page, drafts, order and loaded state. Replacing a page or disposing the mount retires both; a retained old conversation never acts on its replacement. `conversation.signal` and `.own()` cover resources that belong to the whole page.

The [forum example](https://github.com/lumirth/giscusflare/blob/main/examples/forum.ts) demonstrates a complete framework-neutral interface. Its [stylesheet](https://github.com/lumirth/giscusflare/blob/main/website/forum.css) controls presentation. For client-side navigation, read `comments.conversation` when an event handler runs; use `comments.replacePage(nextPage)` to replace the page and bind any page observer to the new conversation. The mount has no separate subscription registry.

## Add a composer

```js
import { createEditor } from 'giscusflare/interactions';

const submit = document.createElement('button');
submit.type = 'submit';
submit.textContent = 'Publish';
const error = document.createElement('p');
const editor = createEditor(conversation, 'main', {
  signal: scope.signal,
  render(editor) {
    if (!editor.form.hasChildNodes()) {
      editor.form.append(editor.textarea, editor.previewElement, error, submit);
    }
    submit.disabled = editor.pending;
    error.textContent = editor.error;
    editor.textarea.hidden = editor.mode === 'preview';
    editor.previewElement.hidden = editor.mode === 'write';
  },
});
host.append(editor.form);
```

The editor owns its actual DOM, input, submission, shortcuts, authentication interaction and preview generation. Its render hook projects that component's state into your markup. Use `write()` and `preview()` for tabs; insert `previewElement` directly because the editor owns its sanitization and asynchronous enhancements. Keep its textarea mounted while switching modes. There is no separate binding subscription or preview-HTML channel.

`beginReply(rootId)` and `beginEdit(comment)` return editor names for `createEditor`. The conversation closes reply/edit editors after confirmed success; render active forms from `conversation.drafts` entries whose `editor` is present. These forms belong to writing, independently of the current `document.roots` and `document.replies` reading windows. Keep them mounted across refresh and order changes even when their target disappears from those windows. Retain writing and retry identity when the outcome is uncertain. Call `editor.dispose()` when removing it early; the supplied view signal also retires it. For local writing before authentication, pass `draftWhileSignedOut: true` in the options. Submission then starts sign-in and retains the draft without automatically posting it.

## Render comment content

`conversation.renderContent(comment.bodyHTML, comment.body, signal)` returns sanitized content with code and math enhancements. Pass a signal for the rendered body’s lifetime; abort it when replacing that body. The view signal is sufficient only when the content remains mounted for the whole view.

`createContentRenderer` from `giscusflare/content` accepts trusted custom code/math renderers. Their supplied signal bounds asynchronous work. If replacing sanitization itself, ensure untrusted HTML cannot execute. Rendering failures should retain readable source. See [API](API.md) for document, commands and options.
