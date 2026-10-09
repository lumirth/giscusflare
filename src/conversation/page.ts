import { Writing, writingTargetKey, type WritingTarget, type WritingFailure } from './writing.js';
import { IssuedEffect } from './issued.js';
import {CountFacts} from './counts.js';
import {countKey,type CountTarget} from '../contracts/count.js';
import { selection } from '../contracts/selection.js';
import type { Action, Selection, ModerationReason } from '../contracts/requests.js';
import type { AccessResult, AccountPatch, ViewerState, Comment, Discussion, AcceptedObservation, ContributionResult, CountObservation, PageDocument, Patch, Reaction, Reactions, Window, WindowDelta, WindowPage } from '../contracts/document.js';
import type { OrderResult } from '../ranking/types.js';
export interface Transport {
    readonly principal?: string | null;
    readonly signedIn?: boolean;
    readonly needsAuthorization?: boolean;
    request<T>(operation: string, body: unknown, signal?: AbortSignal, method?: 'GET' | 'POST'): Promise<T>;
}
export type CommentOrder = 'oldest' | 'newest' | {
    profile: string;
};
export type AcquisitionPurpose = 'initial' | 'restart' | 'continue' | 'revalidate' | 'change-order';
export interface Acquisition { purpose: AcquisitionPurpose; started: number }
export interface ActionAvailability { status: 'available' | 'sign-in' | 'pending' | 'recovery' | 'unavailable'; reason?: string; cause?: 'authorization' | 'loading' | 'unavailable' | 'archived' | 'locked' | 'missing' | 'permission' }
export interface ReactionState { permission: ActionAvailability; confirmed: { count: number; selected: boolean }; desired: boolean; selected: boolean; count: number; pending: boolean; recovery?: Failure; recover: ActionAvailability; abandon: boolean }
export interface SubjectActions { reply: ActionAvailability; edit: ActionAvailability; remove: ActionAvailability; moderate: ActionAvailability; react: ActionAvailability; recover: ActionAvailability; abandon: ActionAvailability }
export type PageConfig = Selection & { description?: string };
export interface PageModelOptions { counts?: CountFacts; writingChanged?(writing?: Writing): void }
export type Failure = WritingFailure;
type SubjectAction = Extract<Action, {type: 'delete' | 'moderate'}>;
type SubjectEffect = IssuedEffect<{action: SubjectAction}>;
interface ReactionIntent {
    principal: string;
    id: string;
    confirmed: boolean;
    reaction: Reaction;
    selected: boolean;
    effect: IssuedEffect<{selected: boolean}>;
    pending?: Promise<void>;
}
const emptyWindow = (): Window => ({ ids: [], cursor: null, count: null });
const emptyDocument = (): PageDocument => ({ nodes: {}, roots: emptyWindow(), replies: {},
    metadata: { thread: null, archived: false, unavailable: false, profiles: [] } });
