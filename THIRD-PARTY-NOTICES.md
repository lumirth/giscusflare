# Third-party notices

This project rebuilds [giscus](https://github.com/giscus/giscus)'s GitHub Discussions comment model for Cloudflare Workers. It is independent of giscus, GitHub, and Cloudflare.

The source depends on Hono, Valibot, and the Standard Schema specification package. TypeScript, esbuild, and Wrangler are build and development tools. The packaging script copies available dependency licenses into `licenses/` when installed packages are present.

The project's license is in [LICENSE](LICENSE). The previous source archive is identified in [docs/PRIOR-RELEASE.json](docs/PRIOR-RELEASE.json).

## Giscus themes

`vendor/giscus/themes` comes from Giscus at `3d6430237108ca4ee3eb6a1a20595201c09c72d5`. Its MIT license is retained in `vendor/giscus/LICENSE`; individual theme files retain Primer, Gruvbox and other author notices. The build adapts root selectors and omits externally hosted loading decorations. No separately licensed GitHub math renderer was copied.

GitHub Octicons (GitHub, Inc.), MIT. The standard interface uses unchanged SVG assets from `@primer/octicons` 19.27.0. See https://github.com/primer/octicons/blob/main/LICENSE.

The pinned files in `vendor/giscus/reference` retain Giscus MIT attribution. Its base/global CSS (including the Primer notice) is compiled for the standard presentation. React component source is a design reference, not bundled code. `src/browser/standard/styles.css` records the small local additions. Lit HTML is BSD-3-Clause; Tailwind CSS and its RTL build plugin are MIT-licensed dependencies.
