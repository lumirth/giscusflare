import { hostStorage } from './host-storage.js';
import { InteractionRegistry } from './interactions.js';
import { fetchPolicy, type FetchPolicy } from '../conversation/fetch-policy.js';
import { browserWritingStore, type WritingRecovery } from './writing-store.js';
import { recoveredWriting, writingTargetKey, type SavedWriting, type Writing } from '../conversation/writing.js';
import { PageModel, type CommentOrder } from '../conversation/page.js';
import { conversationSettings, type Page, type Appearance } from './options.js';
import { BrowserSession, type SessionHost } from './session.js';
import type { ContentRenderer } from './content.js';
import type { ContentSource } from '../contracts/content.js';
import type { WindowPage } from '../contracts/document.js';
import type { Presentation, MountedConversation, ResourceScope } from './presentation.js';

function own(signal: AbortSignal, cleanup: () => void): () => void {
  let active = true;
  const release = () => {
    if (!active) return;
    active = false;
    signal.removeEventListener('abort', release);
    cleanup();
  };
  if (signal.aborted) release();
  else signal.addEventListener('abort', release, { once: true });
  return release;
}

export interface ConversationOptions {
  service: string;
  page: Page;
  appearance?: Partial<Appearance>;
  fetching?: Partial<FetchPolicy> | false;
  writingRecovery?: WritingRecovery | false;
  order?: CommentOrder;
  bootstrap?: { view: WindowPage; expires: number };
  host?: SessionHost;
  content: ContentRenderer;
  contentSource: ContentSource;
}
/** The portable page owner with its actual browser capabilities attached. */
export type Conversation = PageModel & {
  session: BrowserSession;
  appearance: Appearance;
  interactions: InteractionRegistry;
  content: ContentRenderer;
  recovery: {
    readonly ready: Promise<void>;
    records(): readonly SavedWriting[];
    restore(id: string): Promise<Writing | undefined>;
    readonly pending: boolean;
    readonly error: string;
  };
  own(cleanup: () => void): () => void;
  updateAppearance(value: Partial<Appearance>): void;
  initialize(data: Record<string, unknown>): void;
};

