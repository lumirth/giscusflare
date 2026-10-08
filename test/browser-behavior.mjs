import assert from 'node:assert/strict';

/** Custom consumers and content run against the same native service as the embedding journey. */
export async function browserBehavior({ browser, service, blog, report, capability }) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [], providerPreviews = [], contentReads = [];
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.pathname === '/api/v4/preview') providerPreviews.push(url.href);
    if (url.pathname === '/api/v4/page') contentReads.push(JSON.parse(url.searchParams.get('input')));
  });
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(blog + '/__behavior');
    await page.evaluate(async ({ service, blog, capability }) => {
      const api = await import(service + '/headless.js');
      const { mountContent } = await import(service + '/content.js');
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
        await mountContent(node, githubContent(options), { signal: lifetime.signal }).update({ markdown: 'Original source', html, repo: 'example/comments', purpose: 'comment' }).catch(() => {});
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
        } }), { signal: scope.signal }).update({ markdown: 'x', html: '<math-renderer>x</math-renderer>', purpose: 'comment', repo: owner.config.repo });
      };
      const rendering = { disposals: 0, updates: 0, inputs: [] };
      const localMarkdown = async (input, context) => {
        await Promise.resolve();
        context.signal.throwIfAborted();
        if (input.markdown === 'Failed custom rendering remains readable') throw Error('Renderer offline');
        const article = document.createElement('section'), counter = document.createElement('button'), source = document.createElement('p');
        article.dataset.hostMarkdown = input.purpose; source.textContent = input.markdown;
        let clicks = 0; counter.textContent = 'Clicks 0'; counter.onclick = () => { counter.textContent = 'Clicks ' + ++clicks; };
        article.append(source, counter); rendering.inputs.push(input);
        return { node: article, async update(next, nextContext) {
          await Promise.resolve(); nextContext.signal.throwIfAborted(); rendering.updates++;
          rendering.inputs.push(next); source.textContent = next.markdown;
        }, dispose() { rendering.disposals++; counter.onclick = null; } };
      };
      const mounted = api.mountPresentation(target, { service, page: { repo: 'example/comments', origin: blog + '/article', term: 'article' }, content: localMarkdown, fetching: { onFocus: true, staleAfterMs: 0 }, writingRecovery: false, host: { emit() {}, navigate() { throw Error('Unexpected custom-consumer navigation'); } } }, custom);
      const owner = mounted.conversation;
      owner.initialize({ session: capability });
      await until(() => owner.ready);
      check(owner.document.roots.ids.length > 0, 'Custom consumer acquires the real repository document');
      owner.writing().update('Writing belongs to this page');
      await editor.preview();
      check(editor.previewElement.textContent.includes('Writing belongs to this page'), 'A website Markdown pipeline previews original writing');
      check(rendering.inputs.at(-1).purpose === 'preview' && rendering.inputs.at(-1).draft === 'main', 'The preview renderer receives original writing identity and purpose');
      editor.write(); owner.writing().update('Failed custom rendering remains readable');
      await editor.preview();
      check(editor.previewElement.textContent === 'Failed custom rendering remains readable' && editor.error.includes('Renderer offline'), 'Failed website preview retains original writing alongside its error');
      editor.write(); owner.writing().update('Writing belongs to this page');
      const oldInput = editor.textarea;
      check(oldInput.value === 'Writing belongs to this page', 'Custom native editor receives model writing');
      const { createStandardPresentation } = await import(service + '/native.js');
      mounted.replacePresentation(createStandardPresentation());
      check(mounted.conversation === owner && target.querySelector('textarea').value === 'Writing belongs to this page', 'Changing design keeps the actual page and writing');
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
      const shared = mountContent(host, localMarkdown);
      await shared.update({ markdown: 'First mounted value', purpose: 'comment', repo: owner.config.repo });
      const retained = host.firstChild, control = retained.querySelector('button'); control.click();
      await shared.update({ markdown: 'Second mounted value', purpose: 'comment', repo: owner.config.repo });
      check(host.firstChild === retained && control.textContent === 'Clicks 1' && host.textContent.includes('Second mounted value'), 'Changed content updates the same mounted component without losing its state');
      const beforeDispose = rendering.disposals; shared.dispose();
      check(!host.hasChildNodes() && rendering.disposals === beforeDispose + 1, 'Mounted website content releases its resources when retired');
      let releaseLate, lateDisposals = 0;
      const deferred = mountContent(host, () => new Promise(resolve => { releaseLate = resolve; }));
      const lateWork = deferred.update({ markdown: 'Readable pending source', purpose: 'comment', repo: owner.config.repo });
      check(host.textContent === 'Readable pending source', 'Unfinished custom rendering leaves readable original writing');
      deferred.dispose();
      releaseLate({ node: document.createElement('span'), dispose() { lateDisposals++; } }); await lateWork;
      check(lateDisposals === 1 && !host.hasChildNodes(), 'A retired asynchronous renderer cannot attach its late result');
      const offline = mountContent(host, async () => { throw Error('Renderer offline'); });
      await offline.update({ markdown: 'Readable failed source', purpose: 'comment', repo: owner.config.repo }).catch(() => {});
      check(host.textContent === 'Readable failed source', 'Custom renderer failure retains readable original writing'); offline.dispose(); host.remove();
      window.consumer = { mounted, owner, target, until, check, capability };
    }, { service, blog, capability });
    const textarea = page.locator('.forum-composer textarea');
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
    await page.context().route(service + '/api/v4/contribute', route => {
      reactionRequests.push(route.request().postDataJSON()); return route.abort('failed');
    });
    await page.evaluate(async () => {
      const { owner, check } = window.consumer, id = owner.document.roots.ids[0];
      window.consumer.recoverySubject = id;
      window.consumer.recoverySelected = !Boolean(owner.reactions(id).HEART?.selected);
      await owner.setReaction(id, 'HEART', window.consumer.recoverySelected).catch(() => {});
      check(owner.actions(id).react.status === 'recovery' && owner.actions(id).recover.status === 'available', 'A custom presentation can identify an unresolved reaction without inspecting private intents');
    });
    await page.context().unroute(service + '/api/v4/contribute');
    await page.context().route(service + '/api/v4/contribute', route => {
      reactionRequests.push(route.request().postDataJSON()); return route.continue();
    });
    await page.getByRole('article').filter({ has: page.getByRole('button', { name: 'Recover action', exact: true }) }).getByRole('button', { name: 'Recover action', exact: true }).click();
    await page.waitForFunction(() => window.consumer.owner.actions(window.consumer.recoverySubject).react.status !== 'recovery');
    await page.context().unroute(service + '/api/v4/contribute');
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

      mounted.replacePage({ repo: 'example/comments', origin: owner.config.origin, term: 'Another page' });
      check(owner.signal.aborted, 'Navigation retires the former document owner');
      mounted.conversation.initialize({ session: capability });
      await until(() => mounted.conversation.ready);
      check(!target.textContent.includes('Try posting a comment'), 'A replacement page does not adopt the old document');
      mounted.dispose();
      check(!target.hasChildNodes(), 'Final disposal releases the current view');
    });
    assert.ok(contentReads.length > 0 && contentReads.every(input => input.html === false), 'A local Markdown consumer acquires source without provider HTML');
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
