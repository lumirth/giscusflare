import { html, nothing } from "lit-html";
import { strings, relativeDate, message } from "../i18n.js";
import type { HeaderSlot } from "./contracts.js";

export const header: HeaderSlot = ({ runtime }, comment) => {
  const lang = runtime.appearance.lang, t = strings(lang), date = new Date(comment.createdAt);
  return html`<div class="gsc-comment-header">
    <a class="gsc-author" href=${comment.author?.url || comment.url} target="_blank" rel="nofollow noopener noreferrer">
      ${comment.author ? html`<img src=${comment.author.avatarUrl} width="30" height="30" loading="lazy" alt="">` : nothing}
      <span>${comment.author?.login || t.deletedAuthor}</span>
    </a>
    <a class="gsc-time" href=${comment.url} target="_blank" rel="nofollow noopener noreferrer">
      <time datetime=${comment.createdAt} title=${date.toLocaleString(lang)}>${relativeDate(date, lang)}</time>
    </a>
    ${comment.authorAssociation && comment.authorAssociation !== 'NONE' ? html`<span class="gsc-association">${message(lang, comment.authorAssociation)}</span>` : nothing}
    ${comment.lastEditedAt ? html`<span class="gsc-edited" title=${new Date(comment.lastEditedAt).toLocaleString(lang)}>${t.edited}</span>` : nothing}
  </div>`;
};
