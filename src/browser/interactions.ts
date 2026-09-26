import type { ConversationRuntime } from "./runtime.js";

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
export interface ComposerState {
  mode: "write" | "preview";
  previewPending: boolean;
  previewHTML: string;
  previewBody: string;
  pending: boolean;
  fixedWidth: boolean;
  error: string;
}
export interface ComposerBinding {
  readonly state: Readonly<ComposerState>;
  subscribe(listener: () => void): () => void;
  write(): void;
  preview(): Promise<void>;
  toggleFixedWidth(): void;
  submit(): Promise<void>;
  cancel(): void;
  dispose(): void;
}
/** Behavior for consumer-owned DOM. Keep the supplied textarea mounted when previewing. */
export function bindComposer(
  runtime: ConversationRuntime,
  name: string,
  elements: { form: HTMLFormElement; textarea: HTMLTextAreaElement },
): ComposerBinding {
  const { form, textarea } = elements,
    controller = runtime.controller;
  let state: ComposerState = {
    mode: "write",
    previewPending: false,
    previewHTML: "",
    previewBody: "",
    pending: false,
    fixedWidth: false,
    error: "",
  };
  let disposed = false,
    version = 0;
  const listeners = new Set<() => void>();
  const emit = () => {
    if (!disposed) for (const listener of listeners) listener();
  };
  const sync = () => {
    // Assign only when the model actually changed the text. Normal input,
    // previews, reactions and refreshes leave the native editing history alone.
    const value = controller.draft(name);
    if (textarea.value !== value) textarea.value = value;
    textarea.disabled = !runtime.session.signedIn;
    state = {
      ...state,
      pending: controller.operationFor("composer", name)?.status === "pending",
    };
    textarea.readOnly = state.pending;
    emit();
  };
  const input = () => {
    controller.setDraft(name, textarea.value);
    runtime.saveDrafts();
    emit();
  };
  const submit = async () => {
    if (state.pending) return;
    if (!runtime.session.signedIn) {
      try {
        await runtime.session.signIn();
      } catch (error) {
        state = {
          ...state,
          error: error instanceof Error ? error.message : "Unable to sign in.",
        };
        emit();
      }
      return;
    }
    controller.setDraft(name, textarea.value);
    state = { ...state, error: "" };
    try {
      await controller.submit(name);
      state = { ...state, mode: "write", previewHTML: "", previewBody: "" };
    } catch (error) {
      state = {
        ...state,
        error: error instanceof Error ? error.message : "Unable to submit.",
      };
    } finally {
      sync();
      runtime.saveDrafts();
    }
  };
  const onSubmit = (event: SubmitEvent) => {
    event.preventDefault();
    void submit();
  };
  const keydown = (event: KeyboardEvent) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      form.requestSubmit();
    }
  };
  textarea.addEventListener("input", input);
  textarea.addEventListener("keydown", keydown);
  form.addEventListener("submit", onSubmit);
  const unregister = runtime.interactions.register(name, {
    focus: () => textarea.focus({ preventScroll: true }),
    active: () => form.contains(document.activeElement),
  });
  const drafts = controller.subscribeDrafts(sync);
  const unsubscribe = controller.subscribe(sync),
    auth = runtime.session.subscribe(sync);
  sync();
  return {
    get state() {
      return state;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    write() {
      version++;
      state = { ...state, mode: "write", previewPending: false };
      emit();
      textarea.focus({ preventScroll: true });
    },
    async preview() {
      const current = ++version,
        body = textarea.value;
      state = {
        ...state,
        mode: "preview",
        previewBody: body,
        previewHTML: "",
        previewPending: Boolean(body.trim()),
        error: "",
      };
      emit();
      if (!body.trim()) return;
      try {
        const html = await controller.preview(body);
        if (current !== version || disposed) return;
        state = { ...state, previewHTML: html };
      } catch (error) {
        if (current !== version || disposed) return;
        state = {
          ...state,
          error: error instanceof Error ? error.message : "Unable to preview.",
        };
      } finally {
        if (current === version && !disposed) {
          state = { ...state, previewPending: false };
          emit();
        }
      }
    },
    toggleFixedWidth() {
      state = { ...state, fixedWidth: !state.fixedWidth };
      emit();
      textarea.focus({ preventScroll: true });
    },
    submit,
    cancel() {
      controller.closeEditor(name);
    },
    dispose() {
      disposed = true;
      version++;
      unregister();
      drafts();
      unsubscribe();
      auth();
      listeners.clear();
      textarea.removeEventListener("input", input);
      textarea.removeEventListener("keydown", keydown);
      form.removeEventListener("submit", onSubmit);
    },
  };
}

/** Optional details-menu ergonomics, independent of classes or presentation. */
export function bindDismissableMenu(menu: HTMLDetailsElement): () => void {
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
  document.addEventListener("pointerdown", pointer);
  menu.addEventListener("keydown", keyboard);
  return () => {
    document.removeEventListener("pointerdown", pointer);
    menu.removeEventListener("keydown", keyboard);
  };
}
