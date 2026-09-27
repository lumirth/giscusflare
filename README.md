<img src="public/brand/giscusflare-logo.png" alt="giscusflare" width="96" height="96">

# giscusflare

GitHub Discussions comments you can customize and deploy on Cloudflare.

[Try the demo](https://giscusflare.kukas.me/) · [Deploy to Cloudflare](https://deploy.workers.cloudflare.com/?url=https://github.com/lumirth/giscusflare) · [Customization](docs/EXTENDING.md) · [Configuration](docs/CONFIGURATION.md)

Use the default GitHub/giscus-inspired interface, replace individual components, or build a comments section to match your website. The [demo](https://giscusflare.kukas.me/) shows one real conversation in two designs.

- Embed in an iframe or directly in your page.
- Share sign-in, drafts, replies, editing and reactions across custom interfaces.
- Keep comments in a public GitHub repository you choose.
- Allow your own websites, or open your service to others.

## Set up your service

[Deploy to Cloudflare](https://deploy.workers.cloudflare.com/?url=https://github.com/lumirth/giscusflare) creates your source copy and a Worker in your account. Open the Worker's address to connect a GitHub App, choose a comments repository and generate your embed code. [The setup guide](DEPLOY.md) walks through the same steps.

Each page maps to a GitHub discussion. Readers sign in with GitHub to comment or react, and you can manage the conversation on GitHub too. The source copy created during deployment and the repository holding discussions can be separate.

## Make it fit your website

Install the browser package from the [1.0.0 release](https://github.com/lumirth/giscusflare/releases/tag/v1.0.0):

```sh
npm install https://github.com/lumirth/giscusflare/releases/download/v1.0.0/giscusflare-1.0.0.tgz
```

Mount the default interface in your own page:

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
  appearance: { theme: 'preferred_color_scheme' },
});

// Change appearance without replacing the conversation or its editors.
comments.updateAppearance({ theme: 'dark' });
```

For a different design, use the same conversation API with your own markup. The [forum example](examples/forum.ts) uses shared composer bindings for drafts, preview and submission. Start with [customization](docs/EXTENDING.md) or the [API reference](docs/API.md).

[giscus](https://giscus.app) provides a hosted service with a familiar widget. giscusflare puts the service in your Cloudflare account and adds a JavaScript API for designing the interface. Read [the comparison](docs/COMPARISON.md) if you already use giscus.

## Run it

[Configuration](docs/CONFIGURATION.md) covers websites, repositories and caching. [Cloudflare usage](FREE-TIER.md) explains the resource costs and measurements. [Operations](docs/OPERATIONS.md) covers updates and troubleshooting.

For development, use Node 22.16 or newer:

```sh
npm ci
npm test
npm run test:runtime
npm run demo
```

The local demo simulates GitHub and sign-in. See [contributing](CONTRIBUTING.md) and [testing](TESTING.md).

MIT licensed. See [credits and licenses](THIRD-PARTY-NOTICES.md).
