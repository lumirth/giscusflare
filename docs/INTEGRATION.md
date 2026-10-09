# Add comments to a website

[Deploy and register your discussion repository](../DEPLOY.md), then use the setup page to generate an iframe embed or install the matching browser package for native rendering.

## Iframe

```html
<script
  src="https://your-comments.workers.dev/client.js?v=7"
  data-repo="you/comments"
  data-page-key="post:hello-world"
  data-theme="preferred_color_scheme"
  data-loading="lazy"
  crossorigin="anonymous"
  async>
</script>
```

When upgrading from v6, regenerate the embed or update its script URL to `client.js?v=7`. The new service versions its own fixed assets and revalidates their future requests. A previously cached unversioned third-party embed can retain its old 300-second freshness deadline; deployment cannot revoke that existing browser cache or update every already-open client. Rebuild package consumers against the matching release.

Use your service address and registered repository. The loader uses an existing `.giscus` container or creates one after the script; `data-container` selects a container by ID. It resizes the iframe as its installed layout changes. Other appearance settings are `data-lang`, `data-reactions-enabled`, `data-input-position` and `data-emit-metadata`.

## Page identity

`data-page-key` is an exact, permanent website page key. Keep it unchanged when a post's address or title changes. Without an explicit key, the loader uses the canonical pathname without its leading slash, or `index` for the home page. A first contribution can create the corresponding discussion; reading alone does not create one.

To display an existing discussion, use `data-discussion-number="123"` instead of a page key. Optional `data-discussion-id` verifies its immutable GitHub ID. Explicit discussion selection never creates a replacement when the discussion disappears. For an existing giscus site, use the known discussion number or the exact existing hash-backed page key and verify the selected discussion before switching embeds. There is no fuzzy title matching or strictness switch.

The website origin authorizes embedding. The canonical page URL resolves relative content links and supplies the discussion backlink; the return URL sends authentication back to the current page. The return URL belongs to the authorized website origin; the rendering URL can preserve a separate canonical address, including in local previews. Open-hosting embeds additionally include the `data-registration` reference returned by POST `/api/v7/registration` for the configured hosting category. Paste it into setup’s embed generator or native page options; see [open hosting](CONFIGURATION.md#offer-open-hosting).

## Native rendering

Install an archive from the chosen [release](https://github.com/lumirth/giscusflare/releases), commit its lockfile and use the matching service version:

```sh
npm install https://github.com/lumirth/giscusflare/releases/download/v7.0.0/giscusflare-7.0.0.tgz
```

```html
<div id="comments"></div>
```

```js
import { mountComments } from 'giscusflare';
import 'giscusflare/styles.css';

const comments = mountComments(document.querySelector('#comments'), {
  service: 'https://your-comments.workers.dev',
  page: {
    repo: 'you/comments',
    selector: { kind: 'page', key: 'post:hello-world' },
    origin: location.origin,
    pageURL: new URL(location.pathname, location.origin).href,
    returnURL: location.href,
  },
});
```

`mountComments` selects the stock rich-content profile and standard presentation. `comments.conversation` exposes shared reading, account, writing and contribution behavior. Call `dispose()` on removal, `replacePage(nextPage)` for client-side navigation, or `conversation.updateAppearance({ theme: 'dark' })` for a theme change. A page replacement creates a new conversation; rebind subscriptions to its returned owner.

## Choose content delivery

The native default is the stock rich-content profile. For a site-owned compiler, pass `content: preparedContent({ resources })`; [customization](EXTENDING.md) gives the complete producer/consumer example. [API](API.md#content-and-counts) defines browser rendering and replacement contracts.

## Counts on listings

```js
import { createCounts } from 'giscusflare/counts';

const counts = createCounts({ service, repo: 'you/comments', origin: location.origin });
const stop = counts.subscribe('post:hello-world', observation => {
  badge.textContent = String(observation.count);
});
// On removal: stop(); counts.dispose();
```

A string subscription selects the exact page’s root count. Pass a typed `CountTarget` to select explicit discussions or a parent’s reply count; `countKey(target)` supplies their shared map identity. The lightweight capability owns batching, expiry, newer-observation precedence and optional same-tab storage. Conversations automatically publish accepted root observations to the same scoped owner. A failed request establishes neither zero nor a new observation. Hosts only paint labels and badges.

## Content Security Policy

Iframe embedding needs the service in `script-src`, `style-src` and `frame-src`; native rendering needs it in `connect-src`. Profile styles, modules, images and optional browser compilers follow the website's own CSP. The service iframe's policy does not apply to DOM installed directly in your page.

## Navigation and recovery

Call `dispose()` when the mount leaves the page. For client-side navigation, use `replacePage(nextPage)` and rebind subscriptions to the returned owner. Set `writingRecovery: false` or `data-writing-recovery="off"` to disable retention. [API](API.md#actions-reactions-and-session) describes independent records, original-author retries and recovery commands.
