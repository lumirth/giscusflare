import { html, render, nothing } from "lit-html";
import { repeat } from "lit-html/directives/repeat.js";
import type { Presentation, Comment, Discussion } from "../headless.js";
import { strings, message } from "../i18n.js";
import { icon } from "./icon.js";
import { createComposer, composer as boundComposer } from "./composer.js";
import { reactions } from "./reactions.js";
import { header } from "./header.js";
import { actions } from "./actions.js";
import { body } from "./body.js";
import type { Writing } from "../../conversation/writing.js";
import type { StandardParts, StandardContext } from "./contracts.js";

/** Baseline giscus appearance over the canonical page and renderer-owned resources. */
export function createStandardPresentation(parts: StandardParts = {}): Presentation {
  return (target, runtime, scope) => {
    scope.signal.throwIfAborted();
    const root = document.createElement('section');root.className = 'gsc-main';
    const hadClass = target.classList.contains('giscusflare'),
      previousTheme = target.getAttribute('data-theme'), previousDir = target.getAttribute('dir');
    let error = '', disposed = false, drawing = false, main: HTMLElement | undefined, stop: (() => void) | undefined;
    const context: StandardContext = { runtime, scope, report(cause) {
      error = cause instanceof Error ? cause.message : String(cause);draw();
    } };
    scope.own(() => {
      disposed = true;stop?.();
      try { render(nothing, root); } finally {
        root.remove();
        if (!hadClass) target.classList.remove('giscusflare');
        if (previousTheme === null) target.removeAttribute('data-theme');else target.setAttribute('data-theme', previousTheme);
        if (previousDir === null) target.removeAttribute('dir');else target.setAttribute('dir', previousDir);
      }
    });
    target.append(root);target.classList.add('giscusflare');
    const composer = (writing: Writing) => parts.composer ? parts.composer(context, writing)
      : writing.id === 'main' ? main ??= createComposer(context, writing, scope.signal) : boundComposer(context, writing);
    const react = (subject: Comment | Discussion | null, position: 'top' | 'bottom') =>
      (parts.reactions || reactions)(context, { subject, position });
    const attempt = (work: () => Promise<unknown>) => () => {
      if (!scope.signal.aborted) void work().catch(error => {
        if (error?.name !== 'AbortError') context.report(error);
      });
    };
    const loading = (label: string) => html`<div class="gsc-loading" role="status"><div class="gsc-loading-image" aria-hidden="true"></div><p class="gsc-loading-text">${label}</p></div>`;
    const replyTo = (id: string) => () => {
      if (!scope.signal.aborted) runtime.interactions.focus(runtime.writing({kind:'reply',id}).show().id);
    };
      function content(c: Comment, reply: boolean) {
        const t = strings(runtime.appearance.lang);
        return html` ${
          runtime.writings.get("edit:" + c.id)?.open
            ? composer(runtime.writing({kind:'edit',id:c.id}))
            : html`<div
                dir="auto"
                class=${"markdown " + (reply ? "gsc-reply-content" : "gsc-comment-content") + (c.isMinimized ? " minimized" : "")}
              >
                ${
                  c.deletedAt
                    ? html`<em class="color-text-secondary"
                        >${t.deletedComment}</em
                      >`
                    : c.isMinimized
                      ? html`<details>
                          <summary class="color-text-secondary">
                            ${t.hidden}${c.minimizedReason ? " · " + c.minimizedReason : ""}
                          </summary>
                          ${body(context, c)}
                        </details>`
                      : body(context, c)
                }
              </div>`
        }`;
      }
      function reply(c: Comment) {
        return html`<article class="gsc-reply" id=${"comment-" + c.id}>
          <div class="gsc-tl-line"></div>
          <div class="flex">
            <div class="gsc-reply-author-avatar">
              ${c.author ? html`<a href=${c.author.url} target="_blank" rel="nofollow noopener noreferrer"><img class="rounded-full" src=${c.author.avatarUrl} width="30" height="30" loading="lazy" alt=${"@" + c.author.login} /></a>` : nothing}
            </div>
            <div class="w-full min-w-0 ml-2">
              <div class="gsc-header-with-actions">
                ${(parts.header || header)(context, c)}${actions(context, target, c)}
              </div>
              ${content(c, true)}
              ${
                !c.deletedAt && !c.isMinimized
                  ? html`<div class="gsc-reply-footer">
                      <div class="gsc-reply-reactions">${react(c, "top")}</div>
                      ${runtime.document.metadata.thread?.answerId === c.id ? html`<span class="color-text-success">${icon("check")}${strings(runtime.appearance.lang).answered}</span>` : nothing}
                    </div>`
                  : nothing
              }
            </div>
          </div>
        </article>`;
      }
      function comment(c: Comment) {
        const doc = runtime.document, window = doc.replies[c.id],
          t = strings(runtime.appearance.lang),
          replies = (window?.ids || []).map(id => doc.nodes[id]).filter((node): node is Comment => Boolean(node)),
          count = window?.total ?? replies.length,
          hidden = Math.max(0, count - replies.length),
          replying = Boolean(runtime.writings.get("reply:" + c.id)?.open);
        return html`<article class="gsc-comment" id=${"comment-" + c.id}>
          <div
            class=${"color-bg-primary w-full min-w-0 rounded-md border " + (c.viewerDidAuthor ? "gsc-comment-author-is-viewer" : "")}
          >
            <div class="gsc-header-with-actions">
              ${(parts.header || header)(context, c)}${actions(context, target, c)}
            </div>
            ${content(c, false)}
            ${
              !c.deletedAt && !c.isMinimized
                ? html`<div class="gsc-comment-footer">
                    <div class="gsc-comment-reactions">${react(c, "top")}</div>
                    <div class="gsc-comment-replies-count color-text-secondary">
                      ${message(runtime.appearance.lang, "replies", count)}
                    </div>
                  </div>`
                : nothing
            }
            ${
              count
                ? html`<div class="gsc-replies color-bg-inset">
                    ${
                      hidden
                        ? html`<div
                            class="flex h-8 items-center mb-2 pl-4 gsc-replies-more"
                          >
                            <div
                              class="flex w-[29px] shrink-0 content-center mr-[9px] gsc-replies-more-icon"
                            >
                              ${icon("kebab-horizontal")}
                            </div>
                            <button
                              class="color-text-link underline"
                              type="button"
                              ?disabled=${runtime.acquisition(c.id)}
                              @click=${attempt(() => runtime.loadReplies(c.id))}
                            >
                              ${runtime.acquisition(c.id) ? t.loadingReplies : message(runtime.appearance.lang, "showPreviousReplies", hidden)}
                            </button>
                          </div>`
                        : nothing
                    }
                    ${repeat(replies, (r) => r.id, reply)}
                  </div>`
                : nothing
            }
            ${replying ? composer(runtime.writing({kind:'reply',id:c.id})) : runtime.canCompose ? html`<div class="gsc-reply-box color-bg-tertiary"><button type="button" class="form-control color-text-secondary color-border-primary w-full cursor-text rounded border px-2 py-1 text-left focus:border-transparent" @click=${replyTo(c.id)}>${t.writeReply}</button></div>` : nothing}
          </div>
        </article>`;
      }
    function draw() {
      if (disposed || drawing) return;
      drawing = true;
      try {
        const { document: doc } = runtime, { metadata, roots } = doc,
          lang = runtime.appearance.lang, t = strings(lang), discussion = metadata.thread,
          comments = roots.ids.map(id => doc.nodes[id]).filter((node): node is Comment => Boolean(node)),
          destination = discussion?.url || 'https://github.com/' + runtime.config.repo + '/discussions',
          problem = error || runtime.error || runtime.session.error,
          initial = !runtime.ready && !problem,
          writable = runtime.canCompose,
          restartAvailable = runtime.continuity.status === 'restart-required' ||
            [roots, ...Object.values(doc.replies)].some(window => window.cursor === null && window.total !== null && window.total > window.ids.length),
          total = Object.values(discussion?.reactions || {}).reduce((sum, group) => sum + group.count, 0),
          replyCount = comments.reduce((sum, node) => sum + (doc.replies[node.id]?.total ?? doc.replies[node.id]?.ids.length ?? 0), 0);
        if (root.lang !== lang) root.lang = lang;
        if (root.getAttribute('aria-label') !== t.comments) root.setAttribute('aria-label', t.comments);
        if (target.dataset.theme !== runtime.appearance.theme) target.dataset.theme = runtime.appearance.theme;
        if (root.dataset.inputPosition !== runtime.appearance.inputPosition) root.dataset.inputPosition = runtime.appearance.inputPosition;
        const direction = /^(ar|he|fa|ur)(-|$)/.test(lang) ? 'rtl' : 'ltr';
        if (target.dir !== direction) target.dir = direction;
        const selected = (profile: string) => typeof runtime.order === 'object' && runtime.order.profile === profile;
        const commentsView = html`<section class="gsc-comments" ?hidden=${initial}>
          <div class="gsc-header">
            <div class="gsc-left-header">
              <a class="gsc-comments-count link-primary" href=${destination} target="_blank" rel="noopener noreferrer">
                ${message(lang, 'comments', roots.total ?? comments.length, roots.total === null ? '+' : '')}
              </a>
              ${replyCount ? html`<span>·</span><span>${message(lang, 'replies', replyCount, roots.cursor ? '+' : '')}</span>` : nothing}
              <em class="text-sm color-text-secondary">– powered by
                <a class="link-secondary" href="https://github.com/lumirth/giscusflare" target="_blank" rel="noopener noreferrer">giscusflare</a>
              </em>
            </div>
            <ul class="BtnGroup gsc-right-header" aria-label=${t.commentOrder}>
              ${(['oldest', 'newest'] as const).map(order => html`<li class=${'BtnGroup-item ' + (runtime.order === order ? 'BtnGroup-item--selected' : '')}>
                <button type="button" class="btn" aria-pressed=${String(runtime.order === order)} @click=${attempt(() => runtime.setOrder(order))}>${t[order]}</button>
              </li>`)}
              ${metadata.profiles.map(profile => html`<li class=${'BtnGroup-item ' + (selected(profile) ? 'BtnGroup-item--selected' : '')}>
                <button type="button" class="btn" aria-pressed=${String(selected(profile))} @click=${attempt(() => runtime.setOrder({ profile }))}>${profile}</button>
              </li>`)}
            </ul>
            ${discussion ? actions(context, target, discussion) : nothing}
          </div>
          ${runtime.ready && runtime.acquisition()?.purpose !== 'revalidate' && runtime.acquisition() ? loading(t.loading) : nothing}
          ${restartAvailable ? html`<p class="color-text-secondary text-sm">${runtime.continuity.reason || 'New comments are available.'}<button type="button" class="ml-2 color-text-link" @click=${attempt(() => runtime.restart())}>${t.retry}</button></p>` : nothing}
          <div class="gsc-timeline">${repeat(comments, node => node.id, comment)}</div>
          ${roots.cursor ? html`<div class="gsc-pagination"><button type="button" class="gsc-pagination-button"
            ?disabled=${runtime.acquisition()} @click=${attempt(() => runtime.loadMore())}>${t.more}</button></div>` : nothing}
        </section>`;
        render(html`
          ${initial ? loading(t.loading) : nothing}
          ${runtime.appearance.reactionsEnabled && !initial ? html`<section class="gsc-reactions">
            <h4 class="gsc-reactions-count"><a class="link-primary" href=${destination} target="_blank" rel="noopener noreferrer">${message(lang, 'reactions', total)}</a></h4>
            <div class="gsc-discussion-reactions">${react(discussion || null, 'bottom')}</div>
          </section>` : nothing}
          ${problem ? html`<div class="flash flash-error" role="alert">${problem}<button class="ml-2 color-text-link" type="button"
            @click=${() => { error = '';void runtime.restart(); }}>${t.retry}</button></div>` : nothing}
          ${runtime.ready && !writable ? html`<p class="flash">${metadata.unavailable ? t.discussionUnavailable : metadata.archived ? t.archived : t.locked}</p>` : nothing}
          ${commentsView}
          <div class="gsc-main-composer" ?hidden=${!writable}>${composer(runtime.writing())}</div>`, root);
      } finally { drawing = false; }
    }
    let renderedDocument = runtime.document;
    stop = runtime.subscribe(page => {
      if (page.document === renderedDocument) return;
      renderedDocument = page.document; draw();
    });
    draw();
  };
}
