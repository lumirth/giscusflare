# Testing

[Verification](VERIFICATION.md) contains the results for this package. The commands below describe the test suites, not a claim that they passed.

## Node tests

```sh
npm test
```

This runs strict TypeScript checking, builds the application with esbuild, and runs Node's test runner. Tests use Hono, Valibot, the repository code, and Node SQLite. A stateful fixture simulates GitHub responses.

The tests cover request and response schemas, configuration, corrupted records, encryption, expiry, concurrent writes, idempotency, access checks, comments, replies, reactions, moderation, pagination, and sign-in. The GitHub fixture checks request headers, variables, scopes, and token types. It can simulate rate limits, delayed search results, and a connection failure after a write.

## Cloudflare runtime

```sh
npm run test:runtime
```

This starts Wrangler and workerd with a separate test entry point. GitHub is simulated; RPC, SQLite-backed Durable Objects, and native rate-limiting bindings run in workerd.

The tests check routing, schemas, static assets, the widget's Content Security Policy, repository calls, authorization, and persistence after a process restart. They create temporary test keys and storage and remove them afterward.

## Browser

```sh
pip install playwright==1.57.0
python -m playwright install chromium
npm run test:browser
```

Normal mode starts the local demo with separate website and comments-service origins. It tests iframe navigation and a simulated authorization flow.

A component-only mode is available when a managed browser blocks navigation:

```sh
CHROMIUM_PATH=/path/to/chromium BROWSER_COMPONENT_ONLY=1 npm run test:browser
```

It loads the component into `about:blank` and sends API requests through an HTTP bridge. It checks rendering, interactions, layout, and HTML filtering. It does not test popup navigation, browser-enforced iframe messaging, storage restrictions, or CORS and CSP enforcement. Run normal browser mode before deployment.

## Copy checks

```sh
npm run check:copy
npm run test:copy
```

The first command checks for removed voting options, obsolete UI strings, broken documentation links, and changes to the archived verification logs or license. It needs only Node.

The second uses TypeScript and Playwright to load the browser components with simulated responses. It checks reaction labels and counts, conditional setup fields, messages, and layout. It does not run the Worker or test sign-in navigation. It can use a local or global TypeScript installation. Set `CHROMIUM_PATH` to use a browser installed outside Playwright.

Copy-check results are in `docs/copy-checks/`. The full test commands above are still required before deployment.

## Release checks

`npm run check:release` runs the Node, native runtime, normal browser, and package checks. `npm run deploy:check` also validates configuration and runs a Wrangler dry run. CI runs checks without deploying or using production credentials.

Test reports and command exit codes belong in `docs/evidence/`. Keep recorded logs unchanged. The live GitHub and deployed-browser checks are in [Deploy](DEPLOY.md).
