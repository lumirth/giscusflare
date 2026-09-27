# Customize the interface

Use the default presentation as a starting point, or render the conversation with your own components. Both use the same JavaScript API for sign-in, drafts, submissions, reactions and pagination.

| What you want to change | Start here |
| --- | --- |
| Theme, language or composer position | `appearance` options on `mountComments` |
| A header, composer, reaction control or action menu | Component factories passed to `mountComments` |
| The whole interface | `mountPresentation` with your own `Presentation` |
| Rendering in a framework you already use | `createConversation` and a subscription |

Install the [release package](INTEGRATION.md#native-rendering) in your website before importing these modules.

## Replace a component

Pass component factories as the third argument to `mountComments`. A factory receives the shared conversation and returns an element, an update function and a disposal function. The host calls update as its data changes.

The public `StandardParts` type describes each factory's inputs. Use it to replace only the parts that need your own markup. Import `giscusflare/styles.css` when retaining the default presentation's styles.

## Build a presentation

[The forum example](../examples/forum.ts) has its own markup and styles. It imports only `giscusflare/headless` and uses normalized comment data, keyed reactions and shared composer bindings.

A presentation implements `mount(target, conversation)`, returning `update(appearance)` and `dispose()`. It owns its DOM, subscriptions and listeners. The host owns the conversation object.

```js
import { mountPresentation } from 'giscusflare/headless';
import { forumPresentation } from './forum.js';

const comments = mountPresentation(document.querySelector('#comments'), {
  service: 'https://your-comments.workers.dev',
  page: { repo: 'you/comments', origin: location.href, term: 'post:hello-world' },
}, forumPresentation);
```

Render from `conversation.state`. Use comment IDs as component keys so a reaction update does not replace a textarea or another active control. Apply state updates to existing elements and keep editor forms mounted while their surrounding comments change.

## Share composer behavior

Create your form and textarea, then bind them:

```js
import { bindComposer } from 'giscusflare/interactions';

const composer = bindComposer(conversation, 'main', { form, textarea });
const stop = composer.subscribe(() => {
  submitButton.disabled = composer.state.pending;
  errorLabel.textContent = composer.state.error;
});
```

The binding handles input, submission, keyboard shortcuts, sign-in and draft changes. Its `write()` and `preview()` methods control the editing mode. Render `state.previewHTML` and `state.previewBody` through `conversation.renderContent()` for the same content handling as comments.

Use `conversation.beginReply(rootId)` or `conversation.beginEdit(comment)` to open another editor. Each returns the name to pass to `bindComposer`. The main composer uses `main`.

Keep the textarea mounted while switching between write and preview. In `dispose()`, call `stop()` and `composer.dispose()`. Dispose the conversation only if your component created and owns it.

## Render content

`conversation.renderContent(html, markdown)` returns a DOM fragment. The default renderer sanitizes comment HTML and adds the supplied code and math behavior. Use `createContentRenderer` from `giscusflare/content` to choose its content profile or supply your own code and math renderers.

Custom renderer code runs in your page. Keep HTML sanitization when replacing the renderer. Iframe themes can use the service's approved CSS origins; native styles follow the host page's policy.

The [API reference](API.md) lists options, state and commands. [Package assets](PACKAGING.md) explains how to build an independently deployed custom presentation without copying source files.
