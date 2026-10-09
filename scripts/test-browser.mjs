import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdir, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evidence } from '../test/evidence.mjs';
import { browserBehavior } from '../test/browser-behavior.mjs';

const { chromium, webkit, expect } = await import(process.env.PLAYWRIGHT_MODULE || '@playwright/test');
const root = fileURLToPath(new URL('../', import.meta.url));
const report = evidence('real-browser-acceptance');
const screenshots = process.env.BROWSER_SCREENSHOTS;
if (screenshots) await mkdir(screenshots, { recursive: true });
let client = 0;
const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
const ports = await Promise.all([0, 1].map(async () => {
  const server = createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port;
}));
const service = 'http://127.0.0.1:' + ports[0], blog = 'http://127.0.0.1:' + ports[1];
const demo = spawn(process.execPath, ['scripts/demo.mjs'], { cwd: root, env: { ...process.env, PORT: String(ports[0]), BLOG_PORT: String(ports[1]) }, stdio: ['ignore', 'pipe', 'pipe'] });
let output = ''; demo.stdout.on('data', chunk => output += chunk); demo.stderr.on('data', chunk => output += chunk);
try {
  await expect.poll(async () => {
    if (demo.exitCode !== null || demo.signalCode !== null) throw new Error('Demo exited: ' + output);
    try { return (await fetch(service + '/healthz')).status; } catch { return 0; }
  }, { timeout: 20000, message: 'local demo readiness' }).toBe(200);
  assert.equal((await fetch(service + '/%2e%2e%2fpackage.json')).status, 404, 'encoded paths cannot escape the public asset directory');
  for (const [engineName, engine] of [['chromium', chromium], ['webkit', webkit]]) {
    const browser = await engine.launch({ headless: true });
    try {
      let capability;
      for (const mode of ['native', 'iframe']) {
        const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
        const page = await context.newPage();
        if (mode === 'native') await page.addInitScript(() => {
          const now = Date.now.bind(Date);
          Date.now = () => now() + Number(sessionStorage.getItem('__qualification_clock') || 0);
        });
        const clientIP = '192.0.2.' + (10 + client++);
        const platformClient = route => route.continue({ headers: { ...route.request().headers(), 'CF-Connecting-IP': clientIP } });
        await page.context().route(service + '/auth/**', platformClient);
        await page.context().route(service + '/api/v5/auth/**', platformClient);
        await page.context().route('https://avatars.githubusercontent.com/u/1', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="20" fill="#d9e2ee"/><circle cx="20" cy="15" r="7" fill="#596b82"/><path d="M7 37v-4a13 13 0 0 1 26 0v4" fill="#596b82"/></svg>' }));
        const errors = []; page.on('pageerror', error => errors.push(error.message));
        const requests = [], proofs = new Set(), capabilities = new Set(), callbackBodies = [];
        let fragmentExposed = false;
        const observe=request=>{
          requests.push({ url: request.url(), referer: request.headers().referer || '', body: request.postData() || '' });
          const authorization = request.headers().authorization;
          if (authorization?.startsWith('Bearer ')) capabilities.add(authorization.slice(7));
          if(new URL(request.url()).pathname.endsWith('/auth/prepare')){
            const body=request.postDataJSON();
            if(body?.proof)proofs.add(body.proof);
            fragmentExposed ||= request.frame().url().includes('gw-proof');
          }
        };
        const responses = response => {
          if (new URL(response.url()).pathname === '/auth/callback') callbackBodies.push(response.text());
        };
        page.context().on('request', observe);
        page.context().on('response', responses);
        try {
          const path = mode === 'native' ? '/native' : '/article';
          await page.goto(blog + path);
          const surface = mode === 'native' ? page : page.frameLocator('iframe.giscus-frame');
          const appearance = changes => mode === 'native'
            ? page.evaluate(changes => window.demoComments.conversation.updateAppearance(changes), changes)
            : page.evaluate(({origin,changes}) => document.querySelector('iframe').contentWindow.postMessage({giscus:{setConfig:changes}},origin), {origin:service,changes});
          const composer = surface.locator('[data-composer="main"]');
          await expect(surface.getByText('Try posting a comment or replying here.', { exact: true })).toBeVisible();
          await expect(surface.getByText('Hono', { exact: true })).toBeVisible();
          await expect(surface.locator('pre').first()).toContainText('export default');
          if (mode === 'iframe') assert.equal(requests.filter(request => new URL(request.url).pathname === '/api/v5/page').length, 0, 'iframe renders its anonymous server bootstrap without fetching the same page again');
          if (screenshots) {
            await expect.poll(() => surface.locator('img').first().evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true);
            await page.screenshot({ path: resolve(screenshots, engineName + '-' + mode + '-reading.png') });
          }
          const hostFont = await page.getByRole('heading', { level: 1 }).evaluate(element => getComputedStyle(element).fontFamily);
          assert.match(hostFont, /^system-ui\b/, 'comments retain the host fixture typography when first mounted');
          await composer.getByRole('button', { name: 'Sign in with GitHub', exact: true }).click();
          const textarea = composer.locator('textarea'); await expect(textarea).toBeEditable();
          await expect(page).toHaveURL(blog + path);
          assert.equal(proofs.size,1,'one private proof prepares this sign-in');
          assert.equal(fragmentExposed,false,'the authorization page must remove its private fragment before preparing');
          for (const proof of proofs) for (const request of requests) assert.ok(!request.url.includes(proof) && !request.referer.includes(proof), 'private sign-in proof must not appear in URLs or referrers');
          await expect.poll(() => capabilities.size).toBeGreaterThan(0);
          capability = [...capabilities][0];
          const callbacks = await Promise.all(callbackBodies);
          assert.ok(callbacks.length > 0, 'the actual callback document was observed');
          for (const secret of [...proofs, ...capabilities]) for (const html of callbacks) assert.ok(!html.includes(secret), 'callback document contains neither capability nor private proof');
          for (const capability of capabilities) for (const request of requests) assert.ok(!request.url.includes(capability) && !request.referer.includes(capability) && !request.body.includes(capability), 'the preallocated capability never travels in URLs, referrers or request bodies');
          const resize = async () => {
            await textarea.scrollIntoViewIfNeeded();
            const box = await textarea.boundingBox();
            await page.mouse.move(box.x + box.width - 10, box.y + box.height - 10);
            await page.mouse.down();
            await page.mouse.move(box.x + box.width - 10, box.y + box.height + 70, { steps: 8 });
            await page.mouse.up();
            await expect.poll(async () => (await textarea.boundingBox()).height).toBeGreaterThan(box.height + 40);
            return (await textarea.boundingBox()).height;
          };
          const blankHeight = await resize();
          await textarea.click(); await page.keyboard.type('First writing');
          await expect(textarea).toHaveValue('First writing');
          assert.ok(Math.abs((await textarea.boundingBox()).height - blankHeight) < 2, 'first typing respects a height chosen before writing');
          await textarea.press(modifier + '+z'); await expect(textarea).toHaveValue('');
          if (mode === 'iframe') await expect.poll(() => page.evaluate(() => Object.values(localStorage).every(raw => !raw.includes('First writing')))).toBe(true);
          await page.reload(); await expect(textarea).toBeEditable(); await expect(textarea).toHaveValue('');
          await textarea.click(); await page.keyboard.type('A contribution with native undo');
          await expect(textarea).toHaveValue('A contribution with native undo');
          const originalEditor=await textarea.elementHandle();
          await textarea.press(modifier + '+z'); await expect(textarea).toHaveValue('');
          await textarea.press(modifier + '+Shift+z'); await expect(textarea).toHaveValue('A contribution with native undo');
          await composer.getByRole('button', { name: 'Preview', exact: true }).click();
          await expect(composer.getByRole('button', { name: 'Write', exact: true })).toBeVisible();
          await composer.getByRole('button', { name: 'Write', exact: true }).click();
          await textarea.press(modifier + '+z'); await expect(textarea).toHaveValue('');
          await textarea.press(modifier + '+Shift+z'); await expect(textarea).toHaveValue('A contribution with native undo');
          if (mode === 'native') {
            await page.evaluate(() => window.demoComments.conversation.revalidate());
            await page.getByRole('button', { name: 'Toggle theme', exact: true }).click();
          } else {
            await appearance({ theme: 'dark' });
          }
          await expect(surface.locator('.giscusflare')).toHaveAttribute('data-theme', 'dark');
          assert.equal(await textarea.evaluate((element,original)=>element===original,originalEditor),true,'appearance retains the actual editing node');
          await expect(textarea).toHaveValue('A contribution with native undo');
          await textarea.focus();
          await textarea.evaluate(element => element.setSelectionRange(2, 6));
          for (const inputPosition of ['top', 'bottom']) {
            await appearance({ inputPosition });
            await expect.poll(async () => {
              const editor = await composer.boundingBox();
              const comment = await (inputPosition === 'top' ? surface.getByRole('article').first() : surface.getByRole('article').last()).boundingBox();
              return inputPosition === 'top' ? editor.y + editor.height <= comment.y + 2 : editor.y >= comment.y + comment.height - 2;
            }).toBe(true);
            await expect.poll(() => textarea.evaluate(element => element.ownerDocument.activeElement === element && element.selectionStart === 2 && element.selectionEnd === 6)).toBe(true);
            assert.equal(await textarea.evaluate((element,original)=>element===original,originalEditor),true,'composer position retains the active editor');
            await expect(textarea).toHaveValue('A contribution with native undo');
          }
          await textarea.press(modifier + '+z'); await expect(textarea).toHaveValue('');
          await textarea.press(modifier + '+Shift+z'); await expect(textarea).toHaveValue('A contribution with native undo');
          const setTheme = async theme => {
            await appearance({ theme });
            await expect(surface.locator('.giscusflare')).toHaveAttribute('data-theme', theme);
          };
          await setTheme('fro');
          await expect.poll(() => surface.locator('.giscusflare').evaluate(element => getComputedStyle(element).fontFamily)).toMatch(/(?:ui-serif|Georgia|Cambria)/);
          await setTheme('purple_dark');
          await expect.poll(() => surface.locator('.giscusflare').evaluate(element => getComputedStyle(element).fontFamily)).toMatch(/Inter/);
          assert.equal(await page.getByRole('heading', { level: 1 }).evaluate(element => getComputedStyle(element).fontFamily), hostFont, 'comment themes may not change the host heading font');
          if (screenshots) {
            await surface.locator('.giscusflare').evaluate(element => element.scrollIntoView({ block: 'start' }));
            await page.screenshot({ path: resolve(screenshots, engineName + '-' + mode + '-purple-top.png') });
          }
          const customTheme = 'https://themes.example/reader.css';
          await page.context().route(customTheme, route => route.fulfill({ contentType: 'text/css', body: `.giscusflare[data-theme="${customTheme}"]{--color-fg-default:rgb(19,70,41);--font-family-default:monospace;font-family:monospace}` }));
          if (mode === 'native') await page.addStyleTag({ url: customTheme });
          await setTheme(customTheme);
          await expect.poll(() => surface.locator('.giscusflare').evaluate(element => getComputedStyle(element).color)).toBe('rgb(19, 70, 41)');
          await expect.poll(() => surface.locator('.giscusflare').evaluate(element => getComputedStyle(element).fontFamily)).toMatch(/monospace/);
          assert.equal(await page.getByRole('heading', { level: 1 }).evaluate(element => getComputedStyle(element).fontFamily), hostFont, 'scoped custom CSS retains host typography');
          if (mode === 'iframe') {
            let deniedFetches = 0;
            const deniedTheme = 'https://unapproved.example/reader.css';
            await page.context().route(deniedTheme, route => { deniedFetches++;return route.fulfill({ contentType: 'text/css', body: '' }); });
            await surface.locator('.giscusflare').evaluate(element => {
              window.themeViolations = [];
              element.ownerDocument.addEventListener('securitypolicyviolation', event => window.themeViolations.push(event.blockedURI));
            });
            await setTheme(deniedTheme);
            await expect.poll(() => surface.locator('.giscusflare').evaluate(() => window.themeViolations.some(uri => uri === 'https://unapproved.example' || uri.startsWith('https://unapproved.example/')))).toBe(true);
            assert.equal(deniedFetches, 0, 'iframe policy refuses an unapproved stylesheet before network transport');
          }
          await setTheme('purple_dark');
          const hostDirection = await page.getByRole('heading', { level: 1 }).evaluate(element => getComputedStyle(element).direction);
          const language = async lang => {
            await appearance({ lang });
            await expect(surface.locator('.giscusflare')).toHaveAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
          };
          await language('ar');
          assert.equal(await surface.locator('.giscusflare').evaluate(element => getComputedStyle(element).direction), 'rtl', 'Arabic presentation follows actual right-to-left flow');
          assert.equal(await page.getByRole('heading', { level: 1 }).evaluate(element => getComputedStyle(element).direction), hostDirection, 'comment language retains host direction');
          await expect(textarea).toHaveValue('A contribution with native undo');
          assert.equal(await textarea.evaluate((element,original)=>element===original,originalEditor),true,'language retains the editing node');
          if (screenshots) await page.screenshot({ path: resolve(screenshots, engineName + '-' + mode + '-rtl.png') });
          await language('en');
          const compactHeight = (await textarea.boundingBox()).height;
          await textarea.fill('A contribution with native undo\n' + 'Additional writing\n'.repeat(10));
          await expect.poll(async () => (await textarea.boundingBox()).height).toBeGreaterThan(compactHeight + 40);
          await textarea.fill('A contribution with native undo');
          await expect.poll(async () => (await textarea.boundingBox()).height).toBeLessThanOrEqual(compactHeight + 2);
          const chosenHeight = await resize();
          await textarea.click(); await textarea.press('End');
          await page.keyboard.type(' and manual resizing');
          await expect(textarea).toHaveValue('A contribution with native undo and manual resizing');
          assert.ok(Math.abs((await textarea.boundingBox()).height - chosenHeight) < 2, engineName + ' ' + mode + ' keyboard typing respects the reader-chosen height');
          await textarea.press(modifier + '+z');
          assert.notEqual(await textarea.inputValue(), 'A contribution with native undo and manual resizing', 'native undo remains effective after manual resizing');
          await textarea.press(modifier + '+Shift+z');
          await expect(textarea).toHaveValue('A contribution with native undo and manual resizing');
          // Safari on macOS uses Option-Tab for controls unless full keyboard navigation is enabled.
          await textarea.focus(); await textarea.press(engineName === 'webkit' && process.platform === 'darwin' ? 'Alt+Tab' : 'Tab');
          const focus=await textarea.evaluate(element => {
            const focused = element.ownerDocument.activeElement, style = element.ownerDocument.defaultView.getComputedStyle(focused);
            return {tag:focused.tagName,classes:focused.className,focusVisible:focused.matches(':focus-visible'),outlineWidth:style.outlineWidth,outlineStyle:style.outlineStyle,boxShadow:style.boxShadow};
          });
          assert.equal(focus.focusVisible && ((parseFloat(focus.outlineWidth)>0 && focus.outlineStyle!=='none') || focus.boxShadow!=='none'),true,engineName+' '+mode+' visible keyboard focus '+JSON.stringify(focus));
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, engineName + ' ' + mode + ' overflow');
          assert.equal(await textarea.evaluate(element => element.ownerDocument.documentElement.scrollWidth > element.ownerDocument.defaultView.innerWidth), false, engineName + ' ' + mode + ' comments overflow');
          const richCommentID = await surface.getByRole('article').filter({ has: surface.getByText('Hono', { exact: true }) }).getAttribute('id');
          const richComment = surface.locator('[id="' + richCommentID + '"]');
          await richComment.locator('.gsc-actions > summary').click();
          await richComment.getByRole('button', { name: 'Edit', exact: true }).click();
          const cancelEdit = richComment.getByRole('button', { name: 'Cancel', exact: true });
          await expect(cancelEdit).toBeVisible();
          await cancelEdit.focus();
          await richComment.evaluate(card => {
            const document = card.ownerDocument, view = document.defaultView, heights = [], id = card.id;
            const sample = () => heights.push(document.getElementById(id)?.getBoundingClientRect().height || 0);
            const observer = new view.MutationObserver(sample);
            observer.observe(document.body, { childList: true, subtree: true, attributes: true });
            let frame;
            const paint = () => { sample(); frame = view.requestAnimationFrame(paint); };
            sample(); frame = view.requestAnimationFrame(paint);
            view.__cancelGeometry = () => {
              observer.disconnect(); view.cancelAnimationFrame(frame); sample();
              return { minimum: Math.min(...heights), heights };
            };
          });
          await cancelEdit.press('Enter');
          await expect(richComment.getByText('Hono', { exact: true })).toBeVisible();
          await richComment.evaluate(card => new Promise(resolve => card.ownerDocument.defaultView.requestAnimationFrame(() => card.ownerDocument.defaultView.requestAnimationFrame(resolve))));
          const canceledGeometry = await richComment.evaluate(card => {
            const view = card.ownerDocument.defaultView, result = view.__cancelGeometry();
            delete view.__cancelGeometry; return result;
          });
          assert.ok(canceledGeometry.minimum > 0, engineName + ' ' + mode + ' Cancel keeps its published card in the reading layout: ' + JSON.stringify(canceledGeometry));
          if (screenshots) await page.screenshot({ path: resolve(screenshots, engineName + '-' + mode + '-writing.png') });
          const contribution = engineName + ' ' + mode + ' real-browser contribution';
          await textarea.fill(contribution);
          await composer.getByRole('button', { name: 'Comment', exact: true }).click();
          await expect(textarea).toHaveValue('');
          await expect(surface.getByText(contribution, { exact: true })).toBeVisible();
          await surface.getByRole('article').filter({ hasText: contribution }).getByRole('button', { name: 'Write a reply…', exact: true }).click();
          const replyComposer = surface.locator('[data-composer^="reply:"]');
          const reply = contribution + ' reply';
          await replyComposer.locator('textarea').fill(reply);
          await replyComposer.getByRole('button', { name: 'Reply', exact: true }).click();
          await expect(surface.getByText(reply, { exact: true })).toBeVisible();
          if (mode === 'native') {
            const recoveryText = 'Keep this writing when my credential expires';
            await page.context().route(service + '/api/v5/contribute', route => route.abort('failed'));
            await textarea.fill(recoveryText);
            await composer.getByRole('button', { name: 'Comment', exact: true }).click();
            await expect.poll(() => page.evaluate(() => {
              const writing = window.demoComments.conversation.writing();
              return writing.protected && !writing.pending && writing.error?.status === 'uncertain';
            })).toBe(true);
            const saved = await page.evaluate(() => Object.entries(localStorage).find(([, value]) => value.includes('Keep this writing when my credential expires')));
            assert.ok(saved, 'uncertain writing is actually persisted');
            const originalIssuance = requests.filter(request => new URL(request.url).pathname === '/api/v5/contribute').map(request => JSON.parse(request.body)).find(input => input.action.body === recoveryText);
            await page.context().unroute(service + '/api/v5/contribute');
            await page.context().route(service + '/api/v5/preview', route => route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: { code: 'UNAUTHENTICATED', message: 'Credential expired' } }) }));
            await composer.getByRole('button', { name: 'Preview', exact: true }).click();
            await expect.poll(() => page.evaluate(() => window.demoComments.conversation.session.signedIn)).toBe(false);
            await expect(textarea).toHaveValue(recoveryText);
            await expect(composer.getByRole('alert')).toBeVisible();
            await page.reload();
            await expect(textarea).toHaveValue(recoveryText);
            await expect(textarea).toBeVisible();
            await page.context().unroute(service + '/api/v5/preview');
            await page.evaluate(capability => window.demoComments.conversation.session.setSession(capability), capability);
            await expect.poll(() => page.evaluate(() => window.demoComments.conversation.writing().actions.retry)).toBe(true);
            await page.evaluate(async () => {
              const writing = window.demoComments.conversation.writing();
              if (writing.error?.status !== 'uncertain' || writing.actions.edit || writing.actions.clear) throw Error('Restored unresolved writing is not protected');
              const result = await writing.submit(); if (result.status !== 'saved') throw Error('Unresolved contribution did not recover');
            });
            const recoveredIssuance = requests.filter(request => new URL(request.url).pathname === '/api/v5/contribute').map(request => JSON.parse(request.body)).at(-1);
            assert.equal(recoveredIssuance.key, originalIssuance.key, 'Passive credential expiry preserves the issued contribution identity');
            assert.deepEqual(recoveredIssuance.action, originalIssuance.action, 'Recovery preserves the authored destination and body');
            await expect(surface.getByText(recoveryText, { exact: true })).toBeVisible();
            const pendingText = engineName + ' reload during a committed request';
            let committed = false, committedId, releaseResponse;
            const responseHeld = new Promise(resolve => { releaseResponse = resolve; });
            await page.context().route(service + '/api/v5/contribute', async route => {
              const response = await route.fetch(); committedId = (await response.json()).id; committed = true; await responseHeld;
              await route.fulfill({ response }).catch(() => {});
            });
            await textarea.fill(pendingText);
            await composer.getByRole('button', { name: 'Comment', exact: true }).click();
            await expect.poll(() => committed).toBe(true);
            await expect.poll(() => page.evaluate(() => window.demoComments.conversation.writing().pending)).toBe(true);
            await page.evaluate(() => sessionStorage.setItem('__qualification_clock', '301000'));
            await page.reload(); releaseResponse(); await page.context().unroute(service + '/api/v5/contribute');
            await expect(textarea).toHaveValue(pendingText);
            await expect(textarea).toBeVisible();
            await page.evaluate(capability => window.demoComments.conversation.session.setSession(capability), capability);
            await expect.poll(() => page.evaluate(() => window.demoComments.conversation.writing().actions.retry)).toBe(true);
            await composer.getByRole('button', { name: 'Sign out', exact: true }).click();
            await expect.poll(() => page.evaluate(() => window.demoComments.conversation.session.signedIn)).toBe(false);
            await expect(textarea).toHaveValue(pendingText);
            await composer.getByRole('button', { name: 'Sign in with GitHub', exact: true }).click();
            await expect(composer.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
            await expect.poll(() => page.evaluate(() => window.demoComments?.conversation.writing().actions.retry ?? false)).toBe(true);
            await expect(textarea).toHaveValue(pendingText);
            capability = [...capabilities].at(-1);
            const recoveredId = await page.evaluate(async () => {
              const writing = window.demoComments.conversation.writing();
              if (writing.error?.status !== 'uncertain' || writing.actions.clear) throw Error('Reloaded pending work is not unresolved writing');
              const result = await writing.submit(); if (result.status !== 'saved') throw Error('Committed contribution did not recover');
              return result.result.id;
            });
            const providerReadback = await fetch(service + '/api/v5/page?' + new URLSearchParams({ input: JSON.stringify({ config: { repo: 'example/comments', origin: blog + '/native', term: 'article' }, ids: [recoveredId] }) }), { headers: { Origin: blog, Authorization: 'Bearer ' + capability } });
            const observed = await providerReadback.json();
            assert.equal(recoveredId, committedId, 'Reloading pending work retries the original provider contribution');
            assert.equal(observed.nodes[recoveredId]?.body, pendingText, 'The recovered contribution is independently readable from the provider');
            await page.evaluate(() => sessionStorage.removeItem('__qualification_clock'));
            const ownerText = engineName + ' unresolved writing belongs to owner A', independentText = engineName + ' separate writing belongs to owner B';
            let ownerProviderId;
            await page.context().route(service + '/api/v5/contribute', async route => {
              const response = await route.fetch(); ownerProviderId = (await response.json()).id; await route.abort('failed');
            });
            await textarea.fill(ownerText); await composer.getByRole('button', { name: 'Comment', exact: true }).click();
            await expect.poll(() => page.evaluate(() => window.demoComments.conversation.writing().error?.status)).toBe('uncertain');
            await page.context().unroute(service + '/api/v5/contribute');
            const ownerRecordId = await page.evaluate(() => window.demoComments.conversation.writing().id);
            const ownerIssuance = requests.filter(request => new URL(request.url).pathname === '/api/v5/contribute').map(request => JSON.parse(request.body)).at(-1);
            const second = await page.context().newPage(); second.on('pageerror', error => errors.push(error.message));
            let independentRecordId;
            try {
              await second.goto(blog + '/native');
              await second.evaluate(async () => { await window.demoComments.conversation.recovery.ready; });
              independentRecordId = await second.evaluate(() => window.demoComments.conversation.newWriting({ kind: 'comment' }).show().id);
              assert.notEqual(independentRecordId, ownerRecordId, 'A second editor owns a distinct record for the same destination');
              await second.locator('[data-composer="main"] textarea').fill(independentText);
              await expect.poll(() => page.evaluate(({ id, text }) => window.demoComments.conversation.recovery.records().some(record => record.id === id && record.text === text), { id: independentRecordId, text: independentText })).toBe(true);
            } finally { await second.close(); }
            await expect(textarea).toHaveValue(ownerText);
            await page.close();
            const recoveredPage = await page.context().newPage(); recoveredPage.on('pageerror', error => errors.push(error.message));
            try {
              await recoveredPage.goto(blog + '/native');
              await expect.poll(() => recoveredPage.evaluate(() => window.demoComments?.conversation.ready ?? false)).toBe(true);
              const restoredProviderId = await recoveredPage.evaluate(async ({ ownerRecordId, independentRecordId, ownerText, independentText }) => {
                const runtime = window.demoComments.conversation; await runtime.recovery.ready;
                const writing = await runtime.recovery.restore(ownerRecordId);
                if (!writing || writing.text !== ownerText || writing.error?.status !== 'uncertain') throw Error('Another owner or closing an editor lost unresolved writing');
                const result = await writing.submit(); if (result.status !== 'saved') throw Error('The original owner record did not recover');
                const ordinary = runtime.recovery.records().find(record => record.id === independentRecordId);
                if (ordinary?.text !== independentText) throw Error('Recovering one owner erased independent writing');
                return result.result.id;
              }, { ownerRecordId, independentRecordId, ownerText, independentText });
              assert.equal(restoredProviderId, ownerProviderId, 'A later owner recovers the original provider contribution');
              const restoredIssuance = requests.filter(request => new URL(request.url).pathname === '/api/v5/contribute').map(request => JSON.parse(request.body)).at(-1);
              assert.equal(restoredIssuance.key, ownerIssuance.key, 'Independent owners preserve the original unresolved receipt key');
              assert.deepEqual(restoredIssuance.action, ownerIssuance.action);
            } finally { await recoveredPage.close(); }
          }
          assert.deepEqual(errors, [], engineName + ' ' + mode + ' page errors');
          report.checks.push({ engine: engineName, version: browser.version(), mode, status: 'passed', authReturn: true, privateProofBoundary: true, nativeUndo: true, previewContinuity: true, appearanceContinuity: true, positionContinuity: true, rtl: true, customThemeCSS: true, themeFonts: true, hostFontIsolation: true, contentSizing: true, manualResizeContinuity: true, keyboardFocus: true, contributionReadback: true, replyReadback: true, serverBootstrap: mode === 'iframe', mobileOverflow: false });
          console.log('PASS', engineName, mode, 'authorization and editor continuity');
        } finally { context.off('request', observe); context.off('response', responses); await context.close(); }
      }
      await browserBehavior({ browser, service, blog, report, capability });
    } finally { await browser.close(); }
  }
  report.status = 'passed';
} catch (error) { report.status = 'failed'; report.details = error.stack || String(error); console.error(report.details); process.exitCode = 1; }
finally {
  if (demo.exitCode === null && demo.signalCode === null) { demo.kill('SIGTERM'); await once(demo, 'exit'); }
  report.completedAt = new Date().toISOString();
  await mkdir(resolve(root, 'test-results/evidence'), { recursive: true });
  await writeFile(resolve(root, 'test-results/evidence/browser-acceptance.json'), JSON.stringify(report, null, 2) + '\n');
}
