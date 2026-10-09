import type { ContentInputData, ContentPreview, PreparedContent } from '../contracts/content.js';
export type { ContentInputData, ContentPreparer, PreparedContent, ContentPreview, ContentSource } from '../contracts/content.js';

export interface ContentInput extends ContentInputData {
  html?: string;
  prepared?: PreparedContent;
  /** A changed compiler/profile configuration requires a new revision. */
  revision?: string | number;
}
export interface ContentContext {
  /** Cancellation for preparation of the next content revision. */
  signal: AbortSignal;
  /** Persistent controls/resources retire with their installed output. */
  lifetime: AbortSignal;
  providerHTML(): Promise<string>;
  preparedContent(): Promise<PreparedContent>;
}
export interface MountedContent {
  node: Node;
  /** Prepare without mutating the live tree. The owner commits only the current revision. */
  update?(input: ContentInput, context: ContentContext): (() => void) | Promise<() => void>;
  dispose?(): void;
}
export type ContentOutput = Node | MountedContent;
export type ContentRenderer = (input: ContentInput, context: ContentContext) => ContentOutput | Promise<ContentOutput>;
export interface ContentMount { update(input: ContentInput): Promise<void>; clear(): void; dispose(): void }
const mounted = (output: ContentOutput): output is MountedContent => 'node' in output;
const same = (a: ContentInput, b: ContentInput) => a.markdown === b.markdown && a.html === b.html &&
  a.purpose === b.purpose && a.repo === b.repo && a.pageURL === b.pageURL && a.draft === b.draft && a.comment?.id === b.comment?.id &&
  a.comment?.url === b.comment?.url && a.comment?.parentId === b.comment?.parentId && a.revision === b.revision &&
  a.prepared?.html === b.prepared?.html && a.prepared?.revision === b.prepared?.revision &&
  a.prepared?.resources?.styles.join('\n') === b.prepared?.resources?.styles.join('\n') &&
  a.prepared?.resources?.scripts.join('\n') === b.prepared?.resources?.scripts.join('\n');

/** Preparation is detached; installed output changes only after the current result is ready. */
export function mountContent(target: HTMLElement, renderer: ContentRenderer, options: {
  signal?: AbortSignal;
  preview?: (input: ContentInput, signal: AbortSignal) => Promise<ContentPreview>;
} = {}): ContentMount {
  let input: ContentInput | undefined, generation: AbortController | undefined, candidate: AbortController | undefined,
    view: { output: ContentOutput; lifetime: AbortController } | undefined, pending = Promise.resolve(), disposed = false;
  const release = () => {
    const previous = view; view = undefined;
    if (previous) { previous.lifetime.abort(); if (mounted(previous.output)) previous.output.dispose?.(); }
  };
  const clear = () => {
    generation?.abort(); generation = undefined; candidate?.abort(); candidate = undefined; input = undefined;
    try { release(); } finally { target.replaceChildren(); target.removeAttribute('aria-busy'); }
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true; options.signal?.removeEventListener('abort', dispose); clear();
  };
  if (options.signal?.aborted) dispose();
  else options.signal?.addEventListener('abort', dispose, { once: true });
  return {
    clear, dispose,
    update(value) {
      if (disposed) return Promise.resolve();
      const next = { ...value, ...(value.comment ? { comment: { ...value.comment } } : {}) };
      if (input && same(input, next)) return pending;
      generation?.abort(); candidate?.abort();
      const current = generation = new AbortController(); input = next;
      let failing = false;
      const retained = view && mounted(view.output) && view.output.update ? view : undefined;
      const lifetime = retained?.lifetime || (candidate = new AbortController());
      let preview: Promise<ContentPreview> | undefined;
      const delivery = () => preview ||= options.preview ? options.preview(next, current.signal)
        : Promise.reject(new Error('This content requires a configured preparation source.'));
      const context: ContentContext = {
        signal: current.signal, lifetime: lifetime.signal,
        async providerHTML() {
          current.signal.throwIfAborted(); const html = next.html ?? (await delivery()).html;
          if (html === undefined) throw new Error('Provider HTML was not delivered.'); return html;
        },
        async preparedContent() {
          current.signal.throwIfAborted(); const prepared = next.prepared ?? (await delivery()).prepared;
          if (!prepared) throw new Error('Prepared content was not delivered.'); return prepared;
        },
      };
      const active = () => !disposed && generation === current && !current.signal.aborted;
      const finish = () => { if (active()) target.removeAttribute('aria-busy'); };
      const fail = (cause: unknown) => {
        if (!active()) return;
        failing = true;
        current.abort(); input = undefined; target.removeAttribute('aria-busy');
        if (!retained) lifetime.abort();
        if (!view) target.textContent = next.markdown;
        throw cause;
      };
      const install = (output: ContentOutput) => {
        if (!active()) { lifetime.abort(); if (mounted(output)) output.dispose?.(); return; }
        release();
        if (!active()) { lifetime.abort(); if (mounted(output)) output.dispose?.(); return; }
        view = { output, lifetime }; if (candidate === lifetime) candidate = undefined;
        target.replaceChildren(mounted(output) ? output.node : output);
      };
      target.setAttribute('aria-busy', 'true');
      try {
        if (retained && mounted(retained.output)) {
          pending = Promise.resolve(retained.output.update!(next, context)).then(commit => { if (active()) commit(); }).catch(fail).finally(finish);
        } else {
          const output = renderer(next, context);
          if ('then' in output) pending = Promise.resolve(output).then(install).catch(fail).finally(finish);
          else { install(output); finish(); pending = Promise.resolve(); }
        }
      } catch (cause) { pending = Promise.resolve().then(() => fail(cause)); }
      const work = pending;
      pending = new Promise<void>((resolve, reject) => {
        const retired = () => { if (!failing) resolve(); };
        if (current.signal.aborted) retired();
        else current.signal.addEventListener('abort', retired, { once: true });
        work.then(() => { current.signal.removeEventListener('abort', retired); resolve(); },
          cause => { current.signal.removeEventListener('abort', retired); reject(cause); });
      });
      return pending;
    },
  };
}

/** Selected deployment preparation already applied its commenter trust policy. */
export function preparedHTML(): ContentRenderer {
  return async (input, context) => {
    const content = input.prepared || await context.preparedContent();
    await contentResources(content.resources, input.pageURL); context.signal.throwIfAborted();
    const template = document.createElement('template'); template.innerHTML = content.html;
    return template.content;
  };
}
const resources = new WeakMap<Document, Map<string, Promise<void>>>();
function contentResources(value: PreparedContent['resources'], pageURL: string): Promise<void> {
  let known = resources.get(document);
  if (!known) { known = new Map(); resources.set(document, known); }
  const load = (url: string, kind: 'style' | 'script') => {
    const href = new URL(url, pageURL).href, key = kind + ':' + href;
    let work = known!.get(key);
    if (!work) {
      work = kind === 'script' ? import(/* @vite-ignore */ href).then(() => {}) : new Promise<void>((resolve, reject) => {
        const ready = [...document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')].find(link => link.href === href && link.sheet && !link.disabled);
        if (ready) { resolve(); return; }
        const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = href;
        link.addEventListener('load', () => resolve(), { once: true });
        link.addEventListener('error', () => { link.remove(); reject(new Error('Content styles could not load.')); }, { once: true });
        document.head.append(link);
      });
      known!.set(key, work);
      void work.catch(() => { if (known!.get(key) === work) known!.delete(key); });
    }
    return work;
  };
  return Promise.all([...(value?.styles || []).map(url => load(url, 'style')), ...(value?.scripts || []).map(url => load(url, 'script'))]).then(() => {});
}
