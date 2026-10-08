import { Writing, contributionFailure as failure, recoveredWriting, writingId, type WritingTarget, type WritingFailure } from './writing.js';
import { selection } from '../contracts/selection.js';
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
    principal: string | null;
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
    #writings = new Map<string, Writing>();
    get writings(): ReadonlyMap<string, Writing> { return this.#writings; }
    #order: CommentOrder;
    ready = false;
    error = '';
    lastRefresh = 0;
    ranking: OrderResult | null = null;
    writingRevision = 0;
    replyPrefetch = 5;
    includeHTML = false;
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
    #tail: Promise<unknown> = Promise.resolve();
    #listeners = new Set<(page: PageModel) => void>();
    constructor(readonly config: PageConfig, private transport: Transport, order: CommentOrder = 'oldest', readonly lifetime = new AbortController()) {
        this.#order = typeof order === 'string' ? order : Object.freeze({ ...order });
        this.signal.addEventListener('abort', () => { this.#identity.abort(); this.#cancelReads(); this.#listeners.clear(); }, { once: true });
    }
    get order(): CommentOrder { return this.#order; }
    get signal(): AbortSignal { return this.lifetime.signal; }
    #principal(): string | null { return this.document.metadata.viewer?.id ?? this.transport.principal ?? null; }
    get canCompose(): boolean { const meta = this.document.metadata; return this.ready && !meta.archived && !meta.unavailable && !meta.thread?.locked; }
    get hasUnresolvedWriting(): boolean { return [...this.writings.values()].some(writing => writing.protected); }
    get hasWriting(): boolean { return [...this.writings.values()].some(writing => Boolean(writing.text) || writing.protected || writing.actions.undoClear); }
    acquisition(parentId = ''): Acquisition | undefined { return this.#reads.get(parentId)?.state; }
    subscribe(listener: (page: PageModel) => void): () => void {
        this.#listeners.add(listener);
        return () => { this.#listeners.delete(listener); };
    }
    #emit(): void { if (!this.signal.aborted)
        for (const listener of this.#listeners)
            try { listener(this); }
            catch (error) { console.error('A conversation subscriber failed.', error); } }
    notify(): void { this.document = { ...this.document }; this.#emit(); }
    #writing(redraw = false): void { this.writingRevision++; if (redraw)
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
        this.#cancelReads();
        for (const intent of this.#intents.values()) if (intent.issued) intent.error = { status: 'uncertain', message: 'Sign in as the original author to recover this reaction.' };
        for (const effect of this.#effects.values()) effect.error = { status: 'uncertain', message: 'Sign in as the original author to recover this action.' };
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
        return this.transport.request(operation, { ...input, ...(['page', 'contribute'].includes(operation) ? { html: this.includeHTML } : {}), config: selection(this.config) }, signal, method);
    }
    bootstrap(page: WindowPage): void {
        if (this.ready || this.acquisition())
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
        this.continuity = { status: 'current' };
        this.#observationOffset = 0;
    }
    #acquire(parentId: string, purpose: AcquisitionPurpose, observedIds?: string[]): Promise<boolean> {
        this.signal.throwIfAborted();
        const continuing = purpose === 'continue', observing = purpose === 'revalidate';
        const current = this.#reads.get(parentId);
        if (current && (continuing || observing || purpose === 'initial')) return current.work;
        if (continuing && (this.continuity.status === 'restart-required' || (parentId ? this.document.replies[parentId]?.cursor : this.document.roots.cursor) === null)) return Promise.resolve(false);
        if (!parentId && !observing) this.#cancelReads();
        else current?.abort.abort();
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
                        const missing = ids.filter(id => !page.nodes[id]);
                        const removed = new Set([...missing, ...loaded.filter(id => missing.includes(this.document.nodes[id]!.parentId ?? ''))]);
                        const nodes = { ...this.document.nodes, ...page.nodes }, replies = { ...this.document.replies };
                        for (const id of removed) { delete nodes[id]; delete replies[id]; }
                        for (const [id, window] of Object.entries(replies)) replies[id] = { ...window, ids: window.ids.filter(id => !removed.has(id)), total: page.replies?.[id]?.total ?? window.total };
                        this.document = { nodes, roots: { ...this.document.roots, ids: this.document.roots.ids.filter(id => !removed.has(id)), total: page.window.total }, replies, metadata: page.metadata ?? this.document.metadata };
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
                if (!parentId && !continuing) this.#replace(page);
                else if (this.document.metadata.thread?.id !== page.metadata?.thread?.id) {
                    this.continuity = { status: 'restart-required', reason: 'The discussion changed. Restart to acquire its comments.' };
                    this.document = { ...this.document, metadata: page.metadata ?? this.document.metadata };
                    return false;
                } else {
                    const old = parentId ? this.document.replies[parentId] ?? emptyWindow() : this.document.roots;
                    const window = { ...page.window, ids: unique(parentId ? [...page.window.ids, ...old.ids] : [...old.ids, ...page.window.ids]) };
                    const replies = { ...this.document.replies };
                    for (const [id, acquired] of Object.entries(page.replies ?? {})) replies[id] = replies[id] ? { ...replies[id]!, total: acquired.total } : acquired;
                    if (parentId) replies[parentId] = window;
                    this.document = { nodes: { ...this.document.nodes, ...page.nodes }, roots: parentId ? this.document.roots : window, replies, metadata: page.metadata ?? this.document.metadata };
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
    preview(body: string, signal = this.signal): Promise<string> {
        this.signal.throwIfAborted();
        return this.#track(this.#request<{
            html: string;
        }>('preview', { body }, AbortSignal.any([this.signal, signal]), 'POST').then(value => value.html));
    }
    writing(target: WritingTarget = { kind: 'comment' }): Writing {
        this.signal.throwIfAborted();
        const id = writingId(target);
        let writing = this.writings.get(id);
        if (!writing) {
            writing = new Writing(target, {
                changed: redraw => this.#writing(redraw),
                initialText: target => target.kind === 'edit' ? this.document.nodes[target.id]?.body ?? '' : '',
                principal: () => this.#principal(),
                eligible: target => target.kind === 'comment' ? this.canCompose : ['available', 'sign-in'].includes(this.actions(target.id)[target.kind].status),
                contribute: issued => {
                    if (issued.principal !== this.#principal()) return Promise.reject(Object.assign(new Error('The original author must recover this submission.'), { code: 'WRITE_UNCERTAIN' }));
                    return this.#contribute(issued.target.kind === 'edit' ? 'edit' : 'comment', {
                    key: issued.key, body: issued.body,
                    ...(issued.target.kind === 'edit' ? { id: issued.target.id } : { replyToId: issued.target.kind === 'reply' ? issued.target.id : '' }) });
                },
            }, target.kind === 'edit' ? this.document.nodes[target.id]?.body ?? '' : '');
            this.#writings.set(id, writing);
        }
        return writing;
    }
    saveWriting(): string { return JSON.stringify({ version: 4, writing: [...this.writings.values()].filter(writing => writing.text || writing.protected || writing.actions.undoClear).map(writing => writing.save()) }); }
    recoverWriting(raw: string): void {
        for (const saved of recoveredWriting(raw)) this.writing(saved.target).recover(saved);
        this.#writing(true);
    }
    #apply(patch: Patch): void {
        const nodes = { ...this.document.nodes }, missing = Object.entries(patch.nodes ?? {}).filter(([, node]) => !node).map(([id]) => id);
        const removed = unique([...missing, ...Object.keys(nodes).filter(id => missing.includes(nodes[id]!.parentId ?? ''))]);
        for (const [id, node] of Object.entries(patch.nodes ?? {})) {
            if (node)
                nodes[id] = node;
            else
                delete nodes[id];
        }
        for (const id of removed) delete nodes[id];
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
    #effect(operation: SubjectEffect['operation'], input: Record<string, unknown> & { id: string }): Promise<ContributionResult> {
        this.signal.throwIfAborted();
        if (!this.#principal()) return Promise.reject(new Error('Sign in before contributing.'));
        const retained = this.#effects.get(input.id);
        if (retained) {
            const { key: _key, ...issued } = retained.input;
            if (retained.operation !== operation || JSON.stringify(issued) !== JSON.stringify(input)) return Promise.reject(new Error('Resolve the pending action before changing its intent.'));
            return retained.pending ?? this.#issueEffect(input.id, retained);
        }
        const effect: SubjectEffect = { principal: this.#principal(), operation, input: { ...input, key: operationKey() } };
        this.#effects.set(input.id, effect);
        return this.#issueEffect(input.id, effect);
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
    #confirmed(id: string): Reactions { return id === this.document.metadata.thread?.id ? this.document.metadata.thread.reactions : this.document.nodes[id]?.reactions ?? {}; }
    reactions(id: string): Reactions {
        const groups = { ...this.#confirmed(id) };
        for (const intent of this.#intents.values())
            if (intent.id === id && intent.principal === this.#principal()) {
                const previous = groups[intent.reaction] ?? { count: 0, selected: false };
                groups[intent.reaction] = { selected: intent.selected, count: Math.max(0, previous.count + Number(intent.selected) - Number(previous.selected)) };
            }
        return groups;
    }
    actions(subjectId = 'discussion'): SubjectActions {
        const { metadata, nodes } = this.document;
        const discussion = subjectId === 'discussion' || subjectId === metadata.thread?.id;
        const id = discussion ? metadata.thread?.id ?? 'discussion' : subjectId, node = nodes[id];
        const intents = [...this.#intents.values()].filter(intent => intent.id === id);
        const effect = this.#effects.get(id);
        const pending = intents.some(intent => intent.pending) || Boolean(effect?.pending), uncertain = intents.some(intent => intent.error?.status === 'uncertain') || effect?.error?.status === 'uncertain';
        const originalAuthor = [...intents.map(intent => intent.principal), ...(effect ? [effect.principal] : [])].every(principal => principal && principal === this.#principal());
        const recovery: ActionAvailability = !originalAuthor ? { status: 'sign-in', reason: 'Sign in as the original author to recover this action.' } : pending ? { status: 'pending' } : { status: 'available' };
        const unavailable = (reason: string): ActionAvailability => ({ status: 'unavailable', reason });
        const available = (): ActionAvailability => ({ status: this.#principal() ? 'available' : 'sign-in' });
        const base = !this.ready ? unavailable('The discussion is loading.') : metadata.unavailable ? unavailable('The discussion is unavailable.')
            : metadata.archived ? unavailable('The repository is archived.') : !discussion && !node ? unavailable('This comment is unavailable.') : undefined;
        const permission = (allowed: boolean, operation?: SubjectEffect['operation']): ActionAvailability => effect && effect.operation === operation ? (!originalAuthor ? recovery : effect.pending ? { status: 'pending' } : { status: 'recovery', reason: effect.error?.message }) : base ?? (effect?.pending ? { status: 'pending' } : allowed ? available() : unavailable('This action is not permitted.'));
        const participation = base ?? (metadata.thread?.locked ? unavailable('The discussion is locked.') : available());
        const writingAction = (writing: Writing | undefined, action: ActionAvailability): ActionAvailability => writing?.pending ? { status: 'pending' } : writing?.protected ? { status: 'recovery', reason: writing.error?.message } : action;
        return {
            reply: writingAction(this.writings.get(discussion ? 'main' : 'reply:' + id), participation),
            edit: writingAction(this.writings.get('edit:' + id), permission(Boolean(node?.viewerCanUpdate))),
            remove: permission(Boolean(node?.viewerCanDelete), 'delete'),
            moderate: permission(Boolean(node && (node.isMinimized ? node.viewerCanUnminimize : node.viewerCanMinimize)), 'moderate'),
            react: base ?? (uncertain ? { status: 'recovery', reason: 'An action has an unresolved outcome.' } : pending ? { status: 'pending' } : participation),
            recover: !uncertain ? unavailable('No action needs recovery.') : recovery,
            abandon: !uncertain ? unavailable('No unresolved action exists.') : pending ? { status: 'pending' } : { status: 'available' },
        };
    }
    setReaction(id: string, reaction: Reaction, selected: boolean): Promise<void> {
        this.signal.throwIfAborted();
        id = id === 'discussion' ? this.document.metadata.thread?.id ?? id : id;
        const key = id + '\0' + reaction, intent: ReactionIntent = this.#intents.get(key) ?? { principal: this.#principal(), id, reaction, selected };
        if (!intent.principal || intent.principal !== this.#principal()) return Promise.reject(new Error('Sign in as the original author to recover this reaction.'));
        intent.selected = selected;
        this.#intents.set(key, intent);
        const work = intent.pending ?? this.#react(key, intent);
        this.notify();
        return work;
    }
    #react(key: string, intent: ReactionIntent): Promise<void> {
        if (!intent.principal || intent.principal !== this.#principal()) return Promise.reject(new Error('Sign in as the original author to recover this reaction.'));
        const owner = this.#identity.signal;
        let recovering = Boolean(intent.issued);
        intent.pending = this.#track(Promise.resolve().then(async () => {
            try {
                owner.throwIfAborted();
                while (!owner.aborted && this.#intents.get(key) === intent) {
                    if (!intent.issued && Boolean(this.#confirmed(intent.id)[intent.reaction]?.selected) === intent.selected)
                        break;
                    intent.issued ??= { add: intent.selected, key: operationKey() };
                    const issued = intent.issued;
                    await this.#contribute('reaction', { id: intent.id, reaction: intent.reaction, ...issued }, owner);
                    recovering = false;
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
                    if (recovering) intent.error.status = 'uncertain';
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
    /** The host must obtain a deliberate decision before abandoning an unknown outcome. */
    abandonAction(id: string): boolean {
        if (this.actions(id).abandon.status !== 'available') return false;
        id = id === 'discussion' ? this.document.metadata.thread?.id ?? id : id;
        this.#effects.delete(id);
        for (const [key, intent] of this.#intents) if (intent.id === id) this.#intents.delete(key);
        this.notify();
        return true;
    }
    async retryAction(id: string): Promise<void> {
        id = id === 'discussion' ? this.document.metadata.thread?.id ?? id : id;
        const effect = this.#effects.get(id);
        await Promise.all([...(effect ? [effect.pending ?? this.#issueEffect(id, effect)] : []), ...[...this.#intents].filter(([, intent]) => intent.id === id).map(([key, intent]) => intent.pending ?? this.#react(key, intent))]);
    }
}
