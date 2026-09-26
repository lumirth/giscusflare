import {storageNamespace,draftIdentity,scopedStorage} from './storage.js';
import {browserDraftStore} from './draft-store.js';
import {fetchPolicy} from '../conversation/fetch-policy.js';
(() => {
  const script = document.currentScript;
  if (!(script instanceof HTMLScriptElement)) return;
  const service = new URL(script.src).origin, data = script.dataset, repo = (data.repo || '').toLowerCase();
  const namespace = storageNamespace(service,repo);
  const {read,write}=scopedStorage(namespace);
  let fetching=fetchPolicy();
  try{if(data.fetching)fetching=fetchPolicy(JSON.parse(data.fetching));}catch{console.warn('giscusflare: invalid fetching policy; using defaults.');}
  const recovery=data.draftRecovery==='off'?null:browserDraftStore(Number(data.draftRetentionMs)||300_000);
  type Pending = { verifier: string; challenge: string; created: number; fragment: string; attempt?: string; scroll?:number };
  function pending(value: unknown): value is Pending {
    if (!value || typeof value !== 'object') return false;
    const p = value as Partial<Pending>;
    return typeof p.verifier === 'string' && /^[A-Za-z0-9_-]{43}$/.test(p.verifier) && typeof p.challenge === 'string' && /^[A-Za-z0-9_-]{43}$/.test(p.challenge) && typeof p.created === 'number' && Date.now() - p.created < 600000;
  }
  const page = new URL(location.href);
  let returnScroll:number|undefined;
  let handoff: { ticket: string; attempt: string; verifier: string; challenge: string } | null = null;
  if (page.hash.startsWith('#gw-auth=')) {
    try {
      const encoded = page.hash.slice(9), bytes = Uint8Array.from(atob(encoded.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
      const raw: unknown = JSON.parse(new TextDecoder().decode(bytes));
      if (raw && typeof raw === 'object') {
        const result = raw as Record<string, unknown>;
        if (result.repo === repo && typeof result.challenge === 'string' && typeof result.ticket === 'string' && typeof result.attempt === 'string' && /^[A-Za-z0-9_-]{43}$/.test(result.ticket) && /^[A-Za-z0-9_-]{43}$/.test(result.attempt)) {
          const stored = read('pending:' + result.challenge);
          if (pending(stored)) { handoff = { ticket: result.ticket, attempt: result.attempt, verifier: stored.verifier, challenge: result.challenge }; page.hash = stored.fragment || '';returnScroll=stored.scroll; }
          else page.hash = '';
          history.replaceState(history.state, '', page.toString());
        }
      }
    } catch { /* Ignore malformed sign-in fragments. */ }
  }
  page.searchParams.delete('giscus'); page.hash = '';
  const metadata = (key: string) => document.querySelector<HTMLMetaElement>(`meta[property="og:${key}"],meta[name="${key}"]`)?.content || '';
  const mapping = data.mapping || 'pathname'; let term = '';
  switch (mapping) {
    case 'pathname': term = page.pathname.length < 2 ? 'index' : page.pathname.slice(1).replace(/\.\w+$/, ''); break;
    case 'url': term = page.toString(); break;
    case 'title': term = document.title; break;
    case 'og:title': term = metadata('title'); break;
    case 'specific': term = data.term || ''; break;
    case 'number': break;
    default: console.error('giscusflare: unknown mapping.'); return;
  }
  const params = new URLSearchParams({ repo, repoId: data.repoId || '', category: data.category || '', categoryId: data.categoryId || '', origin: page.toString(), backLink: document.querySelector<HTMLMetaElement>('meta[name="giscus:backlink"]')?.content || page.toString(), term, strict: data.strict || '0', theme: data.theme || 'preferred_color_scheme', lang: data.lang || 'en', reactionsEnabled: data.reactionsEnabled || '1', emitMetadata: data.emitMetadata || '0', inputPosition: data.inputPosition || 'bottom', description: metadata('description').replace(/\s+/g, ' ').slice(0, 2000) });
  if (mapping === 'number') params.set('number', data.term || '');
  const frame = document.createElement('iframe'); frame.className = 'giscus-frame'; frame.title = 'Comments'; frame.referrerPolicy = 'no-referrer'; frame.allow='clipboard-write';
  if (data.loading === 'lazy') frame.loading = 'lazy';
  frame.src = `${service}/widget?${params}`;
  type Host = HTMLElement & { __gwCleanup?: () => void };
  let host = (data.container ? document.getElementById(data.container) : document.querySelector('.giscus')) as Host | null;
  if (!host) { host = document.createElement('div'); host.className = 'giscus'; script.after(host); }
  host.__gwCleanup?.(); host.replaceChildren(frame);
  if (![...document.querySelectorAll<HTMLLinkElement>('link[data-gw-style]')].some(l => l.dataset.gwStyle === service)) {
    const style = document.createElement('link'); style.rel = 'stylesheet'; style.href = service + '/embed.css'; style.dataset.gwStyle = service; document.head.append(style);
  }
  let draftKey=draftIdentity({category:params.get('category'),categoryId:params.get('categoryId'),strict:params.get('strict')==='1',number:params.get('number'),term});
  const post = (value: unknown) => frame.contentWindow?.postMessage({ giscus: value }, service);
  const handler = (event: MessageEvent) => {
    if (event.origin !== service || event.source !== frame.contentWindow || !event.data?.giscus || typeof event.data.giscus !== 'object') return;
    const message = event.data.giscus as Record<string, unknown>;
    if (message.ready) {
      const config = message.context as Record<string, unknown> | undefined;
      if (config?.repo === repo && typeof config.term === 'string' && config.term.length <= 256) draftKey = draftIdentity(config);
      const storedSession = read('session', true);
      post({ init: { session: typeof storedSession === 'string' ? storedSession : '', draftState: recovery?.load(namespace+draftKey), fetching, handoff } }); handoff = null;
    }
    if (typeof message.resizeHeight === 'number' && Number.isFinite(message.resizeHeight)) frame.style.height = `${Math.min(100000, Math.max(80, Math.ceil(message.resizeHeight)))}px`;
    if (typeof message.session === 'string' && /^[A-Za-z0-9_-]{43}$/.test(message.session)) write('session', message.session, true);
    if (message.signOut) {write('session', null, true);recovery?.remove(namespace+draftKey);}
    if (typeof message.draftState === 'string' && message.draftState.length <= 240000) {if(message.draftsPresent)recovery?.save(namespace+draftKey,message.draftState);else recovery?.remove(namespace+draftKey);}
    if (message.pending && typeof message.pending === 'object') {
      const p = message.pending as Record<string, unknown>;
      if (typeof p.verifier === 'string' && typeof p.challenge === 'string' && /^[A-Za-z0-9_-]{43}$/.test(p.verifier) && /^[A-Za-z0-9_-]{43}$/.test(p.challenge)) {
        const saved = write('pending:' + p.challenge, { verifier: p.verifier, challenge: p.challenge, created: Date.now(), fragment: location.hash, scroll:window.scrollY, ...(typeof p.attempt === 'string' ? { attempt: p.attempt } : {}) });
        post({ pendingSaved: { challenge: p.challenge, saved } });
      }
    }
    if (typeof message.clearPending === 'string' && /^[A-Za-z0-9_-]{43}$/.test(message.clearPending)) write('pending:' + message.clearPending, null);
    if (typeof message.navigate === 'string') {
      try {
        const url = new URL(message.navigate);
        const saved = read('pending:' + (url.searchParams.get('challenge') || ''));
        if (url.origin === service && url.pathname === '/auth/window' && url.searchParams.get('repo') === repo && url.searchParams.get('mode') === 'redirect' && pending(saved)) {
          // Full-page sign-in needs a proof saved in session storage.
          try { if (!sessionStorage.getItem(namespace + 'pending:' + saved.challenge)) throw new Error(); }
          catch { post({ loginError: 'Allow popups for this site to sign in.' }); return; }
          location.assign(url.toString());
        }
      } catch { /* Refuse arbitrary destinations. */ }
    }
    if(message.rendered&&returnScroll!==undefined){window.scrollTo({top:returnScroll});returnScroll=undefined;}
    if (message.error) console.warn('[giscusflare]', String(message.error).slice(0, 300));
    if (Object.hasOwn(message, 'discussion')) host?.dispatchEvent(new CustomEvent('giscus', { detail: message }));
  };
  const storage = (event: StorageEvent) => { if (event.key === namespace + 'session') { const value = read('session', true); post({ sessionChanged: typeof value === 'string' ? value : '' }); } };
  window.addEventListener('message', handler); window.addEventListener('storage', storage);
  host.__gwCleanup = () => { window.removeEventListener('message', handler); window.removeEventListener('storage', storage); };
})();
