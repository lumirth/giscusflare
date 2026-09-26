import { html, render, nothing } from "lit-html";
import { strings, relativeDate, message } from "../i18n.js";
import type { HeaderFactory } from "./contracts.js";
export const createHeader: HeaderFactory = ({ runtime }) => {
  const element = document.createElement("div");
  return {
    element,
    update({ comment: c, reply }) {
      const t = strings(runtime.config.lang),
        date = new Date(c.createdAt);
      element.className = reply ? "gsc-reply-header" : "gsc-comment-header";
      render(
        html`<div class=${reply ? "gsc-reply-author" : "gsc-comment-author"}>
            <a
              href=${c.author?.url || c.url}
              class="gsc-comment-author-avatar"
              target="_blank"
              rel="nofollow noopener noreferrer"
            >
              ${!reply && c.author ? html`<img class="rounded-full mr-2" src=${c.author.avatarUrl} width="30" height="30" alt=${"@" + c.author.login} loading="lazy" />` : nothing}
              <span
                class="link-primary overflow-hidden text-ellipsis font-semibold"
                >${c.author?.login || t.deletedAuthor}</span
              >
            </a>
            <a
              class="link-secondary overflow-hidden text-ellipsis"
              href=${c.url}
              target="_blank"
              rel="nofollow noopener noreferrer"
              ><time
                class="whitespace-nowrap"
                datetime=${c.createdAt}
                title=${date.toLocaleString(runtime.config.lang)}
                >${relativeDate(date, runtime.config.lang)}</time
              ></a
            >
            ${c.authorAssociation && c.authorAssociation !== "NONE" ? html`<div class="hidden text-xs leading-[18px] sm:inline-flex"><span class="color-box-border-info font-medium capitalize rounded-xl border px-[7px]">${message(runtime.config.lang, c.authorAssociation)}</span></div>` : nothing}
          </div>
          ${c.lastEditedAt ? html`<span class="color-text-secondary" title=${new Date(c.lastEditedAt).toLocaleString(runtime.config.lang)}>${t.edited}</span>` : nothing}`,
        element,
      );
    },
    dispose() {
      render(nothing, element);
    },
  };
};
