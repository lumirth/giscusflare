# A site-owned comment profile

This example uses the site's safe comment compiler and code resources with the standard presentation. [Integration](INTEGRATION.md) covers installation and embedding; [API](API.md) defines the customization contracts. For a complete custom interface, adapt [the forum example](../examples/forum.ts).

## Prepare content in your deployment

Deploy an internal producer alongside the API:

```js
// comments-worker.js
export { default, Repository } from 'giscusflare/worker';
```

```js
// content-worker.js
import { createContentWorker } from 'giscusflare/content/worker';
import { compileComment } from './comment-compiler.js';
import resources from './comment-resources.js';

const revision = 'comments-2026-10-08';
export default createContentWorker({
  revision,
  async prepare(input, signal) {
    const result = await compileComment(input, signal);
    return {
      html: result.html,
      ...(result.needsCode ? { resources: resources.revision } : {}),
      anchorPrefixes: ['comment-footnote-'],
    };
  },
});
```

`compileComment` is the site's commenter-safe compiler. Give it canonical source and context, and interpret once. Trusted article extensions must not grant commenters script, URL or authoring permissions. The factory stamps its configured revision on results; the compiler supplies HTML and resource requirements. The producer receives no commenter credentials or Repository storage. Its factory bounds batches, concurrency and disposable artifact reuse; a cold isolate prepares again.

Keep this Worker internal and add its service binding to the API configuration:

```json
"services": [{ "binding": "CONTENT", "service": "your-comment-content" }]
```

For the supplied stock compiler, export the default from `giscusflare/content/worker/stock` instead; `npm run deploy:content` uses the included stock configuration. [Deployment](../DEPLOY.md) owns setup and [operations](OPERATIONS.md) owns updates and rollback.

## Mount published bodies

Generate one resource manifest from the code compiler: its fingerprint and immutable styles/scripts paths. Resolve those paths at the consuming website's origin:

```js
import { mountComments } from 'giscusflare';
import { preparedContent } from 'giscusflare/content';
import 'giscusflare/styles.css';
import manifest from './comment-resources.js';

const resources = {
  ...manifest,
  styles: manifest.styles.map(path => new URL(path, location.origin).href),
  scripts: manifest.scripts.map(path => new URL(path, location.origin).href),
};
const comments = mountComments(document.querySelector('#comments'), {
  service: 'https://your-comments.workers.dev',
  page: {
    repo: 'you/comments',
    selector: { kind: 'page', key: 'post:hello-world' },
    origin: location.origin,
    pageURL: new URL(location.pathname, location.origin).href,
    returnURL: location.href,
  },
  content: preparedContent({ resources }),
});
```

Publish the immutable resources, producer and consuming website together. Interpretation revision identifies compiler/trust-policy changes; resource revision identifies the actual style/module graph. A code body declares that fingerprint, while prose can remain readable without code resources. Old open pages reject incompatible fingerprints before installation and offer Reload. [API content contracts](API.md#content-and-counts) cover readiness, enhancement failure and installed lifetimes.

A custom presentation binds each canonical comment directly:

```js
const body = conversation.content.mount(target, comment, {
  signal: scope.signal,
  onReady(ready) { card.hidden = !ready; },
});
```

Accepted changes update this binding automatically. Dispose the mount when its card leaves the view. Preview/custom input uses the same owner with `{ markdown, purpose, draft? }`; a [shared editor](API.md#actions-reactions-and-session) owns its form, textarea and preview. Keep those nodes through unrelated redraws to preserve native selection and undo.

For interactive diagrams or framework views, retain mounted output and prepare optional in-place updates with the [renderer contract](API.md#content-and-counts). Preparation must leave the installed tree usable until the shared owner commits the current result. For deliberate browser compilation or code/math replacement, use the same API contracts rather than a second acquisition/cache layer.
