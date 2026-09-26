import type * as R from '../contracts/requests.js';
import type * as G from '../contracts/github.js';
import { ConversationController, type Editor } from '../conversation/controller.js';
import { createConversation, type ConversationRuntime } from './runtime.js';
import { ApiError } from './session.js';
import { button, element as h, jsonElement, link } from './dom.js';
import { strings, reactionLabel, type Strings } from './i18n.js';

interface Boot extends R.Widget { defaultCommentOrder: 'oldest' | 'newest' }
const emoji: Record<string, string> = { THUMBS_UP: '👍', THUMBS_DOWN: '👎', LAUGH: '😄', HOORAY: '🎉', CONFUSED: '😕', HEART: '♥', ROCKET: '🚀', EYES: '👀' };
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
export class GiscusComments extends HTMLElement {
  #config!: R.Widget;
  #runtime!: ConversationRuntime;
  #native = false;
  #strings!: Strings;
  #parent = '';
  get #session() { return this.#runtime.session.signedIn; }
  #controller!: ConversationController;
  #unsubscribe?: () => void;
  #forms = new Map<string, { session: boolean; form: HTMLElement }>();
  get #order() { return this.#controller.state.order; }
  get #view() { return this.#controller.state.view; }
  get #comments() { return this.#controller.state.comments; }
  get #cursor() { return this.#controller.state.nextCursor; }
  get #busy() { return this.#controller.state.loading; }
  get #lastRefresh() { return this.#controller.state.lastRefresh; }
  get #editors() { return this.#controller.editors; }
  #error = '';
  #observer?: ResizeObserver;
  #initTimer?: ReturnType<typeof setTimeout>;
  #initialized = false;
  #authUnsubscribe?: () => void;
  configure(runtime: ConversationRuntime): void {
    if(this.isConnected) throw new Error('Configure comments before mounting.');
    this.#runtime=runtime;this.#config=runtime.config;this.#controller=runtime.controller;
    this.#strings=strings(runtime.config.lang);this.#parent=new URL(runtime.config.origin).origin;this.#native=true;
  }
  connectedCallback(): void {
    if(!this.#runtime){
      const {defaultCommentOrder,...config}=jsonElement<Boot>();
      this.#config=config;this.#strings=strings(config.lang);this.#parent=new URL(config.origin).origin;
      this.#runtime=createConversation({service:location.origin,config,order:defaultCommentOrder,host:{emit:value=>this.#post(value),navigate:url=>this.#post({navigate:url})}});
      this.#controller=this.#runtime.controller;
    }
    this.#authUnsubscribe=this.#runtime.session.subscribe(()=>this.#render());
    this.#unsubscribe = this.#controller.subscribe(() => { this.#saveDrafts(); this.#render(); });
    this.classList.add('gsc-main'); this.#render();
    if (!this.#native) window.addEventListener('message', this.#message);
    window.addEventListener('focus', this.#focus);
    document.addEventListener('visibilitychange', this.#focus);
    if(this.#native){this.#initialized=true;return;}
    this.#observer = new ResizeObserver(() => this.#post({ resizeHeight: document.body.getBoundingClientRect().height + 2 })); this.#observer.observe(document.body);
    this.#post({ ready: true, context: this.#config });
    this.#initTimer = setTimeout(() => { if (!this.#initialized) this.#initialize({}); }, window.parent === window ? 0 : 1000);
  }
  disconnectedCallback(): void {
    window.removeEventListener('message', this.#message); window.removeEventListener('focus', this.#focus); document.removeEventListener('visibilitychange', this.#focus);
    this.#observer?.disconnect(); this.#unsubscribe?.();this.#authUnsubscribe?.();this.#runtime.dispose(); clearTimeout(this.#initTimer);
  }
  #post(value: unknown): void { if (window.parent !== window) window.parent.postMessage({ giscus: value }, this.#parent); }
  #focus = (): void => {
    // Refresh on focus only when there are no drafts, editors, or extra pages.
    if (!document.hidden && this.#initialized && !this.#busy && !this.#runtime.session.pending && !this.#editors.size && this.#comments.length <= 20 && !this.#controller.hasDrafts && !this.querySelector('textarea:focus') && Date.now() - this.#lastRefresh >= 60000) void this.#refresh();
  };
  #message = (event: MessageEvent): void => {
    if (event.source !== window.parent || event.origin !== this.#parent || !event.data?.giscus || typeof event.data.giscus !== 'object') return;
    const data = event.data.giscus as Record<string, unknown>;
    if (data.init && typeof data.init === 'object') this.#initialize(data.init as Record<string, unknown>);
    if (typeof data.loginError === 'string') this.#report(new Error(data.loginError));
    if (typeof data.sessionChanged === 'string' && (!data.sessionChanged || tokenPattern.test(data.sessionChanged))) { this.#runtime.session.setSession(data.sessionChanged); }
    if (data.setConfig && typeof data.setConfig === 'object') this.#setConfig(data.setConfig as Record<string, unknown>);
  };
  #initialize(data: Record<string, unknown>): void {
    this.#initialized=true;clearTimeout(this.#initTimer);this.#runtime.initialize(data);
  }
  #setConfig(update: Record<string, unknown>): void {
    if (update.repo && update.repo !== this.#config.repo) { this.#report(new Error('Create a new embed to change the repository.')); return; }
    const allowed = new Set(['term', 'number', 'strict', 'category', 'categoryId', 'theme', 'lang', 'reactionsEnabled', 'emitMetadata', 'inputPosition']);
    const params = new URLSearchParams(location.search);
    for (const [key, value] of Object.entries(update)) if (allowed.has(key) && ['string', 'boolean', 'number'].includes(typeof value)) params.set(key, typeof value === 'boolean' ? value ? '1' : '0' : String(value));
    if (Object.hasOwn(update, 'term') && !Object.hasOwn(update, 'number')) params.delete('number');
    this.#saveDrafts(); location.replace('/widget?' + params.toString());
  }
  #report(error: unknown): void {
    if (error instanceof Error && error.name === 'AbortError') return;
    this.#error = error instanceof Error ? error.message : this.#strings.unavailable; this.#post({ error: this.#error }); this.#render();
  }
  async #refresh(more = false, _preserve = true): Promise<void> {
    await this.#controller.refresh(more);
    if (this.#config.emitMetadata) {
      const d = this.#view?.discussion;
      this.#post({ discussion: d ? { id: d.id, number: d.number, url: d.url, locked: d.locked, totalCommentCount: d.comments.totalCount, reactionCount: d.reactionGroups.reduce((n, group) => n + group.users.totalCount, 0) } : null });
    }
  }
  async #login(): Promise<void> { try {await this.#runtime.session.signIn();}catch(error){this.#report(error);} }
  async #logout(): Promise<void> { try {await this.#runtime.session.signOut();}catch(error){this.#report(error);} }
  #saveDrafts(): void { this.#runtime.saveDrafts(); }
  #composer(name = 'main', editor?: Editor): HTMLElement {
    const cached = this.#forms.get(name);
    if (cached?.session === this.#session) {
      const text = cached.form.querySelector('textarea')!;
      if (text.value !== this.#controller.draft(name)) text.value = this.#controller.draft(name);
      return cached.form;
    }
    const t = this.#strings, form = h('form', { class: 'gsc-comment-box', 'data-composer': name });
    const text = h('textarea', { rows: 4, maxlength: 60000, placeholder: t.placeholder, 'aria-label': editor?.kind === 'reply' ? t.reply : t.comments });
    text.value = this.#controller.draft(name);
    const preview = h('div', { class: 'markdown preview', hidden: true }), status = h('p', { class: 'composer-status', role: 'status' });
    const write = button(t.write, () => { text.hidden = false; preview.hidden = true; write.setAttribute('aria-pressed', 'true'); show.setAttribute('aria-pressed', 'false'); text.focus(); }, { 'aria-pressed': 'true' });
    const show = button(t.preview, async () => {
      if (!text.value.trim()) return;
      if (!this.#session) { status.textContent = t.signInPreview; return; }
      show.disabled = true;
      try { const html = await this.#controller.preview(text.value); preview.replaceChildren(this.#runtime.renderContent(html, text.value)); text.hidden = true; preview.hidden = false; show.setAttribute('aria-pressed', 'true'); write.setAttribute('aria-pressed', 'false'); status.textContent = ''; }
      catch (error) { status.textContent = error instanceof Error ? error.message : t.unavailable; }
      finally { show.disabled = false; }
    }, { 'aria-pressed': 'false' });
    const submit = h('button', { type: 'submit', class: 'primary' }, this.#session ? editor?.kind === 'edit' ? t.save : editor?.kind === 'reply' ? t.reply : t.post : t.signIn);
    text.addEventListener('input', () => { this.#controller.setDraft(name, text.value); this.#saveDrafts(); });
    text.addEventListener('keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); form.requestSubmit(); } });
    form.addEventListener('submit', event => { event.preventDefault(); void (async () => {
      this.#controller.setDraft(name, text.value); this.#saveDrafts();
      if (!this.#session) { await this.#login(); return; }
      if (!text.value.trim() || submit.disabled) { text.focus(); return; }
      submit.disabled = true; text.readOnly = true; status.textContent = '';
      try {
        const pending = this.#controller.submit(name); this.#saveDrafts();
        await pending;
        this.#forms.delete(name); this.#saveDrafts(); this.#render();
      } catch (error) { status.textContent = error instanceof Error ? error.message : t.unavailable; if (error instanceof ApiError && error.status === 401) this.#render(); }
      finally { submit.disabled = false; text.readOnly = false; }
    })(); });
    const actions = h('div', { class: 'composer-actions' }, h('small', {}, link('https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting', t.markdown)));
    if (editor) actions.append(button(t.cancel, () => { this.#forms.delete(name); this.#controller.closeEditor(name); this.#saveDrafts(); this.#render(); }));
    actions.append(submit); form.append(h('div', { class: 'composer-tabs', role: 'group', 'aria-label': t.editorMode }, write, show), text, preview, status, actions); this.#forms.set(name, { session: this.#session, form }); return form;
  }
  #reactions(subject: G.Comment | G.Discussion | null, page = false): HTMLElement {
    const t = this.#strings, groups = subject?.reactionGroups || [];
    const wrapper = h('div', { class: 'gsc-reactions', 'aria-label': t.reactions });
    const make = (reaction: string): HTMLButtonElement => {
      const group = groups.find(g => g.content === reaction), count = group?.users.totalCount || 0, selected = Boolean(this.#session && group?.viewerHasReacted);
      const b = button(`${emoji[reaction]} ${count}`, async () => {
        if (!this.#session) { await this.#login(); return; }
        b.disabled = true;
        try { await this.#controller.mutate('reaction', { id: page ? 'discussion' : subject!.id, reaction, add: !selected }); }
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
    const content = h('div', { class: 'markdown gsc-comment-content' }, comment.deletedAt ? h('em', {}, 'This comment was deleted.') : this.#runtime.renderContent(comment.bodyHTML, comment.body));
    article.append(header, comment.isMinimized ? h('details', { class: 'minimized' }, h('summary', {}, t.hidden), content) : content);
    const controls = h('div', { class: 'comment-controls' }, this.#reactions(comment));
    const open = (kind: 'reply' | 'edit') => {
      const name = kind + ':' + comment.id; this.#controller.openEditor(name, { kind, id: comment.id, initial: kind === 'edit' ? comment.body : '' });
      this.#saveDrafts(); this.#render();
      const form = [...this.querySelectorAll<HTMLElement>('[data-composer]')].find(e => e.dataset.composer === name); form?.querySelector('textarea')?.focus();
    };
    if (!this.#view?.discussion?.locked && !this.#view?.archived) controls.append(button(t.reply, () => open('reply'), { class: 'text-button' }));
    if (this.#session && comment.viewerCanUpdate) controls.append(button(t.edit, () => open('edit'), { class: 'text-button' }));
    if (this.#session && comment.viewerCanDelete) controls.append(button(t.remove, async () => {
      if (!confirm(t.deleteConfirm)) return;
      try { await this.#controller.mutate('delete', { id: comment.id }); }
      catch (error) { this.#report(error); }
    }, { class: 'text-button' }));
    if (this.#session && (comment.isMinimized ? comment.viewerCanUnminimize : comment.viewerCanMinimize)) controls.append(button(comment.isMinimized ? t.unhide : t.hide, async () => {
      try { await this.#controller.mutate('moderate', { id: comment.id, minimized: !comment.isMinimized }); }
      catch (error) { this.#report(error); }
    }, { class: 'text-button' }));
    article.append(controls);
    for (const kind of ['edit', 'reply']) { const name = kind + ':' + comment.id, editor = this.#editors.get(name); if (editor) article.append(this.#composer(name, editor)); }
    if (!reply && 'replies' in comment) {
      const expanded = this.#controller.state.expanded.has(comment.id);
      const nodes = expanded ? comment.replies.nodes : comment.replies.nodes.slice(-5);
      const list = h('div', { class: 'gsc-replies' }, ...nodes.map(node => this.#comment(node, true))); article.append(list);
      if (comment.replies.nodes.length > 5) article.append(button(expanded ? 'Show fewer replies' : 'Show loaded replies', () => expanded ? this.#controller.fold(comment.id) : this.#controller.expand(comment.id), { class: 'text-button' }));
      if (comment.replies.pageInfo.hasNextPage) article.append(button(t.moreReplies, async () => {
        try { await this.#controller.loadReplies(comment.id); } catch (error) { this.#report(error); }
      }, { class: 'text-button more-replies' }));
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
    sort.addEventListener('change', () => { void this.#controller.setOrder(sort.value === 'newest' ? 'newest' : 'oldest'); });
    const content: Node[] = [header, h('div', { class: 'widget-tools' }, link(d?.url || `https://github.com/${this.#config.repo}/discussions`, t.onGitHub), h('div', { class: 'sort-controls' }, sort, button(t.refresh, () => this.#refresh(false, true), { class: 'text-button', disabled: this.#busy })))];
    if (this.#error || this.#controller.state.error || this.#runtime.session.error) content.push(h('div', { class: 'error', role: 'alert' }, h('p', {}, this.#error || this.#controller.state.error || this.#runtime.session.error), button(t.retry, () => this.#refresh(false, true))));
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
if(!customElements.get('giscus-comments'))customElements.define('giscus-comments', GiscusComments);
