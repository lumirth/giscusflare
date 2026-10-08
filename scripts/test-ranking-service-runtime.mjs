import assert from 'node:assert/strict';
import { generateKeyPairSync, randomBytes, createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { workerd } from './workerd.mjs';
import { evidence } from '../test/evidence.mjs';
import { githubServer } from '../test/github-server.mjs';
import { loadModule } from '../test/modules.mjs';
import { providerTransport } from '../test/native-service.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const { DEFAULT_RANKING_LIMITS: limits } = await loadModule('src/ranking/types.ts');
const { maxRequestsPerHour, maxRowsWrittenPerDay, maxRowsReadPerDay, maxOrderBytes } = limits;
const budget = { maxRequestsPerHour, maxRowsWrittenPerDay, maxRowsReadPerDay, maxOrderBytes };
const profile = {
    profiles: { popular: { weights: { THUMBS_UP: 1 }, tieBreak: 'oldest' } },
    refreshSeconds: limits.refreshSeconds,
};
const report = evidence('native-ranking-service-resources');
report.scope = 'Warm stable corpus plus cold allowance-stopped acquisition across an actual native restart; actual RepositoryEngine, credentials, GitHub transport, canonical SQL and ranking SQL. Uniform visits and authenticated existing-root reactions. Due native alarms are delivered against the controlled clock. Initial OAuth authorization, Worker ingress, response serialization CPU, GB-s and real GitHub latency/billing are not measured.';
report.globalBudget = budget;
report.workloads = {};
async function workload(repositories, roots, visits, mutations, coldRestart = false) {
    const executionBudget = coldRestart ? { ...budget, maxRowsWrittenPerDay: 256, maxRowsReadPerDay: 1024 } : budget;
    let clock = 1800000000000;
    const github = await githubServer({ now: () => clock });
    let runtime;
    try {
        const discussion = github.upstream.addThread('article');
        const index = new Map([[discussion.id, { d: discussion, node: discussion }]]);
        for (let i = 0; i < roots; i++) {
            const comment = github.upstream.addComment(discussion, 'Record ' + i);
            comment.votes.THUMBS_UP = Array.from({ length: i % 103 }, (_, j) => 'voter' + j);
            index.set(comment.id, { d: discussion, node: comment });
        }
        // Fixture lookup cost must not obscure actual service work at this scale.
        github.upstream.locate = id => index.get(id) ?? null;
        const fetch = github.upstream.fetch;
        github.upstream.fetch = request => {
            clock = Number(request.headers.get('X-Fixture-Now') ?? clock);
            return fetch(request);
        };
        const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
        const policies = Object.fromEntries(['example/comments', 'example/second', 'example/third'].slice(0, repositories).map(repo => [
            repo, { origins: ['https://blog.example'], category: 'Announcements', ranking: profile },
        ]));
        runtime = await workerd('scripts/ranking-runtime-worker.ts', {
            outboundService: providerTransport(github.origin),
            durableObjects: { SERVICE: { className: 'RepositoryRankingProof', useSQLite: true } },
            bindings: {
                PUBLIC_ORIGIN: 'https://comments.example',
                GITHUB_APP_ID: '12345',
                GITHUB_CLIENT_ID: 'Iv1.fixture',
                GITHUB_CLIENT_SECRET: 'fixture-client-secret',
                GITHUB_PRIVATE_KEY: privateKey.export({ type: 'pkcs1', format: 'pem' }).toString(),
                SESSION_SECRET: randomBytes(32).toString('base64url'),
                REPOSITORIES: policies,
                RANKING_BUDGET: executionBudget,
            },
        });
        const targetIDs = discussion.comments.slice(0, mutations).map(comment => comment.id);
        let result;
        if (coldRestart) {
            const acquire = async () => {
                const response = await runtime.fetch('http://proof/', { method: 'POST', body: JSON.stringify({ name: 'service', action: 'acquire', now: clock }) });
                assert.equal(response.status, 200);
                return response.json();
            };
            const first = await acquire();
            assert.equal(first.status, 'paused');
            assert.equal(first.reason, 'budget');
            assert.ok(first.writes > 0 && first.writes < 1000, 'cold acquisition stops after a bounded scan quantum');
            await runtime.restart();
            const added = github.upstream.addComment(discussion, 'Created while acquisition was stopped');
            index.set(added.id, { d: discussion, node: added });
            for (let step = 0; step < 40; step++) {
                clock = result?.retryAt ?? first.retryAt;
                result = await acquire();
                if (result.status === 'ready') break;
                assert.ok(['preparing','paused'].includes(result.status));
                if (result.status === 'paused') assert.equal(result.reason, 'budget');
            }
            assert.equal(result.status, 'ready', 'a persisted acquisition completes after restart and allowance renewal');
            result = { ...result, order: result.ids, reads: first.reads + result.reads, writes: first.writes + result.writes, nativeRestarts: 1, firstPause: { now: first.now, writes: first.writes, retryAt: first.retryAt } };
            delete result.ids;
        } else for (let step = 0; step < 300; step++) {
            const response = await runtime.fetch('http://proof/', {
                method: 'POST',
                body: JSON.stringify({ name: 'service', action: 'service', visits, mutations, targetIDs, continuation: step > 0 }),
            });
            result = await response.json();
            assert.equal(response.status, 200, JSON.stringify(result));
            if (result.status !== 'continuing')
                break;
        }
        const effects = discussion.comments.filter(comment => comment.votes.THUMBS_UP?.includes('reader')).length;
        const operations = {};
        for (const call of github.upstream.calls) {
            const operation = call.operation ?? call.path;
            operations[operation] = (operations[operation] ?? 0) + 1;
        }
        return {
            runtime: runtime.versions,
            configuredRepositories: repositories,
            trafficRepositories: 1,
            roots, visits, requestedMutations: mutations, externalEffects: effects,
            perRepositoryBudget: {
                requests: Math.floor(executionBudget.maxRequestsPerHour / repositories),
                writes: Math.floor(executionBudget.maxRowsWrittenPerDay / repositories),
                reads: Math.floor(executionBudget.maxRowsReadPerDay / repositories),
            },
            result,
            independentOrder: discussion.comments.filter(comment => !comment.deletedAt && !comment.isMinimized).sort((a, b) => (b.votes.THUMBS_UP?.length || 0) - (a.votes.THUMBS_UP?.length || 0) || Date.parse(a.createdAt) - Date.parse(b.createdAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).map(comment => comment.id),
            providerOperationsIncludingWarmup: operations,
        };
    }
    finally {
        await runtime?.dispose();
        await github.dispose();
    }
}
try {
    const one = report.workloads.oneRepository = await workload(1, 10000, 10000, 200);
    assert.equal(one.result.status, 'ready', JSON.stringify(one.result));
    assert.equal(one.result.visits, 10000);
    assert.equal(one.result.mutations, 200);
    assert.equal(one.externalEffects, 200, 'independent upstream effects must establish actual completed mutations');
    assert.equal(one.result.warm.count, 10000);
    assert.deepEqual(one.result.order, one.independentOrder, 'returned order follows independently stored provider inputs');
    assert.ok(Buffer.byteLength(JSON.stringify(one.result.order)) <= maxOrderBytes, 'serialized order fits the configured output envelope');
    assert.ok(one.result.alarmEvents > 0, 'expiry and continuation work must be included');
    assert.ok(one.result.reads < 5000000, 'native SQL must fit the independent Free account read envelope');
    assert.ok(one.result.writes < 100000, 'native SQL must fit the independent Free account write envelope');
    assert.ok(one.result.meter.requests <= maxRequestsPerHour);
    report.checks.push('complete warm 10k-root/10k-visit/200-mutation day including due alarms and canonical storage');
    const three = report.workloads.threeRepositorySplit = await workload(3, 3333, 3333, 67);
    assert.equal(three.result.status, 'paused', JSON.stringify(three.result));
    assert.equal(three.result.ranking.reason, 'budget');
    assert.equal(three.result.meter.requests, three.perRepositoryBudget.requests);
    assert.ok(three.result.ranking.retryAt > three.result.now);
    report.checks.push('one-of-three representative workload pauses at its divided hourly request allowance');
    const cold = report.workloads.coldRestartContinuation = await workload(1, 500, 0, 0, true);
    assert.deepEqual(cold.result.order, cold.independentOrder, 'restored acquisition reconciles independently changed provider membership');
    assert.ok(cold.result.interval.started < cold.result.interval.completed, 'the published acquisition interval acknowledges allowance windows');
    report.checks.push('bounded cold acquisition resumes from native SQLite after actual workerd restart and reconciles external membership changes');
    report.status = 'passed';
}
catch (error) {
    report.status = 'failed';
    report.details = error instanceof Error ? error.stack : String(error);
    process.exitCode = 1;
}
finally {
    for (const workload of Object.values(report.workloads)) {
        if (!workload.result.order) { delete workload.independentOrder; continue; }
        const digest = ids => createHash('sha256').update(JSON.stringify(ids)).digest('hex');
        workload.result.orderProof = { count: workload.result.order.length, jsonBytes: Buffer.byteLength(JSON.stringify(workload.result.order)), identifierBytes: { min: Math.min(...workload.result.order.map(id => Buffer.byteLength(id))), max: Math.max(...workload.result.order.map(id => Buffer.byteLength(id))) }, actualSHA256: digest(workload.result.order), providerExpectedSHA256: digest(workload.independentOrder) };
        delete workload.result.order;
        delete workload.independentOrder;
    }
    report.completedAt = new Date().toISOString();
    const output = process.env.RANKING_SERVICE_PROOF_OUTPUT ?? resolve(root, 'test-results/evidence/ranking-service-runtime.json');
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
}
