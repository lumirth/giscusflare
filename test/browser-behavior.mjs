import assert from 'node:assert/strict';

async function cachedIdentityBehavior({ browser, service, blog, report, capability }) {
  const { expect } = await import(process.env.PLAYWRIGHT_MODULE || '@playwright/test');
  for (const mode of ['native', 'iframe']) for (const ordering of ['access-first', 'session-first']) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage(), errors = [], holds = [], accountObservations = [];
    const clientIP = '192.0.2.' + ((browser.browserType().name() === 'chromium' ? 182 : 186) + (mode === 'iframe' ? 2 : 0) + (ordering === 'session-first' ? 1 : 0));
    let returningCapability;
    await context.route(service + '/api/v7/**', route => route.continue({ headers: { ...route.request().headers(), 'CF-Connecting-IP': clientIP } }));
    await context.route(service + '/auth/**', route => route.continue({ headers: { ...route.request().headers(), 'CF-Connecting-IP': clientIP } }));
    await context.route(service + '/__demo/authorize?*', route => route.continue({ headers: { ...route.request().headers(), 'CF-Connecting-IP': clientIP } }));
    await context.addInitScript(() => {
      window.cachedIdentityInitializations = [];
      window.cachedIdentityMessages = [];
      window.addEventListener('message', event => {
        const message = event.data?.giscus, init = message?.init;
        if (init) window.cachedIdentityMessages.push({ at: Date.now(), init: { hasSession: Object.hasOwn(init, 'session'), signedIn: Boolean(init.session), handoff: Boolean(init.handoff), display: init.displayProfile?.profile?.login ?? null } });
        if (typeof message?.session === 'string') window.cachedIdentityMessages.push({ at: Date.now(), savedSession: Boolean(message.session) });
        if (event.source === parent && init && Object.hasOwn(init, 'displayProfile')) window.cachedIdentityInitializations.push(init.displayProfile?.profile?.login ?? null);
      });
      window.cachedIdentityMetadata = [];
      document.addEventListener('giscus', event => { if (Object.hasOwn(event.detail, 'viewer')) window.cachedIdentityMetadata.push(event.detail.viewer?.login ?? null); }, true);
    });
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => {
      const path = new URL(request.url()).pathname;
      if (path === '/api/v7/session') returningCapability = request.headers().authorization?.slice(7);
      if (['session', 'access', 'identity', 'logout', 'auth/prepare'].some(operation => path === '/api/v7/' + operation)) accountObservations.push({ path, request: true, authenticated: Boolean(request.headers().authorization) });
    });
    page.on('response', response => { const path = new URL(response.url()).pathname;if (['session', 'access', 'identity', 'logout', 'auth/prepare'].some(operation => path === '/api/v7/' + operation)) accountObservations.push({ path, status: response.status() }); });
    const hold = async (pattern, failure = '') => {
      let release;
      const gate = new Promise(resolve => { release = resolve; });
      const held = { arrived: 0, release };holds.push(held);
      await context.route(service + pattern, async route => {
        const response = await route.fetch({ headers: { ...route.request().headers(), 'CF-Connecting-IP': clientIP } });
        assert.equal(response.ok(), true, 'The held account/public observation comes from the real local service');
        held.arrived++;await gate;
        if (failure) await route.fulfill({ status: 503, contentType: 'application/json', json: { error: { message: failure, code: 'UNAVAILABLE' } } });
        else await route.fulfill({ response });
      });
      return held;
    };
    const nativeName = async () => page.evaluate(() => {
      const owner = window.demoComments.conversation;
      const output = document.createElement('output');output.id = 'cached-account-name';document.body.append(output);
      const draw = () => { output.textContent = owner.session.displayProfile?.login ?? 'Guest'; };
      owner.own(owner.subscribe(draw));draw();
    });
    try {
      const path = mode === 'native' ? '/native' : '/article';
      await page.goto(blog + path);
      const surface = mode === 'native' ? page : page.frameLocator('iframe.giscus-frame');
      const composer = surface.locator('[data-composer="main"]');
      await composer.getByRole('button', { name: 'Sign in with GitHub', exact: true }).click();
      await composer.getByRole('button', { name: 'Sign out', exact: true }).waitFor();
      if (mode === 'native') await expect.poll(() => page.evaluate(() => window.demoComments.conversation.session.viewer?.login)).toBe('reader');
      else await expect.poll(() => page.evaluate(() => window.cachedIdentityMetadata.includes('reader'))).toBe(true);
      await expect.poll(() => Boolean(returningCapability)).toBe(true);
      await surface.getByText('Try posting a comment or replying here.', { exact: true }).waitFor();
      const session = await hold('/api/v7/session', ordering === 'access-first' ? 'Session profile temporarily unavailable' : '');
      const access = await hold('/api/v7/access', ordering === 'session-first' ? 'Account observation temporarily unavailable' : '');
      const publicPage = mode === 'native' ? await hold('/api/v7/page?*') : undefined;
      await page.reload();
      if (mode === 'native') await nativeName();
      await expect.poll(() => session.arrived).toBeGreaterThan(0);
      if (publicPage) {
        await expect.poll(() => publicPage.arrived).toBeGreaterThan(0);
        assert.equal(access.arrived, 0, 'Account startup waits for a public target, not an unverified cached identity');
        publicPage.release();
      }
      await surface.getByText('Try posting a comment or replying here.', { exact: true }).waitFor();
      await expect.poll(() => access.arrived, { message: mode + ' access starts while session proof is held' }).toBeGreaterThan(0);
      if (mode === 'native') {
        await expect(page.locator('#cached-account-name')).toHaveText('reader');
        assert.deepEqual(await page.evaluate(() => {
          const owner = window.demoComments.conversation;
          return { principal: owner.session.principal, profile: owner.session.viewer, account: owner.viewer, composition: owner.composition.status };
        }), { principal: null, profile: null, account: null, composition: 'sign-in' }, 'Cached display identity provides no principal, verified viewer or account permissions');
      } else {
        await expect.poll(() => surface.locator('.giscusflare').evaluate(() => window.cachedIdentityInitializations.includes('reader'))).toBe(true);
        assert.equal(await page.evaluate(() => window.cachedIdentityMetadata.some(login => login !== null)), false, 'Iframe cached display initialization never publishes a verified viewer');
      }
      await composer.locator('textarea').fill('Cached identity cannot authorize this writing');
      await expect(composer.locator('button[type="submit"]')).toBeDisabled();
      const reading = await surface.getByRole('article').evaluateAll(nodes => nodes.map(node => ({ id: node.id, text: node.querySelector('.gsc-comment-content,.gsc-reply-content')?.textContent, hidden: node.hidden })));
      if (ordering === 'access-first') {
        access.release();
        await expect(composer.locator('button[type="submit"]')).toBeEnabled();
        if (mode === 'native') {
          assert.equal(await page.evaluate(() => Boolean(window.demoComments.conversation.session.principal && window.demoComments.conversation.viewer)), true, 'Access independently establishes principal and account facts');
          assert.equal(await page.evaluate(() => window.demoComments.conversation.session.viewer), null, 'Access proof alone cannot verify the cached display profile');
        } else assert.equal(await page.evaluate(() => window.cachedIdentityMetadata.some(login => login !== null)), false, 'Access-first iframe metadata still has no verified display profile');
        session.release();
        await expect(surface.getByRole('alert').filter({ hasText: 'Session profile temporarily unavailable' }).first()).toBeVisible();
        await expect(composer.locator('button[type="submit"]')).toBeEnabled();
        if (mode === 'native') await expect(page.locator('#cached-account-name')).toHaveText('reader');
      } else {
        session.release();
        if (mode === 'native') {
          await expect.poll(() => page.evaluate(() => window.demoComments.conversation.session.viewer?.login)).toBe('reader');
          assert.equal(await page.evaluate(() => window.demoComments.conversation.viewer), null, 'Session-first display proof cannot manufacture held account permissions');
        } else await expect.poll(() => page.evaluate(() => window.cachedIdentityMetadata.includes('reader'))).toBe(true);
        access.release();
        await expect(surface.getByRole('alert').filter({ hasText: 'Account observation temporarily unavailable' }).first()).toBeVisible();
      }
      assert.deepEqual(await surface.getByRole('article').evaluateAll(nodes => nodes.map(node => ({ id: node.id, text: node.querySelector('.gsc-comment-content,.gsc-reply-content')?.textContent, hidden: node.hidden }))), reading, 'Independent session/account failure preserves every readable public comment and its position');
      assert.equal(await composer.locator('textarea').inputValue(), 'Cached identity cannot authorize this writing', 'Independent account failure preserves native writing');
      for (const held of holds) held.release();
      await context.unroute(service + '/api/v7/session');
      await context.unroute(service + '/api/v7/access');
      if (publicPage) await context.unroute(service + '/api/v7/page?*');
      if (mode === 'native' && ordering === 'session-first') await retiredIdentityBehavior({ page, context, service, capability, returningCapability, expect, clientIP });
      else await Promise.all([page.waitForResponse(response => new URL(response.url()).pathname === '/api/v7/logout'), composer.getByRole('button', { name: 'Sign out', exact: true }).click()]);
      await composer.getByRole('button', { name: 'Sign in with GitHub', exact: true }).waitFor();
      await page.reload();
      if (mode === 'native') { await nativeName();await expect(page.locator('#cached-account-name')).toHaveText('Guest'); }
      else {
        await composer.getByRole('button', { name: 'Sign in with GitHub', exact: true }).waitFor();
        assert.equal(await surface.locator('.giscusflare').evaluate(() => window.cachedIdentityInitializations.includes('reader')), false, 'Iframe sign-out remount cannot revive the retired cached name');
      }
      assert.deepEqual(errors, [], 'Controlled cached identity page errors');
      report.checks.push({ engine: browser.browserType().name(), workflow: mode + ' cached identity without authority, ' + ordering + ' startup and public failure isolation', status: 'passed' });
      console.log('PASS', browser.browserType().name(), mode, 'cached identity', ordering);
    } catch (error) {
      const surface = mode === 'native' ? page : page.frameLocator('iframe.giscus-frame');
      console.error(JSON.stringify({ engine: browser.browserType().name(), mode, ordering, accountObservations,
        host: await page.evaluate(() => ({ metadata: window.cachedIdentityMetadata, hints: window.cachedIdentityInitializations, messages: window.cachedIdentityMessages })).catch(() => null),
        surface: await surface.locator('.giscusflare').evaluate(element => ({ alerts: [...element.querySelectorAll('[role="alert"]')].map(alert => alert.textContent), placeholder: element.querySelector('textarea')?.placeholder, disabled: element.querySelector('textarea')?.disabled, hints: window.cachedIdentityInitializations, messages: window.cachedIdentityMessages })).catch(() => null) }, null, 2));
      throw error;
    } finally {
      for (const held of holds) held.release();
      await context.close();
    }
  }
}

