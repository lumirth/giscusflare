import { scopedStorage, storageNamespace, draftIdentity } from './storage.js';
import type { DraftStore } from './draft-store.js';
import type { Login } from './session.js';
import { challenge } from './dom.js';
type Pending = Login & { fragment?: string; scroll?: number; composer?: string };
const capability = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
const pending = (value: unknown): value is Pending => {
  if (!value || typeof value !== 'object') return false;
  const saved = value as Partial<Pending>;
  return saved.version === 3 && capability(saved.capability) && capability(saved.attempt) && typeof saved.created === 'number' && saved.created <= Date.now() && Date.now() - saved.created < 600000;
};
/** The website owns storage and navigation in both native and iframe embeddings. */
export function hostStorage(service: string, repo: string, recovery: DraftStore | null, position: () => { composer?: string } = () => ({})) {
  const prefix = storageNamespace(service, repo), { read, write, forget } = scopedStorage(prefix);
  let draft = draftIdentity({});
  const session = (changed?: string | null) => {
    if (changed !== undefined) forget('session');
    let value: unknown;
    try { value = changed === undefined ? read('session', true) : JSON.parse(changed || 'null'); } catch { return ''; }
    return capability(value) ? value : '';
  };
  return {
    sessionKey: prefix + 'session', session,
    usePage(page: Parameters<typeof draftIdentity>[0]) { draft = draftIdentity(page); },
    draft: () => recovery?.load(prefix + draft),
    receive(value: Record<string, unknown>): void {
      if (value.session === '' || capability(value.session)) write('session', value.session || null, true);
      if (value.signOut) { write('session', null, true); write('pending', null); recovery?.remove(prefix + draft); }
      if (typeof value.draftState === 'string' && value.draftState.length <= 240000) {
        if (value.draftsPresent) recovery?.save(prefix + draft, value.draftState);
        else recovery?.remove(prefix + draft);
      }
      const previous = read('pending');
      if (pending(previous) && value.clearPending === previous.attempt) write('pending', null);
      if (value.pending && typeof value.pending === 'object') {
        const login = value.pending as Partial<Login>;
        if (pending(login)) {
          write('pending', { ...login, fragment: location.hash, scroll: window.scrollY, ...position() });
        }
      }
    },
    returning(): { handoff: Login; position: Pending } | undefined {
      if (!location.hash.startsWith('#gw-auth=')) return;
      try {
        const bytes = Uint8Array.from(atob(location.hash.slice(9).replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
        const value = JSON.parse(new TextDecoder().decode(bytes));
        const stored = read('pending'), url = new URL(location.href);
        const matched = value.repo === repo && capability(value.attempt) && ['ready','denied'].includes(value.status) && pending(stored) && stored.attempt === value.attempt;
        url.hash = matched ? stored.fragment || '' : '';
        history.replaceState(history.state, '', url);
        if (matched) return { handoff: { capability: stored.capability, attempt: stored.attempt, created: stored.created, version: 3, status: value.status }, position: stored };
      } catch { /* Malformed return fragments never grant a session. */ }
    },
    async navigate(value: string): Promise<boolean> {
      let url: URL;
      try { url = new URL(value); } catch { return false; }
      const saved = read('pending');
      if (url.origin !== service || url.pathname !== '/auth/window' || url.searchParams.get('repo') !== repo || url.searchParams.get('mode') !== 'redirect' || !pending(saved) || url.searchParams.get('attempt') !== saved.attempt) return false;
      if (url.hash !== '#gw-proof=' + await challenge(saved.capability)) return false;
      const current = read('pending');
      if (!pending(current) || current.attempt !== saved.attempt || current.capability !== saved.capability) return false;
      // A full-page return needs its future capability to survive navigation.
      let persisted: unknown;
      try { persisted = JSON.parse(sessionStorage.getItem(prefix + 'pending') || 'null'); } catch { /* Refuse navigation without durable browser proof. */ }
      if (!pending(persisted) || persisted.attempt !== saved.attempt || persisted.capability !== saved.capability) throw new Error('Browser storage is unavailable.');
      location.assign(url.toString());
      return true;
    },
  };
}
