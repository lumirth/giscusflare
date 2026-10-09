import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import postcss from 'postcss';

/** Explicit pinned foundations and authored additions form each supported stylesheet. */
export async function buildStyles() {
  const [foundation, contentFoundation, content, presentation] = await Promise.all([
    'vendor/giscus/reference/styles/compiled.css',
    'vendor/giscus/reference/styles/content.css',
    'src/browser/content.css',
    'src/browser/standard/styles.css',
  ].map(path => readFile(path, 'utf8')));
  const widget = [foundation, content, presentation].join('\n');
  await writeFile('public/widget.css', widget);
  await writeFile('public/content.css', contentFoundation + '\n' + content);
  await writeFile('public/iframe.css', 'body { margin: 0; background: transparent; }\n');
  const native = postcss.parse(widget);
  native.walkRules(rule => {
    if (rule.parent?.type === 'atrule' && /keyframes$/.test(rule.parent.name)) return;
    rule.selectors = rule.selectors.filter(selector => selector.trim()).map(selector => {
      const scoped = selector.replace(/(^|[ ,])(:root|html|body|:host)(?=[ ,.:#\[]|$)/g, '$1.giscusflare').replace(/\.giscusflare\s+\.giscusflare/g, '.giscusflare');
      return scoped.includes('.giscusflare') ? scoped : '.giscusflare ' + scoped;
    });
  });
  await mkdir('public/themes', { recursive: true });
  const nativeThemes = [];
  for (const name of (await readdir('vendor/giscus/themes')).filter(name => name.endsWith('.css')).sort()) {
    const source = postcss.parse(await readFile('vendor/giscus/themes/' + name, 'utf8'));
    source.walkAtRules(/keyframes$/, rule => {
      const original = rule.params, scoped = 'giscusflare-' + name.slice(0, -4) + '-' + original;
      rule.params = scoped;
      source.walkDecls(/animation(?:-name)?$/, declaration => {
        declaration.value = declaration.value.replace(new RegExp('\\b' + original + '\\b', 'g'), scoped);
      });
    });
    // Both outputs derive directly from the pinned palette; no output is parsed back into input.
    const iframe = source.clone();
    for (const [sheet, host] of [[source, `.giscusflare[data-theme="${name.slice(0, -4)}"]`], [iframe, ':root']]) {
      sheet.walkRules(rule => {
        if (rule.parent?.type === 'atrule' && /keyframes$/.test(rule.parent.name)) return;
        rule.selectors = rule.selectors.map(selector => host + (/^(main|html|body|:root|:host)(?=$|[\s.:#\[])/.test(selector)
          ? selector.replace(/^(main|html|body|:root|:host)/, '') : ' ' + selector));
      });
    }
    await writeFile('public/themes/' + name, iframe.toString());
    nativeThemes.push(source.toString());
  }
  await writeFile('public/native.css', native.toString() + '\n' + nativeThemes.join('\n') + '\n');
}
