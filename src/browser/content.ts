import { icon } from './icons.js';
import { batchRequests } from './batch.js';
import type { AcceptedObservation, Comment } from '../contracts/document.js';
import type { ContentInputData, ContentPreview, PreparedContent, ContentBatchResult, ContentSource, ContentResources } from '../contracts/content.js';
export type { ContentInputData, ContentPreparer, PreparedContent, ContentPreview, ContentBatchResult, ContentSource, ContentResources } from '../contracts/content.js';

export interface ContentInput extends ContentInputData {
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
/** One selected capability pairs acquisition semantics with its installed rendering. */
export interface ContentProfile { delivery: ContentSource; render: ContentRenderer }
export function preparedContent(options: Parameters<typeof preparedHTML>[0] = {}): ContentProfile {
  return { delivery: 'prepared', render: preparedHTML(options) };
}
export function browserContent(render: ContentRenderer, delivery: ContentSource = 'source'): ContentProfile {
  return { delivery, render };
}
export type ContentAcquisition = (input: ContentInputData, signal: AbortSignal) => Promise<ContentPreview>;
export interface ContentMount { readonly ready: boolean; readonly pending: boolean; update(input: ContentInput): Promise<void>; clear(): void; dispose(): void }
class ResourceMismatch extends Error {}
const mounted = (output: ContentOutput): output is MountedContent => 'node' in output;
const same = (a: ContentInput, b: ContentInput) => a.markdown === b.markdown && a.html === b.html &&
  a.purpose === b.purpose && a.repo === b.repo && a.pageURL === b.pageURL && a.draft === b.draft && a.comment?.id === b.comment?.id &&
  a.comment?.url === b.comment?.url && a.comment?.parentId === b.comment?.parentId && a.revision === b.revision &&
  a.prepared?.html === b.prepared?.html && a.prepared?.revision === b.prepared?.revision &&
  a.prepared?.anchorPrefixes?.join('\n') === b.prepared?.anchorPrefixes?.join('\n') &&
  a.prepared?.resources === b.prepared?.resources;

interface MountOptions {
  signal?: AbortSignal;
  /** Readable output is installed. It remains ready while a replacement prepares. */
  onReady?: (ready: boolean) => void;
  acquire?: ContentAcquisition;
}
/** Preparation is detached; installed output changes only after the current result is ready. */
export const mountContent: (target: HTMLElement, renderer: ContentRenderer, options?: MountOptions) => ContentMount = installContent;
function installContent(target: HTMLElement, renderer: ContentRenderer, options: MountOptions = {}) {
  let input: ContentInput | undefined, generation: AbortController | undefined, candidate: AbortController | undefined,
    view: { output: ContentOutput; lifetime: AbortController } | undefined, pending = Promise.resolve(), disposed = false, ready = false, failure: HTMLElement | undefined;
  const publishReady = (value: boolean) => {
    if (ready !== value) { ready = value; options.onReady?.(value); }
  };
  const release = () => {
    const previous = view; view = undefined;
    if (previous) { previous.lifetime.abort(); if (mounted(previous.output)) previous.output.dispose?.(); }
  };
  const clear = () => {
    failure?.remove(); failure = undefined;
    generation?.abort(); generation = undefined; candidate?.abort(); candidate = undefined; input = undefined;
    try { release(); } finally { target.replaceChildren(); target.removeAttribute('aria-busy'); publishReady(false); }
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true; options.signal?.removeEventListener('abort', dispose); clear();
  };
  if (options.signal?.aborted) dispose();
  else options.signal?.addEventListener('abort', dispose, { once: true });
  const owner = {
    get input() { return input; },
    get ready() { return ready; },
    get pending() { return target.getAttribute('aria-busy')==='true'; },
    clear, dispose,
    update(value: ContentInput): Promise<void> {
      if (disposed) return Promise.resolve();
      const next = { ...value, ...(value.comment ? { comment: { ...value.comment } } : {}) };
      if (input && !failure && same(input, next)) return pending;
      failure?.remove(); failure = undefined;
      generation?.abort(); candidate?.abort();
      const current = generation = new AbortController(); input = next;
      let failing = false;
      const retained = view && mounted(view.output) && view.output.update ? view : undefined;
      const lifetime = retained?.lifetime || (candidate = new AbortController());
      let acquired: Promise<ContentPreview> | undefined;
      const delivery = () => acquired ||= options.acquire ? options.acquire(next, current.signal)
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
        current.abort(); target.removeAttribute('aria-busy');
        if (!retained) lifetime.abort();
        if (!view) { target.textContent = next.markdown; publishReady(true); }
        const status = failure = document.createElement('div'); status.className = 'giscus-content-recovery'; status.setAttribute('role', 'status');
        const reload = cause instanceof ResourceMismatch;
        status.append(document.createTextNode(reload ? 'Content resources changed. Reload this page to continue. ' : 'Formatted content could not load. '));
        const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = reload ? 'Reload' : 'Retry';
        retry.addEventListener('click', () => { if (!disposed) { if (reload) location.reload(); else void owner.update(next).catch(() => {}); } });
        status.append(retry); target.append(status);
        throw cause;
      };
      const install = (output: ContentOutput) => {
        if (!active()) { lifetime.abort(); if (mounted(output)) output.dispose?.(); return; }
        release();
        if (!active()) { lifetime.abort(); if (mounted(output)) output.dispose?.(); return; }
        view = { output, lifetime }; if (candidate === lifetime) candidate = undefined;
        target.replaceChildren(mounted(output) ? output.node : output);
        publishReady(true);
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
  return owner;
}

/** Selected deployment preparation already applied its commenter trust policy. */
export function preparedHTML(options: {
  /** Selected profile resources can start before its body acquisition completes. */
  resources?: ContentResources;
  /** Optional controls belong to the chosen profile and installed output lifetime. */
  enhance?: (root: DocumentFragment, input: ContentInput, context: ContentContext) => void | Promise<void>;
} = {}): ContentRenderer {
  return async (input, context) => {
    const styles = contentResources(options.resources, input.pageURL, false);
    void styles.catch(() => {}); // Prose can be readable without the selected feature styles.
    const content = input.prepared || await context.preparedContent();
    if (content.resources !== undefined && content.resources !== options.resources?.revision) throw new ResourceMismatch();
    if (content.resources !== undefined) await styles;
    context.signal.throwIfAborted();
    const template = document.createElement('template'); template.innerHTML = content.html;
    const ids = new Map<string, string>();
    for (const element of template.content.querySelectorAll<HTMLElement>('[id]')) {
      if (!content.anchorPrefixes?.some(prefix => element.id.startsWith(prefix))) continue;
      const old = element.id, id = 'gw-content-' + crypto.randomUUID(); ids.set(old, id); element.id = id;
    }
    for (const link of template.content.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')) {
      let href = link.getAttribute('href')!.slice(1); try { href = decodeURIComponent(href); } catch { /* Leave malformed targets unchanged. */ }
      const id = ids.get(href); if (id) link.setAttribute('href', '#' + id);
    }
    const controls = [...template.content.querySelectorAll<HTMLButtonElement>('button[data-content-enhancement]:not([disabled])')];
    for (const control of controls) control.disabled = true;
    const enhanced = (async () => options.enhance?.(template.content, input, context))();
    void Promise.all([enhanced, contentResources(content.resources !== undefined ? options.resources : undefined, input.pageURL, true)]).then(() => {
      if (!context.lifetime.aborted) for (const control of controls) control.disabled = false;
    }).catch(() => { /* Enhancement failure leaves controls unavailable and content readable. */ });
    return template.content;
  };
}
const resources = new WeakMap<Document, Map<string, Promise<void>>>();
async function contentResources(value: ContentResources | undefined, pageURL: string, enhancement: boolean): Promise<void> {
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
  return Promise.all(enhancement ? (value?.scripts || []).map(url => load(url, 'script')) : (value?.styles || []).map(url => load(url, 'style'))).then(() => {});
}

/** Copy is an optional control; its failure never changes interpretation or publication. */
export function copyControl(block: HTMLElement, source: string, labels: {copy:string;copied:string;copyFailed:string}, signal: AbortSignal): void {
  const button = document.createElement('button'); button.type = 'button'; button.className = 'code-copy';
  button.append(icon('copy')); button.title = labels.copy; button.setAttribute('aria-label', labels.copy);
  let reset: ReturnType<typeof setTimeout> | undefined;
  signal.addEventListener('abort', () => clearTimeout(reset), { once: true });
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(source); if (signal.aborted) return;
      button.replaceChildren(icon('check')); button.title = labels.copied; button.setAttribute('aria-label', labels.copied);
      clearTimeout(reset); reset = setTimeout(() => { button.replaceChildren(icon('copy')); button.title = labels.copy; button.setAttribute('aria-label', labels.copy); }, 2000);
    } catch { if (!signal.aborted) { button.title = labels.copyFailed; button.setAttribute('aria-label', labels.copyFailed); } }
  }, { signal });
  block.append(button);
}

