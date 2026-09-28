# Customize the interface

Choose a theme in your service's setup page, or edit `data-theme` in your embed code. For a custom layout or controls, use the JavaScript integration below.

| What you want to change | Use |
| --- | --- |
| Theme, language or composer position | `appearance` options on `mountComments` |
| Comment headers, composers or reaction controls | Component factories passed to `mountComments` |
| The whole interface | `mountPresentation` with your own `Presentation` |
| Rendering in your site's framework | `createConversation` and a subscription |

Start with [native JavaScript embedding](INTEGRATION.md#native-rendering) to install and mount the browser package.

## Change appearance

Pass `appearance` when mounting comments, or update an existing mount:

```js
comments.updateAppearance({
  theme: 'dark',
  inputPosition: 'top',
});
```

See [API options](API.md#options) for theme, language and reaction settings. To load your own theme CSS in an iframe, configure its [allowed origin](CONFIGURATION.md#custom-theme-css).

## Replace a component

Pass component factories as the third argument to `mountComments`. The available replacements are `header`, `composer` and `reactions`. For example, this header displays the author's name as a link:

```js
import { mountComments } from 'giscusflare';
import 'giscusflare/styles.css';

const comments = mountComments(document.querySelector('#comments'), {
  service: 'https://your-comments.workers.dev',
  page: { repo: 'you/comments', origin: location.href, term: 'post:hello-world' },
}, {
  header() {
    const element = document.createElement('a');
    return {
      element,
      update({ comment }) {
        element.textContent = comment.author?.login ?? 'Deleted user';
        element.href = comment.author?.url ?? comment.url;
      },
      dispose() { element.remove(); },
    };
  },
});
```

Each factory returns an element, an `update` function and a `dispose` function. giscusflare calls `update` with the current data and `dispose` when removing the component. Factories receive a context whose `runtime` is the conversation and whose `report(error)` method displays an error.

The exported `StandardParts` type describes the inputs for each replacement.

## Build a presentation

The [forum demo](https://giscusflare.kukas.me/#try-it) uses a complete custom interface. Its [source](../examples/forum.ts) shows comment rendering, reactions, menus and composers; its [stylesheet](../website/forum.css) controls the layout.

Implement `Presentation.mount(target, conversation)`. Render into `target` and return `update(appearance)` and `dispose()` methods. Mount it with:

```js
import { mountPresentation } from 'giscusflare/headless';
import { forumPresentation } from './forum.js';

const comments = mountPresentation(document.querySelector('#comments'), {
  service: 'https://your-comments.workers.dev',
  page: { repo: 'you/comments', origin: location.href, term: 'post:hello-world' },
}, forumPresentation);
```

Read `conversation.state` and subscribe to changes. Use comment IDs as component keys and update existing elements when their data changes. Keep active textareas mounted so typing, selection and browser undo continue to work during updates.

Remove your listeners and subscriptions in the presentation's `dispose()`. The mounting function disposes the conversation itself. For a framework component that manages its own lifecycle, use [`createConversation`](API.md#create-or-mount) directly and dispose it when that component unmounts.

## Add a composer

Create a form and textarea in your interface, then connect them with `bindComposer`:

```js
import { bindComposer } from 'giscusflare/interactions';

const composer = bindComposer(conversation, 'main', { form, textarea });
const stop = composer.subscribe(() => {
  submitButton.disabled = composer.state.pending;
  errorLabel.textContent = composer.state.error;
});
```

The binding handles input, submission, keyboard shortcuts, sign-in and drafts. Use its `write()` and `preview()` methods for editor tabs. Render `state.previewHTML` and `state.previewBody` through `conversation.renderContent()`.

For a reply, call `conversation.beginReply(rootId)` and pass the returned editor name to `bindComposer`. Use `conversation.beginEdit(comment)` for editing. The main composer's name is `main`.

Close a reply or edit form when `composer.state.submission` is `succeeded`. Keep it open on failure so the reader can retry. Keep the textarea mounted while switching between Write and Preview. When removing the form, call `stop()` and `composer.dispose()`.

## Render comment content

Append the fragment returned by `conversation.renderContent(comment.bodyHTML, comment.body)`. This sanitizes GitHub's HTML and adds code and math rendering.

Use `createContentRenderer` from `giscusflare/content` to supply your own code or math renderer. If you replace HTML rendering altogether, sanitize untrusted comment content before inserting it into the page. Native styles and external assets follow your website's Content Security Policy.

See the [API reference](API.md) for state and commands, including pagination and sorting. [Package assets](PACKAGING.md) covers custom service builds.
