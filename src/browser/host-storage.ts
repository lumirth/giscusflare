import { scopedStorage, storageNamespace, writingIdentity } from './storage.js';
import type { WritingStore } from './writing-store.js';
import { validDisplayProfile, validLogin, type DisplayProfile, type Login } from './session.js';
import type { Person } from '../contracts/document.js';
import { challenge } from './dom.js';
import { writingTargetKey, type SavedWriting } from '../conversation/writing.js';
type Pending = Login & { fragment?: string; scroll?: number; composer?: string };
const capability = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
const pending = (value: unknown): value is Pending => {
  if (!validLogin(value)) return false;
  const stored = value as Pending;
  return (stored.fragment === undefined || typeof stored.fragment === 'string') &&
    (stored.scroll === undefined || Number.isFinite(stored.scroll) && stored.scroll >= 0) &&
    (stored.composer === undefined || typeof stored.composer === 'string');
};
/** The website owns storage and navigation in both native and iframe embeddings. */
export function hostStorage(service: string, repo: string, recovery: WritingStore | null, position: () => { composer?: string } = () => ({}), lifetime?: AbortSignal) {
  const prefix = storageNamespace(service, repo), { read, write, forget } = scopedStorage(prefix);
  const controller = new AbortController();
  if (lifetime?.aborted) controller.abort();
  else lifetime?.addEventListener('abort', () => controller.abort(), { once: true });
  let draft = '', scopeLife = new AbortController(), error = '';
  const owned = new Set<string>(), retentionErrors = new Map<string, string>();
  const retaining = new Map<string, {record: SavedWriting | null; work: Promise<void>}>();
  const scope = () => prefix + draft;
  const hintKey = () => 'selected:' + draft;
  const acquire = (id: string, key = scope(), signal = scopeLife.signal) => recovery?.acquire(key, id, signal) ?? Promise.resolve(false);
  const storageFailure = (cause: unknown) => { error = cause instanceof Error ? cause.message : 'Unable to retain writing.'; };
  const retentionFailure = (id: string, cause: unknown) => { retentionErrors.set(id, cause instanceof Error ? cause.message : 'Unable to retain writing.'); };
  const publish = (key: string, id: string, record: SavedWriting | null) => {
    try { if (record) recovery?.save(key, record);else recovery?.remove(key, id);retentionErrors.delete(id); }
    catch (cause) { if (record) retentionFailure(id, cause);else storageFailure(cause); }
  };
  const retain = (record: SavedWriting) => {
    if (owned.has(record.id)) { publish(scope(), record.id, record);return; }
    const pending = retaining.get(record.id);
    if (pending) { pending.record = record;return; }
    const key = scope(), signal = scopeLife.signal;
    const work = acquire(record.id, key, signal).then(acquired => {
      if (signal.aborted || controller.signal.aborted) return;
      const latest = retaining.get(record.id)!;
      if (!acquired) { if (latest.record) retentionFailure(record.id, new Error('This writing is open in another window.'));return; }
      owned.add(record.id);publish(key, record.id, latest.record);
    }).catch(cause => { if (!signal.aborted && retaining.get(record.id)?.record) retentionFailure(record.id, cause); }).finally(() => {
      if (retaining.get(record.id)?.work === work) retaining.delete(record.id);
    });
    retaining.set(record.id, {record, work});
  };
  controller.signal.addEventListener('abort', () => scopeLife.abort(), { once: true });
  const session = (changed?: string | null) => {
    if (changed !== undefined) forget('session');
    let value: unknown;
    try { value = changed === undefined ? read('session', true) : JSON.parse(changed || 'null'); } catch { return ''; }
    return capability(value) ? value : '';
  };
  const records = () => (recovery?.load(scope()) ?? []).filter(record => !owned.has(record.id));
  const restoreWriting = async (id: string): Promise<SavedWriting | undefined> => {
    if (!recovery || controller.signal.aborted) return;
    const key = scope(), signal = scopeLife.signal;
    try {
      const admitted = owned.has(id) || await acquire(id, key, signal);
      if (signal.aborted || controller.signal.aborted || key !== scope()) return;
      if (!admitted) { error = 'This writing is open in another window.';return; }
      const saved = recovery.load(key).find(record => record.id === id);
      if (saved) { owned.add(id);publish(key, id, saved);error = ''; }
      return saved;
    } catch (cause) { if (!signal.aborted && key === scope()) storageFailure(cause); }
  };
  return {
    sessionKey: prefix + 'session', session,
    async displayProfile(token = session()): Promise<DisplayProfile | null> {
      if (!token) return null;
      const fingerprint = await challenge(token), value = read('profile', true) as {fingerprint?: unknown; profile?: unknown} | null;
      return session() === token && value?.fingerprint === fingerprint && validDisplayProfile(value.profile) ? {fingerprint, profile:value.profile} : null;
    },
    async saveDisplayProfile(fingerprint: string, profile: Person): Promise<void> {
      const token = session();
      if (token && validDisplayProfile(profile) && await challenge(token) === fingerprint && session() === token && !controller.signal.aborted) write('profile', {fingerprint, profile}, true);
    },
    get writingPrefix() { return scope() + ':record:'; },
    get error() { return [...retentionErrors.values()][0] || error; },
    usePage(page: Parameters<typeof writingIdentity>[0]) {
      const next = writingIdentity(page);
      if (draft === next) return;
      scopeLife.abort();scopeLife = new AbortController();draft = next;owned.clear();retentionErrors.clear();retaining.clear();
    },
    records, restoreWriting,
    async recover(): Promise<import('./runtime.js').WritingRestoration> {
      const key = scope(), signal = scopeLife.signal;
      if (signal.aborted || key !== scope()) return { records: [], selected: [] };
      const saved = records(), hint = read(hintKey()), selected = Array.isArray(hint) ? hint.filter((id): id is string => typeof id === 'string') : [];
      const groups = new Map<string, SavedWriting[]>();
      for (const record of saved) { const key = writingTargetKey(record.target);groups.set(key, [...groups.get(key) ?? [], record]); }
      const candidates = saved.filter(record => selected.includes(record.id) || groups.get(writingTargetKey(record.target))?.length === 1);
      const writingRecords = (await Promise.all(candidates.map(record => restoreWriting(record.id))))
        .filter((record): record is SavedWriting => Boolean(record));
      if (signal.aborted || key !== scope()) return { records: [], selected: [] };
      return { records: writingRecords, selected: selected.filter(id => owned.has(id)) };
    },
    saveSession(value: string) { if (session() !== value || !value) write('profile', null, true);write('session', value || null, true); },
    selectWriting(ids: readonly string[]) { write(hintKey(), ids); },
    saveWriting(record: SavedWriting) { if (recovery && !controller.signal.aborted) retain(record); },
    removeWriting(id: string) {
      retentionErrors.delete(id);
      if (owned.has(id)) publish(scope(), id, null);
      else { const pending = retaining.get(id);if (pending) pending.record = null; }
    },
    clearPending(attempt?: string) { const saved = read('pending');if (attempt === undefined || pending(saved) && saved.attempt === attempt) write('pending', null); },
    pendingLogin(login: Login & {composer?: string}) { write('pending', {...login, fragment:location.hash, scroll:window.scrollY,...position()}); },
    dispose() { controller.abort(); },
    returning(): { handoff: Login; position: Pending } | undefined {
      if (!location.hash.startsWith('#gw-auth=')) return;
      try {
        const bytes = Uint8Array.from(atob(location.hash.slice(9).replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
        const value = JSON.parse(new TextDecoder().decode(bytes));
        const stored = read('pending'), url = new URL(location.href);
        const matched = value.repo === repo && capability(value.attempt) && ['ready','denied'].includes(value.status) && pending(stored) && stored.attempt === value.attempt;
        url.hash = matched ? stored.fragment || '' : '';
        history.replaceState(history.state, '', url);
        if (matched) return { handoff: { capability: stored.capability, attempt: stored.attempt, created: stored.created, version: 5, status: value.status }, position: stored };
      } catch { /* Malformed return fragments never grant a session. */ }
    },
    async navigate(value: string): Promise<boolean> {
      let url: URL;
      try { url = new URL(value); } catch { return false; }
      const saved = read('pending');
      if (url.origin !== service || url.pathname !== '/auth/window' || url.searchParams.get('repo') !== repo || url.searchParams.get('origin') !== location.origin || url.searchParams.get('mode') !== 'redirect' || !pending(saved) || url.searchParams.get('attempt') !== saved.attempt) return false;
      try { if (new URL(url.searchParams.get('returnURL') || '').origin !== location.origin) return false; } catch { return false; }
      if (url.hash !== '#gw-proof=' + await challenge(saved.capability)) return false;
      while (retaining.size && !controller.signal.aborted) await Promise.allSettled([...retaining.values()].map(pending => pending.work));
      if (controller.signal.aborted) return false;
      if (retentionErrors.size) throw new Error('Unable to save writing before sign-in. ' + [...retentionErrors.values()][0]);
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
