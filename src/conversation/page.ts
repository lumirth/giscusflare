import { selection } from '../contracts/selection.js';
import type { Selection, ModerationReason } from '../contracts/requests.js';
import type { Comment, ContributionResult, PageDocument, Patch, Reaction, Reactions, Window, WindowDelta, WindowPage } from '../contracts/document.js';
import type { OrderResult } from '../ranking/types.js';
export interface Transport {
    request<T>(operation: string, body: unknown, signal?: AbortSignal, method?: 'GET' | 'POST'): Promise<T>;
}
export type CommentOrder = 'oldest' | 'newest' | {
    profile: string;
};
export type PageConfig = Selection & { backLink?: string; description?: string };
export interface Editor {
    kind: 'reply' | 'edit';
    id: string;
}
export interface Failure {
    status: 'failed' | 'uncertain';
    message: string;
}
export interface Draft {
    text: string;
    key?: string;
    editor?: Editor;
    pending?: Promise<ContributionResult>;
    error?: Failure;
}
interface ReactionIntent {
    id: string;
    reaction: Reaction;
    selected: boolean;
    issued?: {
        add: boolean;
        key: string;
    };
    pending?: Promise<void>;
    error?: Failure;
}
const emptyWindow = (): Window => ({ ids: [], cursor: null, total: null });
const emptyDocument = (): PageDocument => ({ nodes: {}, roots: emptyWindow(), replies: {},
    metadata: { thread: null, viewer: null, archived: false, unavailable: false, profiles: [] } });
