# Third-party notices

This project rebuilds [giscus](https://github.com/giscus/giscus)'s GitHub Discussions comment model for Cloudflare Workers. It is independent of giscus, GitHub, and Cloudflare.

Runtime dependencies include Hono, Valibot, Standard Schema, DOMPurify, Lit and MathJax. TypeScript, esbuild, Tailwind and Wrangler support the build. Each dependency retains its package license.

The project's license is in [LICENSE](LICENSE). The previous source archive is identified in [docs/PROVENANCE.md](docs/PROVENANCE.md).

## Giscus themes

`vendor/giscus/themes` comes from Giscus at `3d6430237108ca4ee3eb6a1a20595201c09c72d5`. Its MIT license is retained in `vendor/giscus/LICENSE`; individual theme files retain Primer, Gruvbox and other author notices. The build adapts root selectors. Giscus's Mona loading animation and pagination decorations load from their original GitHub asset URLs. No separately licensed GitHub math renderer was copied.

GitHub Octicons (GitHub, Inc.), MIT. The standard interface uses unchanged SVG assets from `@primer/octicons` 19.27.0. See https://github.com/primer/octicons/blob/main/LICENSE.

The pinned files in `vendor/giscus/reference` retain Giscus MIT attribution. Its base/global CSS (including the Primer notice) is compiled for the standard presentation. React component source is a design reference, not bundled code. `src/browser/standard/styles.css` records the small local additions. Lit HTML is BSD-3-Clause; Tailwind CSS and its RTL build plugin are MIT-licensed dependencies.
