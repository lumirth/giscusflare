import type * as R from '../contracts/requests.js';
import type * as G from '../contracts/github.js';
import type { ThreadView } from '../domain/repository.js';
import type { AuthStatus } from '../domain/auth.js';
import { button, challenge, element as h, jsonElement, link, randomProof } from './dom.js';
import { markdown } from './markdown.js';
import { strings, reactionLabel, type Strings } from './i18n.js';

interface Boot extends R.Widget { defaultCommentOrder: 'oldest' | 'newest' }
interface Login { verifier: string; challenge: string; attempt: string; created: number }
interface Editor { kind: 'reply' | 'edit'; id: string; initial: string }
class ApiError extends Error { constructor(message: string, readonly status: number, readonly code: string) { super(message); } }
const emoji: Record<string, string> = { THUMBS_UP: '👍', THUMBS_DOWN: '👎', LAUGH: '😄', HOORAY: '🎉', CONFUSED: '😕', HEART: '♥', ROCKET: '🚀', EYES: '👀' };
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
class GiscusComments extends HTMLElement {
  #config: R.Widget;
  #order: 'oldest' | 'newest';
  #strings: Strings;
  #parent: string;
  #session = '';
  #view: ThreadView | null = null;
  #comments: G.RootComment[] = [];
  #cursor: string | null = null;
  #drafts = new Map<string, string>();
  #keys = new Map<string, string>();
  #editors = new Map<string, Editor>();
  #error = '';
  #busy = false;
  #generation = 0;
  #lastRefresh = 0;
  #abort?: AbortController;
  #observer?: ResizeObserver;
  #initTimer?: ReturnType<typeof setTimeout>;
  #pollTimer?: ReturnType<typeof setTimeout>;
  #initialized = false;
  #popup: Window | null = null;
  #loginState: Login | null = null;
  #consuming = false;
  constructor() {
    super();
    const { defaultCommentOrder, ...config } = jsonElement<Boot>();
    this.#config = config; this.#order = defaultCommentOrder; this.#strings = strings(config.lang); this.#parent = new URL(config.origin).origin;
  }
  connectedCallback(): void {
    this.classList.add('gsc-main'); this.#render();
    window.addEventListener('message', this.#message); window.addEventListener('focus', this.#focus);
    document.addEventListener('visibilitychange', this.#focus);
    this.#observer = new ResizeObserver(() => this.#post({ resizeHeight: document.body.getBoundingClientRect().height + 2 })); this.#observer.observe(document.body);
    this.#post({ ready: true, context: this.#config });
    this.#initTimer = setTimeout(() => { if (!this.#initialized) this.#initialize({}); }, window.parent === window ? 0 : 1000);
  }
  disconnectedCallback(): void {
    window.removeEventListener('message', this.#message); window.removeEventListener('focus', this.#focus); document.removeEventListener('visibilitychange', this.#focus);
    this.#observer?.disconnect(); this.#abort?.abort(); clearTimeout(this.#initTimer); clearTimeout(this.#pollTimer);
  }
  #post(value: unknown): void { if (window.parent !== window) window.parent.postMessage({ giscus: value }, this.#parent); }
  #focus = (): void => {
    // Refresh on focus only when there are no drafts, editors, or extra pages.
    if (!document.hidden && this.#initialized && !this.#busy && !this.#loginState && !this.#editors.size && this.#comments.length <= 20 && ![...this.#drafts.values()].some(Boolean) && !this.querySelector('textarea:focus') && Date.now() - this.#lastRefresh >= 60000) void this.#refresh();
    if (!document.hidden && this.#loginState && !this.#consuming) this.#schedulePoll(0);
  };
  #message = (event: MessageEvent): void => {
    if (event.origin === location.origin && event.source === this.#popup && this.#loginState) {
      const ready = event.data?.giscusAuth as { attempt?: unknown; challenge?: unknown } | undefined;
      if (ready && typeof ready.attempt === 'string' && tokenPattern.test(ready.attempt) && ready.challenge === this.#loginState.challenge) {
        this.#loginState.attempt = ready.attempt;
        this.#popup?.postMessage({ giscusAuthAck: ready.attempt }, location.origin);
        this.#post({ pending: this.#loginState }); this.#schedulePoll(1000);
      }
      const done = event.data?.giscusAuthDone as { attempt?: unknown; ticket?: unknown; challenge?: unknown; status?: unknown } | undefined;
      if (done && done.attempt === this.#loginState.attempt && done.challenge === this.#loginState.challenge) {
        if (done.status === 'ready' && typeof done.ticket === 'string' && tokenPattern.test(done.ticket)) void this.#finish(done.ticket, this.#loginState);
        else if (done.status === 'denied') this.#authFailed(this.#strings.loginCancelled);
      }
      return;
    }
    if (event.source !== window.parent || event.origin !== this.#parent || !event.data?.giscus || typeof event.data.giscus !== 'object') return;
    const data = event.data.giscus as Record<string, unknown>;
    if (data.init && typeof data.init === 'object') this.#initialize(data.init as Record<string, unknown>);
    if (typeof data.loginError === 'string') this.#authFailed(data.loginError);
    if (typeof data.sessionChanged === 'string' && (!data.sessionChanged || tokenPattern.test(data.sessionChanged))) { this.#session = data.sessionChanged; void this.#refresh(); }
    if (data.setConfig && typeof data.setConfig === 'object') this.#setConfig(data.setConfig as Record<string, unknown>);
  };
  #initialize(data: Record<string, unknown>): void {
    this.#initialized = true; clearTimeout(this.#initTimer);
    if (typeof data.session === 'string' && tokenPattern.test(data.session)) this.#session = data.session;
    if (typeof data.draft === 'string' && !this.#drafts.has('main')) this.#drafts.set('main', data.draft.slice(0, 60000));
    if (typeof data.draftState === 'string' && data.draftState.length <= 240000) {
      try {
        const state = JSON.parse(data.draftState) as { drafts?: unknown; editors?: unknown; keys?: unknown };
        if (Array.isArray(state.drafts)) for (const entry of state.drafts.slice(0, 10)) {
          if (Array.isArray(entry) && typeof entry[0] === 'string' && typeof entry[1] === 'string' && entry[0].length <= 300 && entry[1].length <= 60000) this.#drafts.set(entry[0], entry[1]);
        }
        if (Array.isArray((state as {keys?: unknown}).keys)) for (const entry of (state as {keys: unknown[]}).keys.slice(0, 10)) {
          if (Array.isArray(entry) && typeof entry[0] === 'string' && typeof entry[1] === 'string' && entry[0].length <= 300 && /^[A-Za-z0-9_-]{16,100}$/.test(entry[1])) this.#keys.set(entry[0], entry[1]);
        }
        if (Array.isArray(state.editors)) for (const entry of state.editors.slice(0, 10)) {
          if (Array.isArray(entry) && typeof entry[0] === 'string' && entry[1] && typeof entry[1] === 'object') {
            const e = entry[1] as Partial<Editor>;
            if ((e.kind === 'reply' || e.kind === 'edit') && typeof e.id === 'string' && /^[A-Za-z0-9_+=:/.-]{1,256}$/.test(e.id)) this.#editors.set(entry[0], { kind: e.kind, id: e.id, initial: '' });
          }
        }
      } catch { /* Ignore invalid saved drafts. */ }
    }
    if (data.handoff && typeof data.handoff === 'object') {
      const handoff = data.handoff as Record<string, unknown>;
      if (['ticket', 'verifier', 'attempt', 'challenge'].every(k => typeof handoff[k] === 'string' && tokenPattern.test(handoff[k] as string))) {
        void this.#finish(handoff.ticket as string, { verifier: handoff.verifier as string, attempt: handoff.attempt as string, challenge: handoff.challenge as string, created: Date.now() }); return;
      }
    }
    void this.#refresh();
  }
  #setConfig(update: Record<string, unknown>): void {
    if (update.repo && update.repo !== this.#config.repo) { this.#report(new Error('Create a new embed to change the repository.')); return; }
    const allowed = new Set(['term', 'number', 'strict', 'category', 'categoryId', 'theme', 'lang', 'reactionsEnabled', 'emitMetadata', 'inputPosition']);
    const params = new URLSearchParams(location.search);
    for (const [key, value] of Object.entries(update)) if (allowed.has(key) && ['string', 'boolean', 'number'].includes(typeof value)) params.set(key, typeof value === 'boolean' ? value ? '1' : '0' : String(value));
    if (Object.hasOwn(update, 'term') && !Object.hasOwn(update, 'number')) params.delete('number');
    this.#saveDrafts(); location.replace('/widget?' + params.toString());
  }
  async #api<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
    const response = await fetch('/api/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(this.#session ? { Authorization: 'Bearer ' + this.#session } : {}) }, body: JSON.stringify(body), credentials: 'omit', cache: 'no-store', ...(signal ? { signal } : {}) });
    let data: unknown;
    try { data = await response.json(); } catch { throw new ApiError('The comments service returned an invalid response.', response.status, 'UPSTREAM'); }
    if (!response.ok) {
      const error = data && typeof data === 'object' ? (data as { error?: { message?: unknown; code?: unknown } }).error : undefined;
      if (response.status === 401) { this.#session = ''; this.#post({ signOut: true }); }
      throw new ApiError(typeof error?.message === 'string' ? error.message : 'Request failed.', response.status, typeof error?.code === 'string' ? error.code : 'UPSTREAM');
    }
    return data as T;
  }
  #report(error: unknown): void {
    if (error instanceof Error && error.name === 'AbortError') return;
    this.#error = error instanceof Error ? error.message : this.#strings.unavailable; this.#post({ error: this.#error }); this.#render();
  }
  async #refresh(more = false, preserve = false): Promise<void> {
    if (more && (!this.#cursor || this.#busy)) return;
    const generation = ++this.#generation, oldLength = this.#comments.length;
    this.#abort?.abort(); this.#abort = new AbortController(); this.#busy = true; this.setAttribute('aria-busy', 'true');
    try {
      let view = await this.#api<ThreadView>('thread', { config: this.#config, order: this.#order, cursor: more ? this.#cursor : '' }, this.#abort.signal);
      let nodes = view.discussion?.comments.nodes || [];
      if (this.#order === 'newest') nodes = [...nodes].reverse();
      const merged = more ? [...this.#comments, ...nodes.filter(n => !this.#comments.some(c => c.id === n.id))] : nodes;
      let cursor = view.nextCursor;
      if (preserve && !more) {
        // Keep previously loaded pages after an action, up to 200 comments.
        while (cursor && merged.length < Math.min(oldLength, 200)) {
          const next = await this.#api<ThreadView>('thread', { config: this.#config, order: this.#order, cursor }, this.#abort.signal);
          const page = next.discussion?.comments.nodes || [];
          for (const node of this.#order === 'newest' ? [...page].reverse() : page) if (!merged.some(c => c.id === node.id)) merged.push(node);
          if (cursor === next.nextCursor) break; cursor = next.nextCursor;
        }
      }
      if (generation !== this.#generation) return;
      this.#view = view; this.#comments = merged; this.#cursor = cursor; this.#lastRefresh = Date.now(); this.#error = '';
      if (this.#config.emitMetadata) {
        const d = view.discussion;
        this.#post({ discussion: d ? { id: d.id, number: d.number, url: d.url, locked: d.locked, totalCommentCount: d.comments.totalCount, reactionCount: d.reactionGroups.reduce((n, group) => n + group.users.totalCount, 0) } : null });
      }
    } catch (error) { if (generation === this.#generation && !(error instanceof Error && error.name === 'AbortError')) this.#error = error instanceof Error ? error.message : this.#strings.unavailable; }
    finally { if (generation === this.#generation) { this.#busy = false; this.removeAttribute('aria-busy'); this.#render(); } }
  }
  async #login(): Promise<void> {
    try {
      clearTimeout(this.#pollTimer); this.#popup = window.open('about:blank', 'giscus-' + crypto.randomUUID(), 'popup,width=620,height=760');
      const verifier = randomProof(), proof = await challenge(verifier);
      this.#loginState = { verifier, challenge: proof, attempt: '', created: Date.now() }; this.#post({ pending: this.#loginState }); this.#saveDrafts();
      const params = new URLSearchParams({ repo: this.#config.repo, origin: this.#config.origin, challenge: proof, mode: this.#popup ? 'popup' : 'redirect' });
      const url = location.origin + '/auth/window?' + params.toString();
      if (this.#popup) { this.#popup.location.replace(url); this.#popup.focus(); }
      else if (window.parent !== window) this.#post({ navigate: url });
      else throw new Error('Allow popups for this site to sign in.');
      this.#render();
    } catch (error) { this.#authFailed(error instanceof Error ? error.message : this.#strings.loginFailed); }
  }
  #schedulePoll(delay: number): void {
    clearTimeout(this.#pollTimer);
    if (this.#loginState?.attempt) this.#pollTimer = setTimeout(() => { void this.#poll(); }, delay);
  }
  async #poll(): Promise<void> {
    const login = this.#loginState;
    if (!login?.attempt || this.#consuming) return;
    if (Date.now() - login.created >= 600000) { this.#authFailed('Sign-in expired. Start again.'); return; }
    if (document.hidden) { this.#schedulePoll(10000); return; }
    try {
      const status = await this.#api<AuthStatus>('auth/poll', { repo: this.#config.repo, origin: this.#config.origin, attempt: login.attempt, verifier: login.verifier });
      if (this.#loginState !== login) return;
      if (status.status === 'ready') { await this.#finish(status.ticket, login); return; }
      if (status.status === 'denied') { this.#authFailed(this.#strings.loginCancelled); return; }
    } catch (error) {
      if (error instanceof ApiError && [400, 401, 403, 409].includes(error.status)) { this.#authFailed(error.message); return; }
    }
    this.#schedulePoll(Date.now() - login.created < 60000 ? 10000 : 20000);
  }
  async #finish(ticket: string, login: Login): Promise<void> {
    if (this.#consuming) return; this.#consuming = true; clearTimeout(this.#pollTimer);
    try {
      const data = await this.#api<{ session: string }>('auth/consume', { repo: this.#config.repo, origin: this.#config.origin, attempt: login.attempt, verifier: login.verifier, ticket });
      if (!tokenPattern.test(data.session)) throw new Error('Sign-in returned an invalid session. Start again.');
      this.#session = data.session; this.#post({ session: data.session, clearPending: login.challenge });
      this.#loginState = null; this.#error = ''; await this.#refresh(false, true);
    } catch (error) { this.#authFailed(error instanceof Error ? error.message : this.#strings.loginFailed); }
    finally { this.#consuming = false; }
  }
  #authFailed(message: string): void {
    clearTimeout(this.#pollTimer); if (this.#loginState) this.#post({ clearPending: this.#loginState.challenge });
    this.#loginState = null; this.#error = message; this.#render();
  }
  async #logout(): Promise<void> {
    try { await this.#api('logout', { repo: this.#config.repo, origin: this.#config.origin }); }
    catch (error) { if (!(error instanceof ApiError && error.status === 401)) { this.#report(error); return; } }
    this.#session = ''; this.#post({ signOut: true }); await this.#refresh(false, true);
  }
  #saveDrafts(): void {
    this.#post({ draft: this.#drafts.get('main') || '' });
    const state = JSON.stringify({ drafts: [...this.#drafts], editors: [...this.#editors], keys: [...this.#keys] });
    if (state.length <= 240000) this.#post({ draftState: state });
  }
  #composer(name = 'main', editor?: Editor): HTMLElement {
    const t = this.#strings, form = h('form', { class: 'gsc-comment-box', 'data-composer': name });
    const text = h('textarea', { rows: 4, maxlength: 60000, placeholder: t.placeholder, 'aria-label': editor?.kind === 'reply' ? t.reply : t.comments });
    text.value = this.#drafts.get(name) ?? editor?.initial ?? '';
    const preview = h('div', { class: 'markdown preview', hidden: true }), status = h('p', { class: 'composer-status', role: 'status' });
    const write = button(t.write, () => { text.hidden = false; preview.hidden = true; write.setAttribute('aria-pressed', 'true'); show.setAttribute('aria-pressed', 'false'); text.focus(); }, { 'aria-pressed': 'true' });
    const show = button(t.preview, async () => {
      if (!text.value.trim()) return;
      if (!this.#session) { status.textContent = t.signInPreview; return; }
      show.disabled = true;
      try { const response = await this.#api<{ html: string }>('preview', { config: this.#config, body: text.value }); preview.replaceChildren(markdown(response.html, text.value)); text.hidden = true; preview.hidden = false; show.setAttribute('aria-pressed', 'true'); write.setAttribute('aria-pressed', 'false'); status.textContent = ''; }
      catch (error) { status.textContent = error instanceof Error ? error.message : t.unavailable; }
      finally { show.disabled = false; }
    }, { 'aria-pressed': 'false' });
    const submit = h('button', { type: 'submit', class: 'primary' }, this.#session ? editor?.kind === 'edit' ? t.save : editor?.kind === 'reply' ? t.reply : t.post : t.signIn);
    text.addEventListener('input', () => { this.#drafts.set(name, text.value); this.#keys.delete(name); this.#saveDrafts(); });
    text.addEventListener('keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); form.requestSubmit(); } });
    form.addEventListener('submit', event => { event.preventDefault(); void (async () => {
      this.#drafts.set(name, text.value); this.#saveDrafts();
      if (!this.#session) { await this.#login(); return; }
      if (!text.value.trim() || submit.disabled) { text.focus(); return; }
      submit.disabled = true; text.readOnly = true; status.textContent = '';
      const key = this.#keys.get(name) || crypto.randomUUID(); this.#keys.set(name, key); this.#saveDrafts();
      try {
        if (editor?.kind === 'edit') await this.#api('edit', { config: this.#config, id: editor.id, body: text.value, key });
        else await this.#api('comment', { config: this.#config, body: text.value, replyToId: editor?.id || '', key });
        this.#drafts.delete(name); this.#keys.delete(name); this.#editors.delete(name); this.#saveDrafts();
        if (!editor) this.#order = 'newest'; await this.#refresh(false, Boolean(editor));
      } catch (error) { status.textContent = error instanceof Error ? error.message : t.unavailable; if (error instanceof ApiError && error.status === 401) this.#render(); }
      finally { submit.disabled = false; text.readOnly = false; }
    })(); });
    const actions = h('div', { class: 'composer-actions' }, h('small', {}, link('https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting', t.markdown)));
    if (editor) actions.append(button(t.cancel, () => { this.#editors.delete(name); this.#drafts.delete(name); this.#keys.delete(name); this.#saveDrafts(); this.#render(); }));
    actions.append(submit); form.append(h('div', { class: 'composer-tabs', role: 'group', 'aria-label': t.editorMode }, write, show), text, preview, status, actions); return form;
  }
  #reactions(subject: G.Comment | G.Discussion | null, page = false): HTMLElement {
    const t = this.#strings, groups = subject?.reactionGroups || [];
    const wrapper = h('div', { class: 'gsc-reactions', 'aria-label': t.reactions });
    const make = (reaction: string): HTMLButtonElement => {
      const group = groups.find(g => g.content === reaction), count = group?.users.totalCount || 0, selected = Boolean(this.#session && group?.viewerHasReacted);
      const b = button(`${emoji[reaction]} ${count}`, async () => {
        if (!this.#session) { await this.#login(); return; }
        b.disabled = true;
        try { await this.#api('reaction', { config: this.#config, id: page ? 'discussion' : subject!.id, reaction, add: !selected, key: crypto.randomUUID() }); await this.#refresh(false, true); }
        catch (error) { this.#report(error); } finally { b.disabled = false; }
      }, { class: 'gsc-reaction', 'aria-pressed': String(selected), 'aria-label': `${reactionLabel(t, reaction)}: ${count}`, title: reactionLabel(t, reaction) });
      if (this.#view?.archived || this.#view?.discussion?.locked) b.disabled = true; return b;
    };
    for (const g of groups) if (g.users.totalCount > 0) wrapper.append(make(g.content));
    const menu = h('details', { class: 'reaction-picker' }, h('summary', { 'aria-label': t.reactions, title: t.reactions }, '+'));
    menu.append(h('div', { class: 'reaction-menu' }, ...Object.keys(emoji).map(make))); wrapper.append(menu); return wrapper;
  }
  #comment(comment: G.Comment | G.RootComment, reply = false): HTMLElement {
    const t = this.#strings, article = h('article', { class: reply ? 'gsc-comment gsc-reply' : 'gsc-comment', 'data-comment-id': comment.id });
    const header = h('header', { class: 'comment-header' });
    if (comment.author) header.append(h('img', { class: 'avatar', src: comment.author.avatarUrl, alt: '', width: 28, height: 28, loading: 'lazy', referrerpolicy: 'no-referrer' }), link(comment.author.url, comment.author.login, { class: 'comment-author' }));
    else header.append(h('span', { class: 'comment-author' }, '[deleted]'));
    const date = new Date(comment.createdAt); header.append(link(comment.url, date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }), { class: 'comment-date' }));
    if (['OWNER', 'MEMBER', 'COLLABORATOR'].includes(comment.authorAssociation)) header.append(h('span', { class: 'role-label' }, comment.authorAssociation.toLowerCase()));
    if (comment.lastEditedAt) header.append(h('span', { class: 'edited', title: comment.lastEditedAt }, t.edited));
    const content = h('div', { class: 'markdown gsc-comment-content' }, markdown(comment.bodyHTML, comment.body));
    article.append(header, comment.isMinimized ? h('details', { class: 'minimized' }, h('summary', {}, t.hidden), content) : content);
    const controls = h('div', { class: 'comment-controls' }, this.#reactions(comment));
    const open = (kind: 'reply' | 'edit') => {
      const name = kind + ':' + comment.id; this.#editors.set(name, { kind, id: comment.id, initial: kind === 'edit' ? comment.body : '' });
      this.#saveDrafts(); this.#render();
      const form = [...this.querySelectorAll<HTMLElement>('[data-composer]')].find(e => e.dataset.composer === name); form?.querySelector('textarea')?.focus();
    };
    if (!this.#view?.discussion?.locked && !this.#view?.archived) controls.append(button(t.reply, () => open('reply'), { class: 'text-button' }));
    if (this.#session && comment.viewerCanUpdate) controls.append(button(t.edit, () => open('edit'), { class: 'text-button' }));
    if (this.#session && comment.viewerCanDelete) controls.append(button(t.remove, async () => {
      if (!confirm(t.deleteConfirm)) return;
      try { await this.#api('delete', { config: this.#config, id: comment.id, key: crypto.randomUUID() }); await this.#refresh(false, true); }
      catch (error) { this.#report(error); }
    }, { class: 'text-button' }));
    if (this.#session && comment.viewerCanMinimize) controls.append(button(comment.isMinimized ? t.unhide : t.hide, async () => {
      try { await this.#api('moderate', { config: this.#config, id: comment.id, minimized: !comment.isMinimized, key: crypto.randomUUID() }); await this.#refresh(false, true); }
      catch (error) { this.#report(error); }
    }, { class: 'text-button' }));
    article.append(controls);
    for (const kind of ['edit', 'reply']) { const name = kind + ':' + comment.id, editor = this.#editors.get(name); if (editor) article.append(this.#composer(name, editor)); }
    if (!reply && 'replies' in comment) {
      const list = h('div', { class: 'gsc-replies' }, ...comment.replies.nodes.map(node => this.#comment(node, true))); article.append(list);
      if (comment.replies.pageInfo.hasNextPage) {
        const more = button(t.moreReplies, async () => {
          more.disabled = true;
          try {
            const result = await this.#api<G.Replies>('replies', { config: this.#config, parentId: comment.id, cursor: comment.replies.pageInfo.endCursor || '' });
            for (const node of result.nodes) if (!comment.replies.nodes.some(r => r.id === node.id)) { comment.replies.nodes.push(node); list.append(this.#comment(node, true)); }
            comment.replies.pageInfo = result.pageInfo; comment.replies.totalCount = result.totalCount;
            if (!result.pageInfo.hasNextPage) more.remove();
          } catch (error) { this.#report(error); } finally { more.disabled = false; }
        }, { class: 'text-button more-replies' }); article.append(more);
      }
    }
    return article;
  }
  #render(): void {
    const focused = document.activeElement instanceof HTMLTextAreaElement && this.contains(document.activeElement) ? document.activeElement : null;
    const focusName = focused?.closest<HTMLElement>('[data-composer]')?.dataset.composer, selection = focused ? [focused.selectionStart, focused.selectionEnd] : null;
    const t = this.#strings, d = this.#view?.discussion, viewer = this.#view?.viewer;
    const header = h('div', { class: 'widget-header' }, h('h2', {}, t.comments, h('span', { class: 'comment-count' }, String(d?.comments.totalCount || 0))));
    if (viewer && this.#session) header.append(h('div', { class: 'auth-controls' }, h('span', { class: 'signed-in', 'aria-label': `${t.signedAs} ${viewer.login}` }, link(viewer.url, viewer.login)), button(t.signOut, () => this.#logout(), { class: 'text-button' })));
    else header.append(button(t.signIn, () => this.#login(), { class: 'sign-in' }));
    const sort = h('select', { 'aria-label': t.commentOrder }, h('option', { value: 'oldest' }, t.oldest), h('option', { value: 'newest' }, t.newest)); sort.value = this.#order;
    sort.addEventListener('change', () => { this.#order = sort.value === 'newest' ? 'newest' : 'oldest'; void this.#refresh(); });
    const content: Node[] = [header, h('div', { class: 'widget-tools' }, link(d?.url || `https://github.com/${this.#config.repo}/discussions`, t.onGitHub), h('div', { class: 'sort-controls' }, sort, button(t.refresh, () => this.#refresh(false, true), { class: 'text-button', disabled: this.#busy })))];
    if (this.#error) content.push(h('div', { class: 'error', role: 'alert' }, h('p', {}, this.#error), button(t.retry, () => this.#refresh(false, true))));
    if (this.#config.reactionsEnabled && this.#view) content.push(h('div', { class: 'page-reactions' }, this.#reactions(d || null, true)));
    const canWrite = this.#view && !this.#view.archived && !d?.locked;
    if (canWrite && this.#config.inputPosition === 'top') content.push(this.#composer());
    if (!this.#view && !this.#error) content.push(h('p', { class: 'loading', role: 'status' }, t.loading));
    content.push(h('section', { class: 'gsc-timeline', 'aria-label': t.comments }, ...this.#comments.map(c => this.#comment(c))));
    if (this.#cursor) content.push(button(t.more, () => this.#refresh(true), { class: 'load-more', disabled: this.#busy }));
    if (this.#view?.archived || d?.locked) content.push(h('p', { class: 'locked' }, this.#view?.archived ? t.archived : t.locked));
    else if (canWrite && this.#config.inputPosition !== 'top') content.push(this.#composer());
    this.replaceChildren(...content);
    if (focusName && selection) {
      const form = [...this.querySelectorAll<HTMLElement>('[data-composer]')].find(e => e.dataset.composer === focusName), text = form?.querySelector('textarea');
      if (text) { text.focus({ preventScroll: true }); text.setSelectionRange(selection[0]!, selection[1]!); }
    }
  }
}
customElements.define('giscus-comments', GiscusComments);
