import { html, nothing } from 'lit-html';
import { strings, relativeDate, message } from '../i18n.js';
import type { HeaderSlot } from './contracts.js';

export const header: HeaderSlot = ({ runtime }, comment) => {
  const lang = runtime.appearance.lang, t = strings(lang), date = new Date(comment.createdAt),
    reply = comment.parentId !== null;
  return html`<div class=${reply ? 'gsc-reply-header' : 'gsc-comment-header'}>
    <div class=${reply ? 'gsc-reply-author' : 'gsc-comment-author'}>
      <a href=${comment.author?.url || comment.url} class="gsc-comment-author-avatar" target="_blank" rel="nofollow noopener noreferrer">
        ${!reply && comment.author ? html`<img class="rounded-full mr-2" src=${comment.author.avatarUrl} width="30" height="30" alt=${'@' + comment.author.login} loading="lazy">` : nothing}
        <span class="link-primary overflow-hidden text-ellipsis font-semibold">${comment.author?.login || t.deletedAuthor}</span>
      </a>
      <a class="link-secondary overflow-hidden text-ellipsis" href=${comment.url} target="_blank" rel="nofollow noopener noreferrer">
        <time class="whitespace-nowrap" datetime=${comment.createdAt} title=${date.toLocaleString(lang)}>${relativeDate(date, lang)}</time>
      </a>
      ${comment.authorAssociation && comment.authorAssociation !== 'NONE' ? html`<div class="hidden text-xs leading-[18px] sm:inline-flex">
        <span class="color-box-border-info font-medium capitalize rounded-xl border px-[7px]">${message(lang, comment.authorAssociation)}</span>
      </div>` : nothing}
    </div>
    ${comment.lastEditedAt ? html`<span class="color-text-secondary" title=${new Date(comment.lastEditedAt).toLocaleString(lang)}>${t.edited}</span>` : nothing}
  </div>`;
};
