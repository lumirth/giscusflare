import { copyFile, writeFile } from 'node:fs/promises';
/** One authored scoped sheet serves native and iframe presentations. */
export async function buildStyles() {
  await copyFile('src/browser/standard/styles.css', 'public/widget.css');
  await writeFile('public/iframe.css', 'body { margin: 0; background: transparent; }\n');
}
