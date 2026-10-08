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
        const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
        const clientIP = '192.0.2.' + (10 + client++);
        const platformClient = route => route.continue({ headers: { ...route.request().headers(), 'CF-Connecting-IP': clientIP } });
        await page.context().route(service + '/auth/**', platformClient);
        await page.context().route(service + '/api/v3/auth/**', platformClient);
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
          if (mode === 'iframe') assert.equal(requests.filter(request => new URL(request.url).pathname === '/api/v3/page').length, 0, 'iframe renders its anonymous server bootstrap without fetching the same page again');
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
            await page.evaluate(() => window.demoComments.conversation.refresh());
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
          await page.context().route(customTheme, route => route.fulfill({ contentType: 'text/css', body: `.giscusflare[data-theme="${customTheme}"]{--color-fg-default:rgb(19,70,41);--font-family-default:monospace}` }));
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
          await textarea.evaluate(element => element.scrollIntoView({ block: 'center' }));
          const box = await textarea.boundingBox();
          await page.mouse.move(box.x + box.width - 4, box.y + box.height - 4);
          await page.mouse.down();
          await page.mouse.move(box.x + box.width - 4, box.y + box.height + 70, { steps: 8 });
          await page.mouse.up();
          await expect.poll(async () => (await textarea.boundingBox()).height, { message: engineName + ' ' + mode + ' manual resize from ' + JSON.stringify(box) }).toBeGreaterThan(box.height + 40);
          const chosenHeight = (await textarea.boundingBox()).height;
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
            await page.context().route(service + '/api/v3/contribute', route => route.abort('failed'));
            await textarea.fill(recoveryText);
            await composer.getByRole('button', { name: 'Comment', exact: true }).click();
            await expect.poll(() => page.evaluate(() => {
              const draft = window.demoComments.conversation.drafts.get('main');
              return Boolean(draft?.key && !draft.pending && draft.error);
            })).toBe(true);
            const saved = await page.evaluate(() => Object.entries(localStorage).find(([, value]) => value.includes('Keep this writing when my credential expires')));
            assert.ok(saved, 'uncertain writing is actually persisted');
            await page.context().unroute(service + '/api/v3/contribute');
            await page.context().route(service + '/api/v3/preview', route => route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: { code: 'UNAUTHENTICATED', message: 'Credential expired' } }) }));
            await composer.getByRole('button', { name: 'Preview', exact: true }).click();
            await expect.poll(() => page.evaluate(() => window.demoComments.conversation.session.signedIn)).toBe(false);
            assert.equal(await page.evaluate(key => localStorage.getItem(key), saved[0]), saved[1], 'passive credential expiry retains the exact persisted text and retry identity');
            await page.reload();
            await expect(textarea).toHaveValue(recoveryText);
            await page.context().unroute(service + '/api/v3/preview');
          }
          assert.deepEqual(errors, [], engineName + ' ' + mode + ' page errors');
          report.checks.push({ engine: engineName, version: browser.version(), mode, status: 'passed', authReturn: true, privateProofBoundary: true, nativeUndo: true, previewContinuity: true, appearanceContinuity: true, positionContinuity: true, rtl: true, customThemeCSS: true, themeFonts: true, hostFontIsolation: true, contentSizing: true, manualResizeContinuity: true, keyboardFocus: true, contributionReadback: true, replyReadback: true, serverBootstrap: mode === 'iframe', mobileOverflow: false });
          console.log('PASS', engineName, mode, 'authorization and editor continuity');
        } finally { page.context().off('request', observe); page.context().off('response', responses); await page.close(); }
      }
      await browserBehavior({ browser, service, blog, report, capability });
    } finally { await browser.close(); }
  }
  report.status = 'passed';
} catch (error) { report.status = 'failed'; report.details = error.stack || String(error); console.error(report.details); process.exitCode = 1; }
finally {
  if (demo.exitCode === null && demo.signalCode === null) { demo.kill('SIGTERM'); await once(demo, 'exit'); }
  report.completedAt = new Date().toISOString();
  await mkdir(resolve(root, 'docs/evidence'), { recursive: true });
  await writeFile(resolve(root, 'docs/evidence/browser-acceptance.json'), JSON.stringify(report, null, 2) + '\n');
}
