# Testing

Use Node 22.16 or newer and install the locked dependencies with `npm ci`.

## Automated checks

| Command | What it checks |
| --- | --- |
| `npm test` | TypeScript, package builds, Node tests, domain behavior, and browser events in JSDOM. |
| `npm run test:runtime` | The service in local workerd with SQLite Durable Objects and simulated GitHub. |
| `npm run check:release` | Both suites and required package files. |
| `npm run deploy:check` | Release checks, public configuration validation, and a Wrangler dry run. |

The workerd suite covers repository RPC, SQLite persistence, encrypted sessions across restart, authentication handoff, and native rate limits. Use the browser acceptance checks for real App permissions and the [usage guide](FREE-TIER.md#check-your-usage) for deployed resource measurements.

Use JSDOM for DOM identity, events and state changes. Use a browser for layout, native undo and OAuth navigation.

## Local demo

Run `npm run demo`. Open the printed iframe and native page URLs. The default iframe page is `http://127.0.0.1:8788/article`; the native page is `/native`. Comments and GitHub sign-in are simulated.

## Browser acceptance

Use a disposable discussion and a deployed App for these checks. Record the source version, browser, embedding mode, and observed result.

- Load an existing conversation while signed out. Check comments, replies, themes, and narrow layouts.
- Sign in through full-page navigation and a popup. Check cancellation, blocked popups, sign-out, and return to the original page.
- Type a sentence, use Preview, return to Write, and undo and redo. Check selection and focus after refreshes and reactions.
- Post a comment and reply. Check their author and contents on GitHub. Exercise edits, deletion, pagination, and uncertain-write recovery.
- Toggle all eight emoji reactions. Check rapid toggles and permission failures against the final GitHub state.
- Try an unrelated reader and a moderator. Confirm that controls and server responses match their permissions.
- Embed from an unlisted origin. Check iframe rejection and native request rejection.
- Test representative Markdown, code, math, images, long identifiers, and rendering failures in preview and posted comments.

Include Safari, Firefox, and physical iOS.

## Undo regression

Type a phrase with real keyboard input in a plain textarea and the comment composer. Undo should remove the typing group in both. Repeat after Preview and then redo.

Keep the textarea and nearby decoration nodes mounted while typing. Replacing them can split WebKit's undo groups into individual characters. The DOM regression checks node stability; repeat the keyboard check in a browser.

## Release evidence

Record completed checks in [verification results](docs/CONFIDENCE.md), including the version and test conditions. Link screenshots and theme comparisons from [presentation](docs/PRESENTATION.md). Summarize the changes for users in [release history](docs/STATUS.md).
