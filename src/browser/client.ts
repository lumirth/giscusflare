import {assetURL} from '../contracts/protocol.js';
import {hostStorage} from './host-storage.js';
import {browserWritingStore} from './writing-store.js';
import {fetchPolicy} from '../conversation/fetch-policy.js';
import {conversationSettings} from './options.js';
import {validLogin} from './session.js';
import {recoveredWriting} from '../conversation/writing.js';
import type {ConversationInitialization} from './runtime.js';
(() => {
  const script = document.currentScript;
  if (!(script instanceof HTMLScriptElement)) return;
  const service = new URL(script.src).origin, data = script.dataset, repo = (data.repo || '').toLowerCase();
  let fetching = fetchPolicy();
  try { if (data.fetching) fetching = fetchPolicy(JSON.parse(data.fetching)); } catch { console.warn('giscusflare: invalid fetching policy; using defaults.'); }
  const recovery = data.writingRecovery === 'off' ? null : browserWritingStore(Number(data.writingRetentionMs) || 300_000);
  const lifetime = new AbortController();
  const persistence = hostStorage(service, repo, recovery, undefined, lifetime.signal), returned = persistence.returning();
  let returnScroll = returned?.position.scroll, handoff = returned?.handoff, composer = returned?.position.composer;
  const currentURL = new URL(location.href), canonicalURL = new URL(document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href || currentURL);
  canonicalURL.hash = '';currentURL.hash = '';
  const metadata = (key: string) => document.querySelector<HTMLMetaElement>(`meta[property="og:${key}"],meta[name="${key}"]`)?.content || '';
  const settings = conversationSettings({repo, origin: currentURL.origin, pageURL: canonicalURL.toString(), returnURL: currentURL.toString(),
    selector: data.discussionNumber ? {kind: 'discussion', number: Number(data.discussionNumber), ...(data.discussionId ? {id: data.discussionId} : {})}
      : {kind: 'page', key: data.pageKey || canonicalURL.pathname.slice(1) || 'index'},
    ...(data.registration ? {registration: data.registration} : {}), description: metadata('description').replace(/\s+/g, ' ').slice(0, 2000),
  });
  const config = settings.page;
  const params = new URLSearchParams({repo, origin: config.origin, pageURL: config.pageURL, returnURL: config.returnURL,
    description: config.description, theme: data.theme || 'preferred_color_scheme', lang: data.lang || 'en',
    reactionsEnabled: data.reactionsEnabled || '1', emitMetadata: data.emitMetadata || '0', inputPosition: data.inputPosition || 'bottom'});
  if (config.selector.kind === 'page') params.set('key', config.selector.key);
  else { params.set('number', String(config.selector.number));if (config.selector.id) params.set('discussionId', config.selector.id); }
  if (config.registration) params.set('registration', config.registration);
  const frame = document.createElement('iframe');frame.className = 'giscus-frame';frame.title = 'Comments';frame.referrerPolicy = 'no-referrer';frame.allow = 'clipboard-write';
  if (data.loading === 'lazy') frame.loading = 'lazy';
  frame.src = `${service}/widget?${params}`;
  type Host = HTMLElement & {__gwCleanup?: () => void};
  let host = (data.container ? document.getElementById(data.container) : document.querySelector('.giscus')) as Host | null;
  if (!host) { host = document.createElement('div');host.className = 'giscus';script.after(host); }
  host.__gwCleanup?.();host.replaceChildren(frame);
  let style = [...document.querySelectorAll<HTMLLinkElement>('link[data-gw-style]')].find(link => link.dataset.gwStyle === service);
  if (!style) { style = document.createElement('link');style.rel = 'stylesheet';style.dataset.gwStyle = service;document.head.append(style); }
  style.href = service + assetURL('/embed.css');
  persistence.usePage(config);
  const post = (value: unknown) => frame.contentWindow?.postMessage({giscus: value}, service);
  const initialize = (init: ConversationInitialization & {availableWriting?: readonly import('../conversation/writing.js').SavedWriting[]}) => post({init});
  let initialization = 0, interrupted = false;
  const interrupt = () => { interrupted = true; };
  for (const name of ['pointerdown', 'keydown', 'wheel', 'touchstart']) window.addEventListener(name, interrupt, {signal: lifetime.signal, passive: true});
  const handler = (event: MessageEvent) => {
    if (event.origin !== service || event.source !== frame.contentWindow || !event.data?.giscus || typeof event.data.giscus !== 'object') return;
    const message = event.data.giscus as Record<string, unknown>;
    if (message.ready) {
      if (message.context && typeof message.context === 'object') {
        try {
          const next = conversationSettings(message.context as import('./options.js').Page).page;
          if (next.repo === repo && next.origin === config.origin) persistence.usePage(next);
        } catch { return; }
      }
      const generation = ++initialization, returning = handoff;handoff = undefined;
      initialize({session: persistence.session(), fetching, handoff: returning, ...(composer ? {position: {composer}} : {})});composer = undefined;
      void persistence.recover().then(writing => {
        if (!lifetime.signal.aborted && generation === initialization) initialize({writing,availableWriting:persistence.records()});
      }).catch(cause => {
        if (!lifetime.signal.aborted && generation === initialization) initialize({writing: {records: [], selected: [], error: cause instanceof Error ? cause.message : 'Unable to restore writing.'}});
      });
    }
    if (typeof message.resizeHeight === 'number' && Number.isFinite(message.resizeHeight)) frame.style.height = `${Math.min(100000, Math.max(80, Math.ceil(message.resizeHeight)))}px`;
    if (typeof message.session === 'string') persistence.saveSession(message.session);
    if (message.clearPending === true || typeof message.clearPending === 'string') persistence.clearPending(message.clearPending === true ? undefined : message.clearPending);
    if (validLogin(message.pending)) { const pending = message.pending as import('./session.js').Login & {composer?: unknown};persistence.pendingLogin({...pending,composer:typeof pending.composer === 'string' ? pending.composer : undefined}); }
    if (Array.isArray(message.writingSelected) && message.writingSelected.every(id => typeof id === 'string')) persistence.selectWriting(message.writingSelected);
    if (message.writingRecord) { const record = recoveredWriting([message.writingRecord])[0];if (record) persistence.saveWriting(record); }
    if (typeof message.writingRemoved === 'string') persistence.removeWriting(message.writingRemoved);
    if (typeof message.restoreWriting === 'string') {
      const id = message.restoreWriting;
      void persistence.restoreWriting(id).then(record => {
        if (!lifetime.signal.aborted) post({restoredWriting: record, restoreWritingId: id, init: {availableWriting: persistence.records()}});
      }).catch(() => { if (!lifetime.signal.aborted) post({restoreWritingId: id}); });
    }
    if (typeof message.navigate === 'string') void persistence.navigate(message.navigate).then(valid => {
      if (!valid) initialize({loginError: 'Invalid sign-in destination.'});
    }).catch(cause => initialize({loginError: cause instanceof Error ? cause.message : 'Browser storage is unavailable.'}));
    if (message.rendered && returnScroll !== undefined) { if (!interrupted) window.scrollTo({top: returnScroll});returnScroll = undefined; }
    if (message.error) console.warn('[giscusflare]', String(message.error).slice(0, 300));
    if (Object.hasOwn(message, 'discussion')) host?.dispatchEvent(new CustomEvent('giscus', {detail: message}));
  };
  const storage = (event: StorageEvent) => {
    if (event.key === persistence.sessionKey) initialize({session: persistence.session(event.newValue)});
    else if (event.key?.startsWith(persistence.writingPrefix)) initialize({availableWriting: persistence.records()});
  };
  window.addEventListener('message', handler);window.addEventListener('storage', storage);
  host.__gwCleanup = () => { lifetime.abort();persistence.dispose();window.removeEventListener('message', handler);window.removeEventListener('storage', storage); };
})();
