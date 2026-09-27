# Package and deployment assets

Install the browser and Worker modules from the GitHub release archive:

```sh
npm install https://github.com/lumirth/giscusflare/releases/download/v1.0.0/giscusflare-1.0.0.tgz
```

With npm 12, add `--allow-remote=root` to this command to allow the release URL. See [npm's URL dependency setting](https://docs.npmjs.com/cli/install/#allow-remote).

The release tag, archive and package manifest use the same version. Keep the archive URL in your package manifest and commit your package-manager lockfile. To upgrade, install the archive for the chosen release, rebuild your website and redeploy its service together.

The package exports the default presentation as `giscusflare`, conversation behavior as `giscusflare/headless`, composer bindings as `giscusflare/interactions`, content rendering as `giscusflare/content`, and the service as `giscusflare/worker`.

Custom deployments select static assets through `giscusflare/assets`:

```js
import { copyAssets } from 'giscusflare/assets';

await copyAssets('worker-assets', ['auth', 'setup', 'iframe']);
```

Point Wrangler's `assets.directory` at that output directory. These groups include their required JavaScript chunks.

| Group | Contents |
| --- | --- |
| `auth` | Sign-in pages, scripts, styles and HTTP headers |
| `setup` | Deployment setup page and its logo |
| `iframe` | Default iframe presentation, embed loader and themes |
| `native` | Default presentation as browser modules and scoped styles |
| `headless` | Conversation API as browser modules |

A native custom presentation needs `auth` and `setup` on its service. Add `iframe` if the same service also offers the default iframe. Bundle your custom presentation with its own website build.

`copyAssets` preserves unrelated destination files. Start from an empty generated directory when rebuilding to remove obsolete chunks. The exported `assetManifest` lists each group's paths, sizes and SHA-256 hashes.

`npm run build` produces production assets under `dist/assets`, Worker and browser bundles, and declarations. `npm run build:test` also builds local examples and simulated sign-in. Tests and examples do not enter the package or deployed asset directory.

`npm run test:package` packs an archive, extracts it outside the checkout and verifies its public imports and selected assets. It checks that custom presentation imports exclude the standard UI and that development assets do not ship.
