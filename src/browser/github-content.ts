import { icon } from './icons.js';
import { markdown } from './markdown.js';
import { mountContent, type ContentContext, type ContentInput, type ContentOutput, type ContentRenderer } from './content.js';

export interface CodeContent {
  source: string;
  language: string;
  origin: 'fence' | 'github-file';
  file?: { url: string; path?: string; repository?: string; lineStart?: number; lineEnd?: number };
}
export interface MathContent { source: string; display: boolean }
export type FeatureRenderer<Input> = (input: Input, context: ContentContext) => ContentOutput | Promise<ContentOutput>;
export interface GitHubContentOptions {
  /** Owns the complete feature, including its frame and controls. False leaves sanitized source. */
  code?: FeatureRenderer<CodeContent> | false;
  /** Owns the complete expression. False leaves readable TeX. */
  math?: FeatureRenderer<MathContent> | false;
  copy?: boolean;
  labels?: { copy: string; copied: string; copyFailed: string; mathFailed: string };
}
const defaults = { copy: 'Copy', copied: 'Copied!', copyFailed: 'Select and copy the code manually.', mathFailed: 'Unable to render expression.' };

function copyControl(block: HTMLElement, source: string, labels: typeof defaults, signal: AbortSignal): void {
  const button = document.createElement('button'); button.type = 'button'; button.className = 'code-copy';
  button.append(icon('copy')); button.title = labels.copy; button.setAttribute('aria-label', labels.copy);
  let reset: ReturnType<typeof setTimeout> | undefined;
  signal.addEventListener('abort', () => clearTimeout(reset), { once: true });
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(source); if (signal.aborted) return;
      button.replaceChildren(icon('check')); button.title = labels.copied; button.setAttribute('aria-label', labels.copied);
      clearTimeout(reset); reset = setTimeout(() => {
        button.replaceChildren(icon('copy')); button.title = labels.copy; button.setAttribute('aria-label', labels.copy);
      }, 2000);
    } catch { if (!signal.aborted) { button.title = labels.copyFailed; button.setAttribute('aria-label', labels.copyFailed); } }
  }, { signal });
  block.append(button);
}

/** A replacement feature inherits only lifetime ownership, never a default frame or controls. */
function mountFeature<Input>(element: HTMLElement, input: ContentInput, feature: Input,
  renderer: FeatureRenderer<Input>, context: ContentContext, replace = true): void {
  const target = replace ? document.createElement('span') : element;
  const fallback = replace ? element : document.createTextNode(element.textContent || '');
  if (replace) { target.className = 'giscus-content-feature'; element.replaceWith(target); }
  const mount = mountContent(target, (_source, nextContext) => {
    try {
      const output = renderer(feature, nextContext);
      if ('then' in output) {
        target.replaceChildren(fallback); target.setAttribute('aria-busy', 'true');
        return Promise.resolve(output).catch(() => fallback).finally(() => target.removeAttribute('aria-busy'));
      }
      return output;
    } catch { return fallback; }
  }, { signal: context.lifetime, preview: async () => ({ html: await context.providerHTML() }) });
  void mount.update(input).catch(() => { /* Shared ownership leaves readable source on failure. */ });
}

function fileContent(element: HTMLElement): CodeContent {
  const rows = [...element.querySelectorAll<HTMLElement>('td.blob-code')];
  const anchor = element.querySelector<HTMLAnchorElement>('.Box-header a[href*="/blob/"], .Box-header a[href*="/raw/"]') ||
    element.querySelector<HTMLAnchorElement>('.Box-header a[href]');
  const lines = [...element.querySelectorAll<HTMLElement>('.blob-num[data-line-number]')].map(node => Number(node.dataset.lineNumber));
  const url = anchor?.href || '', path = anchor?.textContent?.trim();
  let repository: string | undefined;
  try { const parsed = new URL(url); if (parsed.hostname === 'github.com') repository = parsed.pathname.split('/').slice(1, 3).join('/'); } catch { /* A readable preview can lack a source link. */ }
  return {
    source: rows.map(row => row.textContent || '').join('\n'),
    language: element.querySelector<HTMLElement>('[data-language]')?.dataset.language || 'text', origin: 'github-file',
    file: { url, ...(path ? { path } : {}), ...(repository ? { repository } : {}),
      ...(lines.length ? { lineStart: lines[0], lineEnd: lines.at(-1) } : {}) },
  };
}

/** Optional GitHub interpretation. Local or server Markdown pipelines do not import this module. */
export function githubContent(options: GitHubContentOptions = {}): ContentRenderer {
  const labels = options.labels || defaults;
  const prepare = (html: string, input: ContentInput, context: ContentContext): HTMLElement => {
    context.signal.throwIfAborted();
    const fragment = markdown(html, input.markdown);
    const pres = [...fragment.querySelectorAll('pre')], expressions = [...fragment.querySelectorAll<HTMLElement>('.giscus-math')];
    if (typeof options.code === 'function') {
      const files = new Set([...fragment.querySelectorAll<HTMLElement>('.blob-wrapper')].map(blob => blob.closest<HTMLElement>('.Box') || blob));
      for (const feature of files) {
        mountFeature(feature, input, fileContent(feature), options.code, context);
      }
    }
    for (const pre of pres) {
      if (!fragment.contains(pre)) continue;
      const source = pre.textContent || '';
      if (typeof options.code === 'function') {
        mountFeature(pre, input, { source, language: pre.dataset.language || 'text', origin: 'fence' }, options.code, context);
      } else if (options.code !== false) {
        const block = document.createElement('div'); block.className = 'code-block'; pre.replaceWith(block); block.append(pre);
        if (options.copy !== false) copyControl(block, source, labels, context.lifetime);
      }
    }
    for (const element of expressions) {
      if (!fragment.contains(element)) continue;
      const source = element.textContent || '', display = element.dataset.display === 'block';
      if (typeof options.math === 'function') {
        mountFeature(element, input, { source, display }, options.math, context);
      } else if (options.math !== false) {
        mountFeature(element, input, { source, display }, async (_feature, current) => {
          try {
            const renderer = await import('./math.js'); current.signal.throwIfAborted();
            return renderer.renderMath(source, display);
          } catch {
            current.signal.throwIfAborted();
            element.classList.add('math-render-error');
            const error = document.createDocumentFragment();
            const message = document.createElement('span'); message.className = 'math-render-message'; message.textContent = labels.mathFailed;
            const sourceCode = document.createElement('code'); sourceCode.className = 'math-render-source'; sourceCode.textContent = element.dataset.source || source;
            error.append(message, sourceCode); return error;
          }
        }, context, false);
      }
    }
    const root = document.createElement('div'); root.className = 'markdown'; root.append(fragment); return root;
  };
  const renderer: ContentRenderer = (input, context) => input.html !== undefined ? prepare(input.html, input, context)
    : context.providerHTML().then(html => prepare(html, input, context));
  return renderer;
}
