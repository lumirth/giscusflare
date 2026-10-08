import { readFile, writeFile } from 'node:fs/promises';
import postcss from 'postcss';
/** The pinned visual foundation is independent of runtime markup scanning. */
export async function buildStyles() {
  const [foundation, content, presentation] = await Promise.all([
    'vendor/giscus/reference/styles/compiled.css',
    'src/browser/content.css',
    'src/browser/standard/styles.css',
  ].map(path => readFile(path, 'utf8')));
  await writeFile('public/widget.css', [foundation, content, presentation].join('\n'));
  const independent = postcss.parse(foundation);
  independent.walkRules(rule => {
    rule.selectors = rule.selectors.filter(selector => !selector.includes('.gsc-') &&
      /\.(?:markdown\b|Box\b|blob-|pl-|task-list|user-mention|team-mention|commit-tease|octicon\b)/.test(selector))
      .map(selector => selector.includes('.markdown') ? selector : '.markdown ' + selector);
    if (!rule.selectors.length) rule.remove();
  });
  independent.walkComments(comment => comment.remove());
  independent.walkAtRules(rule => { if (!rule.nodes?.length) rule.remove(); });
  await writeFile('public/content.css', independent.toString() + '\n' + content);
  await writeFile('public/iframe.css', 'body { margin: 0; background: transparent; }\n');
}
