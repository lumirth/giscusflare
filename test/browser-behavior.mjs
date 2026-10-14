import assert from 'node:assert/strict';
import { browserFixture, responseGate } from './browser-fixture.mjs';

async function cachedIdentityBehavior({ browser, service, blog, report, capability }) {
  const { expect } = await import(process.env.PLAYWRIGHT_MODULE || '@playwright/test');
  for (const mode of ['native', 'iframe']) for (const ordering of ['access-first', 'session-first']) {
    const clientIP = '192.0.2.' + ((browser.browserType().name() === 'chromium' ? 182 : 186) + (mode === 'iframe' ? 2 : 0) + (ordering === 'session-first' ? 1 : 0));
    const fixture = await browserFixture(browser, service, clientIP, mode), { context, page, surface, errors, platformFetch } = fixture;
    let returningCapability;
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
    fixture.observe(page, 'request', request => {
      if (new URL(request.url()).pathname === '/api/v7/session') returningCapability = request.headers().authorization?.slice(7);
    });
    const hold = (pattern, failure = false) => fixture.hold(pattern, async (route, gate) => {
      const response = await platformFetch(route);
      assert.equal(response.ok(), true, 'The held account/public observation comes from the real local service');
      await gate.wait();
      if (failure) await route.abort('failed');
      else await route.fulfill({ response });
    });
    const nativeName = async () => page.evaluate(() => {
      const owner = window.demoComments.conversation;
      const output = document.createElement('output');output.id = 'cached-account-name';document.body.append(output);
      const draw = () => { output.textContent = owner.session.displayProfile?.login ?? 'Guest'; };
      owner.own(owner.subscribe(draw));draw();
    });
    try {
      const path = mode === 'native' ? '/native' : '/article';
      await page.goto(blog + path);
      const composer = surface.locator('[data-composer="main"]');
      await composer.getByRole('button', { name: 'Sign in with GitHub', exact: true }).click();
      await composer.getByRole('button', { name: 'Sign out', exact: true }).waitFor();
      if (mode === 'native') await expect.poll(() => page.evaluate(() => window.demoComments.conversation.session.viewer?.login)).toBe('reader');
      else await expect.poll(() => page.evaluate(() => window.cachedIdentityMetadata.includes('reader'))).toBe(true);
      await expect.poll(() => Boolean(returningCapability)).toBe(true);
      await surface.getByText('Try posting a comment or replying here.', { exact: true }).waitFor();
      const session = await hold('/api/v7/session', ordering === 'access-first');
      const access = await hold('/api/v7/access', ordering === 'session-first');
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
        await expect(surface.getByRole('alert').first()).toBeVisible();
        await expect(composer.locator('button[type="submit"]')).toBeEnabled();
        if (mode === 'native') await expect(page.locator('#cached-account-name')).toHaveText('reader');
      } else {
        session.release();
        if (mode === 'native') {
          await expect.poll(() => page.evaluate(() => window.demoComments.conversation.session.viewer?.login)).toBe('reader');
          assert.equal(await page.evaluate(() => window.demoComments.conversation.viewer), null, 'Session-first display proof cannot manufacture held account permissions');
        } else await expect.poll(() => page.evaluate(() => window.cachedIdentityMetadata.includes('reader'))).toBe(true);
        access.release();
        await expect(surface.getByRole('alert').first()).toBeVisible();
      }
      assert.deepEqual(await surface.getByRole('article').evaluateAll(nodes => nodes.map(node => ({ id: node.id, text: node.querySelector('.gsc-comment-content,.gsc-reply-content')?.textContent, hidden: node.hidden }))), reading, 'Independent session/account failure preserves every readable public comment and its position');
      assert.equal(await composer.locator('textarea').inputValue(), 'Cached identity cannot authorize this writing', 'Independent account failure preserves native writing');
      await fixture.disposeHolds();
      if (mode === 'native' && ordering === 'session-first') await retiredIdentityBehavior({ page, context, service, capability, returningCapability, expect, platformFetch });
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
      fixture.diagnose({ mode, ordering,
        host: await page.evaluate(() => ({ metadata: window.cachedIdentityMetadata, hints: window.cachedIdentityInitializations, messages: window.cachedIdentityMessages })).catch(() => null),
        surface: await surface.locator('.giscusflare').evaluate(element => ({ alerts: [...element.querySelectorAll('[role="alert"]')].map(alert => alert.textContent), placeholder: element.querySelector('textarea')?.placeholder, disabled: element.querySelector('textarea')?.disabled, hints: window.cachedIdentityInitializations, messages: window.cachedIdentityMessages })).catch(() => null) });
      throw error;
    } finally {
      await fixture.close();
    }
  }
}