export function createConversation(options: ConversationOptions): Conversation {
  const settings = conversationSettings(options.page, options.appearance);
  const lifetime = new window.AbortController(), interactions = new InteractionRegistry();
  const policy = fetchPolicy(options.fetching);
  const recovery = options.writingRecovery === false ? null
    : options.writingRecovery?.store || browserWritingStore(options.writingRecovery?.retentionMs);
  const persistence = options.host ? undefined
    : hostStorage(options.service, settings.page.repo, recovery, () => ({ composer: interactions.active }), lifetime.signal);
  persistence?.usePage(settings.page);
  let initialized = false, savedWritingRecords: SavedWriting[] = [], recoveryError = '';
  const restoring = new Set<string>();
  let recovered!: () => void;
  const writingReady = new Promise<void>(resolve => { recovered = resolve; });
  if (options.writingRecovery === false) recovered();
  const delegate = options.host || {
    emit(value: Record<string, unknown>) { persistence!.receive(value); },
    async navigate(url: string) {
      if (!await persistence!.navigate(url)) throw new Error('Invalid sign-in destination.');
    },
  };
  const host: SessionHost = {
    emit(value) {
      if (lifetime.signal.aborted) return;
      delegate.emit(value);
    },
    navigate: url => delegate.navigate(url),
  };
  const session = new BrowserSession(options.service, settings.page, host, identity => {
    if (identity) { page.changeIdentity(); if (!page.signal.aborted) void page.start(); }
    else page.notify();
  }, lifetime.signal);
  const saveWriting = (writing?: Writing) => {
    for (const current of writing ? [writing] : page.writings.values()) {
      if (current.text || current.protected || current.actions.undoClear) host.emit({ writingRecord: current.save() });
      else host.emit({ writingRemoved: current.id });
    }
    host.emit({ writingSelected: page.selectedWriting });
  };
  const page: Conversation = Object.assign(new PageModel(settings.page, session, options.order, lifetime), {
    session, appearance: settings.appearance, interactions,
    content: options.content,
    recovery: {
      ready: writingReady,
      records: () => [
        ...(persistence ? persistence.records() : savedWritingRecords).filter(record => !page.writings.has(record.id)),
        ...[...page.writings.values()].filter(writing => !page.selectedWriting.includes(writing.id) && (writing.text || writing.protected || writing.actions.undoClear)).map(writing => writing.save()),
      ],
      get pending() { return restoring.size > 0; },
      get error() { return recoveryError || persistence?.error || ''; },
      async restore(id: string): Promise<Writing | undefined> {
        if (lifetime.signal.aborted || restoring.has(id)) return;
        const local = page.selectWriting(id);
        if (local) return local.show();
        restoring.add(id);recoveryError = '';page.notify();
        try {
          const saved = persistence ? await persistence.restoreWriting(id) : await options.host?.restoreWriting?.(id);
          if (!saved || lifetime.signal.aborted) { recoveryError = persistence?.error || 'This writing is open in another window or is no longer saved.';return; }
          page.recoverWriting(JSON.stringify({ version: 5, writing: [saved] }));
          return page.selectWriting(saved.id)?.show();
        } catch (cause) { recoveryError = cause instanceof Error ? cause.message : 'Unable to restore writing.'; }
        finally { restoring.delete(id);if (!lifetime.signal.aborted) page.notify(); }
      },
    },
    own: (cleanup: () => void) => own(lifetime.signal, cleanup),
    updateAppearance(value: Partial<Appearance>) {
      lifetime.signal.throwIfAborted();
      Object.assign(settings.appearance, conversationSettings(settings.page, { ...settings.appearance, ...value }).appearance);
      page.notify();
    },
    initialize(data: Record<string, unknown>) {
      if (lifetime.signal.aborted) return;
      initialized = true;
      if (typeof data.loginError === 'string') { session.fail(data.loginError.slice(0, 300)); return; }
      if (data.fetching === false || data.fetching && typeof data.fetching === 'object') {
        try { Object.assign(policy, fetchPolicy(data.fetching as Partial<FetchPolicy> | false)); }
        catch { /* Invalid host settings do not replace validated policy. */ }
        page.replyPrefetch = policy.replyPrefetch;
      }
      if (Array.isArray(data.savedWritingRecords)) savedWritingRecords = recoveredWriting(JSON.stringify({ version: 5, writing: data.savedWritingRecords }));
      if (typeof data.recoveryError === 'string') recoveryError = data.recoveryError;
      if (Array.isArray(data.writingRecords)) {
        const authored = new Map([...page.writings.values()].filter(writing => page.selectedWriting.includes(writing.id) && (writing.text || writing.protected || writing.actions.undoClear)).map(writing => [writingTargetKey(writing.target), writing]));
        page.recoverWriting(JSON.stringify({ version: 5, writing: data.writingRecords }));
        for (const writing of authored.values()) page.selectWriting(writing.id);
        if (Array.isArray(data.writingSelected)) for (const id of data.writingSelected) {
          const saved = typeof id === 'string' ? page.writings.get(id) : undefined;
          if (saved && !authored.has(writingTargetKey(saved.target))) page.selectWriting(saved.id);
        }
        recovered();
      }
      if (typeof data.session === 'string') session.setSession(data.session);
      if (data.handoff && typeof data.handoff === 'object') {
        const login = data.handoff as Record<string, unknown>;
        if (login.version === 5 && typeof login.created === 'number' &&
            ['capability', 'attempt'].every(key => typeof login[key] === 'string' && /^[A-Za-z0-9_-]{43}$/.test(login[key] as string))) {
          void session.adopt({ capability: login.capability as string, attempt: login.attempt as string, created: login.created, version: 5, ...(login.status === 'denied' ? { status: 'denied' as const } : {}) });
          return;
        }
      }
      if (!page.acquisition() && !page.ready) void page.start();
    },
    dispose() {
      if (!lifetime.signal.aborted) try { saveWriting(); } finally { lifetime.abort(); }
    },
  });
  try {
    page.own(() => interactions.clear());
    page.replyPrefetch = policy.replyPrefetch;
    page.contentSource = options.contentSource;
    if (options.bootstrap && options.bootstrap.expires > Date.now()) page.bootstrap(options.bootstrap.view);
    let revision = page.writingRevision;
    page.own(page.subscribe((_page, writing) => {
      if (revision === page.writingRevision) return;
      revision = page.writingRevision; saveWriting(writing);
    }));
    const fresh = (event: Event) => {
      if ((event.type === 'online' ? policy.onReconnect : policy.onFocus) && initialized && !document.hidden && navigator.onLine !== false && !session.pending && !page.acquisition() && !interactions.active)
        void page.revalidate(policy.staleAfterMs);
    };
    const events = { signal: lifetime.signal };
    window.addEventListener('focus', fresh, events);
    window.addEventListener('online', fresh, events);
    document.addEventListener('visibilitychange', fresh, events);
    window.addEventListener('pagehide', () => saveWriting(), events);
    if (persistence) {
      window.addEventListener('storage', event => { if (event.key === persistence.sessionKey) session.setSession(persistence.session(event.newValue));else if (event.key?.startsWith(persistence.writingPrefix)) page.notify(); }, events);
      const returned = persistence.returning(), position = returned?.position;
      if (position) {
        const stop = page.subscribe(() => {
          if (page.acquisition() || !page.ready) return;
          stop(); requestAnimationFrame(() => {
            if (lifetime.signal.aborted) return;
            window.scrollTo({ top: position.scroll || 0 });
            if (position.composer) interactions.focus(position.composer);
          });
        });
      }
      page.initialize({ session: persistence.session(), handoff: returned?.handoff });
      void persistence.recover().then(state => { if (!lifetime.signal.aborted) page.initialize(state);else recovered(); }, cause => { recoveryError = cause instanceof Error ? cause.message : 'Unable to restore writing.';recovered();page.notify(); });
    }
  } catch (error) { try { page.dispose(); } finally { throw error; } }
  return page;
}

