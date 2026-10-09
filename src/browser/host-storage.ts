import { scopedStorage, storageNamespace, writingIdentity } from './storage.js';
import type { WritingStore } from './writing-store.js';
import type { Login } from './session.js';
import { challenge } from './dom.js';
import { recoveredWriting, writingTargetKey, type SavedWriting } from '../conversation/writing.js';
type Pending = Login & { fragment?: string; scroll?: number; composer?: string };
const capability = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
const pending = (value: unknown): value is Pending => {
  if (!value || typeof value !== 'object') return false;
  const saved = value as Partial<Pending>;
  return saved.version === 5 && capability(saved.capability) && capability(saved.attempt) && typeof saved.created === 'number' && saved.created <= Date.now() && Date.now() - saved.created < 600000;
};
/** The website owns storage and navigation in both native and iframe embeddings. */
export function hostStorage(service: string, repo: string, recovery: WritingStore | null, position: () => { composer?: string } = () => ({}), lifetime?: AbortSignal) {
  const prefix = storageNamespace(service, repo), { read, write, forget } = scopedStorage(prefix);
  const controller = new AbortController();
  if (lifetime?.aborted) controller.abort();
  else lifetime?.addEventListener('abort', () => controller.abort(), { once: true });
  let draft = writingIdentity({}), legacyDraft = 'writing:' + JSON.stringify([false, 0, '']), scopeLife = new AbortController(), imported: Promise<void> | undefined, error = '';
  const owned = new Set<string>();
  const queued = new Map<string, { scope: string; signal: AbortSignal; record: SavedWriting | null }>();
  const acquiring = new Map<string, Promise<void>>();
  const scope = () => prefix + draft;
  const hintKey = () => 'selected:' + draft;
  const acquire = (id: string, key = scope(), signal = scopeLife.signal) => recovery?.acquire(key, id, signal) ?? Promise.resolve(false);
  const storageFailure = (cause: unknown) => { error = cause instanceof Error ? cause.message : 'Unable to retain writing.'; };
  const publish = (key: string, id: string, record: SavedWriting | null) => { try { if (record) recovery?.save(key, record);else recovery?.remove(key, id); } catch (cause) { storageFailure(cause); } };
  const retain = (record: SavedWriting) => {
    if (owned.has(record.id)) { publish(scope(), record.id, record);return; }
    const key = scope(), signal = scopeLife.signal;
    queued.set(record.id, { scope: key, signal, record });
    if (acquiring.has(record.id)) return;
    const work = acquire(record.id, key, signal).then(acquired => {
      if (signal.aborted || controller.signal.aborted || key !== scope()) return;
      if (!acquired) { error = 'This writing is open in another window.';return; }
      owned.add(record.id);
      const latest = queued.get(record.id);
      if (latest?.scope === key && latest.signal === signal) publish(key, record.id, latest.record);
    }).catch(cause => { if (!signal.aborted && key === scope()) storageFailure(cause); }).finally(() => { if (acquiring.get(record.id) === work) { acquiring.delete(record.id);queued.delete(record.id); } });
    acquiring.set(record.id, work);
  };
  controller.signal.addEventListener('abort', () => scopeLife.abort(), { once: true });
  const session = (changed?: string | null) => {
    if (changed !== undefined) forget('session');
    let value: unknown;
    try { value = changed === undefined ? read('session', true) : JSON.parse(changed || 'null'); } catch { return ''; }
    return capability(value) ? value : '';
  };
  const records = () => (recovery?.load(scope()) ?? []).filter(record => !owned.has(record.id));
  const importPreviousWriting = async () => {
    if (!recovery) return;
    const key = scope(), signal = scopeLife.signal;
    const legacy = `giscusflare:4:${service}:${repo}:` + legacyDraft, marker = key + ':adopted-v4';
    try {
      if (localStorage.getItem(marker)) return;
      const entry = JSON.parse(localStorage.getItem(legacy) || 'null');
      if (!entry || !(entry.expires === null || entry.expires > Date.now()) || typeof entry.value !== 'string') return;
      const saved = JSON.parse(entry.value);
      if (saved.version !== 4 || !Array.isArray(saved.writing)) return;
      for (const previous of saved.writing) {
        const id = 'v4.' + await challenge(JSON.stringify([legacy, previous.issued?.key ?? previous.target]));
        if (signal.aborted || key !== scope()) return;
        const record = recoveredWriting(JSON.stringify({ version: 5, writing: [{ ...previous, id }] }))[0];
        if (!record) continue;
        if (!recovery.load(key).some(existing => existing.id === id)) recovery.save(key, record);
        if (!recovery.load(key).some(existing => existing.id === id)) return;
      }
      localStorage.setItem(marker, 'true');
    } catch (cause) { if (!signal.aborted && key === scope()) storageFailure(cause); }
  };
  const restoreWriting = async (id: string): Promise<SavedWriting | undefined> => {
    if (!recovery || controller.signal.aborted) return;
    const key = scope(), signal = scopeLife.signal;
    try {
      const admitted = owned.has(id) || await acquire(id, key, signal);
      if (signal.aborted || controller.signal.aborted || key !== scope()) return;
      if (!admitted) { error = 'This writing is open in another window.';return; }
      const saved = recovery.load(key).find(record => record.id === id);
      if (saved) { owned.add(id);error = ''; }
      return saved;
    } catch (cause) { if (!signal.aborted && key === scope()) storageFailure(cause); }
  };
  return {
    sessionKey: prefix + 'session', session,
    get writingPrefix() { return scope() + ':record:'; },
    get error() { return error; },
    usePage(page: Parameters<typeof writingIdentity>[0]) {
      const next = writingIdentity(page);
      legacyDraft = 'writing:' + JSON.stringify([Boolean(page.strict), Number(page.number) || 0, page.term || '']);
      if (draft === next) return;
      scopeLife.abort();scopeLife = new AbortController();draft = next;owned.clear();queued.clear();acquiring.clear();imported = undefined;
    },
    records, restoreWriting,
    async recover(): Promise<{ writingRecords: SavedWriting[]; writingSelected: string[]; savedWritingRecords: SavedWriting[] }> {
      const key = scope(), signal = scopeLife.signal;
      await (imported ??= importPreviousWriting());
      if (signal.aborted || key !== scope()) return { writingRecords: [], writingSelected: [], savedWritingRecords: [] };
      const saved = records(), hint = read(hintKey()), selected = Array.isArray(hint) ? hint.filter((id): id is string => typeof id === 'string') : [];
      const groups = new Map<string, SavedWriting[]>();
      for (const record of saved) { const key = writingTargetKey(record.target);groups.set(key, [...groups.get(key) ?? [], record]); }
      const candidates = saved.filter(record => selected.includes(record.id) || groups.get(writingTargetKey(record.target))?.length === 1);
      const writingRecords: SavedWriting[] = [];
      for (const record of candidates) { if (signal.aborted || key !== scope()) break;const adopted = await restoreWriting(record.id);if (adopted) writingRecords.push(adopted); }
      if (signal.aborted || key !== scope()) return { writingRecords: [], writingSelected: [], savedWritingRecords: [] };
      return { writingRecords, writingSelected: selected.filter(id => owned.has(id)), savedWritingRecords: records() };
    },
    receive(value: Record<string, unknown>): void {
      if (value.session === '' || capability(value.session)) write('session', value.session || null, true);
      if (value.signOut) { write('session', null, true);write('pending', null); }
      if (Array.isArray(value.writingSelected)) write(hintKey(), value.writingSelected.filter(id => typeof id === 'string'));
      if (value.writingRecord && recovery && !controller.signal.aborted) {
        const record = recoveredWriting(JSON.stringify({ version: 5, writing: [value.writingRecord] }))[0];
        if (record) retain(record);
      }
      if (typeof value.writingRemoved === 'string') {
        if (owned.has(value.writingRemoved)) publish(scope(), value.writingRemoved, null);
        else { const pending = queued.get(value.writingRemoved);if (pending) pending.record = null; }
      }
      const previous = read('pending');
      if (pending(previous) && value.clearPending === previous.attempt) write('pending', null);
      if (value.pending && typeof value.pending === 'object') {
        const login = value.pending as Partial<Login>;
        if (pending(login)) write('pending', { ...login, fragment: location.hash, scroll: window.scrollY, ...position() });
      }
    },
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