const unique = (ids: string[]) => [...new Set(ids)];
const message = (error: unknown) => error instanceof Error ? error.message : 'Unable to complete the action.';
function windowPatch(window: Window, change: WindowDelta = {}, prepend = false): Pick<Window,'ids'|'cursor'> {
    const ids = unique(prepend ? [...(change.add ?? []), ...window.ids] : [...window.ids, ...(change.add ?? [])]);
    return { ids: ids.filter(id => !change.remove?.includes(id)), cursor: change.cursor === undefined ? window.cursor : change.cursor };
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
    readonly counts: CountFacts;
    #ownCounts = false;
    document = emptyDocument();
    #writings = new Map<string, Writing>();
    #activeWriting = new Map<string, string>();
    get writings(): ReadonlyMap<string, Writing> { return this.#writings; }
    #order: CommentOrder;
    ready = false;
    error = '';
    viewerError = '';
    notice = '';
    lastRefresh = 0;
    ranking: OrderResult | null = null;
    replyPrefetch = 5;
    providerHTML = false;
    #identity = new AbortController();
    #viewer: ViewerState | null = null;
    #access?: Promise<void>;
    #facts = new Map<string, {age:number; accepted:number; effect?:number}>();
    #accepted = 0;
    continuity: { status: 'current' | 'restart-required'; reason?: string } = { status: 'current' };
    #observationOffset = 0;
    #reads = new Map<string, {
        state: Acquisition;
        abort: AbortController;
        work: Promise<boolean>;
    }>();
    #intents = new Map<string, ReactionIntent>();
    #effects = new Map<string, SubjectEffect>();
    #listeners = new Set<(page: PageModel, writing?: Writing, content?: AcceptedObservation) => void>();
    constructor(config: PageConfig, private transport: Transport, order: CommentOrder = 'oldest', readonly lifetime = new AbortController(), private options: PageModelOptions = {}) {
        this.config = Object.freeze({ ...config, selector: Object.freeze({...config.selector}) });
        this.counts = options.counts ?? new CountFacts();
        this.document.roots = this.#window(this.document.roots);
        const stopCounts = this.counts.subscribe(change => { if (change.value && !this.#ownCounts) this.notify(); }, target => this.#countScope(target));
        this.#order = typeof order === 'string' ? order : Object.freeze({ ...order });
        this.signal.addEventListener('abort', () => { stopCounts(); this.#identity.abort(); this.#cancelReads(); this.#listeners.clear(); }, { once: true });
    }
    #countScope(target: CountTarget): boolean {
        return countKey({selector:this.config.selector,window:target.window}) === countKey(target) && (target.window.kind === 'roots' || Boolean(this.document.nodes[target.window.parentId]));
    }
    #window(window: Pick<Window,'ids'|'cursor'>, parentId = ''): Window {
        const facts = this.counts, target: CountTarget = {selector:this.config.selector,window:parentId?{kind:'replies',parentId}:{kind:'roots'}};
        return {ids:window.ids,cursor:window.cursor,get count() { return facts.get(target); }};
    }
    #count(value: CountObservation | null | undefined, after: number, replayed = false, fresh = true, effect = false): void {
        if (!value) return;
        this.#ownCounts = true;
        try { this.counts.observe(value,{after,replayed,fresh,effect}); } finally { this.#ownCounts = false; }
    }
    get order(): CommentOrder { return this.#order; }
    get signal(): AbortSignal { return this.lifetime.signal; }
    #principal(): string | null { return this.transport.principal ?? null; }
    get viewer(): ViewerState | null { return this.#viewer; }
    get viewerPending(): boolean { return Boolean(this.#access); }
    get targetReady(): boolean { return this.#facts.has('metadata:archived'); }
    get composition(): ActionAvailability { return this.#availability('discussion'); }
    get canCompose(): boolean { return ['available','sign-in'].includes(this.composition.status); }
    #availability(id: string, participation = true): ActionAvailability {
        const meta = this.document.metadata;
        if (!this.targetReady) return {status:'pending',cause:'loading',reason:'Discussion access is loading.'};
        const availability = this.#viewer?.principal === this.#principal() && (!meta.thread || this.#viewer.availability?.target === meta.thread.id) ? this.#viewer.availability : undefined;
        const cause = meta.unavailable || availability?.unavailable ? 'unavailable' : meta.archived || availability?.archived ? 'archived' : id !== 'discussion' && !this.document.nodes[id] ? 'missing' : participation && (meta.thread?.locked || availability?.thread?.locked) ? 'locked' : undefined;
        return cause ? {status:'unavailable',cause,reason:({unavailable:'The discussion is unavailable.',archived:'The repository is archived.',missing:'This comment is unavailable.',locked:'The discussion is locked.'})[cause]} : {status:this.#principal() && !this.transport.needsAuthorization ? 'available' : 'sign-in', ...(this.transport.needsAuthorization ? {cause:'authorization' as const,reason:'Reconnect GitHub before contributing.'} : {})};
    }
    get hasUnresolvedWriting(): boolean { return [...this.writings.values()].some(writing => writing.protected); }
    get hasWriting(): boolean { return [...this.writings.values()].some(writing => Boolean(writing.text) || writing.protected || writing.actions.undoClear); }
    acquisition(parentId = ''): Acquisition | undefined { return this.#reads.get(parentId)?.state; }
    subscribe(listener: (page: PageModel, writing?: Writing, content?: AcceptedObservation) => void): () => void {
        this.#listeners.add(listener);
        return () => { this.#listeners.delete(listener); };
    }
    #emit(writing?: Writing, content?: AcceptedObservation): void { if (!this.signal.aborted)
        for (const listener of this.#listeners)
            try { listener(this, writing, content); }
            catch (error) { console.error('A conversation subscriber failed.', error); } }
    notify(writing?: Writing, content?: AcceptedObservation): void { this.document = { ...this.document }; this.#emit(writing, content); }
    #writing(redraw = false, writing?: Writing): void { this.options.writingChanged?.(writing); if (redraw)
        this.notify(writing);
    else
        this.#emit(writing); }
    dispose(): void { this.lifetime.abort(); }
    #cancelReads(): void { for (const read of this.#reads.values())
        read.abort.abort(); this.#reads.clear(); }
    changeIdentity(): void {
        this.#identity.abort(); this.#identity = new AbortController(); this.#access = undefined; this.#viewer = null; this.viewerError = '';
        for (const writing of this.writings.values()) writing.identityChanged();
        for (const intent of this.#intents.values()) if (intent.effect.issued && !intent.pending) intent.effect.error = { status: 'uncertain', message: 'Sign in as the original author to recover this reaction.' };
        for (const effect of this.#effects.values()) if (!effect.pending) effect.error = { status: 'uncertain', message: 'Sign in as the original author to recover this action.' };
        this.notify();
    }
    #acceptAccount(access: AccessResult | AccountPatch, replayed = false, acceptance = this.#accepted, target = this.document.metadata.thread?.id ?? null, effect = false): void {
        const principal = access.principal;
        if (principal !== this.#principal()) return;
        const old = this.#viewer, viewer: ViewerState = {principal, availability: old?.availability,
            permissions: {...old?.permissions}, reactions: {...old?.reactions}, threadReactions: {...old?.threadReactions}};
        const ids = new Set<string>();let conflicted = false;
        const accept = (scope: string, before?: unknown, incoming?: unknown, id = '') => !(replayed && access.observedAt === this.#facts.get(scope)?.age) && this.#fact(scope, access.observedAt, acceptance, effect, replayed ? undefined : [before,incoming], () => { conflicted = true;if (id && id !== 'discussion') ids.add(id); });
        if ('availability' in access && accept('account:' + principal + ':availability')) viewer.availability = {...access.availability, target: access.availability.thread?.id ?? target};
        for (const [id, permissions] of Object.entries(access.permissions ?? {})) if (accept('account:' + principal + ':permissions:' + id,old?.permissions[id],permissions,id)) viewer.permissions[id] = permissions;
        const selections = (id: string, incoming: import('../contracts/document.js').SelectedReactions, current: import('../contracts/document.js').SelectedReactions = {}) => {
            const values = {...current};
            for (const [reaction, value] of Object.entries(incoming)) if (accept('account:' + principal + ':reaction:' + id + ':' + reaction,current[reaction as Reaction],value,id)) Object.assign(values, {[reaction]: value});
            return values;
        };
        for (const [id, reactions] of Object.entries(access.reactions ?? {})) viewer.reactions[id] = selections(id, reactions, old?.reactions[id]);
        if (access.threadReactions) viewer.threadReactions = selections('discussion', access.threadReactions, old?.threadReactions);
        this.#viewer = viewer;this.viewerError = '';this.#resumeReactions();
        if (conflicted) void this.refreshViewer(false,[...ids]);
    }
    async refreshViewer(missingOnly = false, observedIds?: string[]): Promise<void> {
        if ((!this.#principal() && !this.transport.signedIn) || !this.targetReady || this.transport.needsAuthorization || this.signal.aborted) return;
        if (this.#access) return missingOnly || observedIds ? this.#access.then(() => { if (!this.viewerError) return this.refreshViewer(missingOnly, observedIds); }) : this.#access;
        const identity = this.#identity, signal = AbortSignal.any([this.signal, identity.signal]);
        const ids = (observedIds ? unique(observedIds).filter(id => this.document.nodes[id]) : Object.keys(this.document.nodes)).filter(id => !missingOnly || !this.#viewer?.permissions[id] || !this.#viewer.reactions[id]);
        if (missingOnly && this.#viewer?.principal && !ids.length && (!this.document.metadata.thread || this.#viewer.availability?.target === this.document.metadata.thread.id)) return;
        const work = Promise.resolve().then(async () => {
            for (let offset = 0; offset < Math.max(1, ids.length); offset += 100) {
                const reading = this.document, acceptance = this.#accepted;
                const access = await this.#request<AccessResult>('access', { ids: ids.slice(offset, offset + 100) }, signal, 'POST');
                if (signal.aborted) return;
                this.#acceptAccount(access, false, acceptance, reading.metadata.thread?.id ?? null);
                const availability = access.availability, thread = availability.thread;
                const content = access.principal === this.#principal() && thread && thread.id === this.document.metadata.thread?.id
                    ? this.#accept({patch:{metadata:{thread,archived:availability.archived},observedAt:access.observedAt},baseline:reading,acceptance}) : undefined;
                this.notify(undefined, content);
            }
        }).catch(error => { if (!signal.aborted) { this.viewerError = message(error); this.notify(); } }).finally(() => {
            if (this.#access === work) { this.#access = undefined;this.#emit(); }
        });
        this.#access = work; return work;
    }
    #fact(scope: string, observedAt: number, acceptance = this.#accepted, effect = false, values?: [unknown,unknown], conflicted?: () => void): boolean {
        if (!Number.isFinite(observedAt)) return false;
        const previous = this.#facts.get(scope);
        if (previous && values && JSON.stringify(values[0]) !== JSON.stringify(values[1]) && (effect ? previous.accepted > acceptance && previous.age >= observedAt : (previous.effect ?? 0) > acceptance && observedAt >= previous.age)) { if (effect) previous.effect = ++this.#accepted;conflicted?.();return false; }
        if (previous && (observedAt < previous.age || observedAt === previous.age && previous.accepted > acceptance)) { if (effect) previous.effect = ++this.#accepted;return false; }
        const accepted = ++this.#accepted;
        this.#facts.set(scope, {age:observedAt, accepted,effect:effect ? accepted : previous?.effect});return true;
    }
    #request<T>(operation: string, input: Record<string, unknown>, signal?: AbortSignal, method: 'GET' | 'POST' = 'GET'): Promise<T> {
        return this.transport.request(operation, { ...input, ...(['page', 'contribute'].includes(operation) ? {providerHTML: this.providerHTML} : {}), config: selection(this.config) }, signal, method);
    }
    bootstrap(page: WindowPage): void {
        if (this.ready || this.acquisition())
            return;
        this.#emit(undefined, this.#replace(page));
    }
    #replace(page: WindowPage, baseline = this.document, acceptance = this.#accepted, countAfter = this.counts.revision, countFresh = false): AcceptedObservation | undefined {
        for (const [parent, read] of this.#reads) if (parent) { read.abort.abort(); this.#reads.delete(parent); }
        const content = this.#accept({ page, baseline, replacing: true, acceptance, countAfter, countFresh });
        this.ready = true;
        this.error = '';this.notice = '';
        this.lastRefresh = Math.max(this.lastRefresh, page.observedAt);
        this.continuity = { status: 'current' };
        this.#observationOffset = 0;return content;
    }
    /** Every incoming fact uses the same scope and age rule; traversal is a separate owned field. */
    #accept(input: { page?: WindowPage; patch?: Patch; baseline?: PageDocument; parentId?: string; replacing?: boolean; observedIds?: string[]; replayed?: boolean; acceptance?:number; countAfter?:number; countFresh?:boolean; effect?:boolean }): AcceptedObservation | undefined {
        const { page, patch, parentId = '', replacing = false, observedIds } = input;
        const effect = Boolean(input.effect && !input.replayed), created = effect && patch?.metadataObservedAt !== undefined;
        const baseline = input.baseline ?? this.document, current = this.document, acceptance = input.acceptance ?? this.#accepted;
        const countAfter = input.countAfter ?? this.counts.revision;
        const countFresh = input.countFresh ?? !page;
        const observedAt = page?.observedAt ?? patch?.observedAt;
        if (observedAt === undefined || !Number.isFinite(observedAt)) return;
        const conflictingIds = new Set<string>();let conflicted = false;
        const accept = (scope: string, before?: unknown, incoming?: unknown, age = observedAt, id = ''): boolean => !(input.replayed && age === this.#facts.get(scope)?.age) && this.#fact(scope, age, acceptance, effect, input.replayed ? undefined : [before,incoming], () => { conflicted = true;if (id && id !== current.metadata.thread?.id) conflictingIds.add(id); });
        const count = (value: CountObservation | null | undefined, replayed = false, fresh = countFresh, effect = false) => {
            this.#count(value,countAfter,replayed,fresh,effect);
            if (value && !this.options.counts) { const state = this.counts.state(value.target);if (state.stale && state.changed > countAfter) { conflicted = true;if (value.target.window.kind === 'replies') conflictingIds.add(value.target.window.parentId); } }
        };
        const reactions = (id: string, value: Reactions | undefined, incoming: Reactions, age = observedAt): Reactions => {
            const next = {...value};
            for (const [reaction, group] of Object.entries(incoming)) if (accept('reaction:' + id + ':' + reaction,value?.[reaction as Reaction],group,age,id)) Object.assign(next, {[reaction]: group});
            return next;
        };
        const nodes = { ...current.nodes };
        const incoming = page?.nodes ?? patch?.nodes ?? {};
        const inserted = new Set([...(patch?.roots?.add ?? []), ...Object.values(patch?.replies ?? {}).flatMap(window => window.add ?? [])]);
        const removed: string[] = [];
        for (const [id, value] of Object.entries(incoming)) {
            if (value === null) { if (accept('exists:' + id,Boolean(nodes[id]),false,observedAt,id)) { delete nodes[id]; removed.push(id); } continue; }
            const exists = accept('exists:' + id,Boolean(nodes[id]),true,observedAt,id);
            if (!nodes[id] && !exists) continue;
            const previous = nodes[id], next = { ...previous } as Comment;
            if (previous && inserted.has(id)) continue;
            const revision = value.lastEditedAt ?? value.createdAt;
            const olderBody = previous && revision && Date.parse(revision) < Date.parse(previous.lastEditedAt ?? previous.createdAt);
            for (const [field, fact] of Object.entries(value)) {
                if (field === 'reactions') {
                    next.reactions = reactions(id, previous?.reactions, fact as Reactions); continue;
                }
                if (olderBody && ['body', 'lastEditedAt'].includes(field)) continue;
                if (accept('node:' + id + ':' + field,previous?.[field as keyof Comment],fact,observedAt,id)) Object.assign(next, { [field]: fact });
            }
            nodes[id] = next;
        }
        for (const id of observedIds ?? []) if (!page?.nodes[id] && accept('exists:' + id,Boolean(nodes[id]),false,observedAt,id)) { delete nodes[id]; removed.push(id); }
        for (const [id, node] of Object.entries(nodes)) if (removed.includes(node.parentId ?? '') && accept('exists:' + id,true,false,observedAt,id)) { delete nodes[id]; removed.push(id); }
        let metadata = current.metadata;
        const meta = page?.metadata ?? patch?.metadata;
        const metadataAt = page?.observedAt ?? patch?.metadataObservedAt ?? observedAt;
        if (meta && Number.isFinite(metadataAt)) {
            metadata = { ...metadata };
            for (const [field, fact] of Object.entries(meta)) {
                if (field === 'thread' && fact) {
                    const sameThread = (fact as typeof metadata.thread)?.id === metadata.thread?.id;
                    const initializing = created && !metadata.thread;
                    if (!accept('metadata:thread',metadata.thread?.id ?? null,(fact as Partial<Discussion>).id,metadataAt) && !sameThread && !initializing) continue;
                    if (initializing) this.#facts.set('metadata:thread',{age:metadataAt,accepted:++this.#accepted,effect:this.#accepted});
                    const thread = { ...metadata.thread } as NonNullable<typeof metadata.thread>;
                    for (const [name, value] of Object.entries(fact)) {
                        if (name === 'reactions') {
                            thread.reactions = reactions((fact as typeof thread).id, thread.reactions, value as Reactions, metadataAt);
                        } else if (accept('metadata:thread:' + name,thread[name as keyof typeof thread],value,metadataAt) || initializing) Object.assign(thread, { [name]: value });
                    }
                    metadata.thread = thread;
                } else if (accept('metadata:' + field,metadata[field as keyof typeof metadata],fact,metadataAt)) Object.assign(metadata, { [field]: fact });
            }
        }
        for (const [id, groups] of Object.entries(patch?.reactions ?? {})) {
            if (id === metadata.thread?.id) metadata = { ...metadata, thread: { ...metadata.thread, reactions: reactions(id, metadata.thread.reactions, groups) } };
            else if (nodes[id]) nodes[id] = { ...nodes[id]!, reactions: reactions(id, nodes[id]!.reactions, groups) };
        }
        const replies = replacing ? Object.fromEntries(Object.entries(current.replies).filter(([id, window]) => window !== baseline.replies[id])) : { ...current.replies };
        const acquireWindow = (key: string, old: Window, acquired: Window, replace: boolean): Window => {
            const added = replace ? old.ids.filter(id => !((key ? baseline.replies[key] : baseline.roots)?.ids ?? []).includes(id)) : [];
            const ids = replace ? unique([...acquired.ids, ...added]) : unique(key ? [...acquired.ids, ...old.ids] : [...old.ids, ...acquired.ids]);
            count(acquired.count);
            return this.#window({ids,cursor:acquired.cursor},key);
        };
        if (page?.replies) for (const [id, window] of Object.entries(page.replies)) {
            const old = current.replies[id] ?? emptyWindow();
            if (replacing || !current.replies[id] || current.replies[id].cursor === '') replies[id] = acquireWindow(id,old,window,true);
            else { count(window.count); replies[id] = old; }
        }
        let roots = current.roots;
        if (page) {
            if (parentId) replies[parentId] = acquireWindow(parentId, replies[parentId] ?? emptyWindow(), page.window, false);
            else if (observedIds) count(page.window.count);
            else roots = acquireWindow('', roots, page.window, replacing);
        }
        const membership = (change: WindowDelta): WindowDelta => ({ ...change, ...(change.remove ? {remove: change.remove.filter(id => observedAt >= (this.#facts.get('exists:' + id)?.age ?? -Infinity) && !(observedAt === this.#facts.get('exists:' + id)?.age && this.#facts.get('exists:' + id)!.accepted > acceptance))} : {}) });
        if (patch?.roots) { count(patch.roots.count,input.replayed,true,effect); roots = this.#window(windowPatch(roots,membership(patch.roots),this.order==='newest')); }
        if (patch?.replies) for (const [id,change] of Object.entries(patch.replies)) { count(change.count,input.replayed,true,effect); replies[id] = this.#window(windowPatch(replies[id] ?? {...emptyWindow(),cursor:''},membership(change)),id); }
        roots = this.#window({ids:roots.ids.filter(id=>nodes[id]),cursor:roots.cursor});
        for (const [id, window] of Object.entries(replies)) {
            if (!nodes[id]) delete replies[id]; else replies[id] = this.#window({ids:window.ids.filter(child=>nodes[child]),cursor:window.cursor},id);
        }
        if (replacing) {
            const retained = new Set([...roots.ids, ...Object.entries(replies).flatMap(([parent, window]) => [parent, ...window.ids]), ...Object.keys(current.nodes).filter(id => current.nodes[id] !== baseline.nodes[id])]);
            for (const id of Object.keys(nodes)) if (!retained.has(id)) delete nodes[id];
        }
        this.document = { nodes, roots, replies, metadata };
        this.#resumeReactions();
        const contentHints = Object.fromEntries(Object.entries(page?.contentHints ?? patch?.contentHints ?? {}).filter(([id, hint]) => (!inserted.has(id) || !current.nodes[id]) && nodes[id]?.body === hint.markdown && observedAt >= (this.#facts.get('node:' + id + ':body')?.age ?? -Infinity) && this.#fact('content:' + id, observedAt, acceptance)));
        for (const target of patch?.invalidatedCounts ?? []) {
            const state = this.counts.state(target);
            this.counts.invalidate({target,observedAt: !input.replayed && state.changed > countAfter ? Math.max(observedAt,state.value?.observedAt ?? 0,state.invalidatedAt ?? 0) : observedAt});
            if (!this.options.counts && !input.replayed && state.stale) { conflicted = true;if (target.window.kind === 'replies') conflictingIds.add(target.window.parentId); }
        }
        if (conflicted) this.#reconcile([...conflictingIds]);
        return { contentHints };
    }
    #acquire(parentId: string, purpose: AcquisitionPurpose, observedIds?: string[]): Promise<boolean> {
        this.signal.throwIfAborted();
        const continuing = purpose === 'continue', observing = purpose === 'revalidate';
        const current = this.#reads.get(parentId);
        if (current && (continuing || observing || purpose === 'initial')) return current.work;
        if (continuing && (this.continuity.status === 'restart-required' || (parentId ? this.document.replies[parentId]?.cursor : this.document.roots.cursor) === null)) return Promise.resolve(false);
        if (!parentId && !observing && !continuing) this.#cancelReads();
        else current?.abort.abort();
        const abort = new AbortController(), signal = AbortSignal.any([this.signal, abort.signal]);
        let authorityIds = observedIds;
        const work = Promise.resolve().then(async () => {
            try {
                signal.throwIfAborted();
                let baseline = this.document, acceptance = this.#accepted, countAfter = this.counts.revision;
                if (observing) {
                    // Observe a bounded portion of the existing document, never start a new traversal.
                    const loaded = Object.keys(this.document.nodes);
                    const ids = observedIds ? unique(observedIds).filter(id => this.document.nodes[id]).slice(0, 100)
                        : [...loaded.slice(this.#observationOffset), ...loaded.slice(0, this.#observationOffset)].slice(0, 100);
                    authorityIds = ids;
                    const page = await this.#request<WindowPage>('page', { read: {kind: 'observe', ids}, fresh: true }, signal);
                    signal.throwIfAborted();
                    if (this.document.metadata.thread?.id !== page.metadata?.thread?.id || page.metadata?.unavailable) {
                        const previous = this.document.metadata.thread?.id;
                        this.#accept({ patch: {metadata: page.metadata, observedAt: page.observedAt},acceptance });
                        if (previous !== this.document.metadata.thread?.id || this.document.metadata.unavailable) this.continuity = { status: 'restart-required', reason: 'The discussion changed or is unavailable. Restart deliberately to acquire a new reading order.' };
                    } else {
                        const content = this.#accept({ page, baseline, observedIds: ids, acceptance, countAfter, countFresh:true });
                        this.#emit(undefined, content);
                        this.#observationOffset = loaded.length ? (this.#observationOffset + ids.length) % loaded.length : 0;
                    }
                    this.lastRefresh = Math.max(this.lastRefresh, page.observedAt);
                    this.#emit();
                    return true;
                }
                const cursor = continuing ? (parentId ? this.document.replies[parentId]?.cursor ?? '' : this.document.roots.cursor!) : '';
                let ids: string[] | undefined;
                if (!parentId && typeof this.order === 'object') {
                    if (!continuing) {
                        const deadline = Date.now() + 120000;
                        do {
                            acceptance = this.#accepted;countAfter = this.counts.revision;
                            const ranking = await this.#request<OrderResult>('ranking', { profile: this.order.profile }, signal);
                            signal.throwIfAborted();
                            this.ranking = ranking;
                            const target = ranking.target;
                            const accepted = target ? this.#accept({patch:{metadata:target.metadata,roots:{count:target.count},observedAt:target.observedAt},baseline,acceptance,countAfter,countFresh:false}) : undefined;
                            this.notify(undefined, accepted);
                            if (target) void this.refreshViewer(true);
                            if (ranking.status === 'paused') throw new Error('This order is unavailable right now. You can keep reading chronologically.');
                            if (ranking.status === 'ready') break;
                            if (ranking.retryAt > deadline) throw new Error('This order is still being prepared. Try again later.');
                            await delay(signal, Math.max(1000, ranking.retryAt - Date.now()));
                        } while (Date.now() < deadline);
                    }
                    if (this.ranking?.status !== 'ready') throw new Error('This order is still being prepared. Try again later.');
                    ids = this.ranking.ids.slice(Number(cursor) || 0, (Number(cursor) || 0) + 20);
                }
                baseline = this.document;acceptance = this.#accepted;countAfter = this.counts.revision;
                const fresh = ['restart','change-order'].includes(purpose);
                const page = await this.#request<WindowPage>('page', { read: parentId ? {kind: 'replies', parentId, cursor} : ids ? {kind: 'selected', ids, replyPrefetch: this.replyPrefetch} : {kind: 'roots', order: this.order, cursor, replyPrefetch: this.replyPrefetch}, fresh }, signal);
                signal.throwIfAborted();
                if (ids && this.ranking?.status === 'ready') page.window.cursor = Number(cursor) + ids.length < this.ranking.ids.length ? String(Number(cursor) + ids.length) : null;
                let content: AcceptedObservation | undefined;
                if (!parentId && !continuing) content = this.#replace(page, baseline, acceptance, countAfter, fresh);
                else if (this.document.metadata.thread?.id !== page.metadata?.thread?.id) {
                    const previous = this.document.metadata.thread?.id;
                    this.#accept({ patch: {metadata: page.metadata, observedAt: page.observedAt},acceptance });
                    if (previous !== this.document.metadata.thread?.id) this.continuity = { status: 'restart-required', reason: 'The discussion changed. Restart to acquire its comments.' };
                    return false;
                } else {
                    content = this.#accept({ page, baseline, parentId, acceptance, countAfter, countFresh:fresh });
                }
                this.#emit(undefined, content);
                return true;
            } catch (error) {
                if (!signal.aborted) {
                    if (purpose === 'change-order' || continuing && [400, 404, 410].includes(Number(Object(error).status))) this.continuity = { status: 'restart-required', reason: message(error) };
                    if (!observing || !this.ready) this.error = message(error);
                    this.notify();
                }
                return false;
            } finally {
                if (this.#reads.get(parentId)?.abort === abort) { this.#reads.delete(parentId); void this.refreshViewer(!observing, observing ? authorityIds : undefined); this.notify(); }
            }
        });
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
                authorized: () => !this.transport.needsAuthorization,
                eligible: target => target.kind === 'comment' ? this.canCompose : ['available', 'sign-in'].includes(this.actions(target.id)[target.kind].status),
                contribute: issued => this.#contribute(issued.target.kind === 'edit'
                    ? {type: 'edit', id: issued.target.id, body: issued.body}
                    : {type: 'comment', body: issued.body, replyToId: issued.target.kind === 'reply' ? issued.target.id : ''}, issued.key),
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
    saveWriting(): { records: import('./writing.js').SavedWriting[]; selected: string[] } {
        const writing = [...this.writings.values()].filter(writing => writing.text || writing.protected || writing.actions.undoClear);
        return { records: writing.map(writing => writing.save()), selected: [...this.#activeWriting.values()].filter(id => writing.some(value => value.id === id)) };
    }
    recoverWriting(records: readonly import('./writing.js').SavedWriting[], selected: readonly string[] = []): void {
        const authored = new Map([...this.#activeWriting].filter(([, id]) => { const writing = this.#writings.get(id)!; return writing.touched || writing.text || writing.protected || writing.actions.undoClear; }));
        for (const saved of records) if (!this.#writings.has(saved.id)) this.#createWriting(saved.target, saved);
        for (const id of selected) { const writing = this.#writings.get(id); if (writing && !authored.has(writingTargetKey(writing.target))) this.#activeWriting.set(writingTargetKey(writing.target), id); }
        for (const [target, id] of authored) this.#activeWriting.set(target, id);
        this.#writing(true);
    }
    #reconcile(ids: string[]): void {
        const current = this.#reads.get('')?.work;
        void (current ?? Promise.resolve()).then(() => { if (!this.signal.aborted) { if (this.#reads.has('')) this.#reconcile(ids);else return this.revalidate(0, ids); } });
    }
    #contribute(action: Action, key: string): Promise<ContributionResult> {
        if (this.signal.aborted) return Promise.reject(Object.assign(new Error('This conversation has been disposed.'), { phase: 'not-issued' }));
        const baseline = this.document, acceptance = this.#accepted, countAfter = this.counts.revision;
        let work:Promise<ContributionResult>;
        try { work = this.#request<ContributionResult>('contribute', {key, action,
            ...(action.type === 'comment' ? { creation: { description: this.config.description } } : {}) }, undefined, 'POST'); }
        catch (cause) { return Promise.reject(Object.assign(cause instanceof Error ? cause : new Error(message(cause)), {phase:'not-issued'})); }
        return work.then(result => {
            if (result.phase !== 'confirmed' || typeof result.id !== 'string' || !Number.isSafeInteger(result.number)) throw Object.assign(new Error('The service did not confirm this contribution.'), {phase:'unknown'});
            if (!this.signal.aborted) {
                const content = result.patch ? this.#accept({ patch: result.patch, baseline, replayed: result.replayed, acceptance, countAfter,effect:true }) : undefined;
                const reflected = action.type === 'comment' || action.type === 'edit' ? result.patch?.nodes?.[result.id]?.body !== undefined : Boolean(result.patch?.nodes || result.patch?.reactions);
                this.notice = reflected ? '' : 'Saved on GitHub. Refresh to load the current discussion.';
                if (result.account) this.#acceptAccount(result.account, result.replayed, acceptance,undefined,!result.replayed);
                this.notify(undefined, content);
            }
            return result;
        });
    }
    #effect(action: SubjectAction): Promise<ContributionResult> {
        this.signal.throwIfAborted();
        if (!this.#principal()) return Promise.reject(new Error('Sign in before contributing.'));
        const effectKey = this.#principal() + '\0' + action.id;
        const retained = this.#effects.get(effectKey);
        if (retained) {
            if (JSON.stringify(retained.issued?.action) !== JSON.stringify(action)) return Promise.reject(new Error('Resolve the pending action before changing its intent.'));
            return this.#issueEffect(retained);
        }
        if (this.transport.needsAuthorization) return Promise.reject(Object.assign(new Error('Reconnect GitHub before contributing.'), {phase:'not-issued'}));
        const effect: SubjectEffect = new IssuedEffect(() => this.#principal(), () => {
            if (!effect.pending && !effect.issued) this.#effects.delete(effectKey);
            this.notify();
        });
        this.#effects.set(effectKey, effect);
        return this.#issueEffect(effect, {action: Object.freeze({...action})});
    }
    #issueEffect(effect: SubjectEffect, input: {action: SubjectAction} = effect.issued!): Promise<ContributionResult> {
        return effect.run(input, issued => this.#contribute(issued.action, issued.key)).then(outcome => {
            if (outcome.status === 'failed') throw outcome.cause;
            return outcome.result;
        });
    }
    removeComment(id: string): Promise<ContributionResult> { return this.#effect({type: 'delete', id}); }
    moderateComment(id: string, minimized: boolean, reason: ModerationReason = 'OFF_TOPIC'): Promise<ContributionResult> { return this.#effect({type: 'moderate', id, minimized, reason}); }
    #subject(id: string): string { return id === 'discussion' || id === this.document.metadata.thread?.id ? 'discussion' : id; }
    #intentKey(id: string, reaction: Reaction, principal = this.#principal()): string { return principal + '\0' + id + '\0' + reaction; }
    #confirmed(id: string): Partial<Record<Reaction, {count: number; selected: boolean}>> {
        const groups = id === 'discussion' ? this.document.metadata.thread?.reactions ?? {} : this.document.nodes[id]?.reactions ?? {};
        const selected = id === 'discussion' ? this.#viewer?.threadReactions : this.#viewer?.reactions[id];
        return Object.fromEntries(Object.entries(groups).map(([reaction, group]) => [reaction, { count: group.count, selected: selected?.[reaction as Reaction] ?? false }]));
    }
    #resumeReactions(): void {
        if (this.signal.aborted) return;
        for (const [key, intent] of this.#intents) if (intent.principal === this.#principal() && !intent.pending && intent.effect.error?.status === 'failed' && intent.selected !== intent.confirmed) {
            intent.effect.error = undefined; void this.#react(key, intent).catch(() => {});
        }
    }
    #reactionIntent(id: string, reaction: Reaction): ReactionIntent | undefined {
        return this.#principal() ? this.#intents.get(this.#intentKey(id, reaction)) : [...this.#intents.values()].find(intent => intent.id === id && intent.reaction === reaction && intent.effect.error?.status === 'uncertain');
    }
    reaction(subjectId: string, reaction: Reaction): ReactionState {
        const id = this.#subject(subjectId), intent = this.#reactionIntent(id, reaction);
        const confirmed = this.#confirmed(id)[reaction] ?? { count: 0, selected: false };
        const desired = intent?.selected ?? confirmed.selected;
        return { permission: this.actions(id).react, confirmed: { ...confirmed }, desired, selected: desired,
            count: Math.max(0, confirmed.count + Number(desired) - Number(confirmed.selected)), pending: Boolean(intent?.pending), recovery: intent?.effect.error,
            recover: intent?.effect.error?.status !== 'uncertain' ? { status: 'unavailable' } : intent.pending ? { status: 'pending' } : intent.principal === this.#principal() ? { status: 'available' } : { status: 'sign-in', reason: 'Sign in as the original author to recover this reaction.' },
            abandon: Boolean(intent?.effect.error?.status === 'uncertain' && !intent.pending) };
    }
    reactions(subjectId: string): Partial<Record<Reaction, {count: number; selected: boolean}>> {
        const id = this.#subject(subjectId), groups = { ...this.#confirmed(id) };
        for (const intent of this.#intents.values()) if (intent.id === id && intent.principal === this.#principal()) { const { count, selected } = this.reaction(id, intent.reaction); groups[intent.reaction] = { count, selected }; }
        return groups;
    }
    actions(subjectId = 'discussion'): SubjectActions {
        const { nodes, metadata } = this.document, id = this.#subject(subjectId), node = nodes[id], permissions = this.#viewer?.permissions[id];
        const effect = this.#effects.get(this.#principal() + '\0' + id);
        const pending = Boolean(effect?.pending), uncertain = effect?.error?.status === 'uncertain';
        const unavailable = (reason: string): ActionAvailability => ({ status: 'unavailable', reason });
        const available = (): ActionAvailability => ({ status: this.#principal() ? 'available' : 'sign-in' });
        const authority = this.#availability(id, false);
        const base = authority.status === 'available' || authority.status === 'sign-in' ? undefined : authority;
        const permission = (allowed: boolean, operation?: SubjectAction['type']): ActionAvailability => effect && effect.issued?.action.type === operation ? (effect.pending ? { status: 'pending' } : { status: 'recovery', reason: effect.error?.message }) : base ?? (effect?.pending ? { status: 'pending' } : allowed ? authority : unavailable('This action is not permitted.'));
        const participation = this.#availability(id);
        const writingAction = (writing: Writing | undefined, action: ActionAvailability): ActionAvailability => writing?.pending ? { status: 'pending' } : writing?.protected ? { status: 'recovery', reason: writing.error?.message } : action;
        return {
            reply: writingAction(this.activeWriting(id === 'discussion' ? { kind: 'comment' } : { kind: 'reply', id }), participation),
            edit: writingAction(this.activeWriting({ kind: 'edit', id }), permission(Boolean(permissions?.canUpdate))),
            remove: permission(Boolean(permissions?.canDelete), 'delete'),
            moderate: permission(Boolean(node && (node.isMinimized ? permissions?.canUnminimize : permissions?.canMinimize)), 'moderate'),
            react: id === 'discussion' && !metadata.thread ? unavailable('This discussion does not exist.') : participation.status === 'available' && (!this.#viewer || id !== 'discussion' && !this.#viewer.reactions[id]) ? { status: 'pending', reason: 'Account reactions are loading.' } : participation,
            recover: !uncertain ? unavailable('No action needs recovery.') : pending ? { status: 'pending' } : available(),
            abandon: !uncertain ? unavailable('No unresolved action exists.') : pending ? { status: 'pending' } : { status: 'available' },
        };
    }
    setReaction(subjectId: string, reaction: Reaction, selected: boolean): Promise<void> {
        this.signal.throwIfAborted();
        const principal = this.#principal();
        if (!principal) return Promise.reject(new Error('Sign in before choosing a reaction.'));
        const id = this.#subject(subjectId), key = this.#intentKey(id, reaction, principal);
        if (this.transport.needsAuthorization && !this.#intents.get(key)?.effect.issued) return Promise.reject(Object.assign(new Error('Reconnect GitHub before contributing.'), {phase:'not-issued'}));
        const intent: ReactionIntent = this.#intents.get(key) ?? { principal, id, reaction, selected, confirmed: this.#confirmed(id)[reaction]?.selected ?? false,
            effect: new IssuedEffect(() => this.#principal() === principal ? principal : null, () => this.notify()) };
        intent.selected = selected;
        if (intent.effect.error?.status !== 'uncertain') intent.effect.error = undefined;
        this.#intents.set(key, intent);
        const work = intent.pending ?? this.#react(key, intent);
        this.notify();
        return work;
    }
    #react(key: string, intent: ReactionIntent): Promise<void> {
        intent.pending = Promise.resolve().then(async () => {
            try {
                while (!this.signal.aborted && this.#intents.get(key) === intent) {
                    if (!intent.effect.issued && intent.confirmed === intent.selected) break;
                    const outcome = await intent.effect.run({selected: intent.selected}, issued => this.#contribute({type: 'reaction',
                        subject: intent.id === 'discussion' ? {kind: 'discussion'} : {kind: 'comment', id: intent.id}, reaction: intent.reaction, selected: issued.selected,
                    }, issued.key).then(result => { intent.confirmed = issued.selected; return result; }));
                    if (outcome.status === 'failed') throw outcome.cause;
                    this.#resumeReactions();
                }
                if (intent.selected !== intent.confirmed) throw Object.assign(new Error('Sign in as the original author to finish the requested reaction.'), { code: 'AUTHOR_CHANGED', status: 401, phase: 'not-issued' });
                this.#intents.delete(key);
            } catch (error) {
                if (this.#intents.get(key) === intent) {
                    intent.effect.error ??= {status: 'failed', message: message(error)};
                    if (intent.effect.error.status !== 'uncertain' && Object(error).code !== 'AUTHOR_CHANGED') this.#intents.delete(key);
                }
                throw error;
            } finally {
                intent.pending = undefined;
                this.#resumeReactions(); this.notify();
            }
        });
        return intent.pending;
    }
    retryReaction(subjectId: string, reaction: Reaction): Promise<void> {
        const id = this.#subject(subjectId), intent = this.#reactionIntent(id, reaction);
        return intent ? intent.pending ?? this.#react(this.#intentKey(id, reaction, intent.principal), intent) : Promise.resolve();
    }
    /** Abandonment forgets only this local unresolved reaction; it cannot cancel its remote effect. */
    abandonReaction(subjectId: string, reaction: Reaction): boolean {
        const id = this.#subject(subjectId), intent = this.#reactionIntent(id, reaction);
        if (!intent || intent.pending || intent.effect.error?.status !== 'uncertain') return false;
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
        if (effect) await this.#issueEffect(effect);
    }
}