const unique = (ids: string[]) => [...new Set(ids)];
const operationKey = () => '3.' + Date.now() + '.' + crypto.randomUUID();
const message = (error: unknown) => error instanceof Error ? error.message : 'Unable to complete the action.';
function failure(error: unknown): Failure {
    const value = Object(error), status = Number(value.status ?? 0);
    return { status: !status || status >= 500 || ['WRITE_UNCERTAIN', 'OPERATION_EXPIRED'].includes(value.code) ? 'uncertain' : 'failed', message: message(error) };
}
function windowPatch(window: Window, change: WindowDelta = {}, prepend = false): Window {
    const ids = unique(prepend ? [...(change.add ?? []), ...window.ids] : [...window.ids, ...(change.add ?? [])]);
    return { ids: change.total === 0 ? [] : ids.filter(id => !change.remove?.includes(id)),
        total: change.total ?? window.total, cursor: change.cursor === undefined ? window.cursor : change.cursor };
}
function delay(signal: AbortSignal, ms: number): Promise<void> {
    return new Promise((resolve, reject) => {
        signal.throwIfAborted();
        const done = () => { signal.removeEventListener('abort', cancel); resolve(); };
        const timer = setTimeout(done, ms);
        const cancel = () => { clearTimeout(timer); reject(signal.reason); };
        signal.addEventListener('abort', cancel, { once: true });
    });
}
/** One normalized document and one ordered contribution pipeline own a page. */
export class PageModel {
    document = emptyDocument();
    readonly drafts = new Map<string, Draft>();
    order: CommentOrder;
    ready = false;
    error = '';
    lastRefresh = 0;
    ranking: OrderResult | null = null;
    draftRevision = 0;
    replyPrefetch = 5;
    #identity = new AbortController();
    #reads = new Map<string, {
        abort: AbortController;
        work: Promise<boolean>;
    }>();
    #intents = new Map<string, ReactionIntent>();
    #issued = new Set<Promise<unknown>>();
    #tail: Promise<unknown> = Promise.resolve();
    #listeners = new Set<(page: PageModel) => void>();
    constructor(readonly config: PageConfig, private transport: Transport, order: CommentOrder = 'oldest', readonly lifetime = new AbortController()) {
        this.order = order;
        this.signal.addEventListener('abort', () => { this.#identity.abort(); this.#cancelReads(); this.#listeners.clear(); }, { once: true });
    }
    get signal(): AbortSignal { return this.lifetime.signal; }
    get canCompose(): boolean { const meta = this.document.metadata; return this.ready && !meta.archived && !meta.unavailable && !meta.thread?.locked; }
    get hasDrafts(): boolean { return [...this.drafts.values()].some(draft => Boolean(draft.text)); }
    reading(parentId = ''): boolean { return this.#reads.has(parentId); }
    subscribe(listener: (page: PageModel) => void): () => void {
        this.#listeners.add(listener);
        return () => { this.#listeners.delete(listener); };
    }
    #emit(): void { if (!this.signal.aborted)
        for (const listener of this.#listeners)
            listener(this); }
    notify(): void { this.document = { ...this.document }; this.#emit(); }
    #writing(redraw = false): void { this.draftRevision++; if (redraw)
        this.notify();
    else
        this.#emit(); }
    #track<T>(work: Promise<T>): Promise<T> {
        this.#issued.add(work);
        const done = () => { this.#issued.delete(work); };
        work.then(done, done);
        return work;
    }
    async settled(): Promise<void> { await Promise.allSettled([...this.#issued]); }
    dispose(): void { this.lifetime.abort(); }
    #cancelReads(): void { for (const read of this.#reads.values())
        read.abort.abort(); this.#reads.clear(); }
    changeIdentity(): void {
        this.#identity.abort();
        this.#identity = new AbortController();
        this.#tail = Promise.resolve();
        this.#cancelReads();
        this.#intents.clear();
        this.ranking = null;
        for (const [name, { text, key, editor }] of this.drafts)
            this.drafts.set(name, { text, key, editor });
        this.document = emptyDocument();
        this.ready = false;
        this.error = '';
        this.lastRefresh = 0;
        this.#emit();
    }
    #request<T>(operation: string, input: Record<string, unknown>, signal?: AbortSignal, method: 'GET' | 'POST' = 'GET'): Promise<T> {
        return this.transport.request(operation, { ...input, config: selection(this.config) }, signal, method);
    }
    bootstrap(page: WindowPage): void {
        if (this.ready || this.reading())
            return;
        this.#replace(page);
        this.document = { ...this.document, metadata: { ...this.document.metadata, viewer: null } };
        this.#emit();
    }
    #replace(page: WindowPage): void {
        for (const [parent, read] of this.#reads) if (parent) { read.abort.abort(); this.#reads.delete(parent); }
        this.document = { nodes: page.nodes, roots: page.window, replies: page.replies ?? {}, metadata: page.metadata ?? this.document.metadata };
        this.ready = true;
        this.error = '';
        this.lastRefresh = Date.now();
    }
    #acquire(parentId: string, more: boolean, quiet: boolean): Promise<boolean> {
        this.signal.throwIfAborted();
        if (!parentId && more && this.reading()) return Promise.resolve(false);
        if (more && this.document.roots.cursor === null && !parentId)
            return Promise.resolve(false);
        if (!parentId)
            this.#cancelReads();
        else
            this.#reads.get(parentId)?.abort.abort();
        const abort = new AbortController(), signal = AbortSignal.any([this.signal, this.#identity.signal, abort.signal]);
        const work = this.#track(Promise.resolve().then(async () => {
            try {
                signal.throwIfAborted();
                const cursor = parentId ? this.document.replies[parentId]?.cursor ?? '' : more ? this.document.roots.cursor! : '';
                let ids: string[] | undefined;
                if (!parentId && typeof this.order === 'object') {
                    if (!more) {
                        const deadline = Date.now() + 120000;
                        do {
                            const ranking = await this.#request<OrderResult>('ranking', { profile: this.order.profile }, signal);
                            signal.throwIfAborted();
                            this.ranking = ranking;
                            this.notify();
                            signal.throwIfAborted();
                            if (this.ranking.status === 'paused')
                                throw new Error('This order is unavailable right now. You can keep reading chronologically.');
                            if (this.ranking.status === 'ready')
                                break;
                            if (this.ranking.retryAt > deadline)
                                throw new Error('This order is still being prepared. Try again later.');
                            await delay(signal, Math.max(1000, this.ranking.retryAt - Date.now()));
                        } while (Date.now() < deadline);
                    }
                    if (this.ranking?.status !== 'ready')
                        throw new Error('This order is still being prepared. Try again later.');
                    ids = this.ranking.ids.slice(Number(cursor) || 0, (Number(cursor) || 0) + 20);
                }
                const page = await this.#request<WindowPage>('page', { order: typeof this.order === 'string' ? this.order : 'oldest', cursor, ...(parentId ? { parentId } : {}), ids, replyPrefetch: this.replyPrefetch }, signal);
                signal.throwIfAborted();
                if (ids && this.ranking?.status === 'ready')
                    page.window.cursor = Number(cursor) + ids.length < this.ranking.ids.length ? String(Number(cursor) + ids.length) : null;
                if (!parentId && !more)
                    this.#replace(page);
                else {
                    const old = parentId ? this.document.replies[parentId] ?? emptyWindow() : this.document.roots;
                    const window = { ...page.window, ids: unique(parentId ? [...page.window.ids, ...old.ids] : [...old.ids, ...page.window.ids]) };
                    this.document = { nodes: { ...this.document.nodes, ...page.nodes }, roots: parentId ? this.document.roots : window,
                        replies: { ...this.document.replies, ...page.replies, ...(parentId ? { [parentId]: window } : {}) },
                        metadata: page.metadata ?? this.document.metadata };
                }
                this.#emit();
                return true;
            }
            catch (error) {
                if (parentId)
                    throw error;
                if (!signal.aborted && (!quiet || !this.ready)) {
                    this.error = message(error);
                    this.notify();
                }
                return false;
            }
            finally {
                if (this.#reads.get(parentId)?.abort === abort) {
                    this.#reads.delete(parentId);
                    this.notify();
                }
            }
        }));
        this.#reads.set(parentId, { abort, work });
        this.notify();
        return work;
    }
    async refresh(more = false): Promise<void> { await this.#acquire('', more, false); }
    revalidate(staleAfterMs = 0): Promise<boolean> {
        return this.reading() || Date.now() - this.lastRefresh < staleAfterMs ? Promise.resolve(false) : this.#acquire('', false, true);
    }
    async setOrder(order: CommentOrder): Promise<void> {
        if (JSON.stringify(this.order) === JSON.stringify(order))
            return;
        this.order = order;
        this.ranking = null;
        await this.refresh();
    }
    async loadReplies(parentId: string): Promise<void> {
        if (this.document.replies[parentId]?.cursor === null)
            return;
        const current = this.#reads.get(parentId);
        await (current?.work ?? this.#acquire(parentId, true, false));
    }
    preview(body: string, signal = this.signal): Promise<string> {
        this.signal.throwIfAborted();
        return this.#track(this.#request<{
            html: string;
        }>('preview', { body }, AbortSignal.any([this.signal, signal]), 'POST').then(value => value.html));
    }
    #draft(name: string): Draft { let draft = this.drafts.get(name); if (!draft)
        this.drafts.set(name, draft = { text: '' }); return draft; }
    draft(name = 'main'): string { return this.drafts.get(name)?.text ?? ''; }
    setDraft(name: string, text: string): void {
        this.signal.throwIfAborted();
        const draft = this.#draft(name);
        if (draft.pending)
            throw new Error('Wait for the pending submission before changing its draft.');
        if (draft.text !== text)
            draft.key = undefined;
        draft.text = text;
        draft.error = undefined;
        this.#writing();
    }
    #open(name: string, editor: Editor, text = ''): string {
        this.signal.throwIfAborted();
        const draft = this.drafts.get(name) ?? { text };
        if (draft.pending) throw new Error('Wait for the pending submission before changing its editor.');
        draft.editor = editor;
        this.drafts.set(name, draft);
        this.#writing(true);
        return name;
    }
    beginReply(id: string): string { return this.#open('reply:' + id, { kind: 'reply', id }); }
    beginEdit(comment: Comment): string { return this.#open('edit:' + comment.id, { kind: 'edit', id: comment.id }, comment.body); }
    closeEditor(name: string): void { const draft = this.drafts.get(name); if (draft && !draft.pending) {
        draft.editor = undefined;
        this.#writing(true);
    } }
    serializeDrafts(): string { return JSON.stringify({ version: 3, contributions: [...this.drafts].map(([name, { text, key, editor }]) => ({ name, text, key, editor })) }); }
    restoreDrafts(raw: string): void {
        if (raw.length > 240000)
            return;
        try {
            const saved = JSON.parse(raw);
            if (saved.version !== 3 || !Array.isArray(saved.contributions))
                return;
            for (const { name, text, key, editor } of saved.contributions.slice(0, 30)) {
                if (typeof name !== 'string' || name.length > 300 || typeof text !== 'string' || text.length > 60000)
                    continue;
                if (key !== undefined && (typeof key !== 'string' || !/^[A-Za-z0-9_.-]{1,102}$/.test(key)))
                    continue;
                if (editor && (!['reply', 'edit'].includes(editor.kind) || typeof editor.id !== 'string' || editor.id.length > 256))
                    continue;
                if (this.drafts.get(name)?.pending) continue;
                this.drafts.set(name, { text, key, editor });
            }
            this.#writing(true);
        }
        catch { /* Invalid recovery cannot grant a contribution identity. */ }
    }
    #apply(patch: Patch): void {
        const nodes = { ...this.document.nodes }, removed = Object.entries(patch.nodes ?? {}).filter(([, node]) => !node).map(([id]) => id);
        for (const [id, node] of Object.entries(patch.nodes ?? {})) {
            if (node)
                nodes[id] = node;
            else
                delete nodes[id];
        }
        const replies = { ...this.document.replies };
        for (const id of removed) delete replies[id];
        for (const parent of new Set([...Object.keys(replies), ...Object.keys(patch.replies ?? {})]))
            replies[parent] = windowPatch(replies[parent] ?? emptyWindow(), { ...patch.replies?.[parent], remove: [...removed, ...(patch.replies?.[parent]?.remove ?? [])] });
        this.document = { nodes, roots: windowPatch(this.document.roots, { ...patch.roots, remove: [...removed, ...(patch.roots?.remove ?? [])] }, this.order === 'newest'),
            replies, metadata: { ...this.document.metadata, ...patch.metadata } };
    }
    #contribute(operation: string, input: Record<string, unknown>, owner = this.#identity.signal): Promise<ContributionResult> {
        this.signal.throwIfAborted();
        const work = this.#tail.then(async () => {
            owner.throwIfAborted();
            this.signal.throwIfAborted();
            const { key, ...action } = input;
            const result = await this.#request<ContributionResult>('contribute', { key: key ?? operationKey(), action: { type: operation, ...action },
                ...(operation === 'comment' ? { creation: { backLink: this.config.backLink, description: this.config.description } } : {}) }, undefined, 'POST');
            if (!owner.aborted && !this.signal.aborted) {
                this.#cancelReads();
                if (result.patch)
                    this.#apply(result.patch);
                this.error = result.patch ? '' : 'Saved on GitHub. Refresh to load the current discussion.';
                this.notify();
            }
            return result;
        });
        this.#tail = work.catch(() => { });
        return this.#track(work);
    }
    submit(name = 'main'): Promise<ContributionResult> {
        this.signal.throwIfAborted();
        const draft = this.#draft(name);
        if (draft.pending)
            return draft.pending;
        if (!draft.text.trim()) {
            const error = new Error('Write a comment before submitting.');
            draft.error = { status: 'failed', message: error.message };
            this.notify();
            return Promise.reject(error);
        }
        draft.key ??= operationKey();
        if (!/^3\.\d{13}\.[A-Za-z0-9_-]{16,86}$/.test(draft.key)) {
            const error = new Error('This saved submission may already be on GitHub. Check the discussion before editing and submitting it again.');
            draft.error = { status: 'uncertain', message: error.message };
            this.notify();
            return Promise.reject(error);
        }
        const editor = draft.editor;
        const work = this.#contribute(editor?.kind === 'edit' ? 'edit' : 'comment', { body: draft.text, key: draft.key,
            ...(editor?.kind === 'edit' ? { id: editor.id } : { replyToId: editor?.id ?? '' }) }).then(result => {
            if (!this.signal.aborted && this.drafts.get(name) === draft) {
                this.drafts.delete(name);
                this.#writing(true);
            }
            return result;
        }, error => { if (!this.signal.aborted && this.drafts.get(name) === draft)
            draft.error = failure(error); throw error; })
            .finally(() => { if (this.drafts.get(name) === draft) {
            draft.pending = undefined;
            this.notify();
        } });
        draft.pending = work;
        this.#writing();
        return work;
    }
    removeComment(id: string): Promise<ContributionResult> { return this.#contribute('delete', { id }); }
    moderateComment(id: string, minimized: boolean, reason: ModerationReason = 'OFF_TOPIC'): Promise<ContributionResult> { return this.#contribute('moderate', { id, minimized, reason }); }
    #confirmed(id: string): Reactions { return id === this.document.metadata.thread?.id ? this.document.metadata.thread.reactions : this.document.nodes[id]?.reactions ?? {}; }
    reactions(id: string): Reactions {
        const groups = { ...this.#confirmed(id) };
        for (const intent of this.#intents.values())
            if (intent.id === id) {
                const previous = groups[intent.reaction] ?? { count: 0, selected: false };
                groups[intent.reaction] = { selected: intent.selected, count: Math.max(0, previous.count + Number(intent.selected) - Number(previous.selected)) };
            }
        return groups;
    }
    reactionIntent(id: string, reaction: Reaction): ReactionIntent | undefined { return this.#intents.get(id + '\0' + reaction); }
    setReaction(id: string, reaction: Reaction, selected: boolean): Promise<void> {
        this.signal.throwIfAborted();
        id = id === 'discussion' ? this.document.metadata.thread?.id ?? id : id;
        const key = id + '\0' + reaction, intent = this.#intents.get(key) ?? { id, reaction, selected };
        intent.selected = selected;
        this.#intents.set(key, intent);
        const work = intent.pending ?? this.#react(key, intent);
        this.notify();
        return work;
    }
    #react(key: string, intent: ReactionIntent): Promise<void> {
        const owner = this.#identity.signal;
        intent.pending = this.#track(Promise.resolve().then(async () => {
            try {
                while (!owner.aborted && this.#intents.get(key) === intent) {
                    if (!intent.issued && Boolean(this.#confirmed(intent.id)[intent.reaction]?.selected) === intent.selected)
                        break;
                    intent.issued ??= { add: intent.selected, key: operationKey() };
                    const issued = intent.issued;
                    await this.#contribute('reaction', { id: intent.id, reaction: intent.reaction, ...issued }, owner);
                    intent.issued = undefined;
                    if (intent.selected === issued.add) break;
                    intent.issued = { add: intent.selected, key: operationKey() };
                }
                if (this.#intents.get(key) === intent)
                    this.#intents.delete(key);
            }
            catch (error) {
                if (this.#intents.get(key) === intent) {
                    intent.error = failure(error);
                    if (intent.error.status !== 'uncertain') this.#intents.delete(key);
                }
                throw error;
            }
            finally {
                intent.pending = undefined;
                this.notify();
            }
        }));
        return intent.pending;
    }
    async retryReaction(id: string): Promise<void> {
        await Promise.all([...this.#intents].filter(([, intent]) => intent.id === id).map(([key, intent]) => intent.pending ?? this.#react(key, intent)));
    }
}