async function retiredIdentityBehavior({ page, context, service, capability, returningCapability, expect, clientIP }) {
  const held = [], saves = [];
  for (const operation of ['session', 'access']) await context.route(service + '/api/v7/' + operation, async route => {
    const response = await route.fetch({ headers: { ...route.request().headers(), 'CF-Connecting-IP': clientIP } });
    assert.equal(response.ok(), true, 'Retirement exercises real successful identity/account observations');
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const observation = { old: route.request().headers().authorization === 'Bearer ' + capability, release, completed: false };held.push(observation);
    await gate;await route.fulfill({ response });observation.completed = true;
  });
  await page.exposeFunction('retainedIdentityProfile', login => { saves.push(login); });
  try {
    await page.evaluate(async ({ capability, returningCapability }) => {
      const mounted = window.demoComments, owner = mounted.conversation;
      const output = document.createElement('output');output.id = 'retired-account-name';document.body.append(output);
      const remember = owner.session.host.saveDisplayProfile;
      owner.session.host.saveDisplayProfile = (fingerprint, profile) => { void window.retainedIdentityProfile(profile.login);return remember?.(fingerprint, profile); };
      const draw = () => { output.textContent = owner.session.displayProfile?.login ?? 'Guest'; };
      owner.own(owner.subscribe(draw));
      const hint = async (token, login) => ({ fingerprint: btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''), profile: { login, url: 'https://github.com/reader', avatarUrl: '' } });
      const oldHint = await hint(capability, 'Old cached identity'), newHint = await hint(returningCapability, 'New cached identity');
      owner.initialize({ session: capability, displayProfile: oldHint });draw();
      window.retiredIdentity = { owner, oldHint, newHint };
    }, { capability, returningCapability });
    await expect.poll(() => held.filter(value => value.old).length).toBe(2);
    await page.getByText('Try posting a comment or replying here.', { exact: true }).waitFor();
    const reading = await page.getByRole('article').evaluateAll(nodes => nodes.map(node => ({ id: node.id, text: node.querySelector('.gsc-comment-content,.gsc-reply-content')?.textContent, hidden: node.hidden })));
    await page.evaluate(returningCapability => { const { owner, newHint } = window.retiredIdentity;owner.initialize({ session: returningCapability, displayProfile: newHint }); }, returningCapability);
    await expect.poll(() => held.filter(value => !value.old).length).toBe(2);
    await expect(page.locator('#retired-account-name')).toHaveText('New cached identity');
    await page.evaluate(async () => { const { owner, oldHint } = window.retiredIdentity;owner.initialize({ displayProfile: oldHint });await owner.session.restoreDisplayProfile(oldHint); });
    for (const observation of held.filter(value => value.old)) observation.release();
    await expect.poll(() => held.filter(value => value.old).every(value => value.completed)).toBe(true);
    await expect(page.locator('#retired-account-name')).toHaveText('New cached identity');
    assert.deepEqual(await page.evaluate(() => { const { owner } = window.retiredIdentity;return { principal: owner.session.principal, profile: owner.session.viewer, account: owner.viewer }; }), { principal: null, profile: null, account: null }, 'Late session/access from the former identity cannot prove or grant access to the new identity');
    assert.deepEqual(saves, [], 'Late former-identity profile cannot reach the host cache');
    await page.evaluate(() => window.retiredIdentity.owner.session.signOut());
    for (const observation of held.filter(value => !value.old)) observation.release();
    await expect.poll(() => held.every(value => value.completed)).toBe(true);
    await expect(page.locator('#retired-account-name')).toHaveText('Guest');
    assert.deepEqual(await page.evaluate(() => { const { owner } = window.retiredIdentity;return { signedIn: owner.session.signedIn, principal: owner.session.principal, profile: owner.session.viewer, account: owner.viewer }; }), { signedIn: false, principal: null, profile: null, account: null }, 'Late successful session/access cannot revive a signed-out identity');
    assert.deepEqual(saves, [], 'Late signed-out profile cannot repopulate the host cache');
    assert.deepEqual(await page.getByRole('article').evaluateAll(nodes => nodes.map(node => ({ id: node.id, text: node.querySelector('.gsc-comment-content,.gsc-reply-content')?.textContent, hidden: node.hidden }))), reading, 'Identity switching and sign-out preserve every readable public comment and its position');
  } finally {
    for (const observation of held) observation.release();
    await context.unroute(service + '/api/v7/session');
    await context.unroute(service + '/api/v7/access');
  }
}

