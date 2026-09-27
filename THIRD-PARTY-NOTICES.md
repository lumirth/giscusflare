# Third-party notices

giscusflare implements a GitHub Discussions comment service for Cloudflare Workers. It uses [giscus](https://github.com/giscus/giscus) as its presentation and compatibility reference. The project is independent of giscus, GitHub, and Cloudflare.

The project license is [MIT](LICENSE). [Source provenance](docs/PROVENANCE.md) identifies the original source archive.

## giscus source and assets

The themes in `vendor/giscus/themes` and files in `vendor/giscus/reference` come from giscus commit `3d6430237108ca4ee3eb6a1a20595201c09c72d5`. Its MIT license is retained in `vendor/giscus/LICENSE`. Individual files retain their Primer, Gruvbox, and other author notices.

The build compiles the base and global styles, including their Primer notice, and adapts root selectors for native embedding. The React components are design references and build inputs for stylesheet utility discovery. Their React implementation is not bundled. Local standard-widget additions are in `src/browser/standard/styles.css`.

The standard widget loads giscus's Mona animation and pagination decorations from their original GitHub asset URLs. It does not copy GitHub's separately licensed math renderer.

## Icons

The standard widget uses unchanged SVG assets from `@primer/octicons` 19.27.0. GitHub, Inc. licenses Octicons under [MIT](https://github.com/primer/octicons/blob/main/LICENSE).

## Dependencies

Runtime dependencies include Hono, Valibot, Standard Schema, DOMPurify, Lit HTML, and MathJax. TypeScript, esbuild, Tailwind CSS, its RTL plugin, and Wrangler support the build. Each dependency retains its package license.

Lit HTML uses the BSD-3-Clause license. Tailwind CSS and its RTL plugin use MIT licenses. Review the installed packages' license files when redistributing a build.
