# Add comments to a website

Deploy your service and open its setup page. It verifies the repository, category and allowed website before generating an iframe script.

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

Install the versioned GitHub release archive in your website project:

```sh
npm install https://github.com/lumirth/giscusflare/releases/download/v1.0.0/giscusflare-1.0.0.tgz
```

Then import its public modules:

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

Call `comments.dispose()` when removing the component. For client-side navigation, call `comments.replacePage(nextPage)` with the next page's identity. Use `comments.updateAppearance({ theme: 'dark' })` for a theme change, which retains the conversation and its editors.

Native rendering uses your page's DOM and CSS context. Import `giscusflare/headless` for an independent interface. See [customization](EXTENDING.md), [API](API.md) and [package assets](PACKAGING.md).

## Content Security Policy

For iframe embedding, allow your service in your site's `script-src`, `style-src` and `frame-src`. Native rendering needs the service in `connect-src`. Images, code, math and styles in a native presentation follow your site's own policy.

Add these origins to the policy your website already uses. The service's iframe policy does not apply to content rendered directly in your page.

## Refresh and drafts

Readers see their own successful changes immediately. Reloading or refreshing fetches the current conversation, subject to the service's public cache lifetime. Returning to a stale tab or reconnecting can also refresh it. Open tabs do not repeatedly fetch comments on a timer.

Draft recovery uses local browser storage for five minutes by default. Sign-out clears recovery for the conversation. Use `data-draft-recovery="off"` on the iframe script, or `draftRecovery: false` in JavaScript, to disable it. [API options](API.md) cover refresh triggers and retention.
