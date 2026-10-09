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

Install the package archive from the chosen [GitHub release](https://github.com/lumirth/giscusflare/releases), then commit your lockfile and rebuild your website:

```sh
npm install https://github.com/lumirth/giscusflare/releases/download/v5.0.0/giscusflare-5.0.0.tgz
```

Use matching Worker and browser versions. For a local source build, run `npm ci && npm run build`, run `npm pack`, and install the resulting archive in your website project.

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

## Choose content delivery

The default native mount uses GitHub HTML with the built-in safe renderer and code/math features. To use content prepared by your deployed host, choose both the delivery mode and the DOM renderer:

```js
import { mountComments } from 'giscusflare';
import { preparedHTML } from 'giscusflare/content';

const comments = mountComments(target, {
  service: 'https://your-comments.workers.dev',
  page: { repo: 'you/comments', origin: location.href, term: 'post:hello-world' },
  contentSource: 'prepared',
  content: preparedHTML(),
});
```

The Worker must provide the trusted producer. It prepares published bodies and anonymous previews; canonical GitHub Markdown stays available. The selected content owns its styles and resource references. See [customization](EXTENDING.md#prepare-content-in-your-deployment) for the producer setup. A browser Markdown renderer instead selects `contentSource: 'source'` with its own `content` function.

## Content Security Policy

For iframe embedding, allow the service in your website's `script-src`, `style-src` and `frame-src`. Native rendering needs the service in `connect-src`. Images, code, math, styles and modules in a native presentation follow your website's policy. Prepared resources must be allowed by `style-src` and `script-src` as appropriate.

Add these origins to your existing policy. The service iframe's policy does not apply to content installed directly in your page.

## Reading and writing recovery

Confirmed contributions apply their operation-owned changes immediately. Returning to a stale tab or reconnecting can observe loaded content without resetting reading progress. Deliberate restart or order changes start a new traversal. Public cache lifetime still applies; open tabs do not poll on a timer.

Browser recovery retains independent writing records, including several records for one destination. Recovery controls let the reader select a record explicitly. Ordinary records expire after five minutes by default; unresolved issued submissions remain protected through ordinary retention and sign-out. They preserve original target, body, key and author until a known outcome or explicit abandonment. Storage is best effort. Disable it with `data-writing-recovery="off"` on the iframe script or `writingRecovery: false` in JavaScript. [API options](API.md) cover triggers, retention and recovery selection.
