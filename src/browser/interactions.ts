import { writingTargetKey, type Writing, type WritingOutcome } from "../conversation/writing.js";
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
  readonly writing: Writing;
  submit(): Promise<WritingOutcome>;
  clear(): boolean;
  undoClear(): boolean;
  dispose(): void;
}
/** One editor owns its DOM, projection, preview and native interaction lifetime. */
export function createEditor(runtime: Conversation, writing: Writing, options: {
  render(editor: Editor): void;
  signal?: AbortSignal;
  elements?: { form: HTMLFormElement; textarea: HTMLTextAreaElement; previewElement: HTMLElement };
  writeWhileSignedOut?: boolean;
  submitted?(outcome: WritingOutcome): void;
}): Editor {
  const name = writing.id;
  runtime.signal.throwIfAborted();
  options.signal?.throwIfAborted();
  const { form, textarea, previewElement } = options.elements ?? { form: document.createElement('form'), textarea: document.createElement('textarea'), previewElement: document.createElement('div') };
  const events = new window.AbortController();
  // Adopt a native draft entered before hydration, without replacing its field.
  if (options.elements && textarea.value && !writing.text && !writing.touched && !writing.protected && !writing.actions.undoClear) writing.update(textarea.value);
  form.dataset.composer = writingTargetKey(writing.target);
  form.dataset.writingId = writing.id;
  textarea.rows = 4;textarea.maxLength = 60000;textarea.dir = 'auto';
  let mode: 'write' | 'preview' = 'write', fixedWidth = false, error = '',
    changing = false, clearedSelection: [number, number, 'forward' | 'backward' | 'none'] | undefined, stop: (() => void) | undefined, unregister: (() => void) | undefined;
  const content = runtime.content.mount(previewElement, undefined, { signal: events.signal });
  const disposed = () => events.signal.aborted;
  const dispose = runtime.own(() => {
    options.signal?.removeEventListener('abort', dispose);
    events.abort();content.dispose();stop?.();unregister?.();
    if (!options.elements) { form.remove();form.replaceChildren(); }
  });
  options.signal?.addEventListener('abort', dispose, { once: true });
  const focus = () => textarea.focus({ preventScroll: true });
  const draw = () => { if (!disposed()) options.render(editor); };
  const sync = () => {
    if (disposed() || changing) return;
    const text = writing.text;
    if (textarea.value !== text) textarea.value = text;
    const disabled = !runtime.session.signedIn && !options.writeWhileSignedOut;
    if (textarea.disabled !== disabled) textarea.disabled = disabled;
    if (textarea.readOnly !== !writing.actions.edit) textarea.readOnly = !writing.actions.edit;
    draw();
  };
  const errorText = (cause: unknown, fallback: string) => cause instanceof Error ? cause.message : fallback;
  const replace = (text: string) => {
    focus();textarea.select();
    if (!document.execCommand('insertText', false, text) || textarea.value !== text) textarea.setRangeText(text, 0, textarea.value.length, 'end');
  };
  const editor: Editor = {
    form, textarea, previewElement, signal: events.signal, writing,
    get mode() { return mode; }, get fixedWidth() { return fixedWidth; },
    get error() { return error || writing.error?.message || runtime.session.error; }, get previewPending() { return content.pending; },
    get pending() { return writing.pending; },
    write() { if (!disposed()) { content.clear();mode = 'write';draw();focus(); } },
    toggleFixedWidth() { if (!disposed()) { fixedWidth = !fixedWidth;draw();focus(); } },
    clear() {
      if (disposed() || !writing.actions.clear) return false;
      error = '';
      clearedSelection = [textarea.selectionStart, textarea.selectionEnd, textarea.selectionDirection];
      changing = true;
      try { writing.clear();replace(''); }
      finally { changing = false;sync(); }
      content.clear();mode = 'write';draw();return true;
    },
    undoClear() {
      if (disposed() || !writing.actions.undoClear) return false;
      changing = true;
      try { writing.undoClear();replace(writing.text);if (clearedSelection) textarea.setSelectionRange(...clearedSelection); }
      finally { changing = false;clearedSelection = undefined;sync(); }
      return true;
    },
    async submit() {
      if (disposed()) return { status: 'blocked', reason: 'This editor is disposed.' };
      if (writing.pending) return writing.submit();
      error = '';
      try {
        if (!runtime.session.signedIn || runtime.session.needsAuthorization && !writing.protected) {
          await runtime.session.signIn();return { status: 'blocked', reason: 'Sign in before submitting.' };
        }
        writing.update(textarea.value);
        const outcome = await writing.submit();
        if (outcome.status === 'blocked') error = outcome.reason;
        if (!disposed() && outcome.status === 'saved') { content.clear();mode = 'write'; }
        if (options.submitted) queueMicrotask(() => { if (!runtime.signal.aborted && !options.signal?.aborted) options.submitted?.(outcome); });
        return outcome;
      } catch (cause) {
        error = errorText(cause, 'Unable to submit.');return { status: 'blocked', reason: error };
      } finally { sync(); }
    },
    async preview() {
      if (disposed()) return;
      const body = textarea.value;
      mode = 'preview';error = '';
      if (!body.trim()) { content.clear();draw();return; }
      const work = content.update({ markdown: body, purpose: 'preview', draft: writing.id });
      draw();
      await work.catch(() => {}); // The content owner preserves readable output and offers recovery.
      draw();
    },
    dispose,
  };
  try {
    textarea.addEventListener('input', () => { if (!changing) writing.update(textarea.value); }, { signal: events.signal });
    textarea.addEventListener('keydown', event => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault();form.requestSubmit(); }
    }, { signal: events.signal });
    form.addEventListener('submit', event => { event.preventDefault();void editor.submit(); }, { signal: events.signal });
    unregister = runtime.interactions.register(name, { focus: () => editor.write(), active: () => form.contains(document.activeElement) });
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
