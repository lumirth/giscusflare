# A site-owned comment profile

This example uses the site's safe comment compiler and code resources with the standard presentation. [Integration](INTEGRATION.md) covers installation and embedding; [API](API.md) defines the customization contracts. For a complete custom interface, adapt [the forum example](../examples/forum.ts).

## Prepare content in your deployment

Deploy an internal producer alongside the API:

```js
export { default, Repository } from 'giscusflare/worker';
```

```js
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

`compileComment` must enforce a commenter-safe policy even if the site's article compiler supports trusted scripts or authoring extensions. The factory stamps its revision; the compiler returns HTML and resource requirements under the [producer contract](API.md#content-and-counts). Prepared output is trusted, not sanitized again at installation.

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
const target = document.getElementById('comments');
if (!target) throw new Error('Add #comments before mounting.');
const comments = mountComments(target, {
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

Publish immutable resources, producer and consuming website together. Change interpretation revision for compiler/trust-policy changes and resource revision for a changed style/module graph. Old pages offer Reload on incompatible fingerprints; see [content contracts](API.md#content-and-counts) and [publication/rollback](OPERATIONS.md#update-and-restore).

A custom presentation binds each canonical comment directly:

```js
const body = conversation.content.mount(target, comment, {
  signal: scope.signal,
  onReady(ready) { card.hidden = !ready; },
});
```

Accepted changes update this binding automatically. Dispose the mount when its card leaves the view. Use the [shared editor](API.md#writing) for preview/input and retain its native nodes through unrelated redraws to preserve selection and undo. Interactive diagrams, whole-body updates and browser code/math replacement use the [renderer contract](API.md#content-and-counts), not another acquisition/cache layer.
