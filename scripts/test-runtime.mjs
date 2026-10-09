import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile, symlink } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { nativeService } from '../test/native-service.mjs';
import { evidence } from '../test/evidence.mjs';
const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const origin = 'http://127.0.0.1:18790', blog = 'http://127.0.0.1:18791';
const config = { repo: 'example/comments', origin: blog, pageURL: blog + '/article', returnURL: blog + '/article', selector: { kind: 'page', key: 'article' } };
const random = () => randomBytes(32).toString('base64url'), hash = value => createHash('sha256').update(value).digest('base64url');
const key = () => '3.' + Date.now() + '.' + random();
const report = evidence('native-service-workflows');
report.scope = 'Extracted release package in actual workerd/SQLite and separate content worker, then the portable conversation package against that same independent provider. These phases prove destinations, confirmed effects, observation age, independence and recovery; browser paint/editing has its own acceptance journey.';
const consumer = await mkdtemp(resolve('dist/qualification-consumer-'));
const packedResult = JSON.parse(execFileSync('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', consumer], { encoding: 'utf8' }));
const packed = Array.isArray(packedResult) ? packedResult[0] : Object.values(packedResult)[0];
report.package = { filename: packed.filename, integrity: packed.integrity, shasum: packed.shasum };
const packageDirectory = join(consumer, 'node_modules/giscusflare');
await mkdir(packageDirectory, { recursive: true });
execFileSync('tar', ['-xzf', join(consumer, packed.filename), '--strip-components=1', '-C', packageDirectory]);
for (const dependency of Object.keys(JSON.parse(await readFile(join(packageDirectory, 'package.json'), 'utf8')).dependencies)) {
  const destination = join(consumer, 'node_modules', dependency); await mkdir(dirname(destination), { recursive: true });
  await symlink(resolve('node_modules', dependency), destination, 'dir');
}
const { countKey } = await import(pathToFileURL(join(packageDirectory, 'dist/browser/counts.js')).href);
const rootTarget = key => ({selector:{kind:'page',key},window:{kind:'roots'}});
const articleKey = countKey(rootTarget('article')), missingKey = countKey(rootTarget('missing')), disappearingKey = countKey(rootTarget('disappearing'));
const entry = join(consumer, 'worker.ts'), contentEntry = join(consumer, 'content.ts');
await writeFile(entry, "export { default, Repository } from 'giscusflare/worker';\n");
const writeConsumer = revision => writeFile(contentEntry, `import { createContentWorker } from 'giscusflare/content/worker';
export default createContentWorker({ revision: ${JSON.stringify(revision)}, prepare(input) {
  if (input.markdown === 'Failed isolated body') throw Error('Fixture interpretation failed');
  const source = input.markdown.replace(/[&<>]/g, value => ({'&':'&amp;', '<':'&lt;', '>':'&gt;'}[value]));
  return { html: '<article><p>' + source + '</p></article>', revision: 'ignored' };
} });
`);
await writeConsumer('native-host-1');
let service;
try { service = await nativeService({ origin, blog, entry, contentEntry }); }
catch (error) { await rm(consumer, { recursive: true, force: true }); throw error; }
report.runtime = service.versions;
const read = (name, input, cap = '') => service.fetch(origin + '/api/v6/' + name + '?' + new URLSearchParams({ input: JSON.stringify(name === 'page' ? { read: { kind: 'roots', order: 'oldest' }, ...input, ...(cap ? { fresh: true } : {}) } : input) }), { headers: { Origin: origin, ...(cap ? { 'Cache-Control': 'no-cache', Authorization: 'Bearer ' + cap } : {}) } });
const post = (name, input, cap = '', headers = {}) => service.fetch(origin + '/api/v6/' + name, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...(cap ? { Authorization: 'Bearer ' + cap } : {}), ...headers }, body: JSON.stringify(input) });
const json = async (response, status = 200) => { const result = await response.json(); assert.equal(response.status, status, JSON.stringify(result)); return result; };
let signInIndex = 0;
async function signIn(principal = 'reader') {
    const headers = { 'CF-Connecting-IP': '192.0.2.' + (80 + signInIndex++) };
    service.github.oauthUser = principal;
    const cap = random(), proof = hash(cap);
    const prepared = await post('auth/prepare', { repo: config.repo, origin: config.origin, returnURL: config.returnURL, proof, mode: 'popup' }, '', headers);
    const cookie = prepared.headers.get('Set-Cookie')?.split(';')[0], data = await json(prepared), url = new URL(data.authorizeURL);
    assert.equal(data.attempt, hash(proof));
    assert.equal((await post('access', { config, ids: [] }, cap)).status, 401, 'a future capability is unusable before authorization');
    const callback = origin + '/auth/callback?' + new URLSearchParams({ state: url.searchParams.get('state'), code: 'fixture_' + url.searchParams.get('code_challenge') });
    const response = await service.fetch(callback, { headers: { Cookie: cookie, ...headers }, redirect: 'manual' }), html = await response.text();
    assert.equal(response.status, 200, html);
    assert.ok(!html.includes(cap) && !html.includes(proof) && !html.includes('ghu_'), 'callback contains no credential or capability');
    assert.equal((await service.fetch(callback, { headers: { Cookie: cookie, ...headers }, redirect: 'manual' })).status, 401, 'authorization is one-use');
    assert.equal((await post('auth/prepare', { repo: config.repo, origin: config.origin, returnURL: config.returnURL, proof, mode: 'popup' }, '', headers)).status, 409, 'an existing future capability cannot be replaced');
    return cap;
}
const contribute = (action, cap, submission = key()) => post('contribute', { config, key: submission, action }, cap);
try {
    assert.deepEqual(await json(await service.fetch(origin + '/healthz')), { status: 'ok', version }, 'The extracted Worker reports its published package version');
    const countInput = { repo: config.repo, origin: config.origin, targets: [rootTarget('article')] };
    service.github.now = () => Date.now() - 3_500_000;
    await json(await read('counts', countInput)); // Resolve the page once, with an expiring credential.
    service.github.now = () => Date.now();
    const coldDiscussion = service.github.addThread('cold-reply-count'), coldParent = service.github.addComment(coldDiscussion,'An independently created cold parent');
    service.github.addComment(coldDiscussion,'An independently created cold reply',{replyTo:coldParent.id});
    assert.equal(coldParent.replies.length,1,'The cold count oracle contains an independently created provider reply');
    const coldReplyTarget = {selector:{kind:'page',key:'cold-reply-count'},window:{kind:'replies',parentId:coldParent.id}};
    const measureCounts = async (label,target=rootTarget('article'),expected=service.github.discussions[0].comments.length) => {
      await service.restart();
      const before = service.github.calls.length, started = performance.now();
      const value = await json(await read('counts', { ...countInput, targets:[target], fresh: true }));
      const operations = service.github.calls.slice(before);
      assert.equal(value.observations[countKey(target)].count, expected);
      assert.equal(operations.filter(call => call.operation === 'CommentCounts').length, 1);
      assert.ok(operations.every(call => !call.path.endsWith('/installation')), 'Registered execution does not rediscover installation identity');
      const query = operations.find(call => call.operation === 'CommentCounts');
      assert.ok(!query.query.includes('discussionCategories'), 'A cold count does not rediscover its registered category catalogue');
      if(target.selector.key==='article')assert.ok(!query.query.includes('search('), 'A resolved cold count needs no page discovery');
      report.coldPaths ??= {};
      report.coldPaths[label] = { target, milliseconds: performance.now() - started, operations: operations.map(call => call.operation ?? call.path), scope: 'local native workerd and independent provider; excludes real GitHub network latency' };
      return { value, operations };
    };
    const renewed = await measureCounts('fullyColdIncludingCredentialRenewal',coldReplyTarget,coldParent.replies.length);
    assert.equal(renewed.operations.length, 2, 'A fully cold unmapped reply count needs one credential renewal and one batched count query');
    const noResult = await measureCounts('noReusableCountResult');
    assert.equal(noResult.operations.length, 1, 'A result miss with reusable provider access needs only the count query');
    const warmUnknown = service.github.addThread('unmapped-reply-peer'), warmParent = service.github.addComment(warmUnknown,'A second independently created parent');
    service.github.addComment(warmUnknown,'A second independent reply',{replyTo:warmParent.id});
    assert.equal(warmParent.replies.length,1);
    const warmRoot = rootTarget('unmapped-reply-peer'), warmReply = {selector:warmRoot.selector,window:{kind:'replies',parentId:warmParent.id}}, foreignReply = {selector:warmRoot.selector,window:{kind:'replies',parentId:coldParent.id}};
    const beforeUnknown = service.github.calls.length;
    const unknownPeers = await json(await read('counts',{...countInput,targets:[warmRoot,warmReply,foreignReply],fresh:true}));
    const unknownWork = service.github.calls.slice(beforeUnknown);
    assert.equal(unknownWork.length,1,'An unmapped root/reply batch with reusable App access performs one provider request');
    assert.equal(unknownWork[0].operation,'CommentCounts');
    assert.equal(Object.values(unknownWork[0].variables).filter(value=>typeof value==='string'&&value.startsWith('repo:example/comments in:body ')).length,1,'A shared exact page is discovered once within the batched query');
    assert.equal(unknownPeers.observations[countKey(warmRoot)].count,warmUnknown.comments.length);
    assert.equal(unknownPeers.observations[countKey(warmReply)].count,warmParent.replies.length);
    assert.equal(unknownPeers.observations[countKey(foreignReply)],undefined,'A parent from another canonical discussion cannot publish a reply count');
    assert.equal(unknownPeers.errors[countKey(foreignReply)].code,'PERMISSION','A foreign parent fails locally without discarding its valid peers');
    const mixed = await json(await read('counts', { ...countInput, targets: [rootTarget('article'), rootTarget('missing')] }));
    assert.equal(mixed.observations[articleKey].count, service.github.discussions[0].comments.length, 'The mixed provider query returns the actual resolved count independently of missing selections');
    assert.equal(mixed.observations[missingKey].count, 0);
    const beforeReuse = service.github.calls.length;
    assert.deepEqual(await json(await read('counts', { ...countInput, targets: [rootTarget('article'), rootTarget('missing')] })), mixed, 'Edge result reuse preserves every provider observation age and deadline');
    assert.equal(service.github.calls.length, beforeReuse, 'Reusing the same public result adds no provider work');
    report.checks.push({ workflow: 'separate native count misses and fully cold credential renewal, minimal provider requests, per-key observation reuse', status: 'passed' });
    const explicitRoot = {selector:{kind:'discussion',number:1,id:'D_1'},window:{kind:'roots'}};
    const replyTarget = {selector:{kind:'discussion',number:1,id:'D_1'},window:{kind:'replies',parentId:service.github.discussions[0].comments[0].id}};
    const collidingPage = rootTarget('discussion:1');
    const scoped = await json(await read('counts', {repo:config.repo,origin:config.origin,targets:[collidingPage,explicitRoot,replyTarget],fresh:true}));
    assert.equal(scoped.observations[countKey(collidingPage)].count,0,'A literal page key cannot collide with explicit discussion identity');
    assert.equal(scoped.observations[countKey(explicitRoot)].count,service.github.discussions[0].comments.length);
    assert.equal(scoped.observations[countKey(replyTarget)].count,service.github.discussions[0].comments[0].replies.length,'Root and reply observations have independently reusable identities');
    const first = service.github.discussions[0].comments[0];
    first.body = 'hello🌿'.repeat(32768);
    const response = await read('page', { config }), page = await json(response);
    assert.equal(page.window.count.count, service.github.discussions[0].comments.length);
    assert.equal(page.nodes[first.id].body, first.body, 'native serialization preserves large Unicode values');
    assert.ok(Number(response.headers.get('X-Giscusflare-Expires')) > Date.now());
    const withoutPrefetch = await json(await read('page', { config, read: { kind: 'roots', order: 'oldest', replyPrefetch: 0 } }));
    assert.deepEqual(withoutPrefetch.replies[first.id].ids, [], 'zero reply prefetch leaves the child window unobserved');
    assert.equal(withoutPrefetch.replies[first.id].count.count, first.replies.length);
    assert.notEqual(withoutPrefetch.replies[first.id].cursor, null, 'real replies remain discoverable without prefetch');
    const replies = await json(await read('page', { config, read: { kind: 'replies', parentId: first.id } }));
    assert.equal(replies.window.count.count, first.replies.length);
    assert.deepEqual(replies.window.ids.map(id => replies.nodes[id].body), first.replies.map(reply => reply.body));
    const widget = '/widget?' + new URLSearchParams({ repo: config.repo, origin: config.origin, pageURL: config.pageURL, returnURL: config.returnURL, key: 'article' });
    assert.equal((await service.fetch(origin + widget)).status, 200);
    const calls = service.github.calls.length, hit = await service.fetch(origin + widget);
    assert.equal(hit.status, 200);
    assert.equal(hit.headers.get('Cache-Control'), 'no-store');
    assert.ok(hit.headers.get('Content-Security-Policy').includes(blog));
    assert.equal(service.github.calls.length, calls, 'server bootstrap cache avoids repeated provider work');
    assert.equal((await read('page', { config: { ...config, origin: 'https://unapproved.example', pageURL: 'https://unapproved.example/article', returnURL: 'https://unapproved.example/article' } })).status, 403);
    report.checks.push({ workflow: 'read useful root/reply windows through native RPC, frame/cache and origin boundaries', status: 'passed' });
    const cap = await signIn();
    const creation = { type: 'comment', body: 'A native contribution' }, submission = key();
    const providerFetch = service.github.fetch.bind(service.github);
    const ack = await json(await post('contribute', { config, key: submission, action: creation, content: 'github',
        creation: { description: 'Original article title',  } }, cap));
    assert.equal(ack.patch.nodes[ack.id].body, creation.body, 'The contribution delivers its operation-owned canonical writing');
    const htmlReplay = await json(await post('contribute', { config, key: submission, action: creation, content: 'github' }, cap));
    assert.deepEqual(htmlReplay.patch, ack.patch, 'A confirmed receipt retains its original facts and observation age');
    const replay = await json(await post('contribute', { config: { ...config, pageURL: config.pageURL + '#updated-heading' }, key: submission, action: creation, content: 'source',
        creation: { description: 'Updated article title',  } }, cap));
    assert.equal(replay.id, ack.id, 'Changing delivery URL, article preparation and presentation retains the confirmed contribution');
    assert.equal(replay.patch.nodes[ack.id].body, creation.body, 'receipt replay observes current content without another effect');
    assert.equal((await json(await post('contribute', { config, key: submission, action: { ...creation, body: 'Different writing' } }, cap), 409)).error.code, 'CONFLICT', 'A retained key cannot authorize different writing');
    assert.equal((await json(await post('contribute', { config: { ...config, selector: { kind: 'page', key: 'other-article' } }, key: submission, action: creation }, cap), 409)).error.code, 'CONFLICT', 'A retained key cannot authorize another discussion selection');
    const discussion = service.github.discussions[0], root = discussion.comments.find(comment => comment.id === ack.id);
    assert.equal(discussion.comments.filter(comment => comment.body === creation.body).length, 1, 'receipt replay has one external effect');
    const optionalCreation = { type: 'comment', body: 'Confirmed despite an unavailable display field' }, optionalKey = key();
    service.github.fetch = async request => {
        const query = request.method === 'POST' ? (await request.clone().json()).query : '';
        const response = await providerFetch(request);
        if (!query?.startsWith('mutation AddComment')) return response;
        const envelope = await response.json();
        envelope.data.effect.display = null;
        envelope.errors = [{ message: 'A display field could not be returned', path: ['effect', 'display', 'bodyHTML'] }];
        return new Response(JSON.stringify(envelope), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    const optionalAck = await json(await contribute(optionalCreation, cap, optionalKey));
    service.github.fetch = providerFetch;
    assert.equal(optionalAck.patch?.nodes?.[optionalAck.id]?.createdAt, undefined, 'Malformed optional display data is not adopted as canonical content');
    const optionalReplay = await json(await contribute(optionalCreation, cap, optionalKey));
    assert.equal(optionalReplay.id, optionalAck.id, 'An optional field error does not turn a confirmed receipt into uncertainty');
    assert.equal(discussion.comments.filter(comment => comment.body === optionalCreation.body).length, 1, 'Confirmed receipt recovery cannot repeat the independently observed provider effect');
    const reply = await json(await contribute({ type: 'comment', body: 'A native reply', replyToId: ack.id }, cap));
    assert.equal(root.replies.find(comment => comment.id === reply.id)?.body, 'A native reply');
    await json(await contribute({ type: 'edit', id: ack.id, body: 'Revised contribution' }, cap));
    assert.equal(root.body, 'Revised contribution');
    await json(await contribute({ type: 'reaction', subject: { kind: 'comment', id: ack.id }, reaction: 'HEART', selected: true }, cap));
    assert.ok(root.votes.HEART.includes('reader'));
    const moderator = await signIn('maintainer');
    await json(await contribute({ type: 'moderate', id: ack.id, minimized: true, reason: 'OFF_TOPIC' }, moderator));
    assert.equal(root.isMinimized, true);
    await json(await contribute({ type: 'moderate', id: ack.id, minimized: false }, moderator));
    await json(await contribute({ type: 'delete', id: reply.id }, cap));
    assert.equal(root.replies.length, 0);
    const readback = await json(await read('page', { config }, cap));
    assert.equal(readback.window.count.count, discussion.comments.length);
    assert.equal((await json(await read('page', { config, read: { kind: 'selected', ids: [ack.id] } }, cap))).nodes[ack.id].body, 'Revised contribution');
    assert.equal((await json(await read('counts', { repo: config.repo, origin: config.origin, targets: [rootTarget('article'), rootTarget('missing')], fresh: true }))).observations[articleKey].count, discussion.comments.length);
    const prepared = await json(await read('page', { config, read: { kind: 'selected', ids: [ack.id] }, content: 'prepared' }, cap));
    assert.equal(prepared.nodes[ack.id].body, root.body, 'Canonical source arrives without waiting for content preparation');
    assert.equal(prepared.nodes[ack.id].prepared, undefined, 'Reading is independent of interpretation execution');
    const input = { markdown: root.body, purpose: 'comment', repo: config.repo, pageURL: config.pageURL, comment: { id: ack.id, url: root.url, parentId: null } };
    const rendered = await json(await post('content', { config, inputs: [input, { ...input, markdown: 'Failed isolated body' }] }));
    assert.ok(rendered.results[0].prepared.html.includes(root.body), 'Separate native content worker prepares published source');
    assert.ok(rendered.results[1].error, 'One failed body leaves the successful output usable');
    await service.restart();
    await writeConsumer('native-host-2'); await service.restart(entry);
    const revised = await json(await post('content', { config, inputs: [input] }));
    assert.equal(revised.results[0].prepared.revision, 'native-host-2', 'A changed profile cannot reuse obsolete output');
    const previewSource = 'A prepared preview <keeps its source>';
    const preview = await json(await post('content', { config, inputs: [{ markdown: previewSource, purpose: 'preview', repo: config.repo, pageURL: config.pageURL, draft: crypto.randomUUID() }] }));
    assert.ok(preview.results[0].prepared.html.includes('A prepared preview &lt;keeps its source&gt;'), 'Unsigned local preview uses the safe isolated profile');
    const providerPreview = await json(await post('content',{config,content:'github',inputs:[{repo:config.repo,pageURL:config.pageURL,purpose:'preview',markdown:'Public registered preview'}]}));
    assert.ok(providerPreview.results[0].html.includes('Public registered preview'),'Stock interpretation uses registered public access without commenter identity');
    const provider = service.github.fetch;
    const callsBeforeLocal = service.github.calls.length;
    service.github.fetch = async () => { throw new TypeError('Provider unavailable'); };
    try {
      const local = await json(await post('content', { config, inputs: [{ markdown: 'Offline preview', purpose: 'preview', repo: config.repo, pageURL: config.pageURL }] }));
      assert.ok(local.results[0].prepared.html.includes('Offline preview'));
      const offlineReplay = await json(await contribute(creation, cap, submission));
      assert.equal(offlineReplay.id, ack.id, 'Confirmed receipt recovery needs no new provider observation');
      assert.deepEqual(offlineReplay.patch, ack.patch, 'Receipt replay preserves its original observation age');
      await json(await post('logout', { repo: config.repo, origin: config.origin }, moderator));
      assert.equal(service.github.calls.length, callsBeforeLocal, 'Local content, receipt replay and session cleanup do not call the provider');
    } finally { service.github.fetch = provider; }
    let renewalArrived, releaseRenewal;
    const renewalSeen = new Promise(resolve => { renewalArrived = resolve; });
    const renewalHeld = new Promise(resolve => { releaseRenewal = resolve; });
    service.github.fetch = async request => {
      if (new URL(request.url).pathname !== '/login/oauth/access_token') return provider(request);
      const body = await request.clone().text();
      if (new URLSearchParams(body).get('grant_type') === 'refresh_token') { renewalArrived(); await renewalHeld; return provider(request); }
      const response = await provider(request), token = await response.json();
      return Response.json({...token,expires_in:1});
    };
    let renewingRead;
    try {
      const retiring = await signIn('visitor');
      renewingRead = post('access',{config,ids:[]},retiring);
      let timeout;
      try { await Promise.race([renewalSeen,new Promise((_,reject) => { timeout = setTimeout(() => reject(new Error('Provider renewal was not issued for the expiring session')),5000); })]); }
      finally { clearTimeout(timeout); }
      try { await Promise.race([post('logout',{repo:config.repo,origin:config.origin},retiring).then(response => json(response)),new Promise((_,reject) => { timeout = setTimeout(() => reject(new Error('Local logout waited for held provider credential renewal')),3000); })]); }
      finally { clearTimeout(timeout); }
      releaseRenewal();
      await renewingRead;
      assert.equal((await post('session',{repo:config.repo,origin:config.origin},retiring)).status,401,'Late credential renewal cannot revive an explicitly retired local session');
    } finally { releaseRenewal(); await renewingRead?.catch(() => {}); service.github.fetch = provider; }
    let countArrived, releaseCount;
    const countSeen = new Promise(resolve => { countArrived = resolve; }), countHeld = new Promise(resolve => { releaseCount = resolve; });
    service.github.fetch = async request => {
      const query = request.method === 'POST' && new URL(request.url).pathname === '/graphql' ? (await request.clone().json()).query : '';
      const response = await provider(request);
      if (query.startsWith('query CommentCounts')) { countArrived(); await countHeld; }
      return response;
    };
    let delayedCount;
    try {
      delayedCount = read('counts',{...countInput,fresh:true});
      await countSeen;
      const committed = await json(await post('contribute',{config,key:key(),action:{type:'comment',body:'Created during a held count query'}},cap,{'CF-Connecting-IP':'192.0.2.192'}));
      assert.ok(discussion.comments.find(comment => comment.id === committed.id),'The count race contains a real independent provider effect');
      releaseCount(); await json(await delayedCount);
      service.github.fetch = provider;
      const beforeLatest = service.github.calls.length, latestStarted = Date.now();
      const latestCount = await json(await read('counts',countInput,cap));
      assert.equal(latestCount.observations[articleKey].count,discussion.comments.length,'A new uncached count observes the actual provider effect after an older held query');
      assert.equal(service.github.calls.slice(beforeLatest).filter(call=>call.operation==='CommentCounts').length,1,'The uncached count performs its one necessary provider query');
      assert.ok(latestCount.observations[articleKey].observedAt>=latestStarted,'The new provider query carries its actual observation age');
    } finally { releaseCount(); await delayedCount?.catch(() => {}); service.github.fetch = provider; }
    report.checks.push({ workflow: 'authorize a future capability, contribute/replay, edit, reply, react, moderate and remove with independent provider effects', status: 'passed' });
    const uncertain = { type: 'comment', body: 'Committed before the connection was lost' }, uncertainKey = key();
    service.github.failAfterMutation = true;
    assert.equal((await json(await contribute(uncertain, cap, uncertainKey), 502)).error.code, 'WRITE_UNCERTAIN');
    await service.restart();
    assert.equal((await json(await post('access', { config, ids: [] }, cap))).principal.login, 'reader');
    assert.equal((await json(await contribute(uncertain, cap, uncertainKey), 409)).error.code, 'WRITE_UNCERTAIN');
    service.github.setLogin('reader', 'renamed-reader');
    const renamed = cap;
    assert.equal((await json(await post('access', { config, ids: [] }, cap))).principal.login, 'renamed-reader', 'fresh Page display is observed from GitHub without reissuing the capability');
    assert.equal((await json(await contribute(uncertain, renamed, uncertainKey), 409)).error.code, 'WRITE_UNCERTAIN');
    service.github.setLogin('visitor', 'reader');
    const other = await signIn('visitor');
    assert.equal((await json(await contribute(uncertain, other, uncertainKey), 409)).error.code, 'CONFLICT');
    assert.equal(discussion.comments.filter(comment => comment.body === uncertain.body).length, 1);
    // Portable phase uses the extracted public package and real repository effects, without DOM or renderer fixtures.
    const { PageModel } = await import(pathToFileURL(join(packageDirectory, 'dist/browser/model.js')).href);
    let clientIdentity = { capability: renamed, id: 'U_reader' };
    const issuedRequests = [], responseGates = [];
    const holdResponse = (operation, matches) => {
        let arrived, release;
        const seen = new Promise(resolve => { arrived = resolve; }), held = new Promise(resolve => { release = resolve; });
        responseGates.push({ operation, matches, arrived, held });
        return { seen, release };
    };
    const transport = {
        get principal() { return clientIdentity.id; },
        async request(operation, input, _signal, method = 'GET') {
            if (operation === 'contribute') issuedRequests.push(input);
            const response = await (method === 'POST' ? post(operation, input, clientIdentity.capability, { 'CF-Connecting-IP': '192.0.2.191' }) : read(operation, input, clientIdentity.capability));
            const value = await response.json();
            if (!response.ok) throw Object.assign(new Error(value.error.message), value.error, { status: response.status });
            const at = responseGates.findIndex(gate => gate.operation === operation && gate.matches(input));
            if (at !== -1) { const [gate] = responseGates.splice(at, 1); gate.arrived(value); await gate.held; }
            return value;
        },
    };
    while (discussion.comments.length < 40) service.github.addComment(discussion, 'Reading and writing recovery conversation ' + (discussion.comments.length + 1), { author: 'visitor' });
    const clientSelection = { ...config }, client = new PageModel(clientSelection, transport); await client.start(); await client.refreshViewer();
    clientSelection.selector = { kind: 'page', key: 'another-article' }; // A caller can reuse its options without retargeting an acquired discussion.
    await client.loadMore();
    assert.deepEqual(client.document.roots.ids, discussion.comments.slice(0, 40).map(comment => comment.id), 'Two acquired windows expose real provider contribution destinations');
    const heldRoot = holdResponse('contribute', input => input.action.type === 'comment' && input.action.body === 'First independent root');
    const rootA = client.newWriting({ kind: 'comment' }).show(); rootA.update('First independent root');
    const rootB = client.newWriting({ kind: 'comment' }).show(); rootB.update('Second independent root');
    const publishingA = rootA.submit(); await heldRoot.seen;
    const publishingB = await rootB.submit();
    assert.equal(publishingB.status, 'saved', 'An independent root completes while another confirmation is held');
    assert.equal(discussion.comments.filter(comment => ['First independent root', 'Second independent root'].includes(comment.body)).length, 2, 'Independent roots have two actual provider effects');
    heldRoot.release(); assert.equal((await publishingA).status, 'saved');
    const heldReply = holdResponse('contribute', input => input.action.type === 'comment' && input.action.body === 'First independent reply');
    const replyA = client.newWriting({ kind: 'reply', id: first.id }).show(); replyA.update('First independent reply');
    const replyB = client.newWriting({ kind: 'reply', id: first.id }).show(); replyB.update('Second independent reply');
    const replyingA = replyA.submit(); await heldReply.seen;
    assert.equal((await replyB.submit()).status, 'saved', 'Replies to one collection dispatch independently');
    heldReply.release(); assert.equal((await replyingA).status, 'saved');
    assert.equal(first.replies.filter(reply => reply.body.includes('independent reply')).length, 2, 'Independent replies retain their actual intended destination');
    const oldRead = holdResponse('page', input => input.read?.kind === 'observe' && input.read.ids.includes(first.id));
    const freshness = client.revalidate(0, [first.id]); await oldRead.seen;
    const delayedHeart = holdResponse('contribute', input => input.action.type === 'reaction' && input.action.reaction === 'HEART');
    const heart = client.setReaction(first.id, 'HEART', true); await delayedHeart.seen;
    await client.setReaction(first.id, 'ROCKET', true);
    assert.equal(first.votes.ROCKET.includes('reader'), true, 'An independent reaction reaches the provider while another response is held');
    assert.equal(client.reaction(first.id, 'ROCKET').confirmed.selected, true);
    const latestHeart = client.setReaction(first.id, 'HEART', false);
    assert.equal(client.reaction(first.id, 'HEART').selected, false, 'A rapid choice projects the newest intent while its earlier acknowledgement is delayed');
    delayedHeart.release(); await Promise.all([heart, latestHeart]);
    oldRead.release(); await freshness;
    assert.equal(first.votes.HEART.includes('reader'), false, 'The provider reaches the latest requested reaction state');
    assert.equal(client.reaction(first.id, 'HEART').confirmed.selected, false, 'A delayed reaction receipt cannot replace the newer desired state');
    assert.equal(client.reaction(first.id, 'ROCKET').confirmed.selected, true, 'Another reaction and an older full read cannot erase a newer confirmed group');
    const oldIdentityRead = holdResponse('page', input => input.read?.kind === 'observe' && input.read.ids.includes(first.id));
    const previousReading = client.revalidate(0, [first.id]); await oldIdentityRead.seen;
    const oldAuthorEffect = holdResponse('contribute', input => input.action.type === 'reaction' && input.action.reaction === 'EYES');
    const previousAuthor = client.setReaction(first.id, 'EYES', true); await oldAuthorEffect.seen;
    const publicRoots = [...client.document.roots.ids], publicBody = client.document.nodes[first.id];
    clientIdentity = { capability: other, id: 'U_visitor' }; client.changeIdentity();
    assert.deepEqual(client.document.roots.ids, publicRoots, 'Account retirement retains accumulated public reading');
    assert.equal(client.document.nodes[first.id], publicBody, 'Account retirement keeps public content identity');
    assert.equal(client.viewer, null, 'Account retirement removes previous authority immediately');
    await client.refreshViewer();
    oldAuthorEffect.release(); oldIdentityRead.release(); await Promise.allSettled([previousAuthor, previousReading]);
    assert.equal(client.viewer.principal.id, 'U_visitor', 'An old reading response cannot restore the previous account');
    assert.equal(client.reaction(first.id, 'EYES').selected, false, 'An old author receipt cannot project that author selection into the current account');
    assert.equal(first.votes.EYES.includes('reader'), true, 'Retiring a client account does not undo its already committed provider effect');
    clientIdentity = { capability: renamed, id: 'U_reader' }; client.changeIdentity(); await client.refreshViewer(); await client.loadMore();
    assert.equal(client.reaction(first.id, 'EYES').confirmed.selected, true, 'The original author can observe the confirmed provider state again');
    const providerClock = service.github.now, publicationTime = Math.floor(Date.now() / 1000) * 1000;
    const delayedCreation = holdResponse('contribute', input => input.action.type === 'comment' && input.action.body === 'Original delayed publication' && !input.action.replyToId);
    service.github.now = () => publicationTime;
    try {
        const publication = client.writing().show(); publication.update('Original delayed publication');
        const publishing = publication.submit(), creationReceipt = await delayedCreation.seen;
        await json(await contribute({ type: 'edit', id: creationReceipt.id, body: 'Newer canonical publication' }, renamed));
        await json(await contribute({ type: 'reaction', subject: { kind: 'comment', id: creationReceipt.id }, reaction: 'HEART', selected: true }, renamed));
        await json(await post('contribute', { config, key: key(), action: { type: 'comment', body: 'Another author contribution while publication delivery is delayed' } }, other, { 'CF-Connecting-IP': '192.0.2.190' }));
        await client.restart(); await client.loadMore(); await client.loadMore(); await client.refreshViewer();
        const canonical = discussion.comments.find(comment => comment.id === creationReceipt.id);
        assert.equal(canonical.createdAt, canonical.lastEditedAt, 'The independent provider can edit a contribution within its timestamp resolution');
        assert.equal(client.document.nodes[creationReceipt.id].body, canonical.body, 'Fresh reading observes the provider edit before the older creation receipt is delivered');
        assert.equal(client.reaction(creationReceipt.id, 'HEART').confirmed.selected, true);
        assert.equal(client.document.roots.count.count, discussion.comments.length, 'Fresh reading observes contributions made after the held receipt');
        delayedCreation.release(); assert.equal((await publishing).status, 'saved');
        const current = await json(await read('page', { config, read: { kind: 'observe', ids: [creationReceipt.id] } }, renamed));
        assert.equal(client.document.nodes[creationReceipt.id].body, current.nodes[creationReceipt.id].body, 'A late creation receipt cannot replace already observed canonical writing');
        assert.equal(client.reaction(creationReceipt.id, 'HEART').confirmed.selected, true, 'Creation acknowledgement cannot erase a subsequently observed reaction');
        assert.equal(client.document.roots.count.count, current.window.count.count, 'Creation acknowledgement cannot reduce the established contribution total');
    }
    finally { delayedCreation.release(); service.github.now = providerClock; }
    const retainedWriting = new Map(client.document.roots.ids.filter(id => id !== ack.id).map((id, index) => [id, 'My retained reply for conversation ' + (index + 1)]));
    for (const [id, text] of retainedWriting) client.writing({ kind: 'reply', id }).show().update(text);
    const writing = client.writing({ kind: 'reply', id: ack.id }).show();
    writing.update('Recovered reply belongs to the immutable original author');
    const writingIssuanceStart = issuedRequests.length;
    service.github.failAfterMutation = true;
    assert.equal((await writing.submit()).status, 'failed');
    assert.equal(writing.error.status, 'uncertain');
    writing.hide(); const savedWriting = client.saveWriting(); client.lifetime.abort();
    const restored = new PageModel(config, transport); restored.recoverWriting(savedWriting.records, savedWriting.selected); await restored.start(); await restored.refreshViewer();
    for (const [id, text] of retainedWriting) {
        const retained = restored.writing({ kind: 'reply', id });
        assert.equal(retained.text, text, 'Reload retains each authored reply across both loaded windows');
        assert.deepEqual(retained.target, { kind: 'reply', id }, 'Reload retains each real contribution destination');
        assert.equal(retained.protected, false, 'Ordinary writing remains editable alongside an unresolved submission');
    }
    const recovered = restored.writing({ kind: 'reply', id: ack.id });
    assert.equal(recovered.text, 'Recovered reply belongs to the immutable original author');
    assert.deepEqual(recovered.target, { kind: 'reply', id: ack.id });
    assert.equal((await recovered.submit()).status, 'blocked', 'Restored closed writing remains closed');
    recovered.show(); clientIdentity = { capability: other, id: 'U_visitor' };
    const beforeAccountRefresh = issuedRequests.length;
    assert.equal((await recovered.submit()).status, 'blocked', 'Current authentication governs protected writing before the older display profile is refreshed');
    assert.equal(issuedRequests.length, beforeAccountRefresh, 'A stale author label cannot issue another author recovery request');
    restored.changeIdentity(); await restored.refreshViewer();
    assert.equal((await recovered.submit()).status, 'blocked', 'An account with the former author login cannot recover that author writing');
    assert.equal(recovered.actions.clear, false, 'Changing accounts cannot discard an unresolved issuance');
    clientIdentity = { capability: renamed, id: 'U_reader' }; restored.changeIdentity(); await restored.refreshViewer();
    assert.equal(recovered.actions.retry, true, 'The renamed original author can recover writing');
    await recovered.submit();
    assert.equal(recovered.error.status, 'uncertain', 'An ambiguous provider receipt stays visible through recovery');
    assert.deepEqual(issuedRequests.at(-1).action, { type: 'comment', body: 'Recovered reply belongs to the immutable original author', replyToId: ack.id }, 'Restored uncertainty retries the exact authored body and intended destination');
    assert.equal(issuedRequests.at(-1).key, issuedRequests[writingIssuanceStart].key, 'Restored writing retains the original receipt identity');
    assert.equal(root.replies.filter(reply => reply.body === recovered.text).length, 1, 'Client recovery never changes a reply into a root or duplicates its provider effect');
    assert.equal(discussion.comments.some(comment => comment.body === recovered.text), false);
    assert.equal(recovered.abandon(), true, 'The original author can explicitly reconcile an unresolved submission');
    assert.equal(recovered.target.id, ack.id); assert.equal(recovered.actions.edit, true);
    service.github.failAfterMutation = true;
    await restored.setReaction(first.id, 'LAUGH', true).catch(() => {});
    const reactionIssuance = issuedRequests.at(-1);
    assert.equal(restored.reaction(first.id, 'LAUGH').recovery.status, 'uncertain');
    clientIdentity = { capability: 'x'.repeat(43), id: 'U_reader' };
    await restored.retryReaction(first.id, 'LAUGH').catch(() => {});
    assert.equal(restored.reaction(first.id, 'LAUGH').recovery.status, 'uncertain', 'Rejected recovery cannot erase an earlier uncertain effect');
    const recoveryRequests = issuedRequests.length;
    clientIdentity = { capability: other, id: 'U_visitor' }; restored.changeIdentity(); await restored.refreshViewer();
    await restored.retryReaction(first.id, 'LAUGH').catch(() => {});
    assert.equal(issuedRequests.length, recoveryRequests, 'Another account cannot issue recovery work');
    clientIdentity = { capability: renamed, id: 'U_reader' }; restored.changeIdentity(); await restored.refreshViewer();
    await restored.retryReaction(first.id, 'LAUGH').catch(() => {});
    assert.deepEqual(issuedRequests.at(-1).action, reactionIssuance.action);
    assert.equal(issuedRequests.at(-1).key, reactionIssuance.key, 'Action recovery preserves the original effect identity');
    assert.equal(first.votes.LAUGH.filter(principal => principal === 'reader').length, 1, 'Uncertain action recovery has one independently observed provider effect');
    assert.equal(restored.abandonReaction(first.id, 'LAUGH'), true);
    assert.equal(first.votes.LAUGH.includes('reader'), true, 'Deliberate abandonment releases local recovery without reversing the external effect');
    const dispatchWriting = restored.newWriting({kind:'comment'}).show();
    dispatchWriting.update('An author change before dispatch must not transfer writing');
    const beforeDispatch = discussion.comments.length, dispatchRequests = issuedRequests.length;
    const queuedWriting = dispatchWriting.submit();
    clientIdentity = {capability:other,id:'U_visitor'}; restored.changeIdentity();
    const declined = await queuedWriting;
    assert.equal(declined.status,'failed');
    assert.equal(declined.error.status,'failed','An unissued author transition is editable failure, not ambiguous provider effect');
    assert.equal(issuedRequests.length,dispatchRequests,'Retired author work cannot dispatch under the next account');
    assert.equal(discussion.comments.length,beforeDispatch,'No external contribution is issued by a replacement author');
    clientIdentity = {capability:renamed,id:'U_reader'}; restored.changeIdentity(); await restored.refreshViewer();
    await restored.loadMore(); await restored.loadReplies(ack.id); await restored.refreshViewer();
    const retainedReplies = root.replies.map(reply => reply.id);
    assert.ok(retainedReplies.length > 0, 'The independently committed unresolved reply remains on its real parent');
    assert.deepEqual(restored.document.replies[ack.id].ids, retainedReplies,'Reply traversal is acquired before deletion: '+JSON.stringify(restored.document.replies[ack.id]));
    const deletion = await restored.removeComment(ack.id);
    assert.ok(root.deletedAt && root.replies.length === retainedReplies.length, 'Deleting a root with replies leaves its actual provider tombstone and descendants');
    assert.ok(restored.document.roots.ids.includes(ack.id) && restored.document.nodes[ack.id].deletedAt, 'Canonical deletion preserves the reading parent when provider descendants remain: '+JSON.stringify({member:restored.document.roots.ids.includes(ack.id),node:restored.document.nodes[ack.id],replies:restored.document.replies[ack.id],patch:deletion.patch}));
    assert.deepEqual(restored.document.replies[ack.id].ids, retainedReplies, 'Root deletion does not discard accepted reply membership');
    assert.equal(restored.document.nodes[ack.id].body, '', 'A later provider tombstone clears an edited body without inventing an older revision');
    restored.lifetime.abort();
    report.checks.push({ workflow: 'real client preserves independent reactions and accepted same-second edits/counts across delayed receipts, and retains all authored reply targets/immutable author/issued identity through dismissal, reload, account collision and uncertain recovery', status: 'passed' });
    const disappearing = service.github.addThread('disappearing');
    await json(await read('counts', { repo: config.repo, origin: config.origin, targets: [rootTarget('disappearing')], fresh: true }));
    service.github.discussions = service.github.discussions.filter(thread => thread !== disappearing);
    const partialCounts = await json(await read('counts', { repo: config.repo, origin: config.origin, targets: [rootTarget('article'), rootTarget('disappearing')], fresh: true }));
    assert.equal(partialCounts.observations[articleKey].count, discussion.comments.length, 'An unavailable selection does not discard independently acquired counts');
    assert.equal(partialCounts.observations[disappearingKey], undefined, 'Unavailable mapped discussions cannot fabricate a zero observation');
    assert.equal(partialCounts.errors[disappearingKey].code, 'NOT_FOUND');
    await json(await post('logout', { repo: config.repo, origin: config.origin }, renamed));
    assert.equal((await post('access', { config, ids: [] }, renamed)).status, 401);
    report.checks.push({ workflow: 'ambiguous remote commit survives native restart and account rename without replay or ownership transfer; logout revokes', status: 'passed' });
    const open = await nativeService({origin,blog,entry,contentEntry,repositories:{},openHosting:{origins:[blog],category:'Announcements'}});
    try {
      const call = (name,input,cap='',method='POST') => open.fetch(origin+'/api/v6/'+name+(method==='GET'?'?'+new URLSearchParams({input:JSON.stringify(input)}):''),{method,headers:{Origin:origin,...(method==='POST'?{'Content-Type':'application/json'}:{}),...(cap?{Authorization:'Bearer '+cap}:{})},...(method==='POST'?{body:JSON.stringify(input)}:{})});
      assert.equal((await call('counts',{repo:config.repo,origin:blog,targets:[rootTarget('article')]},'','GET')).status,403,'Open hosting requires a service-issued repository registration');
      assert.equal(open.github.calls.length,0,'Unknown open-hosting requests cannot initiate provider discovery');
      const registered = await json(await call('registration',{repo:config.repo,origin:blog,category:'Announcements'}));
      assert.ok(registered.registration);
      const registeredConfig = {...config,registration:registered.registration};
      const openCap = random(), openProof = hash(openCap);
      const prepared = await call('auth/prepare',{repo:config.repo,origin:blog,returnURL:config.returnURL,registration:registered.registration,proof:openProof,mode:'popup',openerOrigin:origin});
      const cookie = prepared.headers.get('Set-Cookie').split(';')[0], authorization = new URL((await json(prepared)).authorizeURL);
      const callback = await open.fetch(origin+'/auth/callback?'+new URLSearchParams({state:authorization.searchParams.get('state'),code:'fixture_'+authorization.searchParams.get('code_challenge')}),{headers:{Cookie:cookie},redirect:'manual'});
      assert.equal(callback.status,200,await callback.text());
      assert.equal((await json(await call('session',{repo:config.repo,origin:blog,registration:registered.registration},openCap))).principal,'U_reader','Registered routing survives the complete open-hosting authorization return');
      const creation = await json(await call('contribute',{config:registeredConfig,key:key(),action:{type:'comment',body:'An open-hosted contribution'}},openCap));
      assert.equal(open.github.discussions[0].comments.find(comment=>comment.id===creation.id).authorPrincipal,'reader');
      const preview = await json(await call('content',{config:registeredConfig,content:'prepared',inputs:[{repo:config.repo,pageURL:config.pageURL,purpose:'preview',markdown:'Open-hosted local preview'}]}));
      assert.ok(preview.results[0].prepared.html.includes('Open-hosted local preview'));
      const openProvider = open.github.fetch;
      open.github.fetch = async request => {
        const query = request.method === 'POST' && new URL(request.url).pathname === '/graphql' ? (await request.clone().json()).query : '';
        return query.startsWith('query ViewerAccess') ? Response.json({message:'Provider authorization revoked'},{status:401}) : openProvider(request);
      };
      try { assert.equal((await json(await call('access',{config:registeredConfig,ids:[]},openCap),401)).error.code,'GITHUB_AUTH'); }
      finally { open.github.fetch = openProvider; }
      const reconnect = await json(await call('session',{repo:config.repo,origin:blog,registration:registered.registration},openCap));
      assert.equal(reconnect.principal,'U_reader','Revoked provider access retains the verified author of protected writing');
      assert.equal(reconnect.needsAuthorization,true,'Reload exposes reconnect eligibility instead of silently treating retired provider access as usable');
      await json(await call('logout',{repo:config.repo,origin:blog,registration:registered.registration},openCap));
      assert.equal((await call('access',{config:registeredConfig,ids:[]},openCap)).status,401,'Open-hosted logout cleans the same registered actor');
    } finally { await open.dispose(); }
    report.checks.push({workflow:'open-hosting explicit registration, authorization return, verified identity, contribution, local preview and cleanup through the actual Worker',status:'passed'});
    report.status = 'passed';
}
catch (error) {
    report.status = 'failed';
    report.details = error.stack || String(error);
    process.exitCode = 1;
    console.error(report.details);
}
finally {
    await service.dispose();
    await rm(consumer, { recursive: true, force: true });
    report.completedAt = new Date().toISOString();
    await mkdir('test-results/evidence', { recursive: true });
    await writeFile('test-results/evidence/native-runtime.json', JSON.stringify(report, null, 2) + '\n');
}
