# Add comments to a website

After [deploying your service](../DEPLOY.md), use its setup page to generate an iframe embed. For a site that bundles JavaScript, you can instead [mount comments directly in the page](#native-rendering).

## Iframe

Paste the generated script where comments should appear:

```html
<script
  src="https://your-comments.workers.dev/client.js"
  data-repo="you/comments"
  data-category="Announcements"
  data-mapping="pathname"
  data-strict="1"
  data-theme="preferred_color_scheme"
  data-loading="lazy"
  crossorigin="anonymous"
  async>
</script>
```

Use your actual service address and repository. The setup output also includes verified repository and category IDs.

The loader uses an existing `.giscus` container or creates one after the script. `data-container` selects a container by its ID. The iframe resizes as the conversation changes.

## Page identity

Choose how each website page finds its GitHub discussion. `pathname` uses the page path. Use `specific` with a permanent post ID if URLs may change, or `number` to show an existing discussion.

| Mapping | Discussion lookup |
| --- | --- |
| `pathname` | Path without its leading slash or final file extension; the home page uses `index` |
| `url` | Page URL without its fragment or `giscus` query parameter |
| `title` | Document title |
| `og:title` | Open Graph title |
| `specific` | The supplied `data-term` |
| `number` | The existing discussion number supplied in `data-term` |

A stable identifier is useful when pages move. For example, `data-mapping="specific" data-term="post:hello-world"` keeps the conversation attached to that post when its URL or title changes.

Strict matching searches for the identifier's hash in the discussion body. Number mapping selects one existing discussion and never creates a replacement. For an existing giscus site, preserve its mapping and strict setting until you have verified the same discussion loads.

## Native rendering

The 3.0 API is currently an unreleased local candidate. Build and pack this checkout:

```sh
npm run build
npm pack
```

Install the resulting archive in your website project:

```sh
npm install /path/to/giscusflare/giscusflare-3.0.0.tgz
```

For an existing 2.x installation, follow the [3.0 migration table](API.md#migrating-from-2x) when updating your calls. Published 2.x archives remain available from [GitHub releases](https://github.com/lumirth/giscusflare/releases).

Add a container where comments should appear:

```html
<div id="comments"></div>
```

Mount the interface from your website's JavaScript:

```js
import { mountComments } from 'giscusflare';
import 'giscusflare/styles.css';

const comments = mountComments(document.querySelector('#comments'), {
  service: 'https://your-comments.workers.dev',
  page: {
    repo: 'you/comments',
    origin: location.href,
    term: 'post:hello-world',
    strict: true,
  },
});
```

Use `comments.conversation` for state and contribution commands. Use a different `term` for each post. Call `comments.dispose()` when removing the component. For client-side navigation, call `comments.replacePage(nextPage)` with the next page's identity. To change themes, call `comments.conversation.updateAppearance({ theme: 'dark' })`.

Style the container in your page to set its width and outer spacing. See [customization](EXTENDING.md) to replace components or build a different interface, and the [API reference](API.md) for options and methods.

## Content Security Policy

For iframe embedding, allow your service in your site's `script-src`, `style-src` and `frame-src`. Native rendering needs the service in `connect-src`. Images, code, math and styles in a native presentation follow your site's own policy.

Add these origins to the policy your website already uses. The service's iframe policy does not apply to content rendered directly in your page.

## Refresh and drafts

Readers see their own successful changes immediately. Reloading or refreshing fetches the current conversation, subject to the service's public cache lifetime. Returning to a stale tab or reconnecting can also refresh it. Open tabs do not repeatedly fetch comments on a timer.

Draft recovery uses local browser storage for five minutes by default. Sign-out clears recovery for the conversation. Use `data-draft-recovery="off"` on the iframe script, or `draftRecovery: false` in JavaScript, to disable it. [API options](API.md) cover refresh triggers and retention.
