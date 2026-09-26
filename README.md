# giscus-workers

GitHub Discussions comments for Cloudflare Workers. This is an independent rebuild of giscus. Readers sign in with GitHub, and their comments and reactions stay in your discussion repository.

The v2 build has unresolved failures. See [Verification](VERIFICATION.md) before deploying.

## Run locally

Use Node 22.16 or newer:

```sh
npm install
npm test
npm run demo
```

Open `http://127.0.0.1:8788/article` for the demo or `http://127.0.0.1:8787/` for setup. The demo simulates GitHub sign-in and stores comments locally. It does not post to GitHub.

## Comments and reactions

The widget includes comments, replies, editing, deletion, Markdown preview, moderation, and pagination. Readers can use GitHub's eight emoji reactions. Reaction counts appear when people have reacted; the picker offers all eight choices.

Existing discussions use the same repository, category, page mapping, and strict-matching setting as giscus. Readers must authorize your GitHub App again. See [Migration](MIGRATION.md) for compatibility details.

## Embed

After [setting up the service](DEPLOY.md), open its setup page to generate an embed. A typical configuration looks like this:

```html
<script
  src="https://YOUR-COMMENTS-ORIGIN/client.js"
  data-repo="your-account/your-public-repository"
  data-category="Announcements"
  data-mapping="pathname"
  data-strict="0"
  data-reactions-enabled="1"
  data-input-position="bottom"
  data-theme="preferred_color_scheme"
  data-lang="en"
  crossorigin="anonymous"
  async>
</script>
```

Use this service's `client.js` with its API. The original hosted giscus client uses a different sign-in protocol.

## How it runs

Hono handles HTTP requests. Valibot checks input, configuration, stored records, and GitHub responses through Standard Schema contracts. A SQLite-backed Durable Object coordinates each repository's sessions and writes. GitHub stores the conversations.

The browser uses a Web Component and CSS. Hono and Valibot stay on the server. Static files use Workers Static Assets, and rate checks use Cloudflare's native rate-limiting bindings. See [Architecture](ARCHITECTURE.md) and [Free-tier usage](FREE-TIER.md).

## Supported scope

The service accepts configured public repositories on github.com. It includes automatic, light, and dark themes, plus custom CSS from approved origins. The interface has English and nine additional dictionaries. Missing translations use English.

This release does not include private repositories, GitHub Enterprise, MathJax, Mermaid, arbitrary embedded media, or the full giscus theme and translation catalogs.

## Documentation

[Deploy](DEPLOY.md) · [Migrate](MIGRATION.md) · [Test](TESTING.md) · [Verification](VERIFICATION.md)

[Architecture](ARCHITECTURE.md) · [Validation](VALIDATION.md) · [Security](SECURITY.md) · [Free-tier usage](FREE-TIER.md)
