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
import type { StandardParts, StandardContext } from "./contracts.js";

/** One card grammar serves root comments and replies; the renderer owns its children. */
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
    const composer = (name: string) => parts.composer ? parts.composer(context, name)
      : name === 'main' ? main ??= createComposer(context, name, scope.signal) : boundComposer(context, name);
    const react = (subject: Comment | Discussion | null, position: 'top' | 'bottom') =>
      (parts.reactions || reactions)(context, { subject, position });
    const attempt = (work: () => Promise<unknown>) => () => {
      if (!scope.signal.aborted) void work().catch(error => {
        if (error?.name !== 'AbortError') context.report(error);
      });
    };
    const loading = (label: string) => html`<p class="gsc-loading" role="status"><span class="gsc-loading-image" aria-hidden="true"></span>${label}</p>`;
    const replyTo = (id: string) => () => {
      if (!scope.signal.aborted) runtime.interactions.focus(runtime.beginReply(id));
    };
    function card(comment: Comment) {
      const { document: doc, drafts } = runtime, lang = runtime.appearance.lang, t = strings(lang),
        isRoot = comment.parentId === null, window = doc.replies[comment.id],
        replying = isRoot && Boolean(drafts.get('reply:' + comment.id)?.editor),
        replies = (window?.ids || []).map(id => doc.nodes[id]).filter((node): node is Comment => Boolean(node)),
        hidden = Math.max(0, (window?.total ?? replies.length) - replies.length);
      const content = comment.deletedAt ? html`<p class="gsc-deleted">${t.deletedComment}</p>`
        : comment.isMinimized ? html`<details class="gsc-minimized">
            <summary>${t.hidden}${comment.minimizedReason ? ' · ' + comment.minimizedReason : ''}</summary>
            ${body(context, comment)}
          </details>`
        : body(context, comment);
      return html`<article class="gsc-comment" id=${'comment-' + comment.id}
        data-reply=${String(!isRoot)} data-own=${String(comment.viewerDidAuthor)}>
        <header class="gsc-comment-heading">
          ${(parts.header || header)(context, comment)}${actions(context, target, comment)}
        </header>
        ${content}
        ${!comment.deletedAt && !comment.isMinimized || isRoot && !replying && runtime.canCompose ? html`<footer class="gsc-comment-footer">
          ${!comment.deletedAt && !comment.isMinimized ? html`
            ${react(comment, 'top')}
            ${doc.metadata.thread?.answerId === comment.id ? html`<span class="gsc-answer">${icon('check')}${t.answered}</span>` : nothing}
            ${isRoot ? html`<span class="gsc-reply-count">${message(lang, 'replies', window?.total ?? replies.length, window?.total == null ? '+' : '')}</span>` : nothing}
          ` : nothing}
          ${isRoot && !replying && runtime.canCompose ? html`<button type="button" @click=${replyTo(comment.id)}>${t.writeReply}</button>` : nothing}
        </footer>` : nothing}
        ${isRoot && (window?.total ?? replies.length) ? html`<section class="gsc-replies" aria-label=${t.reply}>
          ${window?.cursor !== null && window ? html`<button type="button" ?disabled=${runtime.reading(comment.id)}
            @click=${attempt(() => runtime.loadReplies(comment.id))}>${runtime.reading(comment.id) ? t.loadingReplies : hidden ? message(lang, 'showPreviousReplies', hidden) : t.more}
          </button>` : nothing}
          ${repeat(replies, item => item.id, card)}
        </section>` : nothing}
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
          problem = error || runtime.error || runtime.session.error;
        if (root.lang !== lang) root.lang = lang;
        if (root.getAttribute('aria-label') !== t.comments) root.setAttribute('aria-label', t.comments);
        if (target.dataset.theme !== runtime.appearance.theme) target.dataset.theme = runtime.appearance.theme;
        if (root.dataset.inputPosition !== runtime.appearance.inputPosition) root.dataset.inputPosition = runtime.appearance.inputPosition;
        const direction = /^(ar|he|fa|ur)(-|$)/.test(lang) ? 'rtl' : 'ltr';
        if (target.dir !== direction) target.dir = direction;
        const orders = [
          { value: 'oldest' as const, label: t.oldest }, { value: 'newest' as const, label: t.newest },
          ...metadata.profiles.map(profile => ({ value: { profile }, label: profile })),
        ];
        const selected = (value: typeof orders[number]['value']) => typeof value === 'string'
          ? value === runtime.order : typeof runtime.order === 'object' && value.profile === runtime.order.profile;
        const commentsView = html`<section class="gsc-comments">
          <header class="gsc-header">
            <div class="gsc-meta">
              <a class="gsc-comments-count" href=${destination} target="_blank" rel="noopener noreferrer">${message(lang, 'comments', roots.total ?? comments.length, roots.total === null ? '+' : '')}</a>
              <small>powered by <a href="https://github.com/lumirth/giscusflare" target="_blank" rel="noopener noreferrer">giscusflare</a></small>
            </div>
            <nav class="gsc-order" aria-label=${t.commentOrder}>
              ${orders.map(({ value, label }) => html`<button type="button" aria-pressed=${String(selected(value))}
                @click=${attempt(() => runtime.setOrder(value))}>${label}</button>`)}
            </nav>
            ${discussion ? actions(context, target, discussion) : nothing}
          </header>
          ${runtime.reading() || !runtime.ready && !problem ? loading(t.loading) : nothing}
          ${repeat(comments, comment => comment.id, card)}
          ${roots.cursor ? html`<button class="gsc-pagination" type="button" ?disabled=${runtime.reading()}
            @click=${attempt(() => runtime.refresh(true))}>${t.more}</button>` : nothing}
        </section>`;
        render(html`
          ${runtime.appearance.reactionsEnabled ? html`<section class="gsc-reactions" aria-label=${t.reactions}>
            <a class="gsc-reactions-count" href=${destination} target="_blank" rel="noopener noreferrer">${message(lang, 'reactions', Object.values(discussion?.reactions || {}).reduce((sum, group) => sum + group.count, 0))}
            </a>
            ${react(discussion || null, 'bottom')}
          </section>` : nothing}
          ${problem ? html`<p class="gsc-error" role="alert">${problem}<button type="button"
            @click=${() => { error = '';void runtime.refresh(); }}>${t.retry}</button></p>` : nothing}
          ${runtime.ready && !runtime.canCompose ? html`<p class="gsc-notice">${metadata.unavailable ? t.discussionUnavailable : metadata.archived ? t.archived : t.locked}</p>` : nothing}
          ${commentsView}
          <section class="gsc-active-editors" aria-label=${t.editorMode}>
            ${repeat([...runtime.drafts].filter(([, draft]) => draft.editor), ([name]) => name, ([name, draft]) => html`
              <section aria-label=${draft.editor!.kind === 'edit' ? t.edit : t.reply}>
                <h3>${draft.editor!.kind === 'edit' ? t.edit : t.reply}</h3>
                ${composer(name)}
              </section>`)}
          </section>
          <div class="gsc-main-composer" ?hidden=${!runtime.canCompose}>${composer('main')}</div>`, root);
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
