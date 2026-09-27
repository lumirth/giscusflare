import { html, render, nothing } from "lit-html";
import { bindComposer, type ComposerBinding } from "../headless.js";
import { icon } from "../icons.js";
import { strings, message } from "../i18n.js";
import type { ComposerFactory } from "./contracts.js";

export const createComposer: ComposerFactory = ({ runtime, report }, name) => {
  const form = document.createElement("form");
  form.className =
    "color-bg-primary color-border-primary gsc-comment-box" +
    (name.startsWith("reply:") ? " gsc-comment-box-is-reply" : "");
  form.dataset.composer = name;
  // Keep decoration nodes stable while typing. Replacing siblings of the editor
  // breaks native undo coalescing in WebKit, even when the textarea survives.
  const icons = {
    typography: icon("typography"),
    markdown: icon("markdown"),
    signOut: icon("sign-out"),
    github: icon("mark-github"),
  };
  let binding: ComposerBinding | undefined;
  let previewSignature = "",
    preview: Node | string = "";
  const update = () => {
    const t = strings(runtime.appearance.lang),
      state = binding?.state;
    const writing = state?.mode !== "preview",
      signedIn = runtime.signedIn,
      reply = name.startsWith("reply:"),
      edit = name.startsWith("edit:");
    const signature = JSON.stringify([
      state?.previewPending,
      state?.previewBody,
      state?.previewHTML,
      runtime.appearance.lang,
    ]);
    if (signature !== previewSignature) {
      previewSignature = signature;
      preview = state?.previewPending
        ? message(runtime.appearance.lang, "loadingPreview")
        : state?.previewHTML
          ? runtime.renderContent(state.previewHTML, state.previewBody)
          : message(runtime.appearance.lang, "nothingToPreview");
    }
    render(
      html` <div
          class="color-bg-tertiary color-border-primary gsc-comment-box-tabs"
        >
          <div
            class="mx-2 mb-[-1px] mt-2"
            role="group"
            aria-label=${t.editorMode}
          >
            <button
              type="button"
              class=${"rounded-t border border-b-0 px-4 py-2 " + (writing ? "color-text-primary color-bg-canvas color-border-primary" : "color-text-secondary border-transparent")}
              aria-pressed=${String(writing)}
              @click=${() => binding?.write()}
            >
              ${t.write}
            </button>
            <button
              type="button"
              class=${"ml-1 rounded-t border border-b-0 px-4 py-2 " + (!writing ? "color-text-primary color-bg-canvas color-border-primary" : "color-text-secondary border-transparent")}
              aria-pressed=${String(!writing)}
              ?disabled=${state?.previewPending}
              @click=${() => binding?.preview()}
            >
              ${t.preview}
            </button>
          </div>
          <div class="gsc-comment-box-md-toolbar" ?hidden=${!writing}>
            <button
              type="button"
              class="gsc-toolbar-item"
              aria-label=${message(runtime.appearance.lang, state?.fixedWidth ? "disableFixedWidth" : "enableFixedWidth")}
              title=${message(runtime.appearance.lang, state?.fixedWidth ? "disableFixedWidth" : "enableFixedWidth")}
              aria-pressed=${String(Boolean(state?.fixedWidth))}
              @click=${() => binding?.toggleFixedWidth()}
            >
              ${icons.typography}
            </button>
          </div>
        </div>
        <div class="gsc-comment-box-main">
          <div class="gsc-comment-box-write" ?hidden=${!writing}>
            <textarea
              rows="4"
              maxlength="60000"
              dir="auto"
              class=${"form-control input-contrast gsc-comment-box-textarea " + (state?.fixedWidth ? "gsc-is-fixed-width" : "")}
              aria-label=${reply ? t.reply : t.comments}
              placeholder=${signedIn ? (reply ? message(runtime.appearance.lang, "writeAReply") : t.placeholder) : message(runtime.appearance.lang, "signInToComment")}
            ></textarea>
            <div
              class="form-control input-contrast gsc-comment-box-textarea-extras"
            >
              <a
                class="link-secondary gsc-comment-box-markdown-hint"
                href="https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting"
                target="_blank"
                rel="noopener noreferrer"
                title=${t.markdown}
                aria-label=${t.markdown}
                >${icons.markdown}</a
              >
            </div>
          </div>
          <div
            class="markdown color-border-primary gsc-comment-box-preview"
            ?hidden=${writing}
          >
            ${preview}
          </div>
        </div>
        ${state?.error ? html`<p class="color-text-danger px-2" role="alert">${state.error}</p>` : nothing}
        <div class="gsc-comment-box-bottom">
          ${signedIn && !reply && !edit ? html`<button type="button" class="link-secondary text-sm inline-flex items-center gap-2" @click=${() => runtime.signOut().catch(report)}>${icons.signOut}${t.signOut}</button>` : nothing}
          <div class="gsc-comment-box-buttons">
            ${reply || edit ? html`<button type="button" class="btn ml-1" @click=${() => binding?.cancel()}>${t.cancel}</button>` : nothing}
            <button
              type="submit"
              class="btn btn-primary inline-flex items-center ml-1 gap-2"
              ?disabled=${state?.pending || (signedIn && !runtime.draft(name).trim())}
            >
              ${signedIn ? nothing : icons.github}${signedIn ? (edit ? t.save : reply ? t.reply : t.post) : t.signIn}
            </button>
          </div>
        </div>`,
      form,
    );
  };
  update();
  const textarea = form.querySelector("textarea")!;
  binding = bindComposer(runtime, name, { form, textarea });
  const stop = binding.subscribe(update);
  // Respect a manual resize; automatic growth only follows the previous auto height.
  let autoHeight = "";
  const resize = () => {
    if (autoHeight && textarea.style.height !== autoHeight) return;
    const scroll = window.scrollY;
    textarea.style.height = "auto";
    textarea.style.height =
      Math.min(500, Math.max(100, textarea.scrollHeight)) + "px";
    autoHeight = textarea.style.height;
    if (window.scrollY !== scroll) window.scrollTo({ top: scroll });
  };
  textarea.addEventListener("input", resize);
  update();
  return {
    element: form,
    update,
    dispose() {
      stop();
      binding?.dispose();
      textarea.removeEventListener("input", resize);
      render(nothing, form);
    },
  };
};