/** Custom consumers and content run against the same native service as the embedding journey. */
export async function browserBehavior({ browser, service, blog, report, capability }) {
  await cachedIdentityBehavior({ browser, service, blog, report, capability });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.context().route(service + '/api/v7/**', route => route.continue({headers:{...route.request().headers(),'CF-Connecting-IP':browser.browserType().name()==='chromium'?'192.0.2.180':'192.0.2.181'}}));
  const errors = [], providerPreviews = [], contentReads = [], countReads = [];
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.pathname === '/api/v7/content' && request.method() === 'POST' && request.postDataJSON().inputs?.some(input => input.purpose === 'preview')) providerPreviews.push(url.href);
    if (url.pathname === '/api/v7/page') contentReads.push(JSON.parse(url.searchParams.get('input')));
    if (url.pathname.endsWith('/counts')) countReads.push(url.href);
  });
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(blog + '/__behavior');
    let headerArrived, releaseHeader;
    const headerSeen = new Promise(resolve => {headerArrived=resolve;}), headerHeld = new Promise(resolve => {releaseHeader=resolve;});
    await page.context().route(service + '/api/v7/page?*', async route => { const response=await route.fetch();headerArrived();await headerHeld;await route.fulfill({response}); });
    await page.evaluate(async ({service,blog,capability}) => {
      const {mountComments} = await import(service + '/native.js');
      const style=document.createElement('link');style.rel='stylesheet';style.href=service+'/native.css?v=7';document.head.append(style);
      await new Promise((resolve,reject)=>{style.onload=resolve;style.onerror=reject;});
      const target=document.createElement('div');target.id='cold-standard';document.body.append(target);
      window.coldStandard=mountComments(target,{service,page:{repo:'example/comments',origin:blog,pageURL:blog+'/cold-header',returnURL:blog+'/cold-header',selector:{kind:'page',key:'Cold header target'}}});
      window.coldStandard.conversation.initialize({session:capability});
    }, {service,blog,capability});
    await headerSeen;
    const coldHeader = page.locator('#cold-standard .gsc-header');
    const headerTop = (await coldHeader.boundingBox()).y;
    assert.equal(await coldHeader.evaluate(e=>Boolean(e.compareDocumentPosition(e.parentElement.querySelector('.gsc-loading'))&Node.DOCUMENT_POSITION_FOLLOWING)),true,'The pending reading indication follows the persistent header');
    const coldTextarea=page.locator('#cold-standard textarea');await coldTextarea.click();await page.keyboard.type('Draft while public reading waits');
    releaseHeader();
    await page.locator('#cold-standard .gsc-loading').waitFor({state:'detached'});
    assert.equal(await page.evaluate(()=>window.coldStandard.conversation.ready && window.coldStandard.conversation.document.roots.count.count===0),true,'Held public acquisition completes with the independently known empty target');
    assert.equal((await coldHeader.boundingBox()).y,headerTop,'Removing the reading loader does not displace the persistent header');
    assert.equal(await coldTextarea.inputValue(),'Draft while public reading waits','Initial reading publication retains native writing');
    await page.evaluate(()=>{window.coldStandard.dispose();document.getElementById('cold-standard').remove();});
    await page.context().unroute(service + '/api/v7/page?*');
    contentReads.length=0;
    await page.evaluate(async ({ service, blog, capability }) => {
      const api = await import(service + '/headless.js');
      const { mountContent, browserContent, preparedHTML } = await import(service + '/content.js');
      const { githubContent } = await import(service + '/github-content.js');
      const { forumPresentation } = await import(service + '/forum-example.js');
      const check = (condition, message) => { if (!condition) throw new Error(message); };
      const until = async condition => {
        const deadline = Date.now() + 5000;
        while (!condition()) {
          check(Date.now() < deadline, 'Browser work did not settle within five seconds');
          await new Promise(resolve => setTimeout(resolve, 0));
        }
      };
      const lifetime = new AbortController();
      const contentHost = document.createElement('div');
      contentHost.className = 'article-content';
      document.body.append(contentHost);
      const content = async (html, options = {}) => {
        const node = document.createElement('div');
        node.className = 'markdown';
        contentHost.append(node);
        await mountContent(node, githubContent(options), { signal: lifetime.signal }).update({ markdown: 'Original source', html, repo: 'example/comments', pageURL: blog + '/article', purpose: 'comment' }).catch(() => {});
        return node;
      };
      const rich = await content('<script>window.executed=true</script><img onerror="window.executed=true" src="data:x"><a href="javascript:alert(1)">bad</a><table><tr><td rowspan="2">cell</td></tr></table><input type="checkbox" checked>');
      check(!window.executed && !rich.querySelector('script,[onerror],[onclick]'), 'Rich content cannot execute scripts or event handlers');
      check(!rich.querySelector('a').hasAttribute('href'), 'Executable links are inert');
      check(rich.querySelector('td').rowSpan === 2 && rich.querySelector('input').checked && rich.querySelector('input').disabled, 'Useful table and task-list semantics survive sanitization');
      const math = await content('<p><math-renderer class="js-inline-math">$x^2$</math-renderer></p><math-renderer>$$\\frac{a}{b}$$</math-renderer>');
      await until(() => !math.querySelector('[aria-busy]'));
      check(math.querySelectorAll('math').length === 2 && math.querySelector('mfrac'), 'Inline and display mathematics preserve fraction semantics');
      check([...math.querySelectorAll('math')].map(node => getComputedStyle(node.parentElement).display).join() === 'inline,block', 'Inline and display math have actual distinct layout');
      const malformed = await content('<math-renderer>$\\frac{broken$</math-renderer>');
      await until(() => !malformed.querySelector('[aria-busy]'));
      check(malformed.querySelector('code')?.textContent === '$\\frac{broken$', 'Invalid mathematics keeps readable source');
      const failedCode = await content('<pre><code>fn main() {}</code></pre>', { code: async () => { throw Error('offline'); } });
      await new Promise(resolve => setTimeout(resolve, 0));
      check(failedCode.querySelector('pre').textContent === 'fn main() {}', 'Failed enhancement keeps readable code');
      const enhancementHost = document.createElement('div'); contentHost.append(enhancementHost);
      const enhancement = mountContent(enhancementHost, preparedHTML({resources:{revision:'qualified-resources-1',styles:[],scripts:[blog + '/missing-content-enhancement.js']}}), { signal: lifetime.signal });
      await enhancement.update({ markdown: 'Canonical source', prepared: { html: '<p>Readable prepared output</p>', revision: 'qualified-1', resources:'qualified-resources-1' }, repo: 'example/comments', pageURL: blog + '/article', purpose: 'comment' });
      check(enhancement.ready && enhancementHost.textContent === 'Readable prepared output', 'Prepared output becomes readable independently of optional enhancement');
      await new Promise(resolve => setTimeout(resolve, 0));
      check(enhancementHost.textContent === 'Readable prepared output', 'Enhancement failure cannot erase installed readable output');
      let copied;
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async value => { copied = value; } } });
      const code = await content('<pre><code>first line\n  second line\n' + 'a'.repeat(200) + '</code></pre>');
      code.querySelector('button').click();
      await until(() => copied !== undefined);
      check(copied === 'first line\n  second line\n' + 'a'.repeat(200), 'Copy preserves the complete plain source');
      const buttonX = code.querySelector('button').getBoundingClientRect().x;
      code.querySelector('pre').scrollLeft = 100;
      check(code.querySelector('pre').scrollLeft > 0 && code.querySelector('button').getBoundingClientRect().x === buttonX, 'Long code scrolls while its copy control stays reachable');
      const completeCode = await content('<pre><code class="language-js">custom()</code></pre>', { code: async feature => {
        const output = document.createElement('figure'); output.dataset.hostCode = feature.language;
        output.textContent = feature.source;
        const copy = document.createElement('button'); copy.textContent = 'Copy website code';
        copy.onclick = () => navigator.clipboard.writeText(feature.source); output.append(copy); return output;
      } });
      await until(() => completeCode.querySelector('[data-host-code]'));
      check(completeCode.querySelector('figure').textContent === 'custom()Copy website code' && completeCode.querySelectorAll('button').length === 1, 'A complete code replacement supplies its own output and copy control without an additional default control');
      completeCode.querySelector('button').click(); await until(() => copied === 'custom()');
      const completeMath = await content('<math-renderer>x</math-renderer>', { math: async feature => {
        const output = document.createElement('span'); output.dataset.hostMath = 'true'; output.textContent = feature.source; return output;
      } });
      await until(() => completeMath.querySelector('[data-host-math]'));
      check(!completeMath.querySelector('math-renderer,math'), 'Custom math owns its complete output');
      const unenhanced = await content('<pre><code>ordinary()</code></pre><math-renderer>x</math-renderer>', { code: false, math: false });
      check(unenhanced.querySelector('pre').textContent === 'ordinary()' && !unenhanced.querySelector('button'), 'Opting out retains ordinary readable code without enhancement controls');
      lifetime.abort();
      contentHost.remove();

      const contentScope = new AbortController(), batches = [], ownedHosts = [];
      const preparedOwner = api.createContentOwner({repo:'example/comments',pageURL:blog+'/article',profile:api.preparedContent(),signal:contentScope.signal,batch(inputs,signal) {
        return new Promise(resolve => batches.push({inputs,signal,resolve}));
      }});
      const ownedMount = () => { const host = document.createElement('div'); document.body.append(host); ownedHosts.push(host); return {host,mount:preparedOwner.mount(host)}; };
      const a = ownedMount(), b = ownedMount(), failed = ownedMount();
      const sameInput = {markdown:'Shared prepared source',purpose:'preview',draft:'shared'};
      const failedSource = 'Failed prepared source\n  Preserved indentation\n\nhttps://example.com/' + 'long-source'.repeat(200);
      const first = a.mount.update(sameInput), sibling = b.mount.update(sameInput), bad = failed.mount.update({markdown:failedSource,purpose:'preview',draft:'failed'}).catch(() => {});
      await until(() => batches.length === 1);
      check(batches[0].inputs.length === 2,'Concurrent mounts share one exact preparation while batching independent input');
      a.mount.dispose(); await first;
      check(!batches[0].signal.aborted,'Retiring one mount cannot cancel preparation still owned by a sibling');
      batches[0].resolve({results:batches[0].inputs.map(input=>input.markdown===failedSource?{error:'Independent preparation failed'}:{prepared:{html:'<p>Shared prepared output</p>',revision:'qualified-owner'}})});
      await Promise.all([sibling,bad]);
      check(!a.host.hasChildNodes() && b.host.textContent==='Shared prepared output','A shared result publishes only into the surviving mount');
      check(failed.host.textContent.startsWith(failedSource) && failed.host.querySelector('button')?.textContent==='Retry','One failed batch row preserves exact source and recovery without discarding its successful sibling');
      window.scrollTo({left:1000,behavior:'instant'});
      check(document.documentElement.scrollWidth <= innerWidth && scrollX === 0,'Failed preparation retains long source without horizontal page scrolling on mobile');
      failed.host.querySelector('button').click();
      await until(() => batches.length === 2);
      check(batches[1].inputs[0].markdown===failedSource,'Retry reacquires the exact failed source');
      batches[1].resolve({results:[{prepared:{html:'<p><strong>Recovered prepared output</strong></p>',revision:'qualified-owner'}}]});
      await until(() => failed.host.querySelector('strong'));
      check(failed.host.textContent==='Recovered prepared output' && !failed.host.querySelector('[role="status"]'),'Successful retry replaces the temporary source and recovery with formatted output');
      const last = ownedMount(), pending = last.mount.update({markdown:'Retired pending source',purpose:'preview',draft:'retired'});
      await until(() => batches.length === 3); last.mount.dispose(); await pending;
      check(batches[2].signal.aborted && !last.host.hasChildNodes(),'The final preparation owner cancels acquisition and cannot publish late output');
      batches[2].resolve({results:[{prepared:{html:'<p>Late output</p>',revision:'qualified-owner'}}]});
      contentScope.abort(); for (const host of ownedHosts) host.remove();

      const target = document.createElement('div');
      document.body.append(target);
      let editor, enhancementSignal, releaseEnhancement, releases = 0;
      const custom = (host, owner, scope) => {
        const body = document.createElement('div');
        host.append(body);
        scope.own(() => { releases++; host.replaceChildren(); });
        editor = api.createEditor(owner, owner.writing(), { writeWhileSignedOut: true, signal: scope.signal, render(current) {
          if (!current.form.hasChildNodes()) current.form.append(current.textarea, current.previewElement);
          if (!current.form.isConnected) host.append(current.form);
        } });
        void mountContent(body, githubContent({ math: (_feature, context) => {
          enhancementSignal = context.signal;
          return new Promise(resolve => { releaseEnhancement = resolve; });
        } }), { signal: scope.signal }).update({ markdown: 'x', html: '<math-renderer>x</math-renderer>', purpose: 'comment', repo: owner.config.repo, pageURL: owner.config.pageURL });
      };
      const rendering = { disposals: 0, updates: 0, inputs: [] }, waitingUpdates = new Map();
      let coldPreparation, coldComment;
      const localMarkdown = async (input, context) => {
        if (coldPreparation && input.purpose === 'comment' && (!coldComment || input.comment?.id === coldComment)) await coldPreparation;
        await Promise.resolve();
        context.signal.throwIfAborted();
        if (input.markdown === 'Failed custom rendering remains readable') throw Error('Renderer offline');
        const article = document.createElement('section'), counter = document.createElement('button'), source = document.createElement('p');
        article.dataset.hostMarkdown = input.purpose; source.textContent = input.markdown;
        let clicks = 0; counter.textContent = 'Clicks 0'; counter.addEventListener('click', () => { counter.textContent = 'Clicks ' + ++clicks; }, { signal: context.lifetime });
        article.append(source, counter); rendering.inputs.push(input);
        return { node: article, async update(next, nextContext) {
          if (next.markdown.startsWith('Deferred mounted value ')) await new Promise(resolve => waitingUpdates.set(next.markdown, resolve));
          await Promise.resolve(); rendering.updates++;
          if (next.markdown === 'Failed prepared mounted value') throw Error('Renderer offline');
          rendering.inputs.push(next); return () => { source.textContent = next.markdown; };
        }, dispose() { rendering.disposals++; } };
      };
      const mounted = api.mountPresentation(target, { service, page: { repo: 'example/comments', origin: blog, pageURL: blog + '/article', returnURL: blog + '/article', selector: { kind: 'page', key: 'article' } }, content: browserContent(localMarkdown), fetching: { onFocus: true, staleAfterMs: 0 }, writingRecovery: false, host: { navigate() { throw Error('Unexpected custom-consumer navigation'); } } }, custom);
      const owner = mounted.conversation;
      owner.initialize({ session: capability });
      await until(() => owner.ready);
      check(owner.document.roots.ids.length > 0, 'Custom consumer acquires the real repository document');
      owner.writing().update('Writing belongs to this page');
      await editor.preview();
      check(editor.previewElement.textContent.includes('Writing belongs to this page'), 'A website Markdown pipeline previews original writing');
      check(rendering.inputs.at(-1).purpose === 'preview' && rendering.inputs.at(-1).draft === owner.writing().id, 'The preview renderer receives original writing identity and purpose');
      editor.write(); owner.writing().update('Failed custom rendering remains readable');
      await editor.preview();
      check(editor.previewElement.textContent.includes('Failed custom rendering remains readable') && editor.previewElement.querySelector('button')?.textContent === 'Retry', 'Failed website preview retains original writing alongside shared content recovery');
      editor.write(); owner.writing().update('Writing belongs to this page');
      const oldInput = editor.textarea;
      check(oldInput.value === 'Writing belongs to this page', 'Custom native editor receives model writing');
      const { createStandardPresentation } = await import(service + '/native.js');
      let releaseCold;
      coldPreparation = new Promise(resolve => { releaseCold = resolve; });
      mounted.replacePresentation(createStandardPresentation());
      check(mounted.conversation === owner && target.querySelector('textarea').value === 'Writing belongs to this page', 'Changing design keeps the actual page and writing');
      await new Promise(resolve => requestAnimationFrame(resolve));
      check([...target.querySelectorAll('.gsc-comment,.gsc-reply')].every(card => card.hidden), 'Cold comment cards wait for readable bodies');
      check(target.querySelector('.gsc-comments-count').textContent.includes(String(owner.document.roots.count.count)), 'Known count remains published while bodies prepare');
      check(target.querySelector('textarea').value === 'Writing belongs to this page', 'Writing remains available while body preparation is held');
      check([...target.querySelectorAll('.gsc-comment,.gsc-reply')].every(card => !card.getClientRects().length), 'Cold standard comment shells occupy no visible layout at a real paint boundary');
      check(target.querySelector('.gsc-loading') && !target.querySelector('.gsc-loading').hidden, 'Cold presentation keeps its existing loading indication');
      releaseCold(); coldPreparation = undefined;
      await until(() => [...target.querySelectorAll('.gsc-comment,.gsc-reply')].every(card => !card.hidden));
      check([...target.querySelectorAll('.gsc-comment,.gsc-reply')].every(card => !card.hidden && card.querySelector('[data-host-markdown="comment"]')), 'The first published standard discussion contains its readable bodies');
      coldComment = owner.document.roots.ids[0];
      coldPreparation = new Promise(resolve => { releaseCold = resolve; });
      mounted.replacePresentation(createStandardPresentation());
      await until(() => target.querySelectorAll('[data-host-markdown="comment"]').length > 0);
      check(target.querySelector('#comment-' + coldComment).hidden && [...target.querySelectorAll('.gsc-comment')].some(card => !card.hidden), 'One held body does not conceal independent readable cards');
      check(target.querySelector('.gsc-loading'), 'Held content keeps a visible loading indication without blocking independent reading');
      releaseCold(); coldPreparation = undefined; coldComment = undefined;
      await until(() => !target.querySelector('#comment-' + owner.document.roots.ids[0]).hidden);
      check(!target.querySelector('.gsc-loading'), 'The later loading indication retires when its current body becomes readable');
      check(releases === 1 && enhancementSignal.aborted && !oldInput.isConnected, 'Retiring the custom view releases its acquired resources');
      oldInput.value = 'Obsolete input';
      oldInput.dispatchEvent(new Event('input'));
      check(owner.writing().text === 'Writing belongs to this page', 'Detached controls cannot change the surviving page');
      const late = document.createDocumentFragment();
      late.append('Late mathematics');
      releaseEnhancement(late);
      let failedReleases = 0;
      try {
        mounted.replacePresentation((host, pageOwner, scope) => {
          scope.own(() => { failedReleases++; host.replaceChildren(); });
          api.createEditor(pageOwner, pageOwner.writing(), { signal: scope.signal, render(current) { host.append(current.form); current.form.append(current.textarea); } });
          throw Error('Acquisition failed');
        });
        throw Error('Failure was hidden');
      } catch (error) { check(error.message === 'Acquisition failed', 'Failed acquisition reports its original error'); }
      check(failedReleases === 1 && !target.hasChildNodes(), 'Failed acquisition leaves no live resources or controls');
      mounted.replacePresentation(forumPresentation);
      check(target.querySelector('textarea').value === 'Writing belongs to this page', 'The independent forum consumer uses the same writing');
      owner.writing().update('');
      await until(() => target.querySelector('[data-host-markdown="comment"]'));
      const component = target.querySelector('[data-host-markdown="comment"]'), clicker = component.querySelector('button');
      clicker.click();
      await owner.revalidate();
      check(component.isConnected && clicker.textContent === 'Clicks 1', 'Unchanged content retains a mounted website component and its local state across freshness work');
      const host = document.createElement('div'); target.append(host);
      const readiness = [];
      const shared = mountContent(host, localMarkdown, { onReady: ready => readiness.push(ready) });
      await shared.update({ markdown: 'First mounted value', purpose: 'comment', repo: owner.config.repo, pageURL: owner.config.pageURL });
      const retained = host.firstChild, control = retained.querySelector('button'); control.click();
      await shared.update({ markdown: 'Second mounted value', purpose: 'comment', repo: owner.config.repo, pageURL: owner.config.pageURL });
      check(host.firstChild === retained && control.textContent === 'Clicks 1' && host.textContent.includes('Second mounted value'), 'Changed content updates the same mounted component without losing its state');
      const olderUpdate = shared.update({ markdown: 'Deferred mounted value older', purpose: 'comment', repo: owner.config.repo, pageURL: owner.config.pageURL });
      check(host.textContent.includes('Second mounted value') && control.textContent === 'Clicks 1', 'A retained website component stays usable while its next output is prepared');
      check(JSON.stringify(readiness) === '[true]', 'Installed output stays readable while replacements prepare');
      const newestUpdate = shared.update({ markdown: 'Deferred mounted value newest', purpose: 'comment', repo: owner.config.repo, pageURL: owner.config.pageURL });
      waitingUpdates.get('Deferred mounted value newest')(); await newestUpdate;
      waitingUpdates.get('Deferred mounted value older')(); await olderUpdate;
      check(host.firstChild === retained && host.textContent.includes('Deferred mounted value newest') && !host.textContent.includes('Deferred mounted value older') && control.textContent === 'Clicks 1', 'Reordered rendering completion commits only the newest prepared value without losing mounted state');
      let failedUpdate;
      await shared.update({ markdown: 'Failed prepared mounted value', purpose: 'comment', repo: owner.config.repo, pageURL: owner.config.pageURL }).catch(error => { failedUpdate = error; });
      check(failedUpdate?.message === 'Renderer offline' && host.firstChild === retained && host.textContent.includes('Deferred mounted value newest'), 'Preparation failure reports its error without replacing the last ready component');
      control.click(); check(control.textContent === 'Clicks 2', 'An installed component keeps its interaction lifetime across canceled and failed preparations');
      const beforeDispose = rendering.disposals; shared.dispose();
      check(!host.hasChildNodes() && rendering.disposals === beforeDispose + 1, 'Mounted website content releases its resources when retired');
      check(JSON.stringify(readiness) === '[true,false]', 'Disposal retires presentation readiness with installed output');
      control.click(); check(control.textContent === 'Clicks 2', 'Retiring the installed component also retires its interaction lifetime');
      let releaseLate, lateDisposals = 0;
      const lateReadiness = [];
      const deferred = mountContent(host, () => new Promise(resolve => { releaseLate = resolve; }), { onReady: ready => lateReadiness.push(ready) });
      const lateWork = deferred.update({ markdown: 'Readable pending source', purpose: 'comment', repo: owner.config.repo, pageURL: owner.config.pageURL });
      check(!host.hasChildNodes(), 'Cold content is published only when its complete output is ready');
      deferred.dispose(); await lateWork;
      releaseLate({ node: document.createElement('span'), dispose() { lateDisposals++; } }); await until(() => lateDisposals === 1);
      check(lateDisposals === 1 && !host.hasChildNodes(), 'A retired asynchronous renderer cannot attach its late result');
      check(lateReadiness.length === 0, 'Canceled preparation never publishes readiness from promise settlement');
      let retirementCount = 0, retirementError;
      const throwing = mountContent(host, input => ({ node: document.createTextNode(input.markdown), dispose() {
        retirementCount++; if (input.markdown === 'Throwing installed cleanup') throw Error('Cleanup failed');
      } }));
      await throwing.update({ markdown: 'Throwing installed cleanup', purpose: 'comment', repo: owner.config.repo, pageURL: owner.config.pageURL });
      await throwing.update({ markdown: 'Readable replacement source', purpose: 'comment', repo: owner.config.repo, pageURL: owner.config.pageURL }).catch(error => { retirementError = error; });
      check(retirementError?.message === 'Cleanup failed' && retirementCount === 2 && host.textContent.includes('Readable replacement source'), 'Throwing installed cleanup also retires the uninstalled replacement while preserving readable recovery');
      throwing.dispose(); check(retirementCount === 2 && !host.hasChildNodes(), 'Failed replacement cleanup is not repeated when the mount retires');
      const failedReadiness = [];
      const offline = mountContent(host, async () => { throw Error('Renderer offline'); }, { onReady: ready => failedReadiness.push(ready) });
      await offline.update({ markdown: 'Readable failed source', purpose: 'comment', repo: owner.config.repo, pageURL: owner.config.pageURL }).catch(() => {});
      check(host.textContent.includes('Readable failed source') && failedReadiness[0] === true, 'Cold renderer failure publishes readable original writing');
      offline.clear(); check(failedReadiness[1] === false && !host.hasChildNodes(), 'Clearing fallback writing retires its readiness'); offline.dispose(); host.remove();
      window.consumer = { mounted, owner, target, until, check, capability };
    }, { service, blog, capability });
    await page.context().route(service + '/api/v7/identity', route => route.abort('failed'));
    await page.evaluate(async () => {
      const { owner, until, check } = window.consumer;
      await until(() => !owner.viewerPending);
      const reading = JSON.stringify(owner.document.roots.ids), profile = owner.session.viewer;
      await owner.session.refreshIdentity();
      check(owner.session.error && owner.session.viewer.login === profile.login && owner.session.principal === profile.id, 'Failed display-profile refresh retains verified account identity');
      check(JSON.stringify(owner.document.roots.ids) === reading, 'Display-profile failure does not replace public reading');
    });
    await page.context().unroute(service + '/api/v7/identity');
    await page.evaluate(async () => {
      const { owner, check } = window.consumer;
      await owner.session.verify();
      check(!owner.session.error && owner.session.viewer?.login === 'reader', 'Session Retry refreshes the failed display identity even when principal proof is already verified');
    });
    const beforeCountReuse = countReads.length;
    await page.evaluate(async ({service,blog}) => {
      const {createCounts} = await import(service + '/counts.js');
      const values = [], badge = document.createElement('span'); document.body.append(badge);
      const counts = createCounts({service,repo:'example/comments',origin:blog});
      const release = counts.subscribe('article', value => { values.push(value); badge.textContent = String(value.count); });
      await counts.read(['article']);
      const before = values.length; counts.observe(values.at(-1));
      if (values.length !== before) throw Error('Reusing the exact count observation emitted a new fact');
      window.consumer.counts = {counts,values,badge,release};
    }, {service,blog});
    assert.equal(countReads.length,beforeCountReuse,'A badge reuses the acquired page count without another provider request');
    let countArrived, releaseCount;
    const countSeen = new Promise(resolve => {countArrived=resolve;}), countHeld = new Promise(resolve => {releaseCount=resolve;});
    await page.context().route(service + '/api/v7/counts?*', async route => {
      const response = await route.fetch(); countArrived(); await countHeld; await route.fulfill({response});
    });
    await page.evaluate(() => {
      const {counts,values} = window.consumer.counts;
      window.consumer.counts.pending = counts.invalidate({target:values.at(-1).target,observedAt:values.at(-1).observedAt});
    });
    await countSeen;
    await page.evaluate(async () => {
      const {owner,counts:{counts,values,badge},check} = window.consumer;
      const before = values.at(-1), writing = owner.newWriting({kind:'comment'}).show();
      writing.update('Count observation from an independent contribution');
      const outcome = await writing.submit(); check(outcome.status === 'saved','Count journey publishes a real provider contribution');
      const observation = outcome.result.patch.roots.count; counts.observe(observation);
      check(observation.count === before.count + 1 && badge.textContent === String(observation.count),'Confirmed provider facts update the shared count consumer immediately');
      window.consumer.counts.confirmed = observation;
      window.consumer.counts.membership = owner.document.roots.ids;
    });
    releaseCount(); await page.evaluate(() => window.consumer.counts.pending);
    await page.context().unroute(service + '/api/v7/counts?*');
    await page.evaluate(() => {
      const {values,badge,confirmed,membership} = window.consumer.counts;
      if (values.at(-1).count !== confirmed.count || badge.textContent !== String(confirmed.count)) throw Error('A held older count replaced the confirmed contribution observation');
      if (window.consumer.owner.document.roots.ids !== membership) throw Error('Independent count refresh changed the captured reading membership');
    });
    await page.context().route(service + '/api/v7/counts?*', async route => {
      const response = await route.fetch(), result = await response.json();
      const unavailableKey = JSON.stringify(['page','unavailable',null,'roots',null]);
      delete result.observations[unavailableKey];
      result.errors = {[unavailableKey]:{status:410,code:'NOT_FOUND',message:'The mapped discussion is unavailable.'}};
      await route.fulfill({response,json:result});
    });
    await page.evaluate(async () => {
      const {counts,values,badge} = window.consumer.counts, known = values.at(-1);
      const renewed = counts.invalidate({target:known.target,observedAt:known.observedAt});
      let failed = false; const unavailable = counts.invalidate({target:{selector:{kind:'page',key:'unavailable'},window:{kind:'roots'}},observedAt:known.observedAt}).catch(() => {failed=true;});
      await Promise.all([renewed,unavailable]);
      if (!failed || values.at(-1).count !== known.count || badge.textContent !== String(known.count)) throw Error('One unavailable count discarded an independently successful observation');
    });
    await page.context().unroute(service + '/api/v7/counts?*');
    let cohortArrived, releaseCohort;
    const cohortSeen = new Promise(resolve => {cohortArrived=resolve;}), cohortHeld = new Promise(resolve => {releaseCohort=resolve;});
    await page.context().route(service + '/api/v7/counts?*', async route => {
      const response = await route.fetch();
      assert.equal(JSON.parse(new URL(route.request().url()).searchParams.get('input')).targets.length,2,'Independent count requests share one provider batch');
      cohortArrived();await cohortHeld;await route.fulfill({response});
    });
    await page.evaluate(() => {
      const {counts} = window.consumer.counts, canceled = {selector:{kind:'page',key:'Canceled count acquisition'},window:{kind:'roots'}}, survivor = {selector:{kind:'page',key:'Surviving count acquisition'},window:{kind:'roots'}};
      const abort = new AbortController();
      window.consumer.counts.cohort = {canceled,survivor,abort,canceledWork:counts.read([canceled],abort.signal).catch(() => {}),survivorWork:counts.read([survivor])};
    });
    await cohortSeen;
    await page.evaluate(async () => { const cohort=window.consumer.counts.cohort;cohort.abort.abort();await cohort.canceledWork; });
    releaseCohort();await page.evaluate(async () => {
      const {counts,cohort} = window.consumer.counts;await cohort.survivorWork;
      if (counts.facts.get(cohort.canceled)!==null || counts.facts.get(cohort.survivor)?.count!==0) throw Error('A canceled count row published facts or discarded its still-owned sibling');
    });
    await page.context().unroute(service + '/api/v7/counts?*');
    await page.evaluate(() => { const {counts,badge,release} = window.consumer.counts; release();counts.dispose();badge.remove(); });
    const activeWriting = await page.evaluate(() => window.consumer.owner.writing().id);
    const textarea = page.locator('.forum-composer[data-writing-id="' + activeWriting + '"] textarea');
    await textarea.focus();
    await page.keyboard.type('Forum native editing survives refresh');
    await textarea.evaluate(element => element.setSelectionRange(2, 6));
    await page.evaluate(async () => { await window.consumer.owner.revalidate(); });
    assert.equal(await textarea.evaluate(element => document.activeElement === element && element.selectionStart === 2 && element.selectionEnd === 6), true, 'Real refresh retains forum focus and selection');
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    await textarea.press(modifier + '+z');
    assert.equal(await textarea.inputValue(), '', 'Forum keeps native undo across a real refresh');
    await textarea.press(modifier + '+Shift+z');
    assert.equal(await textarea.inputValue(), 'Forum native editing survives refresh');
    const reactionRequests = [];
    await page.context().route(service + '/api/v7/contribute', route => {
      reactionRequests.push(route.request().postDataJSON()); return route.abort('failed');
    });
    await page.evaluate(async () => {
      const { owner, check } = window.consumer, id = owner.document.roots.ids[0];
      window.consumer.recoverySubject = id;
      window.consumer.recoverySelected = !Boolean(owner.reactions(id).HEART?.selected);
      await owner.setReaction(id, 'HEART', window.consumer.recoverySelected).catch(() => {});
      check(owner.reaction(id, 'HEART').recovery?.status === 'uncertain' && owner.reaction(id, 'HEART').recover.status === 'available', 'A custom presentation can identify an unresolved reaction without inspecting private intents');
    });
    await page.context().unroute(service + '/api/v7/contribute');
    await page.context().route(service + '/api/v7/contribute', route => {
      reactionRequests.push(route.request().postDataJSON()); return route.continue();
    });
    await page.getByRole('article').filter({ has: page.getByRole('button', { name: 'Recover ❤️', exact: true }) }).getByRole('button', { name: 'Recover ❤️', exact: true }).click();
    await page.waitForFunction(() => !window.consumer.owner.reaction(window.consumer.recoverySubject, 'HEART').recovery);
    await page.context().unroute(service + '/api/v7/contribute');
    assert.equal(reactionRequests[1].key, reactionRequests[0].key, 'Reaction recovery retains the issued receipt identity');
    assert.deepEqual(reactionRequests[1].action, reactionRequests[0].action, 'Reaction recovery retains the issued effect');
    await page.evaluate(async () => {
      const { owner, check, recoverySubject, recoverySelected } = window.consumer;
      await owner.revalidate(0, [recoverySubject]);
      check(Boolean(owner.reactions(recoverySubject).HEART?.selected) === recoverySelected, 'Recovered reaction is independently observed from the provider');
    });
    await page.evaluate(async () => {
      const { mounted, owner, target, until, check, capability } = window.consumer;
      const root = owner.document.roots.ids.find(id => owner.document.replies[id]?.cursor);
      check(Boolean(root), 'The real discussion has an earlier reply window');
      await owner.loadMore(); await owner.loadReplies(root);
      const roots = [...owner.document.roots.ids], replies = [...owner.document.replies[root].ids];
      check(roots.length > 20 && ['Reply 1', 'Reply 7'].every(body => replies.some(id => owner.document.nodes[id]?.body === body)), 'The consumer loaded additional comments and the independently known earlier replies');
      document.activeElement?.blur(); window.dispatchEvent(new FocusEvent('focus'));
      check(owner.acquisition()?.purpose === 'revalidate', 'Focus freshness is identified as background acquisition');
      await until(() => !owner.acquisition());
      check(JSON.stringify(owner.document.roots.ids) === JSON.stringify(roots) && JSON.stringify(owner.document.replies[root].ids) === JSON.stringify(replies), 'Background freshness preserves accumulated reading progress');
      const reply = owner.writing({ kind: 'reply', id: root }).show();
      reply.update('Retained destination after editor dismissal'); reply.hide();
      check((await reply.submit()).status === 'blocked', 'Closed writing cannot silently submit elsewhere');
      reply.show();
      const outcome = await reply.submit(); check(outcome.status === 'saved', 'Reopened reply publishes');
      check(owner.document.nodes[outcome.result.id]?.parentId === root && !owner.document.roots.ids.includes(outcome.result.id), 'A dismissed and reopened reply retains its original destination');

      mounted.replacePage({ repo: 'example/comments', origin: owner.config.origin, pageURL: owner.config.pageURL, returnURL: owner.config.returnURL, selector: { kind: 'page', key: 'Another page' } });
      check(owner.signal.aborted, 'Navigation retires the former document owner');
      mounted.conversation.initialize({ session: capability });
      await until(() => mounted.conversation.ready);
      check(!target.textContent.includes('Try posting a comment'), 'A replacement page does not adopt the old document');
      mounted.dispose();
      check(!target.hasChildNodes(), 'Final disposal releases the current view');
    });
    assert.ok(contentReads.length > 0 && contentReads.every(input => input.providerHTML === false && !Object.hasOwn(input, 'content')), 'A local Markdown consumer acquires source without provider HTML');
    assert.equal(providerPreviews.length, 0, 'A complete website Markdown pipeline never requests provider HTML for previews');
    assert.deepEqual(errors, [], 'Custom consumer and rich-content page errors');
    report.checks.push({ engine: browser.browserType().name(), workflow: 'real repository custom consumer, content safety and resource retirement', status: 'passed' });
    console.log('PASS', browser.browserType().name(), 'custom consumer and rich content');

    const requests = [];
    page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) requests.push(request.url()); });
    await page.goto(service + '/');
    await page.waitForFunction(() => !document.getElementById('deployment-status').textContent.includes('Checking'));
    await page.locator('#app-form [name="website"]').fill(blog + '/article');
    await page.locator('#app-form button').click();
    const registration = new URL(await page.locator('#app-link').getAttribute('href'));
    assert.equal(registration.origin, 'https://github.com');
    assert.equal(registration.searchParams.get('callback_urls[]'), service + '/auth/callback');
    assert.equal(registration.searchParams.get('discussions'), 'write');
    await page.locator('#configuration-form [name="appId"]').fill('1234');
    await page.locator('#configuration-form [name="clientId"]').fill('Iv1.example');
    await page.locator('#configuration-form [name="repo"]').fill('Example/Comments');
    await page.locator('textarea[name="registration"][form="configuration-form"]').fill(JSON.stringify({ repo: 'example/comments', category: 'Announcements', repositoryId: 'R_fixture', installationId: 123, categoryId: 'CAT_fixture' }));
    await page.locator('#configuration-form button').click();
    const values = await page.locator('#configuration-values').evaluate(list => Object.fromEntries([...list.querySelectorAll('dt')].map(label => [label.textContent, label.nextElementSibling.textContent])));
    assert.deepEqual(JSON.parse(values.REPOSITORIES)['example/comments'].origins, [blog]);
    const registeredPolicy = JSON.parse(values.REPOSITORIES)['example/comments'];
    assert.equal(registeredPolicy.repositoryId, 'R_fixture');
    assert.equal(registeredPolicy.installationId, 123);
    assert.equal(registeredPolicy.categoryId, 'CAT_fixture');
    assert.equal(values.PUBLIC_ORIGIN, service);
    assert.equal('GITHUB_PRIVATE_KEY' in values, false);
    await page.locator('#generate-secret').click();
    const secret = await page.locator('#session-secret').textContent();
    assert.match(secret, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(requests.length, 1, 'Configuration and generated secrets stay local');
    await page.locator('#setup-form [name="term"]').fill('article');
    await page.locator('#setup-form button[type="submit"]').click();
    await page.waitForFunction(() => !document.getElementById('setup-result').hidden);
    assert.equal(requests.length, 2, 'Only deployment status and registered repository information use the network');
    assert.ok(!requests.some(url => url.includes(secret)));
    assert.ok((await page.locator('#setup-code').textContent()).includes(`src="${service}/client.js?v=7"`));
    assert.ok((await page.locator('#setup-code').textContent()).includes('data-page-key="article"'));
    assert.deepEqual(errors, [], 'Setup page errors');
    report.checks.push({ engine: browser.browserType().name(), workflow: 'local registered configuration and typed embed generation', status: 'passed' });
    console.log('PASS', browser.browserType().name(), 'setup privacy');
  } finally { await page.close(); }
}
