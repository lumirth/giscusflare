import { html, render, nothing } from "lit-html";
import { AsyncDirective } from "lit-html/async-directive.js";
import { directive } from "lit-html/directive.js";
import { createEditor } from "../headless.js";
import { strings, message } from "../i18n.js";
import { icon } from "./icon.js";
import type { StandardContext } from "./contracts.js";

export function createComposer({ runtime, report }: StandardContext, name: string, signal: AbortSignal): HTMLElement {
  let acquired = false;
  return createEditor(runtime, name, { signal, render(editor) {
    const { form, textarea, previewElement } = editor;
    if (!acquired) {
      acquired = true;form.className = 'gsc-comment-box';
      textarea.className = 'gsc-comment-box-textarea';
      previewElement.className = 'markdown gsc-comment-box-preview';
      editor.signal.addEventListener('abort', () => render(nothing, form), { once: true });
    }
    const lang = runtime.appearance.lang, t = strings(lang), writing = editor.mode === 'write',
      signedIn = runtime.session.signedIn, reply = name.startsWith('reply:'), edit = name.startsWith('edit:');
    const label = reply ? t.reply : t.comments,
      placeholder = signedIn ? (reply ? message(lang, 'writeAReply') : t.placeholder) : message(lang, 'signInToComment');
    if (textarea.getAttribute('aria-label') !== label) textarea.setAttribute('aria-label', label);
    if (textarea.placeholder !== placeholder) textarea.placeholder = placeholder;
    if (textarea.dataset.fixedWidth !== String(editor.fixedWidth)) textarea.dataset.fixedWidth = String(editor.fixedWidth);
    if (textarea.hidden === writing) textarea.hidden = !writing;
    if (previewElement.hidden !== writing) previewElement.hidden = writing;
    const typography = message(lang, editor.fixedWidth ? 'disableFixedWidth' : 'enableFixedWidth');
    render(html`<div class="gsc-editor-tabs" role="group" aria-label=${t.editorMode}>
      <button type="button" aria-pressed=${String(writing)} @click=${() => editor.write()}>${t.write}</button>
      <button type="button" aria-pressed=${String(!writing)} ?disabled=${editor.previewPending} @click=${() => editor.preview()}>${t.preview}</button>
      <button class="gsc-editor-toolbar" type="button" ?hidden=${!writing}
        aria-label=${typography} title=${typography} aria-pressed=${String(editor.fixedWidth)}
        @click=${() => editor.toggleFixedWidth()}>${icon('typography')}</button>
    </div>
    ${textarea}${previewElement}
    ${editor.error ? html`<p class="gsc-error" role="alert">${editor.error}</p>` : nothing}
    <footer class="gsc-editor-footer">
      <a href="https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting"
        target="_blank" rel="noopener noreferrer" aria-label=${t.markdown} title=${t.markdown}>
        ${icon('markdown')}<span>${t.markdown}</span>
      </a>
      ${signedIn && !reply && !edit ? html`<button type="button"
        @click=${() => { if (!editor.signal.aborted) void runtime.session.signOut().catch(report); }}>
        ${icon('sign-out')}${t.signOut}
      </button>` : nothing}
      ${reply || edit ? html`<button type="button" @click=${() => editor.cancel()}>${t.cancel}</button>` : nothing}
      <button type="submit" ?disabled=${editor.pending || (signedIn && !runtime.draft(name).trim())}>
        ${signedIn ? nothing : icon('mark-github')}${signedIn ? (edit ? t.save : reply ? t.reply : t.post) : t.signIn}
      </button>
    </footer>`, form);
  } }).form;
}

class Composer extends AsyncDirective {
  #element?: HTMLElement;
  #release?: () => void;
  render(context: StandardContext, name: string) {
    context.scope.signal.throwIfAborted();
    if (!this.#element) {
      const abort = new window.AbortController();
      this.#release = context.scope.own(() => { abort.abort();this.#element = undefined; });
      try { this.#element = createComposer(context, name, abort.signal); }
      catch (error) { this.#release();throw error; }
    }
    return this.#element;
  }
  override disconnected() { this.#release?.(); }
}
export const composer = directive(Composer);
