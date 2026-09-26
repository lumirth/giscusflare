/** Check this copy revision without installing application dependencies. */
import assert from 'node:assert/strict';
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const read = name => readFile(resolve(root, name), 'utf8');
const tests = [];
async function check(name, run) {
  try { await run(); tests.push({ name, result: 'passed' }); console.log('PASS', name); }
  catch (error) { tests.push({ name, result: 'failed', error: error.message }); throw error; }
}
async function files(directory) {
  const result = [];
  for (const item of await readdir(resolve(root, directory), { withFileTypes: true })) {
    const path = directory ? directory + '/' + item.name : item.name;
    if (item.isDirectory() && !['node_modules', '.git', '.wrangler', '__pycache__'].includes(item.name)) result.push(...await files(path));
    else if (item.isFile()) result.push(path);
  }
  return result;
}
try {
  await check('Runtime sources and demo contain no alternate voting option', async () => {
    const paths = [...await files('src'), ...await files('public'), 'scripts/demo.mjs'];
    for (const path of paths) assert.doesNotMatch(await read(path), /voteMode|data-vote-mode|\u2191/, path);
  });
  await check('Both widget schemas omit the removed option', async () => {
    const text = await read('src/contracts/requests.ts');
    assert.ok(text.includes('export const Widget = v.pipe(v.strictObject('));
    assert.ok(text.includes('export const WidgetQuery = v.pipe(v.strictObject('));
    assert.ok(!text.includes('voteMode'));
  });
  await check('Widget shows existing emoji reactions without a separate likes counter', async () => {
    const text = await read('src/browser/widget.ts');
    for (const name of ['THUMBS_UP', 'THUMBS_DOWN', 'LAUGH', 'HOORAY', 'CONFUSED', 'HEART', 'ROCKET', 'EYES']) assert.ok(text.includes(name));
    assert.ok(text.includes('g.users.totalCount > 0'));
    assert.ok(text.includes('reactionLabel(t, reaction)'));
    assert.doesNotMatch(text, /t\.like|#notice|t\.saved|t\.loginNote|t\.empty|gsc-like/);
  });
  await check('Translated dictionaries have no deleted reassurance or voting labels', async () => {
    const text = await read('src/browser/i18n.ts');
    assert.doesNotMatch(text, /\b(?:like|saved|loginNote|empty)\s*:/);
    assert.ok(text.includes('loginCancelled:'));
    assert.ok(text.includes('thumbsUp: "Thumbs up"'));
  });
  await check('Setup generates ordinary reaction embeds and has no voting selector', async () => {
    const source = await read('src/browser/setup.ts'), html = await read('public/index.html');
    assert.ok(source.includes("'data-reactions-enabled': '1'"));
    assert.ok(source.includes('termField.hidden = !needsTerm'));
    assert.doesNotMatch(html, /name=["']vote/);
    assert.ok(html.includes('Generate embed code'));
    assert.ok(source.includes("copyButton.textContent = 'Copied'"));
  });
  await check('Editorial prose has no em dashes or curly quote punctuation', async () => {
    const paths = [...await files('src'), ...await files('public'), 'scripts/demo.mjs', ...(await files('')).filter(p => !p.includes('/') && p.endsWith('.md')), 'docs/WRITING.md'];
    for (const path of paths) assert.doesNotMatch(await read(path), /[\u2014\u2018\u2019\u201c\u201d]/, path);
  });
  await check('Relative documentation links resolve', async () => {
    for (const path of (await files('')).filter(p => p.endsWith('.md'))) {
      const text = await read(path);
      for (const match of text.matchAll(/\]\(([^)]+)\)/g)) {
        const target = match[1].split('#')[0];
        if (!target || /^(https?:|mailto:)/.test(target)) continue;
        await readFile(resolve(root, dirname(path), target));
      }
    }
  });
  await check('Original license and verification evidence are unchanged', async () => {
    const { files: retained } = JSON.parse(await read('docs/copy-checks/preserved-files.json'));
    for (const [path, expected] of Object.entries(retained)) {
      const digest = createHash('sha256').update(await readFile(resolve(root, path))).digest('hex');
      assert.equal(digest, expected, path);
    }
  });
} finally {
  await mkdir(resolve(root, 'docs/copy-checks'), { recursive: true });
  await writeFile(resolve(root, 'docs/copy-checks/static.json'), JSON.stringify({ node: process.version, checks: tests, applicationBuild: 'not-tested' }, null, 2) + '\n');
}
console.log(`${tests.length} static copy checks passed.`);
