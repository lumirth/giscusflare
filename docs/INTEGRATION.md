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

Version 4 is currently a release candidate. To use this checkout, build it with `npm ci && npm run build`, create its archive with `npm pack`, and install that archive in your website project.

```sh
npm install /path/to/giscusflare-4.0.0.tgz
```

[GitHub releases](https://github.com/lumirth/giscusflare/releases) contain published package archives. Use matching service and browser versions; do not combine this version 4 browser build with the released version 3 service.

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

## Reading and writing recovery

Readers see confirmed changes through canonical observations. Returning to a stale tab or reconnecting can observe already loaded content without resetting reading progress. Deliberate restart or changing order starts a new traversal. Public cache lifetime still applies; open tabs do not poll on a timer.

Ordinary writing recovery uses local browser storage for five minutes by default. Snapshots containing pending or unresolved issued submissions do not expire through that retention policy and survive sign-out. They preserve destination, original body, receipt key and author until the outcome is known or recovery is deliberately abandoned. Storage remains best effort. Use `data-writing-recovery="off"` on the iframe script, or `writingRecovery: false` in JavaScript, to disable storage. In-memory writing remains owned by its page. [API options](API.md) cover reading triggers and retention.
