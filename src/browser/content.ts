/** Original writing is available to every renderer, including previews. */
export interface ContentInput {
  markdown: string;
  html?: string;
  purpose: 'comment' | 'preview';
  repo: string;
  comment?: { id: string; url: string; parentId: string | null };
  draft?: string;
  /** Change this when external rendering inputs, such as a theme, change. */
  revision?: string | number;
}
export interface ContentContext {
  /** Cancels this rendering generation. Mounted trees are released through dispose(), not this signal. */
  signal: AbortSignal;
  /** No provider request occurs unless the renderer calls this function. */
  providerHTML(): Promise<string>;
}
/** Frameworks can retain a mounted tree and update it without remounting. */
export interface MountedContent {
  node: Node;
  update?(input: ContentInput, context: ContentContext): void | Promise<void>;
  dispose?(): void;
}
export type ContentOutput = Node | MountedContent;
export type ContentRenderer = ((input: ContentInput, context: ContentContext) => ContentOutput | Promise<ContentOutput>) & {
  /** Opt into provider HTML for published content. Markdown pipelines omit this capability. */
  providerHTML?: boolean;
};
export interface ContentMount {
  update(input: ContentInput): Promise<void>;
  clear(): void;
  dispose(): void;
}
const mounted = (output: ContentOutput): output is MountedContent => 'node' in output;
const same = (a: ContentInput, b: ContentInput) => a.markdown === b.markdown && a.html === b.html &&
  a.purpose === b.purpose && a.repo === b.repo && a.draft === b.draft && a.comment?.id === b.comment?.id &&
  a.comment?.url === b.comment?.url && a.comment?.parentId === b.comment?.parentId && a.revision === b.revision;

/** One owner for published content, previews, and framework-mounted output. */
export function mountContent(target: HTMLElement, renderer: ContentRenderer, options: {
  signal?: AbortSignal;
  providerHTML?: (input: ContentInput, signal: AbortSignal) => Promise<string>;
} = {}): ContentMount {
  let input: ContentInput | undefined, generation: AbortController | undefined,
    view: MountedContent | undefined, pending = Promise.resolve(), disposed = false;
  const release = () => { const previous = view; view = undefined; previous?.dispose?.(); };
  const clear = () => {
    generation?.abort(); generation = undefined; input = undefined;
    try { release(); } finally { target.replaceChildren(); }
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
      generation?.abort();
      const current = generation = new AbortController(); input = next;
      let html: Promise<string> | undefined;
      const context: ContentContext = {
        signal: current.signal,
        providerHTML() {
          current.signal.throwIfAborted();
          return html ||= next.html !== undefined ? Promise.resolve(next.html)
            : options.providerHTML ? options.providerHTML(next, current.signal)
            : Promise.reject(new Error('This content renderer requires a provider HTML source.'));
        },
      };
      const active = () => !disposed && generation === current && !current.signal.aborted;
      const fail = (cause: unknown) => {
        if (!active()) return;
        current.abort(); input = undefined;
        try { release(); } finally { target.textContent = next.markdown; }
        throw cause;
      };
      const install = (output: ContentOutput) => {
        if (!active()) { if (mounted(output)) output.dispose?.(); return; }
        view = mounted(output) ? output : undefined;
        target.replaceChildren(mounted(output) ? output.node : output);
      };
      try {
        if (view?.update) {
          pending = Promise.resolve(view.update(next, context)).catch(fail);
        } else {
          release(); target.textContent = next.markdown;
          const output = renderer(next, context);
          if ('then' in output) pending = Promise.resolve(output).then(install).catch(fail);
          else { install(output); pending = Promise.resolve(); }
        }
      } catch (cause) { pending = Promise.resolve().then(() => fail(cause)); }
      return pending;
    },
  };
}
