import assert from 'node:assert/strict';

/** Custom consumers and content run against the same native service as the embedding journey. */
export async function browserBehavior({ browser, service, blog, report, capability }) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(blog + '/__behavior');
    await page.evaluate(async ({ service, blog, capability }) => {
      const api = await import(service + '/native.js');
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
      contentHost.className = 'giscusflare';
      document.body.append(contentHost);
      const content = (html, options = {}) => {
        const node = document.createElement('div');
        node.className = 'markdown';
        contentHost.append(node);
        node.append(api.createContentRenderer(options)(html, '', lifetime.signal));
        return node;
      };
      const rich = content('<script>window.executed=true</script><img onerror="window.executed=true" src="data:x"><a href="javascript:alert(1)">bad</a><table><tr><td rowspan="2">cell</td></tr></table><input type="checkbox" checked>');
      check(!window.executed && !rich.querySelector('script,[onerror],[onclick]'), 'Rich content cannot execute scripts or event handlers');
      check(!rich.querySelector('a').hasAttribute('href'), 'Executable links are inert');
      check(rich.querySelector('td').rowSpan === 2 && rich.querySelector('input').checked && rich.querySelector('input').disabled, 'Useful table and task-list semantics survive sanitization');
      const math = content('<p><math-renderer class="js-inline-math">$x^2$</math-renderer></p><math-renderer>$$\\frac{a}{b}$$</math-renderer>');
      await until(() => !math.querySelector('[aria-busy]'));
      check(math.querySelectorAll('math').length === 2 && math.querySelector('mfrac'), 'Inline and display mathematics preserve fraction semantics');
      check([...math.querySelectorAll('math')].map(node => getComputedStyle(node.parentElement).display).join() === 'inline,block', 'Inline and display math have actual distinct layout');
      const malformed = content('<math-renderer>$\\frac{broken$</math-renderer>');
      await until(() => !malformed.querySelector('[aria-busy]'));
      check(malformed.querySelector('code')?.textContent === '$\\frac{broken$', 'Invalid mathematics keeps readable source');
      const failedCode = content('<pre><code>fn main() {}</code></pre>', { code: async () => { throw Error('offline'); } });
      await new Promise(resolve => setTimeout(resolve, 0));
      check(failedCode.querySelector('pre').textContent === 'fn main() {}', 'Failed enhancement keeps readable code');
      let copied;
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async value => { copied = value; } } });
      const code = content('<pre><code>first line\n  second line\n' + 'a'.repeat(200) + '</code></pre>');
      code.querySelector('button').click();
      await until(() => copied !== undefined);
      check(copied === 'first line\n  second line\n' + 'a'.repeat(200), 'Copy preserves the complete plain source');
      const buttonX = code.querySelector('button').getBoundingClientRect().x;
      code.querySelector('pre').scrollLeft = 100;
      check(code.querySelector('pre').scrollLeft > 0 && code.querySelector('button').getBoundingClientRect().x === buttonX, 'Long code scrolls while its copy control stays reachable');
      lifetime.abort();
      contentHost.remove();

      const target = document.createElement('div');
      document.body.append(target);
      let editor, enhancementSignal, releaseEnhancement, releases = 0;
      const custom = (host, owner, scope) => {
        const body = document.createElement('div');
        host.append(body);
        scope.own(() => { releases++; host.replaceChildren(); });
        editor = api.createEditor(owner, 'main', { draftWhileSignedOut: true, signal: scope.signal, render(current) {
          if (!current.form.hasChildNodes()) current.form.append(current.textarea, current.previewElement);
          if (!current.form.isConnected) host.append(current.form);
        } });
        body.append(api.createContentRenderer({ math: (_source, _display, signal) => {
          enhancementSignal = signal;
          return new Promise(resolve => { releaseEnhancement = resolve; });
        } })('<math-renderer>x</math-renderer>', '', scope.signal));
      };
      const mounted = api.mountPresentation(target, { service, page: { repo: 'example/comments', origin: blog + '/article', term: 'article' }, fetching: false, draftRecovery: false, host: { emit() {}, navigate() { throw Error('Unexpected custom-consumer navigation'); } } }, custom);
      const owner = mounted.conversation;
      owner.initialize({ session: capability });
      await until(() => owner.ready);
      check(owner.document.roots.ids.length > 0, 'Custom consumer acquires the real repository document');
      owner.setDraft('main', 'Writing belongs to this page');
      const oldInput = editor.textarea;
      check(oldInput.value === 'Writing belongs to this page', 'Custom native editor receives model writing');
      mounted.replacePresentation(api.createStandardPresentation());
      check(mounted.conversation === owner && target.querySelector('textarea').value === 'Writing belongs to this page', 'Changing design keeps the actual page and writing');
      check(releases === 1 && enhancementSignal.aborted && !oldInput.isConnected, 'Retiring the custom view releases its acquired resources');
      oldInput.value = 'Obsolete input';
      oldInput.dispatchEvent(new Event('input'));
      check(owner.draft() === 'Writing belongs to this page', 'Detached controls cannot change the surviving page');
      const late = document.createDocumentFragment();
      late.append('Late mathematics');
      releaseEnhancement(late);
      let failedReleases = 0;
      try {
        mounted.replacePresentation((host, pageOwner, scope) => {
          scope.own(() => { failedReleases++; host.replaceChildren(); });
          api.createEditor(pageOwner, 'main', { signal: scope.signal, render(current) { host.append(current.form); current.form.append(current.textarea); } });
          throw Error('Acquisition failed');
        });
        throw Error('Failure was hidden');
      } catch (error) { check(error.message === 'Acquisition failed', 'Failed acquisition reports its original error'); }
      check(failedReleases === 1 && !target.hasChildNodes(), 'Failed acquisition leaves no live resources or controls');
      mounted.replacePresentation(forumPresentation);
      check(target.querySelector('textarea').value === 'Writing belongs to this page', 'The independent forum consumer uses the same writing');
      owner.setDraft('main', '');
      window.consumer = { mounted, owner, target, until, check, capability };
    }, { service, blog, capability });
    const textarea = page.locator('.forum-composer textarea');
    await textarea.focus();
    await page.keyboard.type('Forum native editing survives refresh');
    await textarea.evaluate(element => element.setSelectionRange(2, 6));
    await page.evaluate(async () => { await window.consumer.owner.refresh(); });
    assert.equal(await textarea.evaluate(element => document.activeElement === element && element.selectionStart === 2 && element.selectionEnd === 6), true, 'Real refresh retains forum focus and selection');
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    await textarea.press(modifier + '+z');
    assert.equal(await textarea.inputValue(), '', 'Forum keeps native undo across a real refresh');
    await textarea.press(modifier + '+Shift+z');
    assert.equal(await textarea.inputValue(), 'Forum native editing survives refresh');
    await page.evaluate(async () => {
      const { mounted, owner, target, until, check, capability } = window.consumer;
      mounted.replacePage({ repo: 'example/comments', origin: owner.config.origin, term: 'Another page' });
      check(owner.signal.aborted, 'Navigation retires the former document owner');
      mounted.conversation.initialize({ session: capability });
      await until(() => mounted.conversation.ready);
      check(!target.textContent.includes('Try posting a comment'), 'A replacement page does not adopt the old document');
      mounted.dispose();
      check(!target.hasChildNodes(), 'Final disposal releases the current view');
    });
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
    await page.locator('#configuration-form button').click();
    const values = await page.locator('#configuration-values').evaluate(list => Object.fromEntries([...list.querySelectorAll('dt')].map(label => [label.textContent, label.nextElementSibling.textContent])));
    assert.deepEqual(JSON.parse(values.REPOSITORIES)['example/comments'].origins, [blog]);
    assert.equal(values.PUBLIC_ORIGIN, service);
    assert.equal('GITHUB_PRIVATE_KEY' in values, false);
    await page.locator('#generate-secret').click();
    const secret = await page.locator('#session-secret').textContent();
    assert.match(secret, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(requests.length, 1, 'Configuration and generated secrets stay local');
    await page.locator('#setup-form button[type="submit"]').click();
    await page.waitForFunction(() => !document.getElementById('setup-result').hidden);
    assert.equal(requests.length, 2, 'Only deployment status and explicit repository verification use the network');
    assert.ok(!requests.some(url => url.includes(secret)));
    assert.ok((await page.locator('#setup-code').textContent()).includes(`src="${service}/client.js"`));
    assert.deepEqual(errors, [], 'Setup page errors');
    report.checks.push({ engine: browser.browserType().name(), workflow: 'local configuration and explicit provider verification', status: 'passed' });
    console.log('PASS', browser.browserType().name(), 'setup privacy');
  } finally { await page.close(); }
}
