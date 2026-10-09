import {hostStorage} from './host-storage.js';
import {browserWritingStore} from './writing-store.js';
import {fetchPolicy} from '../conversation/fetch-policy.js';
(() => {
  const script = document.currentScript;
  if (!(script instanceof HTMLScriptElement)) return;
  const service = new URL(script.src).origin, data = script.dataset, repo = (data.repo || '').toLowerCase();
  let fetching=fetchPolicy();
  try{if(data.fetching)fetching=fetchPolicy(JSON.parse(data.fetching));}catch{console.warn('giscusflare: invalid fetching policy; using defaults.');}
  const recovery=data.writingRecovery==='off'?null:browserWritingStore(Number(data.writingRetentionMs)||300_000);
  const lifetime = new AbortController();
  const persistence=hostStorage(service,repo,recovery,undefined,lifetime.signal),returned=persistence.returning();
  let returnScroll=returned?.position.scroll,handoff=returned?.handoff??null;
  const page = new URL(location.href);
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
  const params = new URLSearchParams({ repo, origin: page.toString(), backLink: document.querySelector<HTMLMetaElement>('meta[name="giscus:backlink"]')?.content || page.toString(), term, strict: data.strict || '0', theme: data.theme || 'preferred_color_scheme', lang: data.lang || 'en', reactionsEnabled: data.reactionsEnabled || '1', emitMetadata: data.emitMetadata || '0', inputPosition: data.inputPosition || 'bottom', description: metadata('description').replace(/\s+/g, ' ').slice(0, 2000) });
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
  persistence.usePage({origin:page.origin,strict:['1','true'].includes(params.get('strict') || ''),number:params.get('number'),term});
  const post = (value: unknown) => frame.contentWindow?.postMessage({ giscus: value }, service);
  let initialization = 0;
  const handler = (event: MessageEvent) => {
    if (event.origin !== service || event.source !== frame.contentWindow || !event.data?.giscus || typeof event.data.giscus !== 'object') return;
    const message = event.data.giscus as Record<string, unknown>;
    if (message.ready) {
      const config = message.context as Record<string, unknown> | undefined;
      if (config?.repo === repo && typeof config.term === 'string' && config.term.length <= 256) persistence.usePage(config);
      const generation = ++initialization, returning = handoff; handoff = null;
      void persistence.recover().then(state => {
        if (!lifetime.signal.aborted && generation === initialization) post({ init: { session: persistence.session(), ...state, fetching, handoff: returning } });
      }).catch(cause => { if (!lifetime.signal.aborted && generation === initialization) post({ init: { session: persistence.session(), writingRecords: [], savedWritingRecords: [], recoveryError: cause instanceof Error ? cause.message : 'Unable to restore writing.', fetching, handoff: returning } }); });
    }
    if (typeof message.resizeHeight === 'number' && Number.isFinite(message.resizeHeight)) frame.style.height = `${Math.min(100000, Math.max(80, Math.ceil(message.resizeHeight)))}px`;
    persistence.receive(message);
    if (typeof message.restoreWriting === 'string') {
      const id = message.restoreWriting;
      void persistence.restoreWriting(id).then(record => {
        if (!lifetime.signal.aborted) post({ restoredWriting: record, restoreWritingId: id, savedWritingRecords: persistence.records() });
      }).catch(() => { if (!lifetime.signal.aborted) post({ restoreWritingId: id }); });
    }
    if(typeof message.navigate==='string')void persistence.navigate(message.navigate).then(valid=>{if(!valid)post({loginError:'Invalid sign-in destination.'});}).catch(()=>post({loginError:'Allow popups for this site to sign in.'}));
    if(message.rendered&&returnScroll!==undefined){window.scrollTo({top:returnScroll});returnScroll=undefined;}
    if (message.error) console.warn('[giscusflare]', String(message.error).slice(0, 300));
    if (Object.hasOwn(message, 'discussion')) host?.dispatchEvent(new CustomEvent('giscus', { detail: message }));
  };
  const storage = (event: StorageEvent) => { if (event.key === persistence.sessionKey) { post({ sessionChanged: persistence.session(event.newValue) }); } else if (event.key?.startsWith(persistence.writingPrefix)) post({ savedWritingRecords: persistence.records() }); };
  window.addEventListener('message', handler); window.addEventListener('storage', storage);
  host.__gwCleanup = () => { lifetime.abort(); persistence.dispose(); window.removeEventListener('message', handler); window.removeEventListener('storage', storage); };
})();
