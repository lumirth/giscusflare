import { interpretGitHubContent, type CodeContent, type MathContent } from '../content/github.js';
import { copyControl, preparedHTML, type ContentContext, type ContentOutput, type ContentRenderer } from './content.js';
export type { CodeContent, MathContent } from '../content/github.js';

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

/** A custom feature owns its output and resources for the installed body's lifetime. */
async function installFeature<Input>(element: HTMLElement, feature: Input, renderer: FeatureRenderer<Input>, context: ContentContext): Promise<void> {
  let output: ContentOutput;
  try { output = await renderer(feature, context); }
  catch { context.signal.throwIfAborted(); return; }
  const owned = 'node' in output ? output : undefined;
  if (context.signal.aborted || context.lifetime.aborted) {
    owned?.dispose?.(); context.signal.throwIfAborted(); context.lifetime.throwIfAborted();
  }
  if (owned?.dispose) context.lifetime.addEventListener('abort', () => owned.dispose!(), { once: true });
  element.replaceWith(owned ? owned.node : output as Node);
}

/** Browser and stock server content share one interpretation; only installation differs. */
export function githubContent(options: GitHubContentOptions = {}): ContentRenderer {
  const installPrepared = preparedHTML();
  return async (input, context) => {
    const html = input.html ?? await context.providerHTML();
    context.signal.throwIfAborted();
    const { prepared, features } = await interpretGitHubContent({ ...input, html }, {
      code: typeof options.code === 'function' ? 'custom' : options.code === false ? 'source' : 'default',
      math: typeof options.math === 'function' ? 'custom' : options.math === false ? 'source' : 'default',
      mathFailed: (options.labels || defaults).mathFailed,
    });
    context.signal.throwIfAborted();
    const output = await installPrepared({ ...input, prepared }, context);
    const fragment = ('node' in output ? output.node : output) as DocumentFragment;
    const placeholders = new Map([...fragment.querySelectorAll<HTMLElement>('[data-gw-feature]')].map(element => [element.dataset.gwFeature!, element]));
    await Promise.all(features.map(feature => {
      const element = placeholders.get(feature.key);
      if (!element) return;
      return feature.kind === 'code' && typeof options.code === 'function'
        ? installFeature(element, feature.input, options.code, context)
        : feature.kind === 'math' && typeof options.math === 'function'
          ? installFeature(element, feature.input, options.math, context) : undefined;
    }));
    context.signal.throwIfAborted();
    if (options.code === undefined && options.copy !== false)
      for (const block of fragment.querySelectorAll<HTMLElement>('.code-block'))
        copyControl(block, block.querySelector('pre')?.textContent || '', options.labels || defaults, context.lifetime);
    return fragment;
  };
}
