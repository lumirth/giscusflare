# Verification

`npm test` runs strict browser/Worker type checks, builds the package, and runs the Node tests. Domain tests use an explicit GitHub simulator and real Node SQLite. Browser interaction tests use JSDOM; they can establish DOM identity and event handling, but cannot prove native undo, layout or OAuth navigation.

`npm run test:runtime` runs real local workerd, SQLite Durable Object RPC, cookie/proof authentication, encrypted session restart persistence and native rate limits. GitHub is simulated. It does not establish deployed CPU capacity or real App permissions.

`npm run check:release` runs both suites and artifact validation. Browser acceptance is separate and must be recorded in `docs/STATUS.md`; passing the command is not a visual acceptance or production-release certificate.

## Browser acceptance

Use the actual browser against the staging fixture and compare with giscus.app. Verify:

- Signed-out bottom composer, one main sign-in action, contextual reaction sign-in, all eight original emoji reactions.
- Desktop and narrow layouts, light/dark themes, focused textarea/Markdown surface, unclipped Octicons.
- Type with real keyboard input, switch Preview/Write, undo/redo, react and refresh; keep textarea identity, selection and writing intact.
- Rapid reaction toggles, local pending feedback, canonical result and error recovery.
- Replies beyond the initial buffer, cancelled/reopened reply draft, root/reply edits, sort changes.
- Native and iframe authentication, same-window return and optional popup, return location, origin enforcement.
- Independent public-API example without loading the standard presentation/style.

The previous Python component harnesses and copy-era lexical checks were removed. Their assumptions about private DOM and exact source spelling are not the new contract. Regression coverage belongs to domain behavior, shared interactions, package boundaries and actual browser observations.
