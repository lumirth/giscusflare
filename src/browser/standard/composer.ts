import { html, render, nothing } from "lit-html";
import { AsyncDirective } from "lit-html/async-directive.js";
import { directive } from "lit-html/directive.js";
import { createEditor } from "../headless.js";
import { strings, message } from "../i18n.js";
import { icon } from "./icon.js";
import type { StandardContext } from "./contracts.js";

export function createComposer({ runtime, report }: StandardContext, name: string, signal: AbortSignal): HTMLElement {
  let acquired = false;
  const icons = { typography: icon('typography'), markdown: icon('markdown'), signOut: icon('sign-out'), github: icon('mark-github') };
  return createEditor(runtime, name, { signal, render(editor) {
    const { form, textarea, previewElement } = editor;
    if (!acquired) {
      acquired = true;
      form.className = 'color-bg-primary color-border-primary gsc-comment-box' + (name.startsWith('reply:') ? ' gsc-comment-box-is-reply' : '');
      previewElement.className = 'markdown color-border-primary gsc-comment-box-preview';
      let automaticHeight = '';
      textarea.addEventListener('input', () => {
        if (textarea.style.height && textarea.style.height !== automaticHeight) return;
        const scroll = window.scrollY;
        textarea.style.height = 'auto';
        textarea.style.height = automaticHeight = textarea.scrollHeight + 'px';
        if (window.scrollY !== scroll) window.scrollTo({ top: scroll, behavior: 'instant' });
      }, { signal: editor.signal });
      editor.signal.addEventListener('abort', () => render(nothing, form), { once: true });
    }
    const lang = runtime.appearance.lang, t = strings(lang), writing = editor.mode === 'write',
      signedIn = runtime.session.signedIn, reply = name.startsWith('reply:'), edit = name.startsWith('edit:');
    const label = reply ? t.reply : t.comments,
      placeholder = signedIn ? (reply ? message(lang, 'writeAReply') : t.placeholder) : message(lang, 'signInToComment');
    if (textarea.getAttribute('aria-label') !== label) textarea.setAttribute('aria-label', label);
    if (textarea.placeholder !== placeholder) textarea.placeholder = placeholder;
    const textareaClass = 'form-control input-contrast gsc-comment-box-textarea ' + (editor.fixedWidth ? 'gsc-is-fixed-width' : '');
    if (textarea.className !== textareaClass) textarea.className = textareaClass;
    if (previewElement.hidden !== writing) previewElement.hidden = writing;
    const typography = message(lang, editor.fixedWidth ? 'disableFixedWidth' : 'enableFixedWidth');
    render(html`<div class="color-bg-tertiary color-border-primary gsc-comment-box-tabs">
      <div class="mx-2 mb-[-1px] mt-2" role="group" aria-label=${t.editorMode}>
        <button type="button"
          class=${'rounded-t border border-b-0 px-4 py-2 ' + (writing ? 'color-text-primary color-bg-canvas color-border-primary' : 'color-text-secondary border-transparent')}
          aria-pressed=${String(writing)} @click=${() => editor.write()}>${t.write}</button>
        <button type="button"
          class=${'ml-1 rounded-t border border-b-0 px-4 py-2 ' + (!writing ? 'color-text-primary color-bg-canvas color-border-primary' : 'color-text-secondary border-transparent')}
          aria-pressed=${String(!writing)} ?disabled=${editor.previewPending} @click=${() => editor.preview()}>${t.preview}</button>
      </div>
      <div class="gsc-comment-box-md-toolbar" ?hidden=${!writing}>
        <button type="button" class="gsc-toolbar-item" aria-label=${typography} title=${typography}
          aria-pressed=${String(editor.fixedWidth)} @click=${() => editor.toggleFixedWidth()}>${icons.typography}</button>
      </div>
    </div>
    <div class="gsc-comment-box-main">
      <div class="gsc-comment-box-write" ?hidden=${!writing}>
        ${textarea}
        <div class="form-control input-contrast gsc-comment-box-textarea-extras">
          <a class="link-secondary gsc-comment-box-markdown-hint"
            href="https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting"
            target="_blank" rel="noopener noreferrer" title=${t.markdown} aria-label=${t.markdown}>${icons.markdown}</a>
        </div>
      </div>
      ${previewElement}
    </div>
    ${editor.error ? html`<p class="color-text-danger px-2" role="alert">${editor.error}</p>` : nothing}
    <div class="gsc-comment-box-bottom">
      ${signedIn && !reply && !edit ? html`<button type="button" class="link-secondary text-sm inline-flex items-center gap-2"
        @click=${() => { if (!editor.signal.aborted) void runtime.session.signOut().catch(report); }}>${icons.signOut}${t.signOut}</button>` : nothing}
      <div class="gsc-comment-box-buttons">
        ${reply || edit ? html`<button type="button" class="btn ml-1" @click=${() => editor.cancel()}>${t.cancel}</button>` : nothing}
        <button type="submit" class="btn btn-primary inline-flex items-center ml-1 gap-2"
          ?disabled=${editor.pending || (signedIn && !runtime.draft(name).trim())}>
          ${signedIn ? nothing : icons.github}${signedIn ? (edit ? t.save : reply ? t.reply : t.post) : t.signIn}
        </button>
      </div>
    </div>`, form);
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
