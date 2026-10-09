import * as v from 'valibot';
import { ReadCache } from './read-cache.js';
import { RankingEngine } from '../ranking/engine.js';
import { headQuery, discoveryQuery, observationQuery, parseHead, parseDiscovery, parseObservation } from '../ranking/github.js';
import type { RankingScope } from '../ranking/github.js';
import {type Source,type Storage as RankingStorage} from '../ranking/types.js';
import type { EffectResult, ReadValue } from '../contracts/results.js';
import type { WindowPage, Metadata, ContributionResult } from '../contracts/document.js';
import { configuration, secrets, type ConfigBindings, type RepositoryPolicy } from '../contracts/config.js';
import { parse } from '../contracts/parse.js';
import * as R from '../contracts/requests.js';
import * as C from '../contracts/rpc.js';
import * as S from '../contracts/storage.js';
import * as G from '../contracts/github.js';
import { NodeID } from '../contracts/primitives.js';
import { authorizeWidget, parentOrigin, policy, repositoryScope, repositoryIdentityScope, discussionScope } from './authorization.js';
import { Auth } from './auth.js';
import { hash } from './crypto.js';
import { GitHub, type AcquiredPage, type AcquisitionRequest } from './github.js';
import { AppError, requireCondition, result, type Result } from './errors.js';
import { Store } from './store.js';
import type { ContentInputData, ContentPreparer, PreparedContent, ContentSource, ContentPreview } from '../contracts/content.js';
export interface RepositoryOptions { content?: { revision: string; prepare: ContentPreparer } }
const PreparedArtifact = v.strictObject({
    html: v.pipe(v.string(), v.maxLength(1000000)), revision: v.pipe(v.string(), v.minLength(1), v.maxLength(256)),
    resources: v.optional(v.strictObject({ styles: v.pipe(v.array(v.pipe(v.string(), v.maxLength(2048))), v.maxLength(64)), scripts: v.pipe(v.array(v.pipe(v.string(), v.maxLength(2048))), v.maxLength(64)) })),
});
interface Access extends AcquiredPage {
    client: GitHub;
    token: string;
    session: S.Session | null;
    policy: RepositoryPolicy;
}
const emptyWindow = () => ({ ids: [], cursor: null, total: 0 });
const emptyRequest = (): AcquisitionRequest => ({ order: 'oldest', cursor: '', replyPrefetch: 0, ids: [], html: false });
export class RepositoryEngine {
    #reads = new ReadCache(() => this.store.now());
    #prepared = new ReadCache(() => this.store.now());
    #client?: GitHub;
    #ranking?: RankingEngine;
    #repositoryId?: string;
    constructor(readonly env: ConfigBindings, readonly store: Store, readonly rankingStorage?: RankingStorage, readonly options: RepositoryOptions = {}) { }
    execute<K extends C.Operation>(name: K, raw: unknown, repositoryID: string): Promise<Result<Output<K>>> {
        return result(async () => {
            const id = parse(NodeID, repositoryID);
            requireCondition(!this.#repositoryId || this.#repositoryId === id, 403, 'PERMISSION', 'The repository object identity does not match.');
            this.#repositoryId = id;
            requireCondition(Object.hasOwn(C.operations, name), 400, 'BAD_INPUT', 'Unknown repository operation.');
            const input = parse(C.operations[name].call, raw), request = 'request' in input ? input.request : input;
            const config = configuration(this.env);
            if ('config' in request)
                authorizeWidget(config, request.config);
            else if ('origin' in request)
                parentOrigin(policy(config, request.repo), request.origin);
            return await (this[name] as (input: C.Input<K>) => Promise<Output<K>>).call(this, input);
        }) as Promise<Result<Output<K>>>;
    }
    #base(repo: string) {
        const config = configuration(this.env), p = policy(config, repo), keys = secrets(this.env);
        if (this.#client?.repo !== repo)
            this.#client = new GitHub(repo,this.#repositoryId!,config,keys,this.store);
        return { client: this.#client, policy: p, auth: new Auth(config,keys,repo,this.#repositoryId!,p,this.store,this.#client) };
    }
    #pin(repo: string, meta: G.RepositoryHead) {
        requireCondition(!meta.isPrivate && meta.nameWithOwner.toLowerCase() === repo, 403, 'PUBLIC_ONLY', 'Only the configured public repository is available.');
        const identity = this.store.get('identity:v3', S.ActorIdentity);
        requireCondition(this.#repositoryId === meta.id, 403, 'PERMISSION', 'The acquired repository does not match this repository object.');
        if (!identity || identity.repo !== repo)
            this.store.put('identity:v3', S.ActorIdentity, { repo, repositoryId: meta.id });
    }
    #mapping(w: Pick<R.Selection, 'strict' | 'term'>, p: RepositoryPolicy) { return 'mapping:v3:' + JSON.stringify([p.categoryId||p.category, w.strict, w.term]); }
    #group(w: R.Selection) { return JSON.stringify([w.repo, policy(configuration(this.env), w.repo).category, w.number || [w.strict, w.term]]); }
    #remember(w: R.Selection, number: number) { this.#reads.identify(this.#group(w), 'discussion:' + number); }
    #invalidate(w: R.Selection, number: number) { const group = this.#group(w); this.#reads.invalidate(g => g === group || g === 'discussion:' + number || g === 'access'); }
    #metadata(a: Access, unavailable = false): Metadata { return { thread: a.discussion, viewer:a.viewer, archived: a.repository.isArchived, unavailable, profiles: Object.keys(a.policy.ranking?.profiles ?? {}) }; }
    /** One owner resolves selection, validates current authority, and acquires a window.
     * Creation shares this owner under the term lock rather than a second resolver. */
    async #acquire(w: R.Selection, principal: string | S.Session, request: AcquisitionRequest, create?: R.ContributionRequest['creation'], reserve?: (n: number) => void): Promise<Access> {
        const base = this.#base(w.repo), session = typeof principal === 'string' ? await base.auth.session(principal, w.origin, create !== undefined) : principal;
        const token = session?.credentials.accessToken || await base.client.installation(reserve ? () => reserve(2) : undefined);
        const key = this.#mapping(w, base.policy);
        const run = async () => {
            let number = w.number || this.store.get(key, S.Mapping)?.number;
            let resolved: Awaited<ReturnType<GitHub['resolve']>> | undefined;
            if (!number) {
                reserve?.(1);
                resolved = await base.client.resolve(w,base.policy.category,token,Boolean(session));
                const categoryId = repositoryScope(resolved.repository, w.repo, base.policy);
                this.#pin(w.repo, resolved.repository);
                if (resolved.selected) {
                    discussionScope(resolved.selected, w.repo, resolved.repository.id, categoryId);
                    number = resolved.selected.number;
                    this.store.put(key, S.Mapping, { number });
                    this.store.delete('creating:' + key);
                }
            }
            if (!number && create !== undefined) {
                requireCondition(resolved && !resolved.repository.isArchived, 403, 'ARCHIVED', 'The repository is archived.');
                requireCondition(!this.store.get('creating:' + key, S.Creation), 409, 'WRITE_UNCERTAIN', 'GitHub may have created this discussion. Check the repository before creating another.');
                this.store.limit('create:' + session!.principal, 10, 3600000);
                const categoryId = repositoryScope(resolved.repository, w.repo, base.policy);
                try {
                    const appToken = await base.client.installation();
                    this.store.put('creating:' + key, S.Creation, { started: this.store.now() });
                    const created = await base.client.create({ ...w, ...create }, resolved.repository.id, categoryId, appToken);
                    discussionScope(created, w.repo, resolved.repository.id, categoryId);
                    number = created.number;
                    this.store.put(key, S.Mapping, { number });
                    this.store.delete('creating:' + key);
                }
                catch (error) {
                    if (error instanceof AppError && [400, 401, 403, 404, 429].includes(error.status))
                        this.store.delete('creating:' + key);
                    throw error;
                }
            }
            let acquired: AcquiredPage;
            if (number) {
                reserve?.(1);
                acquired = await base.client.page(number, { ...request, replyPrefetch: Math.min(request.replyPrefetch,base.policy.maxReplyPrefetch)},token,Boolean(session));
                this.#pin(w.repo, acquired.repository);
                if (acquired.discussion) {
                    repositoryIdentityScope(acquired.repository, acquired.category, w.repo, base.policy);
                    this.#remember(w, number);
                }
                if (create !== undefined)
                    requireCondition(acquired.discussion, 410, 'NOT_FOUND', 'The mapped discussion was deleted. Select a new discussion explicitly.');
            }
            else
                acquired = { repository: resolved!.repository, category:undefined,discussion:null,viewer:resolved!.viewer,page: { nodes: {}, window: emptyWindow(), replies: {} } };
            return { ...acquired, client: base.client, policy: base.policy, token, session };
        };
        return create !== undefined ? this.store.lock(key, run) : run();
    }
    async page(input: C.Input<'page'>): Promise<ReadValue<WindowPage>> {
        const r = input.request, w = r.config, p = policy(configuration(this.env), w.repo);
        const load = async () => {
            const a = await this.#acquire(w, input.session, { ...r, html: r.content === 'github' });
            if (r.ids && !r.observe)
                for (const id of a.page.window.ids)
                    requireCondition(!a.page.nodes[id]!.parentId, 400, 'BAD_INPUT', 'Ranked windows contain top-level comments.');
            return { ...a.page, metadata: this.#metadata(a, Boolean(!a.discussion && (w.number || this.store.get(this.#mapping(w, p), S.Mapping)))) };
        };
        const { origin, ...identity } = w;
        const acquired = input.session ? { value: await load(), expires: 0 }
            : await this.#reads.read(JSON.stringify(['page', identity, r.order, r.cursor, r.parentId, r.ids, r.replyPrefetch, r.observe, r.content === 'github']), this.#group(w), p.displayCacheMs, load);
        if (r.content !== 'prepared') return acquired;
        const value = structuredClone(acquired.value);
        await this.#prepareNodes(value.nodes, w.repo, w.origin);
        return { value, expires: acquired.expires };
    }
    async info(input: R.InfoRequest) {
        const base = this.#base(input.repo);
        return this.#reads.read('info', 'repository', base.policy.displayCacheMs, async () => {
            const meta = await base.client.repository(await base.client.installation()), categoryId = repositoryScope(meta, input.repo, base.policy);
            this.#pin(input.repo, meta);
            return { repo: meta.nameWithOwner, repoId: meta.id, category: base.policy.category, categoryId, defaultCommentOrder: base.policy.defaultCommentOrder, profiles: Object.keys(base.policy.ranking?.profiles ?? {}) };
        });
    }
    async counts(input: R.CountsRequest) {
        const base = this.#base(input.repo), missing = new Map<string, R.Selection>();
        let batch: Promise<Map<string, number>> | undefined;
        const load = async () => {
            const pages = [...missing].map(([term, w]) => ({ term, widget: w, number: this.store.get(this.#mapping(w, base.policy), S.Mapping)?.number ?? null }));
            const { meta, summaries } = await base.client.counts(pages, input.strict, base.policy.category, await base.client.installation());
            const categoryId = repositoryScope(meta, input.repo, base.policy);
            this.#pin(input.repo, meta);
            for (const [i, page] of pages.entries())
                if (summaries[i]) {
                    discussionScope(summaries[i]!, input.repo, meta.id, categoryId);
                    this.store.put(this.#mapping(page.widget, base.policy), S.Mapping, { number: summaries[i]!.number });
                    this.#remember(page.widget, summaries[i]!.number);
                }
            return new Map(pages.map((p, i) => [p.term, summaries[i]?.comments.totalCount ?? 0]));
        };
        const entries = await Promise.all([...new Set(input.terms)].map(term => {
            const w: R.Selection = { repo: input.repo, origin: input.origin, strict: input.strict, term, number: 0 }, group = this.#group(w);
            return this.#reads.read('count:' + group, group, base.policy.countCacheMs, () => { missing.set(term, w); batch ??= Promise.resolve().then(load); return batch.then(values => values.get(term)!); }).then(e => ({ term, ...e }));
        }));
        const expires = Math.min(...entries.map(e => e.expires));
        return { value: { counts: Object.fromEntries(entries.map(e => [e.term, e.value])), observedAt: expires - base.policy.countCacheMs, expiresAt: expires }, expires };
    }
    #ranker(repo: string): RankingEngine | undefined {
        if (this.#ranking)
            return this.#ranking;
        const config = configuration(this.env), selected = config.repositories[repo]?.ranking;
        if (!selected)
            return;
        requireCondition(this.rankingStorage, 503, 'CONFIGURATION', 'Ranking storage is unavailable.');
        const count = Object.values(config.repositories).filter(p => p.ranking).length, b = config.rankingBudget;
        requireCondition(Math.floor(b.maxRowsWrittenPerDay / count) >= 256 && Math.floor(b.maxRowsReadPerDay / count) >= 256 && Math.floor(b.maxRequestsPerHour / count) >= 1, 503, 'CONFIGURATION', 'The ranking allowance is too small for the configured repositories.');
        return this.#ranking = new RankingEngine(this.rankingStorage, { ...selected, maxRequestsPerHour: Math.floor(b.maxRequestsPerHour / count), maxRowsWrittenPerDay: Math.floor(b.maxRowsWrittenPerDay / count), maxRowsReadPerDay: Math.floor(b.maxRowsReadPerDay / count), maxOrderBytes: b.maxOrderBytes }, this.store.now);
    }
    #rankingSource(repo: string, discussionId: string, categoryId?: string): Source {
        const base = this.#base(repo), identity = this.store.get('identity:v3', S.ActorIdentity)!;
        const scope: RankingScope = { repo, repositoryId: identity.repositoryId, discussionId, category: base.policy.category, ...((categoryId||base.policy.categoryId) ? { categoryId:categoryId||base.policy.categoryId } : {}) };
        const read = async (spec: {
            query: string;
            variables: Record<string, unknown>;
        }) => base.client.rankingGraph(spec.query, spec.variables, await base.client.installation(() => this.#ranker(repo)!.allowRequests(2)));
        return { head: async () => parseHead(await read(headQuery(scope)), scope), discover: async (cursor, inputs) => parseDiscovery(await read(discoveryQuery(scope, cursor, inputs)), scope, inputs), observe: async (ids, inputs) => parseObservation(await read(observationQuery(ids, inputs)), ids, scope, inputs) };
    }
    async ranking(input: C.Input<'ranking'>) {
        const w = input.request.config, ranker = this.#ranker(w.repo), p = policy(configuration(this.env), w.repo);
        requireCondition(ranker && Object.hasOwn(ranker.options.profiles, input.request.profile), 400, 'BAD_INPUT', 'This ranking profile is not enabled.');
        try {
            const access = await this.#reads.read('access:' + JSON.stringify(w), 'access', p.displayCacheMs, async () => { const a = await this.#acquire(w, '', emptyRequest(), undefined, n => ranker.allowRequests(n)); return { discussion: a.discussion, category: a.category }; });
            const a = access.value;
            requireCondition(a.discussion, 404, 'NOT_FOUND', 'Discussion not found.');
            return await ranker.request(a.discussion.id, input.request.profile, this.#rankingSource(w.repo, a.discussion.id, a.category?.id));
        }
        catch (error) {
            if (error instanceof AppError && error.code === 'RANKING_BUDGET')
                return { status: 'paused' as const, reason: 'budget' as const, retryAt: this.store.now() + (error.retryAfter ?? 60) * 1000 };
            throw error;
        }
    }
    async continueRanking() { const identity = this.store.get('identity:v3', S.ActorIdentity); if (identity) {
        this.#repositoryId = identity.repositoryId;
        await this.#ranker(identity.repo)?.continueJobs(id => this.#rankingSource(identity.repo, id));
    } }
    rankingAlarm() { return this.#ranking?.nextAlarmAt() ?? null; }
    async #prepare(input: ContentInputData): Promise<PreparedContent> {
        const producer = this.options.content;
        requireCondition(producer && typeof producer.revision === 'string' && producer.revision.trim().length > 0 && producer.revision.length <= 256 && typeof producer.prepare === 'function', 503, 'CONFIGURATION', 'This deployment needs a versioned content producer.');
        const key = await hash(JSON.stringify([producer.revision, input]));
        return (await this.#prepared.read(key, 'prepared', 86400000, async () => {
            const record = 'prepared:v5:' + key;
            let persisted: PreparedContent | null = null;
            try { persisted = this.store.get(record, PreparedArtifact); } catch { try { this.store.delete(record); } catch {} }
            if (persisted) return persisted;
            const value = parse(PreparedArtifact, await producer.prepare(input), 'upstream');
            if (new TextEncoder().encode(JSON.stringify(value)).byteLength <= 1024 * 1024) {
                const retain = () => {
                    this.store.put(record, PreparedArtifact, value, this.store.now() + 86400000);
                    this.store.bound('prepared:v5:', 8 * 1024 * 1024, 256);
                };
                try { if (this.store.transactionSync) this.store.transactionSync(retain); else retain(); }
                catch { console.error('Prepared content could not be retained.'); }
            }
            return value;
        })).value;
    }
    async #prepareNodes(nodes: Record<string, Partial<import('../contracts/document.js').Comment> | null>, repo: string, pageURL: string): Promise<void> {
        for (const comment of Object.values(nodes)) if (comment && comment.body !== undefined && comment.id && comment.url) {
            comment.prepared = await this.#prepare({ markdown: comment.body, purpose: 'comment', repo, pageURL,
                comment: { id: comment.id, url: comment.url, parentId: comment.parentId ?? null } });
        }
    }
    async preview(input: C.Input<'preview'>): Promise<ContentPreview> {
        const request = input.request;
        if (request.content === 'prepared') return { prepared: await this.#prepare({ markdown: request.body, purpose: 'preview', repo: request.config.repo, pageURL: request.config.origin, ...(request.draft ? { draft: request.draft } : {}) }) };
        if (request.content === 'source') return {};
        const base = this.#base(request.config.repo), session = await base.auth.session(input.session, request.config.origin, true);
        const meta = await base.client.repositoryHead(session!.credentials.accessToken);
        this.#pin(request.config.repo, meta);
        requireCondition(!meta.isArchived, 403, 'ARCHIVED', 'The repository is archived.');
        this.store.limit('preview:' + session!.principal, 30, 60000);
        return { html: await base.client.markdown(request.body, session!.credentials.accessToken) };
    }
    async #delivery(effect: EffectResult, content: ContentSource, repo: string, pageURL: string): Promise<ContributionResult> {
        if (content !== 'prepared' || !effect.patch?.nodes) return effect;
        // Preparation is display work, never grounds to repeat the confirmed effect.
        const delivery = structuredClone(effect);
        try { await this.#prepareNodes(delivery.patch!.nodes!, repo, pageURL); } catch { /* Original source remains readable. */ }
        return delivery;
    }
    async contribute(input: C.Input<'contribute'>): Promise<ContributionResult> {
        const r = input.request, w = r.config, action = r.action;
        const base = this.#base(w.repo), session = await base.auth.session(input.session, w.origin, true);
        const selected = w.number ? { repo: w.repo, number: w.number } : { repo: w.repo, term: w.term, strict: w.strict };
        const intent = { selection: selected, action };
        const receiptKey = 'receipt:v3:' + await hash(r.key), fingerprint = await hash(JSON.stringify(intent)), owner = session!.principal;
        return this.store.lock(receiptKey, async () => {
            const receipt = this.store.get(receiptKey, S.Receipt);
            if (receipt) {
                requireCondition(receipt.owner === owner, 409, 'CONFLICT', 'This submission belongs to another GitHub account.');
                requireCondition(receipt.fingerprint === fingerprint, 409, 'CONFLICT', 'This request ID was used for different content.');
                requireCondition(receipt.result, 409, 'WRITE_UNCERTAIN', 'GitHub may have saved this change. Check the discussion before submitting it again.');
                return this.#delivery(receipt.result, r.content, w.repo, w.origin);
            }
            const created = Number(r.key.split('.')[1]);
            requireCondition(Number.isSafeInteger(created) && created <= this.store.now() + 300000 && this.store.now() - created < 86400000, 409, 'OPERATION_EXPIRED', 'This submission is too old to retry. Check the discussion before submitting again.');
            const targetId = action.type === 'comment' ? action.replyToId : action.type === 'reaction' ? action.subject.kind === 'comment' ? action.subject.id : '' : action.id;
            const create = action.type === 'comment' && !action.replyToId || action.type === 'reaction' && action.subject.kind === 'discussion' && action.selected;
            const a = await this.#acquire(w, session!, { ...emptyRequest(), operation: action }, create ? r.creation : undefined);
            requireCondition(!a.repository.isArchived, 403, 'ARCHIVED', 'The repository is archived.');
            requireCondition(a.discussion, 404, 'NOT_FOUND', 'Discussion not found.');
            const target = targetId ? a.target : null;
            if (targetId)
                requireCondition(target, 404, 'NOT_FOUND', 'Comment not found.');
            if (action.type === 'comment' || action.type === 'reaction')
                requireCondition(!a.discussion.locked, 403, 'LOCKED', 'This discussion is locked.');
            if (action.type === 'edit')
                requireCondition(target!.viewerCanUpdate, 403, 'PERMISSION', 'You cannot edit this comment.');
            if (action.type === 'delete')
                requireCondition(target!.viewerCanDelete, 403, 'PERMISSION', 'You cannot delete this comment.');
            if (action.type === 'moderate')
                requireCondition(action.minimized ? target!.viewerCanMinimize : target!.viewerCanUnminimize, 403, 'PERMISSION', 'You cannot moderate this comment.');
            const parentId = action.type === 'comment' && target ? (target.parentId || target.id) : target?.parentId || '';
            this.store.limit('write:' + owner, 30, 60000);
            this.store.limit('all-writes', 180, 60000);
            const expires = Math.max(created, this.store.now()) + 86400000;
            this.store.put(receiptKey, S.Receipt, {owner,fingerprint,result:null}, expires);
            let effect: EffectResult;
            try {
                const confirmed = await a.client.contribute(action, a.discussion.id, targetId || a.discussion.id, parentId, a.token, r.content === 'github');
                effect = { ...confirmed, number: a.discussion.number, ...(parentId ? { parentId } : {}) };
                if (create && effect.patch) effect.patch = { ...effect.patch, metadata: { thread: a.discussion, archived: a.repository.isArchived, unavailable: false, profiles: Object.keys(a.policy.ranking?.profiles ?? {}) } };
                this.store.put(receiptKey, S.Receipt, {owner,fingerprint,result:effect}, expires);
            }
            catch (error) {
                if (error instanceof AppError && [400, 401, 403, 404, 429].includes(error.status)) {
                    this.store.delete(receiptKey);
                    throw error;
                }
                throw new AppError(502, 'WRITE_UNCERTAIN', 'GitHub may have saved this change. Check the discussion before submitting it again.');
            }
            finally {
                this.#invalidate(w, a.discussion.number);
            }
            if (action.type === 'reaction' && !parentId && action.subject.kind === 'comment') {
                const count = effect.patch?.reactions?.[effect.id]?.[action.reaction]?.count;
                if (count !== undefined) try { this.#ranker(w.repo)?.reaction(a.discussion.id, effect.id, action.reaction, count); }
                catch { /* Acquisition cadence and its budget remain independent of interactive completion. */ }
            }
            return this.#delivery(effect, r.content, w.repo, w.origin);
        });
    }
    authPrepare(input: C.Input<'authPrepare'>) { return this.#base(input.request.repo).auth.prepare(input); }
    authCallback(input: C.Input<'authCallback'>) { return this.#base(input.repo).auth.callback(input); }
    logout(input: C.Input<'logout'>) { return this.#base(input.request.repo).auth.logout(input.session,input.request.origin); }
}
export type Output<K extends C.Operation> = Awaited<ReturnType<RepositoryEngine[K]>>;
