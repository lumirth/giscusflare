import { readFile, writeFile } from 'node:fs/promises';
/** The pinned visual foundation is independent of runtime markup scanning. */
export async function buildStyles() {
  const sheets = await Promise.all([
    'vendor/giscus/reference/styles/compiled.css',
    'src/browser/standard/styles.css',
  ].map(path => readFile(path, 'utf8')));
  await writeFile('public/widget.css', sheets.join('\n'));
  await writeFile('public/iframe.css', 'body { margin: 0; background: transparent; }\n');
}
