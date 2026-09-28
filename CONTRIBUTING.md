# Contributing

To work on giscusflare itself, start with the local demo below. The [architecture guide](docs/DESIGN.md) maps the source directories and explains how requests reach GitHub. For changes to embedding, authentication, storage or public exports, describe the proposed behavior in an issue before implementation.

## Local work

Use Node 22.16 or newer:

```sh
npm ci
npm test
npm run demo
```

The demo uses simulated GitHub and needs no credentials. Run `npm run test:runtime` for Worker, RPC, and SQLite changes. [Testing](TESTING.md) covers browser and real GitHub checks.

Edit source files in `src/`. Build scripts generate browser bundles, styles, themes, and type declarations. Do not edit generated output as the fix. Commit dependency changes with the updated lockfile.

## Changes to the interface

Use the public conversation and interaction APIs. Keep authentication, persistence, and GitHub requests out of presentation code. Preserve textarea identity and native editing behavior.

For the standard presentation, compare with giscus on the same discussion and viewer state. Record deliberate differences. For a custom presentation, verify that it does not import the standard interface through a private module.

## Documentation and reports

Write instructions for the person using the feature. Explain required settings, observable results, and recovery from likely failures. Keep one site's domain, credentials, and deployment history in that site's project.

A bug report should include the source version, browser, embedding mode, relevant public configuration, and steps to reproduce it. Remove tokens, private keys, and authorization URLs. Distinguish a local simulator result from behavior observed with a deployed GitHub App.

A change description should explain the problem, resulting behavior, and checks performed.
