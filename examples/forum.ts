// A framework-neutral presentation consuming the same page document as the default UI.
import { mountContent } from 'giscusflare/content';
import { createEditor, type Presentation, type Writing } from 'giscusflare/headless';
const emojis = {
  THUMBS_UP: '👍', THUMBS_DOWN: '👎', LAUGH: '😄', HOORAY: '🎉',
  CONFUSED: '😕', HEART: '❤️', ROCKET: '🚀', EYES: '👀',
} as const;
const node = (tag: string, text = '') => {
  const element = document.createElement(tag);
  element.textContent = text;
  return element;
};

export const forumPresentation: Presentation = (target, page, scope) => {
  const status = node('p'), list = node('div'), editorHost = node('div'), toolbar = node('div');
  scope.own(() => { target.classList.remove('forum'); target.replaceChildren(); });
  target.classList.add('forum');
  status.setAttribute('role', 'status');
  list.className = 'forum-list'; editorHost.className = 'forum-editors'; toolbar.className = 'forum-toolbar';
  const action = (text: string, run: () => unknown) => {
    const button = node('button', text) as HTMLButtonElement;
    button.type = 'button';
    button.onclick = () => {
      Promise.resolve().then(() => {
        if (!scope.signal.aborted && target.contains(button)) return run();
      }).catch(error => {
        if (!scope.signal.aborted && error?.name !== 'AbortError') status.textContent = String(error);
      });
    };
    return button;
  };
  const auth = action('Sign in', () => page.session.signedIn ? page.session.signOut() : page.session.signIn());
  toolbar.append(node('h3', 'Discussion'), auth, action('Refresh', () => page.revalidate()),
    action('Reverse order', () => page.setOrder(page.order === 'oldest' ? 'newest' : 'oldest')));
  target.append(toolbar, status, list, editorHost);
  const editors = new Map<string, ReturnType<typeof createEditor>>();
  scope.own(() => { for (const editor of editors.values()) editor.dispose(); });
  const composer = (writing: Writing) => {
    const name = writing.id;
    let editor = editors.get(name);
    if (editor) return editor;
    const feedback = node('p'), submit = document.createElement('button');
    submit.type = 'submit';
    editor = createEditor(page, writing, { signal: scope.signal, render(editor) {
      const { form, textarea, previewElement } = editor;
      if (!form.hasChildNodes()) {
        textarea.rows = 5; textarea.setAttribute('aria-label', 'Your comment');
        form.className = 'forum-composer';
        form.append(action('Write', () => editor.write()), action('Preview', () => editor.preview()),
          textarea, previewElement, feedback, submit);
        if (name !== 'main') form.append(action('Cancel', () => writing.hide()));
      }
      const previewing = editor.mode === 'preview';
      if (textarea.hidden !== previewing) textarea.hidden = previewing;
      if (previewElement.hidden === previewing) previewElement.hidden = !previewing;
      if (feedback.textContent !== editor.error) feedback.textContent = editor.error;
      if (submit.disabled !== !(writing.actions.submit || writing.actions.retry)) submit.disabled = !(writing.actions.submit || writing.actions.retry);
      const label = page.session.signedIn ? 'Publish' : 'Sign in with GitHub';
      if (submit.textContent !== label) submit.textContent = label;
    } });
    editors.set(name, editor);
    editorHost.append(editor.form);
    return editor;
  };
  const articles = new Map<string, { element: HTMLElement; body: HTMLElement; content: ReturnType<typeof mountContent> }>();
  scope.own(() => { for (const article of articles.values()) article.content.dispose(); });
  const draw = () => {
    const { document: doc } = page;
    const authLabel = page.session.signedIn ? 'Sign out' : 'Sign in', problem = page.error || page.session.error;
    if (auth.textContent !== authLabel) auth.textContent = authLabel;
    if (status.textContent !== problem) status.textContent = problem;
    for (const [name, editor] of editors) if (name !== 'main' && !page.writings.get(name)?.open) {
      editor.dispose(); editors.delete(name);
    }
    composer(page.writing());
    for (const writing of page.writings.values()) if (writing.open) composer(writing);
    const live = new Set<string>();
    const card = (id: string): HTMLElement[] => {
      const comment = doc.nodes[id];
      if (!comment) return [];
      live.add(id);
      let retained = articles.get(id);
      if (!retained) {
        const element = node('article'), body = node('div');
        element.className = 'forum-post'; element.dataset.comment = id; body.className = 'forum-body';
        retained = { element, body, content: mountContent(body, page.content, { signal: scope.signal }) }; articles.set(id, retained);
      }
      const { element, body } = retained;
      body.hidden = false;
      if (comment.deletedAt) { retained.content.clear(); body.textContent = 'Comment deleted.'; }
      else void retained.content.update({ markdown: comment.body, html: comment.bodyHTML, purpose: 'comment', repo: page.config.repo,
        comment: { id: comment.id, url: comment.url, parentId: comment.parentId } }).catch(() => {});
      const byline = node('header'), avatar = node('span', (comment.author?.login || '?').slice(0, 1).toUpperCase());
      byline.className = 'forum-byline'; avatar.className = 'forum-avatar'; avatar.setAttribute('aria-hidden', 'true');
      const date = node('a', new Date(comment.createdAt).toLocaleString()) as HTMLAnchorElement;
      date.href = comment.url; byline.append(avatar, node('strong', comment.author?.login || 'Deleted'), date);
      const controls = node('div'), groups = page.reactions(id);
      controls.className = 'forum-actions';
      for (const reaction of Object.keys(emojis) as (keyof typeof emojis)[]) {
        const group = groups[reaction], button = action(`${emojis[reaction]} ${group?.count || 0}`,
          () => page.setReaction(id, reaction, !group?.selected));
        button.disabled = page.actions(id).react.status !== 'available';
        button.setAttribute('aria-pressed', String(Boolean(group?.selected))); controls.append(button);
      }
      if (page.actions(id).recover.status === 'available') controls.append(action('Recover action', () => page.retryAction(id)));
      controls.append(action('Reply', () => page.interactions.focus(page.writing({ kind: 'reply', id: comment.parentId || id }).show().id)));
      if (page.actions(id).edit.status === 'available') controls.append(action('Edit', () => page.interactions.focus(page.writing({ kind: 'edit', id }).show().id)));
      if (comment.isMinimized && !comment.deletedAt) {
        const disclosure = document.createElement('details'); disclosure.append(node('summary', 'Hidden comment'), body);
        element.replaceChildren(byline, disclosure, controls);
      } else element.replaceChildren(byline, body, controls);
      const repliesWindow = doc.replies[id];
      if (comment.parentId === null && repliesWindow) {
        const replies = node('div'); replies.className = 'replies';
        if (repliesWindow.cursor !== null) replies.append(action('Earlier replies', () => page.loadReplies(id)));
        replies.append(...repliesWindow.ids.flatMap(card)); element.append(replies);
      }
      return [element];
    };
    list.replaceChildren(...doc.roots.ids.flatMap(card));
    if (doc.roots.cursor !== null) list.append(action('More comments', () => page.loadMore()));
    for (const [id, article] of articles) if (!live.has(id)) { article.content.dispose(); articles.delete(id); }
  };
  let rendered = page.document;
  scope.own(page.subscribe(() => {
    if (rendered === page.document) return;
    rendered = page.document; draw();
  }));
  draw();
};
