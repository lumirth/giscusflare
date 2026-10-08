// A framework-neutral presentation consuming the same page document as the default UI.
import { createEditor, type Presentation, type Comment } from 'giscusflare/headless';
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
  toolbar.append(node('h3', 'Discussion'), auth, action('Refresh', () => page.refresh()),
    action('Reverse order', () => page.setOrder(page.order === 'oldest' ? 'newest' : 'oldest')));
  target.append(toolbar, status, list, editorHost);
  const editors = new Map<string, ReturnType<typeof createEditor>>();
  scope.own(() => { for (const editor of editors.values()) editor.dispose(); });
  const composer = (name: string) => {
    let editor = editors.get(name);
    if (editor) return editor;
    const feedback = node('p'), submit = document.createElement('button');
    submit.type = 'submit';
    editor = createEditor(page, name, { signal: scope.signal, render(editor) {
      const { form, textarea, previewElement } = editor;
      if (!form.hasChildNodes()) {
        textarea.rows = 5; textarea.setAttribute('aria-label', 'Your comment');
        form.className = 'forum-composer';
        form.append(action('Write', () => editor.write()), action('Preview', () => editor.preview()),
          textarea, previewElement, feedback, submit);
        if (name !== 'main') form.append(action('Cancel', () => editor.cancel()));
      }
      const previewing = editor.mode === 'preview';
      if (textarea.hidden !== previewing) textarea.hidden = previewing;
      if (previewElement.hidden === previewing) previewElement.hidden = !previewing;
      if (feedback.textContent !== editor.error) feedback.textContent = editor.error;
      if (submit.disabled !== editor.pending) submit.disabled = editor.pending;
      const label = page.session.signedIn ? 'Publish' : 'Sign in with GitHub';
      if (submit.textContent !== label) submit.textContent = label;
    } });
    editors.set(name, editor);
    editorHost.append(editor.form);
    return editor;
  };
  const articles = new Map<string, { element: HTMLElement; body: HTMLElement; comment: Comment; release: () => void }>();
  scope.own(() => { for (const article of articles.values()) article.release(); });
  const draw = () => {
    const { document: doc } = page;
    const authLabel = page.session.signedIn ? 'Sign out' : 'Sign in', problem = page.error || page.session.error;
    if (auth.textContent !== authLabel) auth.textContent = authLabel;
    if (status.textContent !== problem) status.textContent = problem;
    for (const [name, editor] of editors) if (name !== 'main' && !page.drafts.get(name)?.editor) {
      editor.dispose(); editors.delete(name);
    }
    composer('main');
    for (const [name, draft] of page.drafts) if (draft.editor) composer(name);
    const live = new Set<string>();
    const card = (id: string): HTMLElement[] => {
      const comment = doc.nodes[id];
      if (!comment) return [];
      live.add(id);
      let retained = articles.get(id);
      if (!retained) {
        const element = node('article'), body = node('div');
        element.className = 'forum-post'; element.dataset.comment = id; body.className = 'forum-body';
        retained = { element, body, comment, release: () => {} }; articles.set(id, retained);
      }
      const { element, body } = retained, previous = retained.comment;
      if (!body.hasChildNodes() || previous.bodyHTML !== comment.bodyHTML || previous.body !== comment.body ||
          previous.deletedAt !== comment.deletedAt || previous.isMinimized !== comment.isMinimized) {
        retained.release();
        const lifetime = new window.AbortController();
        retained.release = scope.own(() => lifetime.abort());
        const content = comment.deletedAt ? node('p', 'Comment deleted.')
          : page.renderContent(comment.bodyHTML, comment.body, lifetime.signal);
        if (comment.isMinimized && !comment.deletedAt) {
          const hidden = document.createElement('details'); hidden.append(node('summary', 'Hidden comment'), content);
          body.replaceChildren(hidden);
        } else body.replaceChildren(content);
      }
      retained.comment = comment;
      const byline = node('header'), avatar = node('span', (comment.author?.login || '?').slice(0, 1).toUpperCase());
      byline.className = 'forum-byline'; avatar.className = 'forum-avatar'; avatar.setAttribute('aria-hidden', 'true');
      const date = node('a', new Date(comment.createdAt).toLocaleString()) as HTMLAnchorElement;
      date.href = comment.url; byline.append(avatar, node('strong', comment.author?.login || 'Deleted'), date);
      const controls = node('div'), groups = page.reactions(id);
      controls.className = 'forum-actions';
      for (const reaction of Object.keys(emojis) as (keyof typeof emojis)[]) {
        const group = groups[reaction], button = action(`${emojis[reaction]} ${group?.count || 0}`,
          () => page.setReaction(id, reaction, !group?.selected));
        button.disabled = !page.session.signedIn || !page.canCompose;
        button.setAttribute('aria-pressed', String(Boolean(group?.selected))); controls.append(button);
      }
      controls.append(action('Reply', () => page.interactions.focus(page.beginReply(comment.parentId || id))));
      if (comment.viewerCanUpdate) controls.append(action('Edit', () => page.interactions.focus(page.beginEdit(comment))));
      element.replaceChildren(byline, body, controls);
      const repliesWindow = doc.replies[id];
      if (comment.parentId === null && repliesWindow) {
        const replies = node('div'); replies.className = 'replies';
        if (repliesWindow.cursor !== null) replies.append(action('Earlier replies', () => page.loadReplies(id)));
        replies.append(...repliesWindow.ids.flatMap(card)); element.append(replies);
      }
      return [element];
    };
    list.replaceChildren(...doc.roots.ids.flatMap(card));
    if (doc.roots.cursor !== null) list.append(action('More comments', () => page.refresh(true)));
    for (const [id, article] of articles) if (!live.has(id)) { article.release(); articles.delete(id); }
  };
  let renderedDocument = page.document;
  scope.own(page.subscribe(() => {
    if (page.document === renderedDocument) return;
    renderedDocument = page.document; draw();
  }));
  draw();
};
