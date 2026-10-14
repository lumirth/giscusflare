export function responseGate() {
  let release, arrive;
  const held = new Promise(resolve => { release = resolve; }), seen = new Promise(resolve => { arrive = resolve; });
  return { release, seen, arrived: 0, async wait() { this.arrived++; arrive(); await held; } };
}

export async function browserFixture(browser, service, clientIP, mode = 'native') {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } }), page = await context.newPage();
  const surface = mode === 'native' ? page : page.frameLocator('iframe.giscus-frame');
  const platformHeaders = route => ({ ...route.request().headers(), 'CF-Connecting-IP': clientIP });
  const platformClient = route => route.continue({ headers: platformHeaders(route) });
  const platformFetch = route => route.fetch({ headers: platformHeaders(route) });
  // Include the local provider redirect so one reader keeps its ingress identity.
  await context.route(service + '/**', platformClient);
  const errors = [], responses = [], accountObservations = [], contentResults = [], observers = [], holds = [];
  const observe = (target, event, listener) => { target.on(event, listener); observers.push(() => target.off(event, listener)); };
  const account = path => ['session', 'access', 'identity', 'logout', 'auth/prepare'].some(operation => path === '/api/v7/' + operation);
  observe(page, 'pageerror', error => errors.push(error.message));
  observe(page, 'request', request => {
    const path = new URL(request.url()).pathname;
    if (account(path)) accountObservations.push({ path, request: true, authenticated: Boolean(request.headers().authorization) });
  });
  observe(page, 'response', response => {
    const path = new URL(response.url()).pathname, status = response.status();
    if (path.startsWith('/api/') || path.startsWith('/auth/')) responses.push({ path, status });
    if (account(path)) accountObservations.push({ path, status });
    if (path === '/api/v7/content') void response.json().then(result => contentResults.push(result.results?.map(value => ({ error: value.error, prepared: Boolean(value.prepared), html: value.html !== undefined })))).catch(() => {});
  });
  return { context, page, surface, platformClient, platformFetch, errors, observe,
    diagnose: details => console.error(JSON.stringify({ engine: browser.browserType().name(), errors, responses, contentResults, accountObservations, ...details }, null, 2)),
    async hold(pattern, handle) {
      const gate = responseGate(), listener = route => handle(route, gate);
      gate.dispose = async () => { gate.release(); await context.unroute(service + pattern, listener); };
      holds.push(gate); await context.route(service + pattern, listener); return gate;
    },
    async disposeHolds() { for (const gate of holds) await gate.dispose(); },
    async close() {
      for (const gate of holds) gate.release();
      for (const dispose of observers) dispose();
      await context.close();
    }
  };
}