/** The mount owns page replacement and an independently replaceable view lifetime. */
export function mountPresentation(target: HTMLElement, options: ConversationOptions, presentation: Presentation): MountedConversation {
  let current = { ...options }, conversation: Conversation | undefined, view: AbortController | undefined, disposed = false;
  const active = () => {
    if (!conversation || conversation.signal.aborted) throw new Error('Comments are not mounted.');
    return conversation;
  };
  const draw = () => {
    const page = active();view?.abort();
    const lifetime = view = new window.AbortController();
    const release = page.own(() => lifetime.abort());
    lifetime.signal.addEventListener('abort', release, { once: true });
    const scope: ResourceScope = { signal: lifetime.signal, own: cleanup => own(lifetime.signal, cleanup) };
    try { presentation(target, page, scope); }
    catch (error) { try { lifetime.abort(); } finally { throw error; } }
  };
  const mount = () => {
    const page = createConversation(current);conversation = page;
    try { draw(); }
    catch (error) { conversation = undefined;try { page.dispose(); } finally { throw error; } }
  };
  mount();
  return {
    get conversation() { return active(); },
    replacePage(page) {
      if (disposed) throw new Error('Cannot update disposed comments.');
      const settings = conversationSettings(page, conversation?.appearance || current.appearance);
      conversation?.dispose();conversation = undefined;
      current = { ...current, ...settings, bootstrap: undefined };mount();
    },
    replacePresentation(value) {
      if (disposed) throw new Error('Cannot update disposed comments.');
      presentation = value;draw();
    },
    dispose() { if (!disposed) { disposed = true;conversation?.dispose(); } },
  };
}
