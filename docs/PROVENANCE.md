# Source provenance

giscusflare began with the owner-supplied `giscus-workers-v2` version 2.0.0. [Commit `5e62a02`](https://github.com/lumirth/giscusflare/tree/5e62a02) preserves that import and its original README. The project retains the imported MIT license and attribution.

The giscus themes and presentation reference files are pinned at commit `3d6430237108ca4ee3eb6a1a20595201c09c72d5`. Their license notices remain in the vendor directory. See [Third-party notices](../THIRD-PARTY-NOTICES.md) for dependencies and external assets.

## Generated visual foundation

`vendor/giscus/reference/styles/compiled.css` is a generated, project-selected dependency. It expands the pinned giscus `base.css`/`globals.css`, Tailwind 3.4.17 and `tailwindcss-vanilla-rtl` 0.4.0 using the standard presentation class vocabulary from giscusflare `b39375bbba0b8249c3bc661c63150b5917b31d80`. PostCSS is 8.5.28. It contains no project-specific override stylesheet. Those rules remain in `src/browser/standard/styles.css`; independently usable content structure rules live in `src/browser/content.css`. Ordinary builds assemble the standard stylesheet and scope native output without scanning source or installing Tailwind.

| Input/output | SHA-256 |
| --- | --- |
| Pinned `base.css` | `2ff02cf9b1631d2a1260db1a163e9e68e32716af7834067c35087998cc99aaba` |
| Pinned `globals.css` | `496a662537c72229be79336309679f4c1fc5bd77e059997797d64f15dabea374` |
| Generated `compiled.css` | `2945fa3d045ab4756380bee3b76488ca9c37e7b04d6579c4f41fc2e625f76be4` |

The generated dependency is reported separately from authored source. Project overrides, markup and native/theme adaptation code remain fully counted. Its retained upstream CSS and Tailwind notices identify their licenses. The frozen utility vocabulary is a stylesheet API: new project styling belongs in authored CSS rather than assuming a source scanner will manufacture a class.

To regenerate the reference in isolation using the baseline lockfile (this is not part of the ordinary build):

```sh
style_project_root=$PWD
style_reference_dir=$(mktemp -d)
git archive b39375bbba0b8249c3bc661c63150b5917b31d80 > "$style_reference_dir/reference.tar"
mkdir "$style_reference_dir/reference"
tar -xf "$style_reference_dir/reference.tar" -C "$style_reference_dir/reference"
cd "$style_reference_dir/reference"
npm ci --ignore-scripts
node --input-type=module <<'JS'
import postcss from 'postcss';
import tailwind from 'tailwindcss';
import rtl from 'tailwindcss-vanilla-rtl';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const source = '@tailwind base;\n@tailwind components;\n' +
  (await Promise.all(['base', 'globals'].map(name =>
    readFile(`vendor/giscus/reference/styles/${name}.css`, 'utf8')))).join('\n') +
  '\n@tailwind utilities;\n';
const result = await postcss([tailwind({
  content: ['src/browser/standard/**/*.ts', 'src/browser/markdown.ts',
    'vendor/giscus/reference/components/*.tsx'].map(path => resolve(path)),
  plugins: [rtl], corePlugins: { ...rtl.disabledCorePlugins },
})]).process(source, { from: resolve('vendor/giscus/reference/styles/base.css') });
const notice = '/*! Generated visual reference: pinned Giscus base/globals and Tailwind 3.4.17 + vanilla-rtl 0.4.0; utility usage from giscusflare b39375bbba0b8249c3bc661c63150b5917b31d80. Project overrides are maintained separately in src/browser/standard/styles.css. See docs/PROVENANCE.md and THIRD-PARTY-NOTICES.md. */\n';
await writeFile('compiled.css', notice + result.css);
JS
shasum -a 256 compiled.css
cp compiled.css "$style_project_root/vendor/giscus/reference/styles/compiled.css"
```
