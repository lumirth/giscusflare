# giscusflare

GitHub Discussions comments for Cloudflare Workers, with a replaceable interface and shared conversation APIs.

**In development.** See [verification status and release gaps](docs/STATUS.md).

## Development

Use Node 22.16 or newer. Development takes place on `main`.

```sh
npm ci
npm test
npm run test:runtime
npm run demo
```

The demo serves an iframe page at `http://127.0.0.1:8788/article` and a native page at `/native`. GitHub, sign-in and comments are simulated locally. The command prints the addresses when using custom ports.

`npm test` checks TypeScript, builds the package and runs the Node tests. `test:runtime` tests the service in workerd with SQLite and simulated GitHub. [Testing](TESTING.md) describes browser and deployment checks.

## Integration

- `giscusflare` exports the standard Giscus-style interface and native embedding.
- `giscusflare/styles.css` supplies its scoped styles.
- `giscusflare/headless` exports the conversation runtime, interactions and content renderer for independent interfaces.
- `giscusflare/worker` supplies the Cloudflare service.

The API is experimental. Custom presentations share authentication, drafts, pagination, reactions and recovery through the runtime. See [customization](docs/EXTENDING.md) and the [independent example](examples/custom.ts).

The separate `kukas-giscusflare` repository hosts the production service and Kukas's custom presentation. GitHub Discussions in `kukas-comments` hold the actual comments.

## Documentation

- [Deploy](DEPLOY.md)
- [Architecture](docs/DESIGN.md)
- [Standard presentation and intentional differences](docs/PRESENTATION.md)
- [Remaining implementation work](docs/IMPLEMENTATION.md)
- [Giscus capability reference](docs/CAPABILITIES.md)
- [GitHub API constraints](docs/GITHUB-API.md)
- [Free-tier usage](FREE-TIER.md)
- [Source provenance](docs/PROVENANCE.md) and [third-party notices](THIRD-PARTY-NOTICES.md)