export type OwnedContentInput = Omit<ContentInputData, 'repo' | 'pageURL' | 'html'> & { revision?: string | number };
export interface OwnedContentMount extends Omit<ContentMount, 'update'> { update(input: OwnedContentInput | Comment): Promise<void> }
export interface ContentOwner {
  mount(target: HTMLElement, input?: OwnedContentInput | Comment, options?: { signal?: AbortSignal; onReady?: (ready: boolean) => void }): OwnedContentMount;
  /** Only accepted reading/effect observations enter the selected content lifecycle. */
  observe(observation: AcceptedObservation, nodes: Record<string, Comment>): void;
}
/** The selected profile, canonical context, acquisition and installed mounts have one owner. */
export function createContentOwner(options: {
  repo: string;
  pageURL: string;
  profile: ContentProfile;
  signal: AbortSignal;
  batch(inputs: ContentInputData[], signal: AbortSignal): Promise<ContentBatchResult>;
}): ContentOwner {
  const acquire = batchRequests<ContentInputData,ContentPreview>({
    bytes:input=>new TextEncoder().encode(JSON.stringify(input)).byteLength,
    async run(inputs, signal) {
      const response=await options.batch(inputs,signal);signal.throwIfAborted();
      if(response.results.length!==inputs.length)throw new Error('Invalid content response.');
      return response.results.map(result=>'error' in result?{error:new Error(result.error)}:{value:result});
    },
  });
  const delivery:ContentAcquisition=(input,signal)=>acquire(JSON.stringify(input),input).wait(signal);
  const hints = new Map<string, {markdown:string;html:string}>();
  const mounts = new Map<ReturnType<typeof installContent>, string | undefined>();
  const bound = (input: OwnedContentInput | Comment): ContentInput => {
    const source = 'body' in input ? {markdown: input.body, purpose: 'comment' as const, comment: {id:input.id,url:input.url,parentId:input.parentId}} : input;
    const hint = source.purpose==='comment' && source.comment && hints.get(source.comment.id);
    return {...source,repo:options.repo,pageURL:options.pageURL,...(hint && hint.markdown===source.markdown?{html:hint.html}:{})};
  };
  options.signal.addEventListener('abort', () => { for (const mount of mounts.keys()) mount.dispose(); mounts.clear(); hints.clear(); }, {once: true});
  return {
    mount(target, input, settings = {}) {
      options.signal.throwIfAborted();
      const signal = settings.signal ? AbortSignal.any([options.signal, settings.signal]) : options.signal;
      signal.throwIfAborted();
      const installed = installContent(target, options.profile.render, {signal, onReady: settings.onReady, acquire: delivery});
      const mount = {
        get ready() { return installed.ready; },
        get pending() { return installed.pending; },
        update(next: OwnedContentInput | Comment) { mounts.set(installed, 'body' in next ? next.id : next.comment?.id); return installed.update(bound(next)); },
        clear: installed.clear,
        dispose() { mounts.delete(installed); installed.dispose(); },
      };
      mounts.set(installed, undefined); signal.addEventListener('abort', () => mounts.delete(installed), {once:true});
      if (input) void mount.update(input).catch(() => {});
      return mount;
    },
    observe(observation, nodes) {
      for (const [id,hint] of hints) if (!nodes[id] || nodes[id]!.deletedAt || nodes[id]!.body!==hint.markdown) hints.delete(id);
      for (const [id, hint] of Object.entries(observation.contentHints || {})) {
        const node = nodes[id]; if (node && !node.deletedAt && node.body===hint.markdown) hints.set(id,{...hint});
      }
      for (const [mount, id] of mounts) {
        const node = id && nodes[id]; if (!node || node.deletedAt) continue;
        const input = bound(node);
        if (!mount.input || !same(mount.input, input))
          void mount.update(input).catch(() => {});
      }
    },
  };
}
