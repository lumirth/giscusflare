import { message } from "./i18n.js";
import type { Conversation } from "./runtime.js";

export interface FocusHandle {
  focus(): void;
  active(): boolean;
}
/** Presentations register interactions; the runtime never knows their selectors. */
export class InteractionRegistry {
  #handles = new Map<string, FocusHandle>();
  register(key: string, handle: FocusHandle): () => void {
    this.#handles.set(key, handle);
    return () => {
      if (this.#handles.get(key) === handle) this.#handles.delete(key);
    };
  }
  get active(): string | undefined {
    return [...this.#handles].find(([, h]) => h.active())?.[0];
  }
  focus(key: string): void {
    this.#handles.get(key)?.focus();
  }
  clear(): void {
    this.#handles.clear();
  }
}
export interface Editor {
  readonly form: HTMLFormElement;
  readonly textarea: HTMLTextAreaElement;
  readonly previewElement: HTMLElement;
  readonly signal: AbortSignal;
  readonly mode: "write" | "preview";
  readonly fixedWidth: boolean;
  readonly pending: boolean;
  readonly previewPending: boolean;
  readonly error: string;
  write(): void;
  preview(): Promise<void>;
  toggleFixedWidth(): void;
  submit(): Promise<void>;
  cancel(): void;
  dispose(): void;
}
/** One editor owns its DOM, projection, preview and native interaction lifetime. */
export function createEditor(runtime: Conversation, name: string, options: {
  render(editor: Editor): void;
  signal?: AbortSignal;
  draftWhileSignedOut?: boolean;
}): Editor {
  runtime.signal.throwIfAborted();
  options.signal?.throwIfAborted();
  const form = document.createElement('form'), textarea = document.createElement('textarea'),
    previewElement = document.createElement('div'), events = new window.AbortController();
  form.dataset.composer = name;
  textarea.rows = 4;textarea.maxLength = 60000;textarea.dir = 'auto';
  let mode: 'write' | 'preview' = 'write', fixedWidth = false, error = '', previewPending = false,
    preview: AbortController | undefined, stop: (() => void) | undefined, unregister: (() => void) | undefined;
  const disposed = () => events.signal.aborted;
  const dispose = runtime.own(() => {
    options.signal?.removeEventListener('abort', dispose);
    events.abort();preview?.abort();stop?.();unregister?.();form.remove();form.replaceChildren();
  });
  options.signal?.addEventListener('abort', dispose, { once: true });
  const pending = () => Boolean(runtime.drafts.get(name)?.pending);
  const focus = () => textarea.focus({ preventScroll: true });
  const draw = () => { if (!disposed()) options.render(editor); };
  const sync = () => {
    if (disposed()) return;
    const text = runtime.draft(name);
    if (textarea.value !== text) textarea.value = text;
    const disabled = (!runtime.session.signedIn && !options.draftWhileSignedOut) || !runtime.canCompose;
    if (textarea.disabled !== disabled) textarea.disabled = disabled;
    if (textarea.readOnly !== pending()) textarea.readOnly = pending();
    draw();
  };
  const errorText = (cause: unknown, fallback: string) => cause instanceof Error ? cause.message : fallback;
  const editor: Editor = {
    form, textarea, previewElement, signal: events.signal,
    get mode() { return mode; }, get fixedWidth() { return fixedWidth; },
    get error() { return error || runtime.drafts.get(name)?.error?.message || runtime.session.error; }, get previewPending() { return previewPending; },
    get pending() { return pending(); },
    write() { if (!disposed()) { preview?.abort();mode = 'write';previewPending = false;draw();focus(); } },
    toggleFixedWidth() { if (!disposed()) { fixedWidth = !fixedWidth;draw();focus(); } },
    cancel() { if (!disposed()) runtime.closeEditor(name); },
    async submit() {
      if (disposed() || pending()) return;
      error = '';
      try {
        if (!runtime.session.signedIn) { await runtime.session.signIn();return; }
        runtime.setDraft(name, textarea.value);
        await runtime.submit(name);
        if (disposed()) return;
        preview?.abort();mode = 'write';previewPending = false;previewElement.replaceChildren();
      } catch { /* The draft or session owns contribution and authentication failures. */ }
      finally { sync(); }
    },
    async preview() {
      if (disposed()) return;
      preview?.abort();const current = preview = new window.AbortController(), body = textarea.value;
      mode = 'preview';error = '';previewPending = Boolean(body.trim());
      previewElement.replaceChildren(message(runtime.appearance.lang, previewPending ? 'loadingPreview' : 'nothingToPreview'));
      draw();
      if (!previewPending) return;
      const active = () => !disposed() && !current.signal.aborted;
      try {
        const html = await runtime.preview(body, current.signal);
        if (active()) previewElement.replaceChildren(runtime.renderContent(html, body, current.signal));
      } catch (cause) {
        if (!active()) return;
        current.abort();previewPending = false;
        error = errorText(cause, 'Unable to preview.');previewElement.replaceChildren();draw();
      }
      finally { if (active()) { previewPending = false;draw(); } }
    },
    dispose,
  };
  try {
    textarea.addEventListener('input', () => runtime.setDraft(name, textarea.value), { signal: events.signal });
    textarea.addEventListener('keydown', event => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault();form.requestSubmit(); }
    }, { signal: events.signal });
    form.addEventListener('submit', event => { event.preventDefault();void editor.submit(); }, { signal: events.signal });
    unregister = runtime.interactions.register(name, { focus, active: () => form.contains(document.activeElement) });
    stop = runtime.subscribe(sync);sync();
  } catch (cause) { dispose();throw cause; }
  return editor;
}

/** Optional details-menu ergonomics, independent of classes or presentation. */
export function bindDismissableMenu(menu: HTMLDetailsElement, signal?: AbortSignal): () => void {
  const events = new window.AbortController();
  const dispose = () => { events.abort();signal?.removeEventListener('abort', dispose); };
  const pointer = (event: Event) => {
    if (!menu.contains(event.target as Node)) menu.open = false;
  };
  const keyboard = (event: KeyboardEvent) => {
    if (event.key === "Escape" && menu.open) {
      menu.open = false;
      menu.querySelector("summary")?.focus({ preventScroll: true });
      event.stopPropagation();
    }
  };
  if (signal?.aborted) return dispose;
  signal?.addEventListener('abort', dispose, { once: true });
  document.addEventListener("pointerdown", pointer, { signal: events.signal });
  menu.addEventListener("keydown", keyboard, { signal: events.signal });
  return dispose;
}
