import { Writing, contributionFailure as failure, recoveredWriting, writingTargetKey, type WritingTarget, type WritingFailure } from './writing.js';
import { selection } from '../contracts/selection.js';
import type { ContentPreview, ContentSource } from '../contracts/content.js';
import type { Selection, ModerationReason } from '../contracts/requests.js';
import type { Comment, ContributionResult, PageDocument, Patch, Reaction, Reactions, Window, WindowDelta, WindowPage } from '../contracts/document.js';
import type { OrderResult } from '../ranking/types.js';
export interface Transport {
    readonly principal?: string | null;
    request<T>(operation: string, body: unknown, signal?: AbortSignal, method?: 'GET' | 'POST'): Promise<T>;
}
export type CommentOrder = 'oldest' | 'newest' | {
    profile: string;
};
export type AcquisitionPurpose = 'initial' | 'restart' | 'continue' | 'revalidate' | 'change-order';
export interface Acquisition { purpose: AcquisitionPurpose; started: number }
export interface ActionAvailability { status: 'available' | 'sign-in' | 'pending' | 'recovery' | 'unavailable'; reason?: string }
export interface ReactionState { permission: ActionAvailability; confirmed: { count: number; selected: boolean }; desired: boolean; selected: boolean; count: number; pending: boolean; recovery?: Failure; recover: ActionAvailability; abandon: boolean }
export interface SubjectActions { reply: ActionAvailability; edit: ActionAvailability; remove: ActionAvailability; moderate: ActionAvailability; react: ActionAvailability; recover: ActionAvailability; abandon: ActionAvailability }
export type PageConfig = Selection & { backLink?: string; description?: string };
export type Failure = WritingFailure;
interface SubjectEffect {
    principal: string | null;
    operation: 'delete' | 'moderate';
    input: Record<string, unknown>;
    pending?: Promise<ContributionResult>;
    error?: Failure;
}
interface ReactionIntent {
    principal: string;
    id: string;
    confirmed: { count: number; selected: boolean };
    acknowledged?: boolean;
    reaction: Reaction;
    selected: boolean;
    issued?: {
        selected: boolean;
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
function windowPatch(window: Window, change: WindowDelta = {}, prepend = false): Window {
    const ids = unique(prepend ? [...(change.add ?? []), ...window.ids] : [...window.ids, ...(change.add ?? [])]);
    return { ids: change.total === 0 ? [] : ids.filter(id => !change.remove?.includes(id)),
        total: change.total ?? (window.total === null ? null : window.total + (change.add ?? []).filter(id => !window.ids.includes(id)).length - window.ids.filter(id => change.remove?.includes(id)).length), cursor: change.cursor === undefined ? window.cursor : change.cursor };
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
/** One normalized document; effects serialize only where their owned fields conflict. */
export class PageModel {
    readonly config: Readonly<PageConfig>;
    document = emptyDocument();
    #writings = new Map<string, Writing>();
    #activeWriting = new Map<string, string>();
    get writings(): ReadonlyMap<string, Writing> { return this.#writings; }
    #order: CommentOrder;
    ready = false;
    error = '';
    lastRefresh = 0;
    ranking: OrderResult | null = null;
    writingRevision = 0;
    replyPrefetch = 5;
    contentSource: ContentSource = 'source';
    #identity = new AbortController();
    continuity: { status: 'current' | 'restart-required'; reason?: string } = { status: 'current' };
    #observationOffset = 0;
    #reads = new Map<string, {
        state: Acquisition;
        abort: AbortController;
        work: Promise<boolean>;
    }>();
    #intents = new Map<string, ReactionIntent>();
    #effects = new Map<string, SubjectEffect>();
    #issued = new Set<Promise<unknown>>();
    #operations = new Map<string, Promise<unknown>>();
    #listeners = new Set<(page: PageModel, writing?: Writing) => void>();
    constructor(config: PageConfig, private transport: Transport, order: CommentOrder = 'oldest', readonly lifetime = new AbortController()) {
        this.config = Object.freeze({ ...config });
        this.#order = typeof order === 'string' ? order : Object.freeze({ ...order });
        this.signal.addEventListener('abort', () => { this.#identity.abort(); this.#cancelReads(); this.#listeners.clear(); }, { once: true });
    }
    get order(): CommentOrder { return this.#order; }
    get signal(): AbortSignal { return this.lifetime.signal; }
    #principal(): string | null { return this.transport.principal !== undefined ? this.transport.principal : this.document.metadata.viewer?.id ?? null; }
    get canCompose(): boolean { const meta = this.document.metadata; return this.ready && !meta.archived && !meta.unavailable && !meta.thread?.locked; }
    get hasUnresolvedWriting(): boolean { return [...this.writings.values()].some(writing => writing.protected); }
    get hasWriting(): boolean { return [...this.writings.values()].some(writing => Boolean(writing.text) || writing.protected || writing.actions.undoClear); }
    acquisition(parentId = ''): Acquisition | undefined { return this.#reads.get(parentId)?.state; }
    subscribe(listener: (page: PageModel, writing?: Writing) => void): () => void {
        this.#listeners.add(listener);
        return () => { this.#listeners.delete(listener); };
    }
    #emit(writing?: Writing): void { if (!this.signal.aborted)
        for (const listener of this.#listeners)
            try { listener(this, writing); }
            catch (error) { console.error('A conversation subscriber failed.', error); } }
    notify(writing?: Writing): void { this.document = { ...this.document }; this.#emit(writing); }
    #writing(redraw = false, writing?: Writing): void { this.writingRevision++; if (redraw)
        this.notify(writing);
    else
        this.#emit(writing); }
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
        this.#cancelReads();
        for (const intent of this.#intents.values()) if (intent.issued && !intent.pending) intent.error = { status: 'uncertain', message: 'Sign in as the original author to recover this reaction.' };
        for (const effect of this.#effects.values()) if (!effect.pending) effect.error = { status: 'uncertain', message: 'Sign in as the original author to recover this action.' };
        this.ranking = null;
        for (const writing of this.writings.values()) writing.identityChanged();
        this.document = emptyDocument();
        this.ready = false;
        this.error = '';
        this.lastRefresh = 0;
        this.continuity = { status: 'current' };
        this.#observationOffset = 0;
        this.#emit();
    }
    #request<T>(operation: string, input: Record<string, unknown>, signal?: AbortSignal, method: 'GET' | 'POST' = 'GET'): Promise<T> {
        return this.transport.request(operation, { ...input, ...(['page', 'contribute', 'preview'].includes(operation) ? { content: this.contentSource } : {}), config: selection(this.config) }, signal, method);
    }
    bootstrap(page: WindowPage): void {
        if (this.ready || this.acquisition())
            return;
        this.#replace(page);
        this.document = { ...this.document, metadata: { ...this.document.metadata, viewer: null } };
        this.#emit();
    }
    #replace(page: WindowPage, baseline = this.document): void {
        for (const [parent, read] of this.#reads) if (parent) { read.abort.abort(); this.#reads.delete(parent); }
        this.#adopt(page, baseline, '', true);
        this.ready = true;
        this.error = '';
        this.lastRefresh = Date.now();
        this.continuity = { status: 'current' };
        this.#observationOffset = 0;
    }
    #adopt(page: WindowPage, baseline: PageDocument, parentId = '', replacing = false, observedIds?: string[]): void {
        const current = this.document, nodes = replacing ? { ...page.nodes } : { ...current.nodes };
        for (const [id, node] of Object.entries(page.nodes))
            if ((!parentId || id !== parentId || !current.nodes[id]) && current.nodes[id] === baseline.nodes[id]) nodes[id] = node;
        for (const [id, node] of Object.entries(current.nodes)) if (node !== baseline.nodes[id]) nodes[id] = node;
        const removed = (observedIds ?? []).filter(id => !page.nodes[id] && current.nodes[id] === baseline.nodes[id] && current.replies[id] === baseline.replies[id]);
        for (const id of Object.keys(baseline.nodes)) if (!current.nodes[id]) delete nodes[id];
        for (const id of Object.keys(nodes)) if (removed.includes(id) || removed.includes(nodes[id]!.parentId ?? '')) delete nodes[id];
        const replies = replacing ? { ...page.replies } : { ...current.replies };
        for (const [id, acquired] of Object.entries(page.replies ?? {})) {
            const old = current.replies[id];
            if (replacing) {
                const added = old?.ids.filter(child => !baseline.replies[id]?.ids.includes(child)) ?? [];
                replies[id] = { ...acquired, ids: unique([...acquired.ids, ...added]), total: old !== baseline.replies[id] ? old?.total ?? acquired.total : acquired.total };
            } else replies[id] = old ? { ...old, total: old === baseline.replies[id] ? acquired.total : old.total } : acquired;
        }
        if (parentId) {
            const old = current.replies[parentId] ?? emptyWindow();
            replies[parentId] = { ...page.window, ids: unique([...page.window.ids, ...old.ids]), total: old === baseline.replies[parentId] ? page.window.total : old.total };
        }
        for (const [id, window] of Object.entries(replies)) {
            if (removed.includes(id)) delete replies[id];
            else { const ids = window.ids.filter(child => nodes[child]); if (ids.length !== window.ids.length) replies[id] = { ...window, ids }; }
        }
        const roots = observedIds ? { ...current.roots, ids: current.roots.ids.filter(id => nodes[id]), total: current.roots === baseline.roots ? page.window.total : current.roots.total }
            : parentId ? current.roots : { ...page.window,
                ids: replacing ? unique([...page.window.ids, ...current.roots.ids.filter(id => !baseline.roots.ids.includes(id))]) : unique([...current.roots.ids, ...page.window.ids]),
                total: current.roots === baseline.roots ? page.window.total : current.roots.total };
        const rootIds = roots.ids.filter(id => nodes[id]);
        this.document = { nodes, roots: rootIds.length === roots.ids.length ? roots : { ...roots, ids: rootIds }, replies, metadata: !parentId && current.metadata === baseline.metadata ? page.metadata ?? current.metadata : current.metadata };
        this.#adoptReactions();
    }
    #acquire(parentId: string, purpose: AcquisitionPurpose, observedIds?: string[]): Promise<boolean> {
        this.signal.throwIfAborted();
        const continuing = purpose === 'continue', observing = purpose === 'revalidate';
        const current = this.#reads.get(parentId);
        if (current && (continuing || observing || purpose === 'initial')) return current.work;
        if (continuing && (this.continuity.status === 'restart-required' || (parentId ? this.document.replies[parentId]?.cursor : this.document.roots.cursor) === null)) return Promise.resolve(false);
        if (!parentId && !observing && !continuing) this.#cancelReads();
        else current?.abort.abort();
        const baseline = this.document;
        const abort = new AbortController(), signal = AbortSignal.any([this.signal, this.#identity.signal, abort.signal]);
        const work = this.#track(Promise.resolve().then(async () => {
            try {
                signal.throwIfAborted();
                if (observing) {
                    // Observe a bounded portion of the existing document, never start a new traversal.
                    const loaded = Object.keys(this.document.nodes);
                    const ids = observedIds ? unique(observedIds).filter(id => this.document.nodes[id]).slice(0, 100)
                        : [...loaded.slice(this.#observationOffset), ...loaded.slice(0, this.#observationOffset)].slice(0, 100);
                    const page = await this.#request<WindowPage>('page', { ids, observe: true, replyPrefetch: 0 }, signal);
                    signal.throwIfAborted();
                    if (this.document.metadata.thread?.id !== page.metadata?.thread?.id || page.metadata?.unavailable) {
                        this.document = { ...this.document, metadata: page.metadata ?? this.document.metadata };
                        this.continuity = { status: 'restart-required', reason: 'The discussion changed or is unavailable. Restart deliberately to acquire a new reading order.' };
                    } else {
                        this.#adopt(page, baseline, '', false, ids);
                        this.#observationOffset = loaded.length ? (this.#observationOffset + ids.length) % loaded.length : 0;
                    }
                    this.lastRefresh = Date.now();
                    this.#emit();
                    return true;
                }
                const cursor = continuing ? (parentId ? this.document.replies[parentId]?.cursor ?? '' : this.document.roots.cursor!) : '';
                let ids: string[] | undefined;
                if (!parentId && typeof this.order === 'object') {
                    if (!continuing) {
                        const deadline = Date.now() + 120000;
                        do {
                            const ranking = await this.#request<OrderResult>('ranking', { profile: this.order.profile }, signal);
                            signal.throwIfAborted();
                            this.ranking = ranking;
                            this.notify();
                            if (ranking.status === 'paused') throw new Error('This order is unavailable right now. You can keep reading chronologically.');
                            if (ranking.status === 'ready') break;
                            if (ranking.retryAt > deadline) throw new Error('This order is still being prepared. Try again later.');
                            await delay(signal, Math.max(1000, ranking.retryAt - Date.now()));
                        } while (Date.now() < deadline);
                    }
                    if (this.ranking?.status !== 'ready') throw new Error('This order is still being prepared. Try again later.');
                    ids = this.ranking.ids.slice(Number(cursor) || 0, (Number(cursor) || 0) + 20);
                }
                const page = await this.#request<WindowPage>('page', { order: typeof this.order === 'string' ? this.order : 'oldest', cursor, ...(parentId ? { parentId } : {}), ids, replyPrefetch: this.replyPrefetch }, signal);
                signal.throwIfAborted();
                if (ids && this.ranking?.status === 'ready') page.window.cursor = Number(cursor) + ids.length < this.ranking.ids.length ? String(Number(cursor) + ids.length) : null;
                if (!parentId && !continuing) this.#replace(page, baseline);
                else if (this.document.metadata.thread?.id !== page.metadata?.thread?.id) {
                    this.continuity = { status: 'restart-required', reason: 'The discussion changed. Restart to acquire its comments.' };
                    this.document = { ...this.document, metadata: page.metadata ?? this.document.metadata };
                    return false;
                } else {
                    this.#adopt(page, baseline, parentId);
                }
                this.#emit();
                return true;
            } catch (error) {
                if (!signal.aborted) {
                    if (purpose === 'change-order' || continuing && [400, 404, 410].includes(Number(Object(error).status))) this.continuity = { status: 'restart-required', reason: message(error) };
                    if (!observing || !this.ready) this.error = message(error);
                    this.notify();
                }
                return false;
            } finally {
                if (this.#reads.get(parentId)?.abort === abort) { this.#reads.delete(parentId); this.notify(); }
            }
        }));
        this.#reads.set(parentId, { state: { purpose, started: Date.now() }, abort, work });
        this.notify();
        return work;
    }
    async start(): Promise<void> { if (!this.ready) await this.#acquire('', 'initial'); }
    async restart(): Promise<void> { await this.#acquire('', this.ready ? 'restart' : 'initial'); }
    async loadMore(): Promise<void> { await this.#acquire('', 'continue'); }
    revalidate(staleAfterMs = 0, observedIds?: string[]): Promise<boolean> {
        return !this.ready || this.acquisition() || Date.now() - this.lastRefresh < staleAfterMs ? Promise.resolve(false) : this.#acquire('', 'revalidate', observedIds);
    }
    async setOrder(order: CommentOrder): Promise<void> {
        if (JSON.stringify(this.order) === JSON.stringify(order)) return;
        this.#order = typeof order === 'string' ? order : Object.freeze({ ...order });
        this.ranking = null;
        await this.#acquire('', 'change-order');
    }
    async loadReplies(parentId: string): Promise<void> { await this.#acquire(parentId, 'continue'); }
    preview(body: string, signal = this.signal, draft?: string): Promise<ContentPreview> {
        this.signal.throwIfAborted();
        return this.#track(this.#request<ContentPreview>('preview', { body, draft }, AbortSignal.any([this.signal, signal]), 'POST'));
    }
    activeWriting(target: WritingTarget = { kind: 'comment' }): Writing | undefined {
        return this.#writings.get(this.#activeWriting.get(writingTargetKey(target)) ?? '');
    }
    writing(target: WritingTarget = { kind: 'comment' }): Writing { return this.activeWriting(target) ?? this.newWriting(target); }
    newWriting(target: WritingTarget = { kind: 'comment' }): Writing { return this.#createWriting(target); }
    #createWriting(target: WritingTarget, saved?: import('./writing.js').SavedWriting): Writing {
        this.signal.throwIfAborted();
        const writing = new Writing(target, {
                changed: redraw => this.#writing(redraw, writing),
                initialText: target => target.kind === 'edit' ? this.document.nodes[target.id]?.body ?? '' : '',
                principal: () => this.#principal(),
                eligible: target => target.kind === 'comment' ? this.canCompose : ['available', 'sign-in'].includes(this.actions(target.id)[target.kind].status),
                contribute: issued => {
                    if (issued.principal !== this.#principal()) return Promise.reject(Object.assign(new Error('The original author must recover this submission.'), { code: 'WRITE_UNCERTAIN' }));
                    return this.#contribute(issued.target.kind === 'edit' ? 'edit' : 'comment', {
                    key: issued.key, body: issued.body,
                    ...(issued.target.kind === 'edit' ? { id: issued.target.id } : { replyToId: issued.target.kind === 'reply' ? issued.target.id : '' }) });
                },
            }, target.kind === 'edit' ? this.document.nodes[target.id]?.body ?? '' : '', saved?.id);
        if (saved) writing.recover(saved);
        this.#writings.set(writing.id, writing);
        this.#activeWriting.set(writingTargetKey(target), writing.id);
        return writing;
    }
    selectWriting(id: string): Writing | undefined {
        const writing = this.#writings.get(id);
        if (writing) { this.#activeWriting.set(writingTargetKey(writing.target), id);this.#writing(true, writing); }
        return writing;
    }
    get selectedWriting(): readonly string[] { return [...this.#activeWriting.values()]; }
    saveWriting(): string {
        const writing = [...this.writings.values()].filter(writing => writing.text || writing.protected || writing.actions.undoClear);
        return JSON.stringify({ version: 5, writing: writing.map(writing => writing.save()), selected: [...this.#activeWriting.values()].filter(id => writing.some(value => value.id === id)) });
    }
    recoverWriting(raw: string): void {
        const recovered = recoveredWriting(raw);
        for (const saved of recovered) if (!this.#writings.has(saved.id)) this.#createWriting(saved.target, saved);
        try { for (const id of JSON.parse(raw).selected ?? []) if (typeof id === 'string') this.selectWriting(id); } catch {}
        this.#writing(true);
    }
    #apply(patch: Patch): void {
        const nodes = { ...this.document.nodes }, missing = Object.entries(patch.nodes ?? {}).filter(([, node]) => !node).map(([id]) => id);
        const removed = unique([...missing, ...Object.keys(nodes).filter(id => missing.includes(nodes[id]!.parentId ?? ''))]);
        for (const [id, node] of Object.entries(patch.nodes ?? {})) if (node) {
            const previous = nodes[id], changed = { ...node };
            const revision = node.lastEditedAt ?? node.createdAt;
            if (revision && previous && Date.parse(previous.lastEditedAt ?? previous.createdAt) > Date.parse(revision)) {
                delete changed.body; delete changed.bodyHTML; delete changed.prepared; delete changed.lastEditedAt;
            }
            nodes[id] = { ...previous, ...(changed.body !== undefined && changed.body !== previous?.body ? { prepared: undefined, bodyHTML: undefined } : {}), ...changed } as Comment;
        }
        for (const id of removed) delete nodes[id];
        const replies = { ...this.document.replies };
        for (const id of removed) delete replies[id];
        for (const parent of new Set([...(removed.length ? Object.keys(replies) : []), ...Object.keys(patch.replies ?? {})]))
            replies[parent] = windowPatch(replies[parent] ?? emptyWindow(), { ...patch.replies?.[parent], remove: [...removed, ...(patch.replies?.[parent]?.remove ?? [])] });
        let metadata = patch.metadata ? { ...this.document.metadata, ...patch.metadata } : this.document.metadata;
        for (const [id, groups] of Object.entries(patch.reactions ?? {})) {
            if (id === metadata.thread?.id) metadata = { ...metadata, thread: { ...metadata.thread, reactions: { ...metadata.thread.reactions, ...groups } } };
            else if (nodes[id]) nodes[id] = { ...nodes[id]!, reactions: { ...nodes[id]!.reactions, ...groups } };
        }
        this.document = { nodes, roots: patch.roots || removed.length ? windowPatch(this.document.roots, { ...patch.roots, remove: [...removed, ...(patch.roots?.remove ?? [])] }, this.order === 'newest') : this.document.roots, replies, metadata };
    }
    #contribute(operation: string, input: Record<string, unknown>, principal = this.#principal()): Promise<ContributionResult> {
        this.signal.throwIfAborted();
        const id = String(input.id ?? ''), parent = this.document.nodes[id]?.parentId;
        const scopes = operation === 'reaction' ? [] : operation === 'comment' ? [input.replyToId ? 'replies:' + (this.document.nodes[String(input.replyToId)]?.parentId || input.replyToId) : 'roots']
            : operation === 'delete' ? ['node:' + id, parent ? 'replies:' + parent : 'roots', 'replies:' + id] : ['node:' + id];
        const keys = scopes.map(scope => principal + '\0' + scope), previous = keys.map(key => this.#operations.get(key)?.catch(() => undefined));
        const work = this.#track(Promise.all(previous).then(async () => {
            this.signal.throwIfAborted();
            if (!principal || principal !== this.#principal()) throw Object.assign(new Error('Sign in as the original author to continue this contribution.'), { code: 'WRITE_UNCERTAIN' });
            const { key, ...action } = input;
            const result = await this.#request<ContributionResult>('contribute', { key: key ?? operationKey(), action: { type: operation, ...action },
                ...(operation === 'comment' ? { creation: { backLink: this.config.backLink, description: this.config.description } } : {}) }, undefined, 'POST');
            if (principal === this.#principal() && !this.signal.aborted) {
                if (result.patch) this.#apply({ ...result.patch, metadata: this.document.metadata.thread ? undefined : result.patch.metadata });
                this.error = result.patch ? '' : 'Saved on GitHub. Refresh to load the current discussion.';
                this.notify();
            }
            return result;
        }).finally(() => { for (const key of keys) if (this.#operations.get(key) === work) this.#operations.delete(key); }));
        for (const key of keys) this.#operations.set(key, work);
        return work;
    }
    #effect(operation: SubjectEffect['operation'], input: Record<string, unknown> & { id: string }): Promise<ContributionResult> {
        this.signal.throwIfAborted();
        if (!this.#principal()) return Promise.reject(new Error('Sign in before contributing.'));
        const effectKey = this.#principal() + '\0' + input.id;
        const retained = this.#effects.get(effectKey);
        if (retained) {
            const { key: _key, ...issued } = retained.input;
            if (retained.operation !== operation || JSON.stringify(issued) !== JSON.stringify(input)) return Promise.reject(new Error('Resolve the pending action before changing its intent.'));
            return retained.pending ?? this.#issueEffect(effectKey, retained);
        }
        const effect: SubjectEffect = { principal: this.#principal(), operation, input: { ...input, key: operationKey() } };
        this.#effects.set(effectKey, effect);
        return this.#issueEffect(effectKey, effect);
    }
    #issueEffect(id: string, effect: SubjectEffect): Promise<ContributionResult> {
        if (!effect.principal || effect.principal !== this.#principal()) return Promise.reject(new Error('Sign in as the original author to recover this action.'));
        const recovering = effect.error?.status === 'uncertain';
        const work = this.#track(this.#contribute(effect.operation, effect.input).then(result => {
            if (this.#effects.get(id) === effect) this.#effects.delete(id);
            return result;
        }, error => {
            if (this.#effects.get(id) === effect) {
                effect.error = failure(error);
                if (recovering) effect.error.status = 'uncertain';
                if (effect.error.status !== 'uncertain') this.#effects.delete(id);
            }
            throw error;
        }).finally(() => { effect.pending = undefined; this.notify(); }));
        effect.pending = work;
        this.notify();
        return work;
    }
    removeComment(id: string): Promise<ContributionResult> { return this.#effect('delete', { id }); }
    moderateComment(id: string, minimized: boolean, reason: ModerationReason = 'OFF_TOPIC'): Promise<ContributionResult> { return this.#effect('moderate', { id, minimized, reason }); }
    #subject(id: string): string { return id === 'discussion' || id === this.document.metadata.thread?.id ? 'discussion' : id; }
    #intentKey(id: string, reaction: Reaction, principal = this.#principal()): string { return principal + '\0' + id + '\0' + reaction; }
    #confirmed(id: string): Reactions { return id === 'discussion' ? this.document.metadata.thread?.reactions ?? {} : this.document.nodes[id]?.reactions ?? {}; }
    #canAdopt(intent: ReactionIntent): boolean { return intent.principal === this.#principal() && Boolean(intent.id === 'discussion' ? this.document.metadata.thread : this.document.nodes[intent.id]); }
    #adoptReactions(): void {
        for (const [key, intent] of this.#intents) if (intent.acknowledged && this.#canAdopt(intent)) {
            const id = intent.id === 'discussion' ? this.document.metadata.thread!.id : intent.id;
            const previous = this.#confirmed(intent.id)[intent.reaction];
            if (previous?.count !== intent.confirmed.count || previous.selected !== intent.confirmed.selected) this.#apply({ reactions: { [id]: { [intent.reaction]: intent.confirmed } } });
            intent.acknowledged = false;
            if (!intent.pending && !intent.issued && intent.selected === intent.confirmed.selected) this.#intents.delete(key);
        }
        for (const [key, intent] of this.#intents) if (intent.principal === this.#principal() && !intent.pending && intent.error?.status === 'failed' && intent.selected !== intent.confirmed.selected) {
            intent.error = undefined; void this.#react(key, intent).catch(() => {});
        }
    }
    #reactionIntent(id: string, reaction: Reaction): ReactionIntent | undefined {
        return this.#principal() ? this.#intents.get(this.#intentKey(id, reaction)) : [...this.#intents.values()].find(intent => intent.id === id && intent.reaction === reaction && intent.error?.status === 'uncertain');
    }
    reaction(subjectId: string, reaction: Reaction): ReactionState {
        const id = this.#subject(subjectId), intent = this.#reactionIntent(id, reaction);
        const confirmed = intent?.acknowledged ? intent.confirmed : this.#confirmed(id)[reaction] ?? { count: 0, selected: false };
        const desired = intent?.selected ?? confirmed.selected;
        return { permission: this.actions(id).react, confirmed: { ...confirmed }, desired, selected: desired,
            count: Math.max(0, confirmed.count + Number(desired) - Number(confirmed.selected)), pending: Boolean(intent?.pending), recovery: intent?.error,
            recover: intent?.error?.status !== 'uncertain' ? { status: 'unavailable' } : intent.pending ? { status: 'pending' } : intent.principal === this.#principal() ? { status: 'available' } : { status: 'sign-in', reason: 'Sign in as the original author to recover this reaction.' },
            abandon: Boolean(intent?.error?.status === 'uncertain' && !intent.pending) };
    }
    reactions(subjectId: string): Reactions {
        const id = this.#subject(subjectId), groups = { ...this.#confirmed(id) };
        for (const intent of this.#intents.values()) if (intent.id === id && intent.principal === this.#principal()) { const { count, selected } = this.reaction(id, intent.reaction); groups[intent.reaction] = { count, selected }; }
        return groups;
    }
    actions(subjectId = 'discussion'): SubjectActions {
        const { metadata, nodes } = this.document, id = this.#subject(subjectId), node = nodes[id];
        const effect = this.#effects.get(this.#principal() + '\0' + id);
        const pending = Boolean(effect?.pending), uncertain = effect?.error?.status === 'uncertain';
        const unavailable = (reason: string): ActionAvailability => ({ status: 'unavailable', reason });
        const available = (): ActionAvailability => ({ status: this.#principal() ? 'available' : 'sign-in' });
        const base = !this.ready ? unavailable('The discussion is loading.') : metadata.unavailable ? unavailable('The discussion is unavailable.')
            : metadata.archived ? unavailable('The repository is archived.') : id !== 'discussion' && !node ? unavailable('This comment is unavailable.') : undefined;
        const permission = (allowed: boolean, operation?: SubjectEffect['operation']): ActionAvailability => effect && effect.operation === operation ? (effect.pending ? { status: 'pending' } : { status: 'recovery', reason: effect.error?.message }) : base ?? (effect?.pending ? { status: 'pending' } : allowed ? available() : unavailable('This action is not permitted.'));
        const participation = base ?? (metadata.thread?.locked ? unavailable('The discussion is locked.') : available());
        const writingAction = (writing: Writing | undefined, action: ActionAvailability): ActionAvailability => writing?.pending ? { status: 'pending' } : writing?.protected ? { status: 'recovery', reason: writing.error?.message } : action;
        return {
            reply: writingAction(this.activeWriting(id === 'discussion' ? { kind: 'comment' } : { kind: 'reply', id }), participation),
            edit: writingAction(this.activeWriting({ kind: 'edit', id }), permission(Boolean(node?.viewerCanUpdate))),
            remove: permission(Boolean(node?.viewerCanDelete), 'delete'),
            moderate: permission(Boolean(node && (node.isMinimized ? node.viewerCanUnminimize : node.viewerCanMinimize)), 'moderate'),
            react: participation,
            recover: !uncertain ? unavailable('No action needs recovery.') : pending ? { status: 'pending' } : available(),
            abandon: !uncertain ? unavailable('No unresolved action exists.') : pending ? { status: 'pending' } : { status: 'available' },
        };
    }
    setReaction(subjectId: string, reaction: Reaction, selected: boolean): Promise<void> {
        this.signal.throwIfAborted();
        const principal = this.#principal();
        if (!principal) return Promise.reject(new Error('Sign in before choosing a reaction.'));
        const id = this.#subject(subjectId), key = this.#intentKey(id, reaction, principal);
        const intent: ReactionIntent = this.#intents.get(key) ?? { principal, id, reaction, selected, confirmed: { ...this.#confirmed(id)[reaction] ?? { count: 0, selected: false } } };
        intent.selected = selected;
        if (intent.error?.status !== 'uncertain') intent.error = undefined;
        this.#intents.set(key, intent);
        const work = intent.pending ?? this.#react(key, intent);
        this.notify();
        return work;
    }
    #react(key: string, intent: ReactionIntent): Promise<void> {
        if (intent.principal !== this.#principal()) return Promise.reject(new Error('Sign in as the original author to recover this reaction.'));
        let recovering = Boolean(intent.issued);
        intent.pending = this.#track(Promise.resolve().then(async () => {
            try {
                while (!this.signal.aborted && this.#intents.get(key) === intent && intent.principal === this.#principal()) {
                    if (!intent.issued && intent.confirmed.selected === intent.selected) break;
                    intent.issued ??= { selected: intent.selected, key: operationKey() };
                    const issued = intent.issued;
                    const result = await this.#contribute('reaction', { subject: intent.id === 'discussion' ? { kind: 'discussion' } : { kind: 'comment', id: intent.id }, reaction: intent.reaction, ...issued }, intent.principal);
                    const actualId = intent.id === 'discussion' ? result.id : intent.id;
                    intent.confirmed = result.patch?.reactions?.[actualId]?.[intent.reaction] ?? { selected: issued.selected, count: Math.max(0, intent.confirmed.count + Number(issued.selected) - Number(intent.confirmed.selected)) };
                    intent.acknowledged = true; intent.error = undefined; recovering = false; intent.issued = undefined;
                    this.#adoptReactions();
                }
                if (intent.selected !== intent.confirmed.selected) throw Object.assign(new Error('Sign in as the original author to finish the requested reaction.'), { code: 'AUTHOR_CHANGED', status: 401 });
                if (this.#canAdopt(intent)) this.#intents.delete(key);
            } catch (error) {
                if (this.#intents.get(key) === intent) {
                    intent.error = failure(error);
                    if (recovering) intent.error.status = 'uncertain';
                    if (intent.error.status !== 'uncertain' && Object(error).code !== 'AUTHOR_CHANGED') this.#intents.delete(key);
                }
                throw error;
            } finally {
                intent.pending = undefined;
                this.#adoptReactions(); this.notify();
            }
        }));
        return intent.pending;
    }
    retryReaction(subjectId: string, reaction: Reaction): Promise<void> {
        const id = this.#subject(subjectId), intent = this.#reactionIntent(id, reaction);
        return intent ? intent.pending ?? this.#react(this.#intentKey(id, reaction, intent.principal), intent) : Promise.resolve();
    }
    /** Abandonment forgets only this local unresolved reaction; it cannot cancel its remote effect. */
    abandonReaction(subjectId: string, reaction: Reaction): boolean {
        const id = this.#subject(subjectId), intent = this.#reactionIntent(id, reaction);
        if (!intent || intent.pending || intent.error?.status !== 'uncertain') return false;
        this.#intents.delete(this.#intentKey(id, reaction, intent.principal)); this.notify(); return true;
    }
    /** The host must obtain a deliberate decision before abandoning an unknown outcome. */
    abandonAction(subjectId: string): boolean {
        const id = this.#subject(subjectId);
        if (this.actions(id).abandon.status !== 'available') return false;
        this.#effects.delete(this.#principal() + '\0' + id);
        this.notify(); return true;
    }
    async retryAction(subjectId: string): Promise<void> {
        const id = this.#subject(subjectId), effectKey = this.#principal() + '\0' + id, effect = this.#effects.get(effectKey);
        if (effect) await (effect.pending ?? this.#issueEffect(effectKey, effect));
    }
}
