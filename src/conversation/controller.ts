import type { Widget } from '../contracts/requests.js';
import type { Comment, RootComment, Replies } from '../contracts/github.js';
import type { MutationResult } from '../contracts/results.js';
import type { ThreadView } from '../domain/repository.js';

export interface Transport {
  request<T>(operation: string, body: unknown, signal?: AbortSignal): Promise<T>;
}
export interface Editor { kind: 'reply' | 'edit'; id: string; initial: string }
export interface ConversationState {
  view: ThreadView | null;
  comments: RootComment[];
  order: 'oldest' | 'newest';
  nextCursor: string | null;
  loading: boolean;
  error: string;
  lastRefresh: number;
  expanded: ReadonlySet<string>;
}
const emptyPage = () => ({ hasNextPage: false, hasPreviousPage: false, startCursor: null, endCursor: null });
const unique = <T extends { id: string }>(items: T[]) => [...new Map(items.map(item => [item.id, item])).values()];

/** Owns conversation continuity independently of DOM, embedding and credentials. */
export class ConversationController {
  #state: ConversationState;
  #listeners = new Set<() => void>();
  #generation = 0;
  #abort?: AbortController;
  #disposed = false;
  #replyLoads = new Map<string, Promise<void>>();
  #pending = new Map<string, Promise<MutationResult>>();
  #drafts = new Map<string, string>();
  #keys = new Map<string, string>();
  #editors = new Map<string, Editor>();
  constructor(readonly config: Widget, readonly transport: Transport, order: 'oldest' | 'newest' = 'oldest') {
    this.#state = { view: null, comments: [], order, nextCursor: null, loading: false, error: '', lastRefresh: 0, expanded: new Set() };
  }
  /** Consumers must treat the snapshot as immutable. Mutations go through actions. */
  get state(): Readonly<ConversationState> { return this.#state; }
  get editors(): ReadonlyMap<string, Editor> { return this.#editors; }
  get hasDrafts(): boolean { return [...this.#drafts.values()].some(Boolean); }
  subscribe(listener: () => void): () => void { this.#listeners.add(listener); return () => this.#listeners.delete(listener); }
  #emit(): void { if (!this.#disposed) for (const listener of this.#listeners) listener(); }
  #patch(patch: Partial<ConversationState>): void { this.#state = { ...this.#state, ...patch }; this.#emit(); }
  #live(): void { if (this.#disposed) throw new Error('This conversation has been disposed.'); }
  dispose(): void { this.#disposed = true; this.#generation++; this.#abort?.abort(); this.#listeners.clear(); }
  draft(name = 'main'): string { return this.#drafts.get(name) ?? this.#editors.get(name)?.initial ?? ''; }
  setDraft(name: string, value: string): void {
    this.#live();
    if (this.#pending.has('composer:' + name)) throw new Error('Wait for the pending submission before changing its draft.');
    if (this.draft(name) !== value) this.#keys.delete(name);
    this.#drafts.set(name, value);
  }
  openEditor(name: string, editor: Editor): void { this.#editors.set(name, editor); this.#emit(); }
  closeEditor(name: string): void {
    if (this.#pending.has('composer:' + name)) return;
    this.#editors.delete(name); this.#drafts.delete(name); this.#keys.delete(name); this.#emit();
  }
  serializeDrafts(): string { return JSON.stringify({ drafts: [...this.#drafts], keys: [...this.#keys], editors: [...this.#editors] }); }
  restoreDrafts(raw: string): void {
    if (raw.length > 240000) return;
    try {
      const saved = JSON.parse(raw);
      for (const [field, target] of [['drafts', this.#drafts], ['keys', this.#keys]] as const) {
        if (!Array.isArray(saved[field])) continue;
        for (const entry of saved[field].slice(0, 10)) {
          if (!Array.isArray(entry) || typeof entry[0] !== 'string' || typeof entry[1] !== 'string' || entry[0].length > 300) continue;
          if (field === 'keys' ? !/^[A-Za-z0-9_-]{16,100}$/.test(entry[1]) : entry[1].length > 60000) continue;
          target.set(entry[0], entry[1]);
        }
      }
      if (Array.isArray(saved.editors)) for (const entry of saved.editors.slice(0, 10)) {
        const editor = entry?.[1];
        if (typeof entry?.[0] === 'string' && entry[0].length <= 300 && editor && ['reply', 'edit'].includes(editor.kind) && typeof editor.id === 'string' && /^[A-Za-z0-9_+=:/.-]{1,256}$/.test(editor.id)) {
          this.#editors.set(entry[0], { kind: editor.kind, id: editor.id, initial: '' });
        }
      }
    } catch { /* Browser storage is untrusted; invalid saved state is ignored. */ }
  }
  async setOrder(order: 'oldest' | 'newest'): Promise<void> {
    if (order === this.#state.order) return;
    this.#state = { ...this.#state, order, comments: [], nextCursor: null };
    await this.refresh();
  }
  async refresh(more = false): Promise<void> {
    this.#live();
    if (more && (!this.#state.nextCursor || this.#state.loading)) return;
    const generation = ++this.#generation, previous = this.#state;
    this.#abort?.abort(); this.#abort = new AbortController();
    const signal = this.#abort.signal;
    this.#patch({ loading: true, error: '' });
    try {
      const fetchPage = (cursor: string) => this.transport.request<ThreadView>('thread', { config: this.config, order: previous.order, cursor }, signal);
      const view = await fetchPage(more ? previous.nextCursor! : '');
      const ordered = (page: ThreadView) => previous.order === 'newest' ? [...(page.discussion?.comments.nodes || [])].reverse() : page.discussion?.comments.nodes || [];
      let comments = more ? unique([...previous.comments, ...ordered(view)]) : ordered(view);
      let nextCursor = view.nextCursor;
      const seen = new Set<string>();
      // Revalidate all loaded root pages; do not silently forget later pages.
      while (!more && nextCursor && comments.length < previous.comments.length && !seen.has(nextCursor)) {
        seen.add(nextCursor); const page = await fetchPage(nextCursor);
        comments = unique([...comments, ...ordered(page)]); nextCursor = page.nextCursor;
      }
      // Revalidate expanded replies to their previous depth, preserving folding.
      for (let i = 0; i < comments.length; i++) {
        const item = comments[i]!, old = previous.comments.find(c => c.id === item.id);
        if (!old || !previous.expanded.has(item.id) || old.replies.nodes.length <= item.replies.nodes.length) continue;
        let replies = item.replies; const cursors = new Set<string>();
        while (replies.pageInfo.hasNextPage && replies.nodes.length < old.replies.nodes.length) {
          const cursor = replies.pageInfo.endCursor || ''; if (cursors.has(cursor)) break; cursors.add(cursor);
          const page = await this.transport.request<Replies>('replies', { config: this.config, parentId: item.id, cursor }, signal);
          replies = { ...page, nodes: unique([...replies.nodes, ...page.nodes]) };
        }
        comments[i] = { ...item, replies };
      }
      if (generation !== this.#generation || this.#disposed) return;
      this.#patch({ view, comments, nextCursor, lastRefresh: Date.now() });
    } catch (error) {
      if (generation === this.#generation && !signal.aborted) this.#patch({ error: error instanceof Error ? error.message : 'Unable to load comments.' });
    } finally { if (generation === this.#generation && !this.#disposed) this.#patch({ loading: false }); }
  }
  async loadReplies(parentId: string): Promise<void> {
    this.#live();
    const pending = this.#replyLoads.get(parentId); if (pending) return pending;
    const root = this.#state.comments.find(c => c.id === parentId); if (!root) return;
    this.#patch({ expanded: new Set([...this.#state.expanded, parentId]) });
    if (!root.replies.pageInfo.hasNextPage) return;
    const generation = this.#generation;
    const load = (async () => {
      const page = await this.transport.request<Replies>('replies', { config: this.config, parentId, cursor: root.replies.pageInfo.endCursor || '' });
      if (this.#disposed || generation !== this.#generation) return;
      this.#patch({ comments: this.#state.comments.map(c => c.id === parentId ? { ...c, replies: { ...page, nodes: unique([...c.replies.nodes, ...page.nodes]) } } : c) });
    })();
    this.#replyLoads.set(parentId, load);
    try { await load; } finally { this.#replyLoads.delete(parentId); }
  }
  fold(parentId: string): void { const expanded = new Set(this.#state.expanded); expanded.delete(parentId); this.#patch({ expanded }); }
  expand(parentId: string): void { this.#patch({ expanded: new Set([...this.#state.expanded, parentId]) }); }
  async preview(body: string): Promise<string> { return (await this.transport.request<{ html: string }>('preview', { config: this.config, body })).html; }
  submit(name = 'main'): Promise<MutationResult> {
    this.#live(); const existing = this.#pending.get('composer:' + name); if (existing) return existing;
    const body = this.draft(name), editor = this.#editors.get(name);
    if (!body.trim()) return Promise.reject(new Error('Write a comment before submitting.'));
    const key = this.#keys.get(name) || crypto.randomUUID(); this.#keys.set(name, key);
    const operation = editor?.kind === 'edit' ? 'edit' : 'comment';
    const input = editor?.kind === 'edit' ? { id: editor.id, body, key } : { body, replyToId: editor?.id || '', key };
    const request = this.mutate(operation, input, 'composer:' + name).then(result => {
      this.#drafts.delete(name); this.#keys.delete(name); this.#editors.delete(name); this.#emit(); return result;
    });
    return request;
  }
  async mutate(operation: string, input: Record<string, unknown>, scope = operation + ':' + String(input.id || 'discussion')): Promise<MutationResult> {
    this.#live();
    const old = this.#pending.get(scope); if (old) return old;
    const run = (async () => {
      const result = await this.transport.request<MutationResult>(operation, { ...input, key: input.key || crypto.randomUUID(), config: this.config });
      if (this.#disposed) return result;
      // A read begun before this successful write cannot overwrite the result.
      this.#generation++; this.#abort?.abort(); this.#state = { ...this.#state, loading: false };
      this.#reconcile(result, operation);
      if (!this.#state.view?.discussion) await this.refresh();
      return result;
    })();
    this.#pending.set(scope, run);
    try { return await run; } finally { this.#pending.delete(scope); }
  }
  #reconcile(result: MutationResult, operation: string): void {
    let comments = this.#state.comments, view = this.#state.view;
    if (result.removed) {
      const rootRemoved = comments.some(c => c.id === result.id);
      comments = comments.filter(c => c.id !== result.id).map(c => ({ ...c, replies: { ...c.replies, totalCount: c.replies.totalCount - Number(c.replies.nodes.some(r => r.id === result.id)), nodes: c.replies.nodes.filter(r => r.id !== result.id) } }));
      if (rootRemoved && view?.discussion) view = { ...view, discussion: { ...view.discussion, comments: { ...view.discussion.comments, totalCount: Math.max(0, view.discussion.comments.totalCount - 1) } } };
    }
    const comment = result.comment;
    if (comment) {
      if (comment.replyTo) {
        const parent = comment.replyTo.id;
        comments = comments.map(c => c.id !== parent ? c : { ...c, replies: { ...c.replies, totalCount: c.replies.totalCount + Number(operation === 'comment' && !c.replies.nodes.some(r => r.id === comment.id)), nodes: unique([...c.replies.nodes, comment]) } });
        this.#state = { ...this.#state, expanded: new Set([...this.#state.expanded, parent]) };
      } else {
        const old = comments.find(c => c.id === comment.id);
        const root = { ...comment, replies: old?.replies || { totalCount: 0, nodes: [], pageInfo: emptyPage() } };
        comments = old ? comments.map(c => c.id === root.id ? root : c) : this.#state.order === 'newest' ? [root, ...comments] : [...comments, root];
        if (!old && operation === 'comment' && view?.discussion) view = { ...view, discussion: { ...view.discussion, comments: { ...view.discussion.comments, totalCount: view.discussion.comments.totalCount + 1 } } };
      }
    }
    const reaction = result.reactions;
    if (reaction) {
      const update = <T extends Comment>(c: T): T => c.id === reaction.id ? { ...c, reactionGroups: reaction.reactionGroups } : c;
      comments = comments.map(c => ({ ...update(c), replies: { ...c.replies, nodes: c.replies.nodes.map(update) } }));
      if (view?.discussion?.id === reaction.id) view = { ...view, discussion: { ...view.discussion, reactionGroups: reaction.reactionGroups } };
    }
    this.#patch({ comments, view, error: '' });
  }
}
