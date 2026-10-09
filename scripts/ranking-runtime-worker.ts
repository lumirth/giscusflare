import { DurableObject } from 'cloudflare:workers';
import { RepositoryEngine } from '../src/domain/repository.js';
import { Store } from '../src/domain/store.js';
import { hash, random } from '../src/domain/crypto.js';
import { Session } from '../src/contracts/storage.js';
import type { ConfigBindings } from '../src/contracts/config.js';
const registeredPolicy = { repositoryId: 'R_fixture', installationId: 123, categoryId: 'CAT_fixture', category: 'Announcements', origins: ['https://blog.example'], maxReplyPrefetch: 20, displayCacheMs: 60000, countCacheMs: 300000, defaultCommentOrder: 'oldest' as const, customThemeOrigins: [] };
/** Measured full-service workload; native cursors keep their streaming/billing contract. */
export class RepositoryRankingProof extends DurableObject<ConfigBindings> {
    #now = 1800000000000;
    #reads = 0;
    #writes = 0;
    #http = 0;
    #alarms = 0;
    #alarmEvents = 0;
    #store: Store;
    #repository: RepositoryEngine;
    #session = '';
    #index = 0;
    #applied = 0;
    #start = 0;
    #warm: unknown;
    #identitySetup: unknown;
    #order: string[] = [];
    constructor(ctx: DurableObjectState, env: ConfigBindings) {
        super(ctx, env);
        const sql = { exec: (query: string, ...args: (string | number | null)[]) => {
                const cursor = ctx.storage.sql.exec(query, ...args);
                let reads = 0, writes = 0;
                const account = () => { this.#reads += cursor.rowsRead - reads; this.#writes += cursor.rowsWritten - writes; reads = cursor.rowsRead; writes = cursor.rowsWritten; };
                account();
                return { get rowsRead() { return cursor.rowsRead; }, get rowsWritten() { return cursor.rowsWritten; },
                    *[Symbol.iterator]() { try {
                        yield* cursor;
                    }
                    finally {
                        account();
                    } } };
            } };
        const transactionSync = <T>(work: () => T) => ctx.storage.transactionSync(work);
        this.#store = new Store(sql, () => this.#now, transactionSync);
        const nativeFetch = globalThis.fetch.bind(globalThis);
        globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
            this.#http++;
            const request = new Request(input, init), headers = new Headers(request.headers);
            headers.set('X-Fixture-Now', String(this.#now));
            return nativeFetch(new Request(request, { headers }));
        };
        this.#repository = new RepositoryEngine(env, this.#store, { sql, transactionSync });
    }
    async #schedule() { await this.#store.schedule({ storage: { sql: this.#store.sql, getAlarm: () => this.ctx.storage.getAlarm(), setAlarm: async (time) => { this.#alarms++; await this.ctx.storage.setAlarm(time); } } }, this.#repository.rankingAlarm()); }
    override async alarm() { this.#store.prune(); await this.#repository.continueRanking(); await this.#schedule(); }
    async #advance(time: number) {
        for (let events = 0; events < 10000; events++) {
            const due = await this.ctx.storage.getAlarm();
            if (due === null || due > time) {
                this.#now = Math.max(this.#now, time);
                return;
            }
            this.#now = Math.max(this.#now, due);
            await this.ctx.storage.deleteAlarm();
            this.#alarmEvents++;
            await this.alarm();
        }
        throw Error('Native alarms did not converge.');
    }
    async #ready() {
        for (let step = 0; step < 1000; step++) {
            const outcome = await this.#repository.execute('ranking', { config: { repo: 'example/comments', origin: 'https://blog.example', pageURL: 'https://blog.example/article', returnURL: 'https://blog.example/article', selector: { kind: 'discussion', number: 1, id: 'D_1' } }, profile: 'popular' }, registeredPolicy);
            await this.#schedule();
            if (!outcome.ok)
                throw Error(JSON.stringify(outcome.error));
            if (outcome.value.status !== 'preparing') {
                if (outcome.value.status === 'ready')
                    this.#order = outcome.value.ids;
                return outcome.value;
            }
            await this.#advance(Math.max(this.#now + 1, outcome.value.retryAt));
        }
        throw Error('Ranking did not converge within bounded events.');
    }
    async acquire(time: number) {
        this.#now = time;
        const result = await this.#repository.execute('ranking', { config: { repo: 'example/comments', origin: 'https://blog.example', pageURL: 'https://blog.example/article', returnURL: 'https://blog.example/article', selector: { kind: 'discussion', number: 1, id: 'D_1' } }, profile: 'popular' }, registeredPolicy);
        if (!result.ok) throw Error(JSON.stringify(result.error));
        await this.#schedule();
        return { ...result.value, ...this.#metrics() };
    }
    async run({ visits = 10000, mutations = 200, continuation = false, targetIDs = [] }: {
        visits?: number;
        mutations?: number;
        continuation?: boolean;
        targetIDs?: string[];
    }) {
        if (!continuation) {
            const warm = await this.#ready();
            this.#warm = warm.status === 'ready' ? { status: warm.status, count: warm.ids.length, interval: warm.interval } : warm;
            this.#start = (Math.floor(this.#now / 86400000) + 1) * 86400000;
            await this.#advance(this.#start);
            this.#index = 0;
            this.#applied = 0;
            this.#reads = 0;
            this.#writes = 0;
            this.#http = 0;
            this.#alarms = 0;
            this.#alarmEvents = 0;
            this.#session = random();
            const id = await hash(this.#session);
            const value = { principal: 'U_reader', credentials: { accessToken: 'ghu_reader', accessExpires: this.#now + 28800000, refreshToken: 'ghr_reader', refreshExpires: this.#now + 15552000000 }, origin: 'https://blog.example', expires: this.#now + 30 * 86400000 };
            await this.#store.putSecret('session:' + id, Session, value, this.env.SESSION_SECRET, this.env.GITHUB_APP_ID + ':' + this.env.GITHUB_CLIENT_ID + ':R_fixture', value.expires);
            const input = {repo:'example/comments',origin:'https://blog.example'}, authority = {session:this.#session}, before = this.#http;
            const local = await this.#repository.execute('session',input,registeredPolicy,authority);
            if (!local.ok || local.value.principal !== 'U_reader' || local.value.profile !== null || this.#http !== before) throw Error('Stored session identity must be available locally without a display profile.');
            const identity = await this.#repository.execute('identity',input,registeredPolicy,authority);
            if (!identity.ok || identity.value.principal !== 'U_reader' || identity.value.profile.login !== 'reader' || this.#http !== before + 1) throw Error('A missing display profile needs exactly one independent user lookup.');
            const retained = await this.#repository.execute('session',input,registeredPolicy,authority);
            if (!retained.ok || retained.value.profile?.login !== 'reader' || this.#http !== before + 1) throw Error('The acquired identity display must be reused locally.');
            this.#identitySetup = {localSessionRequests:0,missingProfileRequests:1,reusedProfileRequests:0};
            this.#reads = 0;this.#writes = 0;this.#http = 0;this.#alarms = 0;this.#alarmEvents = 0;
        }
        const end = Math.min(visits, this.#index + 64);
        for (; this.#index < end; this.#index++) {
            await this.#advance(this.#start + Math.floor(this.#index * 86400000 / visits));
            const ranking = await this.#ready();
            if (ranking.status !== 'ready')
                return { status: 'paused', visit: this.#index, ranking, ...this.#metrics() };
            const target = Math.floor((this.#index + 1) * mutations / visits);
            while (this.#applied < target) {
                const result = await this.#repository.execute('contribute', { config: { repo: 'example/comments', origin: 'https://blog.example', pageURL: 'https://blog.example/article', returnURL: 'https://blog.example/article', selector: { kind: 'discussion', number: 1, id: 'D_1' } }, key: '3.' + this.#now + '.' + random(), providerHTML:false, action: { type: 'reaction', subject: { kind: 'comment', id: targetIDs[this.#applied]! }, reaction: 'THUMBS_UP', selected: true } }, registeredPolicy,{session:this.#session});
                if (!result.ok)
                    throw Error(JSON.stringify(result.error));
                await this.#schedule();
                this.#applied++;
            }
        }
        if (this.#index < visits)
            return { status: 'continuing', visit: this.#index };
        const final = await this.#ready();
        return { status: final.status, visits: this.#index, mutations: this.#applied, warm: this.#warm, identitySetup: this.#identitySetup, order: this.#order, ...this.#metrics() };
    }
    #metrics() { const row = [...this.#store.sql.exec('SELECT value FROM ranking_meter WHERE id=1')][0]; return { reads: this.#reads, writes: this.#writes, http: this.#http, alarmWrites: this.#alarms, alarmEvents: this.#alarmEvents, meter: row ? JSON.parse(String(row.value)) : null, now: this.#now }; }
}
export default { async fetch(request: Request, env: {
        SERVICE: DurableObjectNamespace<RepositoryRankingProof>;
    }) {
        const input = await request.json() as {
            name: string;
            visits?: number;
            mutations?: number;
            continuation?: boolean;
            targetIDs?: string[];
            action?: string;
            now?: number;
        };
        const actor = env.SERVICE.get(env.SERVICE.idFromName(input.name));
        return Response.json(input.action === 'acquire' ? await actor.acquire(input.now!) : await actor.run(input));
    } };
