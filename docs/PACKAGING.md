# Package and deployment assets

For a custom website interface, install the browser package using [native integration](INTEGRATION.md#native-rendering). That guide includes archive installation and a mounting example. When upgrading, install the archive for the chosen release, commit your lockfile and rebuild the website. Follow its release notes for matching service updates.

## Choose an import

| Import | Use it for |
| --- | --- |
| `giscusflare` | Mounting the default interface or replacing its components |
| `giscusflare/styles.css` | Styling the default interface in your page |
| `giscusflare/headless` | Building a complete custom interface |
| `giscusflare/interactions` | Connecting composers and menus to your controls |
| `giscusflare/content` | Shared content mounting and renderer contracts |
| `giscusflare/content/github` | Optional GitHub HTML interpretation, code and math defaults/replacements |
| `giscusflare/content.css` | Built-in content structure without the standard comments layout |
| `giscusflare/worker` | Building a custom Worker deployment |
| `giscusflare/assets` | Copying the static files that deployment needs |

## Build a custom Worker

The [deploy button](../DEPLOY.md) supplies the standard service and assets. If you maintain a separate Worker build, copy the asset groups you need:

```js
import { copyAssets } from 'giscusflare/assets';

await copyAssets('worker-assets', ['auth', 'setup', 'iframe']);
```

Point Wrangler's `assets.directory` at `worker-assets`. Each group includes its required JavaScript chunks.

| Group | Contents |
| --- | --- |
| `auth` | Sign-in pages, scripts, styles and HTTP headers |
| `setup` | Deployment setup page and its logo |
| `iframe` | Default iframe interface, embed loader and themes |
| `native` | Default interface as browser modules and scoped styles |
| `headless` | Conversation API as browser modules |
| `content` | Optional GitHub content renderer, its lazy dependencies and independent styles |

For a service used only by your native custom interface, select `auth` and `setup`. Add `iframe` to offer the default embed too. Bundle your custom interface with your website.

Start with an empty generated asset directory on each build. `copyAssets` preserves unrelated files, so reusing an old directory can leave obsolete chunks behind. The exported `assetManifest` lists paths, sizes and SHA-256 hashes for checking the output.

## Build and check a release package

`npm run build` produces Worker and browser bundles, type declarations and static assets under `dist/assets`. `npm run build:test` also builds local examples and simulated sign-in.

Run `npm run test:package` to extract the archive outside the checkout and check its public imports and selected assets. The check verifies public entry points and that development assets stay out of the package. Headless consumers explicitly select content and import no default UI or content interpretation.
