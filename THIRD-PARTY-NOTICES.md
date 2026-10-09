# Third-party notices

giscusflare implements a GitHub Discussions comment service for Cloudflare Workers. It uses [giscus](https://github.com/giscus/giscus) as its presentation and compatibility reference.

The project license is [MIT](LICENSE). [Source provenance](docs/PROVENANCE.md) identifies the original source archive.

## giscus source and assets

The themes in `vendor/giscus/themes` and files in `vendor/giscus/reference` come from giscus commit `3d6430237108ca4ee3eb6a1a20595201c09c72d5`. Its MIT license is retained in `vendor/giscus/LICENSE`. Individual files retain their Primer, Gruvbox, and other author notices.

The build adapts vendored theme selectors for native embedding. The generated visual foundation expands pinned giscus reference styles and Tailwind 3.4.17/vanilla-rtl 0.4.0 using the pre-3.0 presentation's class vocabulary; it retains the upstream Primer and Tailwind MIT notices. Its generation inputs and recipe are recorded in [source provenance](docs/PROVENANCE.md). Project overrides remain separately authored. Vendored React components remain presentation references; their implementation is not bundled.

The standard widget's Mona SVG is hand-authored geometry reproducing the seven poses of GitHub's loading artwork; the geometry and shared animation code are maintained here. Pagination decorations still use their original GitHub asset URLs. It does not copy GitHub's separately licensed math renderer.

The visual foundation's generator license texts are retained under `vendor/giscus/reference/styles/licenses`: Tailwind CSS, copyright Tailwind Labs, Inc., and vanilla-rtl, copyright 2022-current Thibaud Colas, both MIT.

## Icons

The standard widget uses unchanged SVG assets from `@primer/octicons` 19.27.0. GitHub, Inc. licenses Octicons under [MIT](https://github.com/primer/octicons/blob/main/LICENSE).

## Dependencies

Runtime dependencies include Hono, Valibot, parse5, Lit HTML, MathJax and Octicons. TypeScript, esbuild, PostCSS and Wrangler support the build. Each dependency retains its package license.

Lit HTML uses the BSD-3-Clause license. Review the installed packages' license files when redistributing a build.

## GitHub GraphQL reference schema

Tests use a gzip-compressed, otherwise unchanged copy of GitHub, Inc.'s [public GraphQL schema](https://docs.github.com/en/graphql/overview/public-schema), downloaded from its [official schema endpoint](https://docs.github.com/public/fpt/schema.docs.graphql). Retrieval time, source URL and uncompressed SHA-256 are recorded in [`test/github-schema.json`](https://github.com/lumirth/giscusflare/blob/main/test/github-schema.json). This development-only reference validates actual request documents; it is excluded from the browser, Worker and package builds. GitHub's documentation [license notice](https://github.com/github/docs#license) identifies its documentation and code licenses; this project's MIT license does not relicense upstream material.