async function retiredIdentityBehavior({ page, context, service, capability, returningCapability, expect, platformFetch }) {
  const held = [], saves = [];
  for (const operation of ['session', 'access']) await context.route(service + '/api/v7/' + operation, async route => {
    const response = await platformFetch(route);
    assert.equal(response.ok(), true, 'Retirement exercises real successful identity/account observations');
    const observation = { ...responseGate(), old: route.request().headers().authorization === 'Bearer ' + capability, completed: false };held.push(observation);
    await observation.wait();await route.fulfill({ response });observation.completed = true;
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
  const fixture = await browserFixture(browser, service, browser.browserType().name() === 'chromium' ? '192.0.2.180' : '192.0.2.181'), { page, errors, platformClient, platformFetch } = fixture;
  const providerPreviews = [], contentReads = [], countReads = [];
  fixture.observe(page, 'request', request => {
    const url = new URL(request.url());
    if (url.pathname === '/api/v7/content' && request.method() === 'POST' && request.postDataJSON().inputs?.some(input => input.purpose === 'preview')) providerPreviews.push(url.href);
    if (url.pathname === '/api/v7/page') contentReads.push(JSON.parse(url.searchParams.get('input')));
    if (url.pathname.endsWith('/counts')) countReads.push(url.href);
  });
  try {
    await page.goto(blog + '/__behavior');
    const header = await fixture.hold('/api/v7/page?*', async (route, gate) => { const response=await platformFetch(route);await gate.wait();await route.fulfill({response}); });
    await page.evaluate(async ({service,blog,capability}) => {
      const {mountComments} = await import(service + '/native.js');
      const style=document.createElement('link');style.rel='stylesheet';style.href=service+'/native.css?v=7';document.head.append(style);
      await new Promise((resolve,reject)=>{style.onload=resolve;style.onerror=reject;});
      const target=document.createElement('div');target.id='cold-standard';document.body.append(target);
      window.coldStandard=mountComments(target,{service,page:{repo:'example/comments',origin:blog,pageURL:blog+'/cold-header',returnURL:blog+'/cold-header',selector:{kind:'page',key:'Cold header target'}}});
      window.coldStandard.conversation.initialize({session:capability});
    }, {service,blog,capability});
    await header.seen;
    const coldTextarea=page.locator('#cold-standard textarea');await coldTextarea.click();await page.keyboard.type('Draft while public reading waits');
    header.release();
    await page.locator('#cold-standard .gsc-loading').waitFor({state:'detached'});
    assert.equal(await page.evaluate(()=>window.coldStandard.conversation.ready && window.coldStandard.conversation.document.roots.count.count===0),true,'Held public acquisition completes with the independently known empty target');
    assert.equal(await coldTextarea.inputValue(),'Draft while public reading waits','Initial reading publication retains native writing');
    await page.evaluate(()=>{window.coldStandard.dispose();document.getElementById('cold-standard').remove();});
    await header.dispose();
    contentReads.length=0;
    await page.evaluate(async ({ service, blog, capability }) => {
      const api = await import(service + '/headless.js');
      const { browserContent } = await import(service + '/content.js');
      const { forumPresentation } = await import(service + '/forum-example.js');
      const check = (condition, message) => { if (!condition) throw new Error(message); };
      const until = async condition => {
        const deadline = Date.now() + 5000;
        while (!condition()) {
          check(Date.now() < deadline, 'Browser work did not settle within five seconds');
          await new Promise(resolve => setTimeout(resolve, 0));
        }
      };
      const target = document.createElement('div');
      document.body.append(target);
      let editor;
      const custom = (host, owner, scope) => {
        scope.own(() => host.replaceChildren());
        editor = api.createEditor(owner, owner.writing(), { writeWhileSignedOut: true, signal: scope.signal, render(current) {
          if (!current.form.hasChildNodes()) current.form.append(current.textarea, current.previewElement);
          if (!current.form.isConnected) host.append(current.form);
        } });
      };
      let coldPreparation, coldComment;
      const dependencies = new Map();
      const holdBody = (markdown, fail = false) => {
        let release, arrive;
        const waiting = new Promise(resolve => { release = resolve; }), seen = new Promise(resolve => { arrive = resolve; });
        dependencies.set(markdown, { waiting, arrive, fail });
        return { seen, release, restore: () => { dependencies.delete(markdown); release(); } };
      };
      const prepare = async (input, context) => {
        if (coldPreparation && input.purpose === 'comment' && (!coldComment || input.comment?.id === coldComment)) await coldPreparation;
        const dependency = input.purpose === 'comment' && dependencies.get(input.markdown);
        if (dependency) { dependency.arrive(); await dependency.waiting; }
        await Promise.resolve();
        // Already issued website dependency work can finish after cancellation.
        if (!dependency) context.signal.throwIfAborted();
        if (dependency?.fail) throw Error('Website content dependency unavailable');
        if (input.markdown === 'Failed custom rendering remains readable') throw Error('Renderer offline');
      };
      const localMarkdown = async (input, context) => {
        await prepare(input, context);
        const article = document.createElement('section'), counter = document.createElement('button'), source = document.createElement('p');
        article.dataset.hostMarkdown = input.purpose; source.textContent = input.markdown;
        let clicks = 0; counter.textContent = 'Clicks 0'; counter.addEventListener('click', () => { counter.textContent = 'Clicks ' + ++clicks; }, { signal: context.lifetime });
        article.append(source, counter);
        return { node: article, async update(next, nextContext) {
          await prepare(next, nextContext);
          return () => { source.textContent = next.markdown; };
        } };
      };
      const mounted = api.mountPresentation(target, { service, page: { repo: 'example/comments', origin: blog, pageURL: blog + '/article', returnURL: blog + '/article', selector: { kind: 'page', key: 'article' } }, content: browserContent(localMarkdown), fetching: { onFocus: true, staleAfterMs: 0 }, writingRecovery: false, host: { navigate() { throw Error('Unexpected custom-consumer navigation'); } } }, custom);
      const owner = mounted.conversation;
      owner.initialize({ session: capability });
      await until(() => owner.ready);
      check(owner.document.roots.ids.length > 0, 'Custom consumer acquires the real repository document');
      owner.writing().update('Writing belongs to this page');
      await editor.preview();
      check(editor.previewElement.textContent.includes('Writing belongs to this page'), 'A website Markdown pipeline previews original writing');
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
      oldInput.value = 'Obsolete input';
      oldInput.dispatchEvent(new Event('input'));
      check(owner.writing().text === 'Writing belongs to this page', 'Detached controls cannot change the surviving page');
      mounted.replacePresentation(forumPresentation);
      check(target.querySelector('textarea').value === 'Writing belongs to this page', 'The independent forum consumer uses the same writing');
      owner.writing().update('');
      await until(() => target.querySelector('[data-host-markdown="comment"]'));
      const component = target.querySelector('[data-host-markdown="comment"]'), clicker = component.querySelector('button');
      clicker.click();
      await owner.revalidate();
      check(component.isConnected && clicker.textContent === 'Clicks 1', 'Unchanged content retains a mounted website component and its local state across freshness work');
      window.consumer = { mounted, owner, target, until, check, capability, holdBody };
    }, { service, blog, capability });
    await page.evaluate(async ({service}) => {
      const {owner,target,until,check,holdBody} = window.consumer;
      const authored = owner.newWriting({kind:'comment'}).show();authored.update('An authored comment for canonical edit continuity');
      const published = await authored.submit();check(published.status === 'saved', 'The custom reader publishes a comment to edit');
      const id = published.result.id;
      await owner.refreshViewer();
      check(owner.actions(id).edit.status === 'available', 'The actual provider grants this account permission to edit its published comment');
      const article = target.querySelector('[data-comment="' + id + '"]');
      await until(() => article.querySelector('[data-host-markdown="comment"]'));
      const component = article.querySelector('[data-host-markdown="comment"]'), source = component.querySelector('p'), control = component.querySelector('button');
      const original = source.textContent;
      control.click();
      const publish = async body => {
        const writing = owner.writing({kind:'edit',id}).show();writing.update(body);
        const outcome = await writing.submit();
        check(outcome.status === 'saved', 'Editing publishes through the real contribution service: ' + JSON.stringify(outcome));
        const response = await fetch(service + '/api/v7/page?' + new URLSearchParams({input:JSON.stringify({config:{repo:'example/comments',origin:owner.config.origin,pageURL:owner.config.pageURL,returnURL:owner.config.returnURL,selector:{kind:'page',key:'article'}},read:{kind:'observe',ids:[id]},fresh:true,providerHTML:false})}), {cache:'no-store'});
        check(response.ok, 'A separate anonymous public read obtains the edited provider comment');
        const readback = await response.json();
        check(readback.nodes[id]?.body === body, 'The canonical edit is independently readable after publication');
      };
      const olderBody = 'An edited comment waiting on website resources', newerBody = 'A newer canonical edit is ready to read', recoveredBody = 'A canonical edit survives unavailable website resources';
      const older = holdBody(olderBody);
      try {
        await publish(olderBody);await older.seen;
        control.click();
        check(source.textContent === original && control.textContent === 'Clicks 2', 'Pending interpretation retains readable source and working installed controls');
        await publish(newerBody);await until(() => source.textContent === newerBody);
        older.release();
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        check(component.isConnected && source.textContent === newerBody && control.textContent === 'Clicks 2', 'A late older interpretation cannot replace the newer published edit or reset its mounted state');
      } finally { older.restore(); }
      const offline = holdBody(recoveredBody, true);offline.release();
      try {
        await publish(recoveredBody);
        await until(() => article.querySelector('.giscus-content-recovery button'));
        control.click();
        check(source.textContent === newerBody && control.textContent === 'Clicks 3', 'Failed replacement keeps the last readable edit and its installed controls usable');
        offline.restore();
        article.querySelector('.giscus-content-recovery button').click();
        await until(() => source.textContent === recoveredBody && !article.querySelector('.giscus-content-recovery'));
        check(component.isConnected && control.textContent === 'Clicks 3', 'Visible Retry publishes the independently verified canonical edit without losing mounted state');
      } finally { offline.restore(); }
    }, {service});
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
      window.consumer.counts = {counts,values,badge,release};
    }, {service,blog});
    assert.equal(countReads.length,beforeCountReuse,'A badge reuses the acquired page count without another provider request');
    const count = await fixture.hold('/api/v7/counts?*', async (route, gate) => { const response = await platformFetch(route); await gate.wait(); await route.fulfill({response}); });
    await page.evaluate(() => {
      const {counts,values} = window.consumer.counts;
      window.consumer.counts.pending = counts.invalidate({target:values.at(-1).target,observedAt:values.at(-1).observedAt});
    });
    await count.seen;
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
    count.release(); await page.evaluate(() => window.consumer.counts.pending);
    await count.dispose();
    await page.evaluate(() => {
      const {values,badge,confirmed,membership} = window.consumer.counts;
      if (values.at(-1).count !== confirmed.count || badge.textContent !== String(confirmed.count)) throw Error('A held older count replaced the confirmed contribution observation');
      if (window.consumer.owner.document.roots.ids !== membership) throw Error('Independent count refresh changed the captured reading membership');
    });
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
      reactionRequests.push(route.request().postDataJSON()); return platformClient(route);
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
      await until(() => !owner.acquisition());
      await owner.revalidate(0, [outcome.result.id]);
      check(owner.document.nodes[outcome.result.id]?.body === 'Retained destination after editor dismissal' && owner.document.nodes[outcome.result.id]?.parentId === root && !owner.document.roots.ids.includes(outcome.result.id), 'Independent provider reading confirms a dismissed and reopened reply retains its authored body and destination');

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
    assert.deepEqual(errors, [], 'Custom consumer page errors');
    report.checks.push({ engine: browser.browserType().name(), workflow: 'custom reading, native writing, canonical edits with overlapping interpretation and readable Retry, contribution readback and recovery', status: 'passed' });
    console.log('PASS', browser.browserType().name(), 'custom reading and writing');

    await page.close();
    const setupPage = await fixture.context.newPage();
    fixture.observe(setupPage, 'pageerror', error => errors.push(error.message));
    const requests = [];
    fixture.observe(setupPage, 'request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) requests.push(request.url()); });
    await setupPage.goto(service + '/');
    await setupPage.waitForFunction(() => !document.getElementById('deployment-status').textContent.includes('Checking'));
    await setupPage.locator('#app-form [name="website"]').fill(blog + '/article');
    await setupPage.locator('#app-form button').click();
    const registration = new URL(await setupPage.locator('#app-link').getAttribute('href'));
    assert.equal(registration.origin, 'https://github.com');
    assert.equal(registration.searchParams.get('callback_urls[]'), service + '/auth/callback');
    assert.equal(registration.searchParams.get('discussions'), 'write');
    await setupPage.locator('#configuration-form [name="appId"]').fill('1234');
    await setupPage.locator('#configuration-form [name="clientId"]').fill('Iv1.example');
    await setupPage.locator('#configuration-form [name="repo"]').fill('Example/Comments');
    await setupPage.locator('textarea[name="registration"][form="configuration-form"]').fill(JSON.stringify({ repo: 'example/comments', category: 'Announcements', repositoryId: 'R_fixture', installationId: 123, categoryId: 'CAT_fixture' }));
    await setupPage.locator('#configuration-form button').click();
    const values = await setupPage.locator('#configuration-values').evaluate(list => Object.fromEntries([...list.querySelectorAll('dt')].map(label => [label.textContent, label.nextElementSibling.textContent])));
    assert.deepEqual(JSON.parse(values.REPOSITORIES)['example/comments'].origins, [blog]);
    const registeredPolicy = JSON.parse(values.REPOSITORIES)['example/comments'];
    assert.equal(registeredPolicy.repositoryId, 'R_fixture');
    assert.equal(registeredPolicy.installationId, 123);
    assert.equal(registeredPolicy.categoryId, 'CAT_fixture');
    assert.equal(values.PUBLIC_ORIGIN, service);
    assert.equal('GITHUB_PRIVATE_KEY' in values, false);
    await setupPage.locator('#generate-secret').click();
    const secret = await setupPage.locator('#session-secret').textContent();
    assert.match(secret, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(requests.length, 1, 'Configuration and generated secrets stay local');
    await setupPage.locator('#setup-form [name="term"]').fill('article');
    await setupPage.locator('#setup-form button[type="submit"]').click();
    await setupPage.waitForFunction(() => !document.getElementById('setup-result').hidden);
    assert.equal(requests.length, 2, 'Only deployment status and registered repository information use the network');
    assert.ok(!requests.some(url => url.includes(secret)));
    assert.ok((await setupPage.locator('#setup-code').textContent()).includes(`src="${service}/client.js?v=7"`));
    assert.ok((await setupPage.locator('#setup-code').textContent()).includes('data-page-key="article"'));
    assert.deepEqual(errors, [], 'Setup page errors');
    report.checks.push({ engine: browser.browserType().name(), workflow: 'local registered configuration and typed embed generation', status: 'passed' });
    console.log('PASS', browser.browserType().name(), 'setup privacy');
  } finally { await fixture.close(); }
}
