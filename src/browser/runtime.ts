import { hostStorage } from './host-storage.js';
import { createCounts } from './counts.js';
import { InteractionRegistry } from './interactions.js';
import { fetchPolicy, type FetchPolicy } from '../conversation/fetch-policy.js';
import { browserWritingStore, type WritingRecovery } from './writing-store.js';
import { recoveredWriting, type SavedWriting, type Writing } from '../conversation/writing.js';
import { PageModel, type CommentOrder } from '../conversation/page.js';
import { conversationSettings, type Page, type Appearance } from './options.js';
import { BrowserSession, type Login, type SessionHost } from './session.js';
import { createContentOwner, type ContentProfile, type ContentOwner } from './content.js';
import { selection } from '../contracts/selection.js';
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
  content: ContentProfile;
}
/** Browser storage recovery travels as records, never as serialized model state. */
export interface WritingRestoration {
  records: readonly SavedWriting[];
  selected: readonly string[];
  available: readonly SavedWriting[];
  error?: string;
}
/** The same initialization event is used by native hosts and the iframe adapter. */
export interface ConversationInitialization {
  session?: string;
  handoff?: Login;
  fetching?: Partial<FetchPolicy> | false;
  writing?: WritingRestoration;
  availableWriting?: readonly SavedWriting[];
  loginError?: string;
  position?: {scroll?: number;composer?: string};
}
/** Presentations publish when their installed reading layout can position a return. */
export interface ReadingLayout {
  readonly ready: boolean;
  publish(): void;
  subscribe(listener: () => void): () => void;
  reset(): void;
}
/** The portable page owner with its actual browser capabilities attached. */
export type Conversation = PageModel & {
  session: BrowserSession;
  appearance: Appearance;
  interactions: InteractionRegistry;
  content: ContentOwner;
  readingLayout: ReadingLayout;
  recovery: {
    readonly ready: Promise<void>;
    records(): readonly SavedWriting[];
    restore(id: string): Promise<Writing | undefined>;
    readonly pending: boolean;
    readonly error: string;
  };
  own(cleanup: () => void): () => void;
  updateAppearance(value: Partial<Appearance>): void;
  initialize(data: ConversationInitialization): void;
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
  let initialized = false, savedWritingRecords: readonly SavedWriting[] = [], recoveryError = '';
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
      delegate.emit(value.pending && typeof value.pending === 'object' ? {...value, pending: {...value.pending, composer: interactions.active}} : value);
    },
    navigate: url => delegate.navigate(url),
  };
  const session = new BrowserSession(options.service, settings.page, host, change => {
    if (change === 'identity') page.changeIdentity();
    else if (change === 'verified') void page.refreshViewer(true);
    else page.notify();
  }, lifetime.signal);
  const content = createContentOwner({repo: settings.page.repo, pageURL: settings.page.pageURL, profile: options.content, signal: lifetime.signal,
    batch: (inputs, signal) => session.request('content', {config: selection(settings.page), inputs, content: options.content.delivery}, signal),
  });
  const saveWriting = (writing?: Writing) => {
    for (const current of writing ? [writing] : page.writings.values()) {
      if (current.text || current.protected || current.actions.undoClear) host.emit({ writingRecord: current.save() });
      else host.emit({ writingRemoved: current.id });
    }
    host.emit({ writingSelected: page.selectedWriting });
  };
  let layoutReady = false;
  const layoutListeners = new Set<() => void>();
  lifetime.signal.addEventListener('abort', () => layoutListeners.clear(), {once: true});
  const readingLayout: ReadingLayout = {
    get ready() { return layoutReady; },
    publish() { if (layoutReady || lifetime.signal.aborted) return;layoutReady = true;for (const listener of layoutListeners) listener(); },
    subscribe(listener) { layoutListeners.add(listener);return () => { layoutListeners.delete(listener); }; },
    reset() { layoutReady = false; },
  };
  const returnPosition = (position: NonNullable<ConversationInitialization['position']>) => {
    const positioning = new window.AbortController();
    const release = own(lifetime.signal, () => positioning.abort());
    positioning.signal.addEventListener('abort', release, {once: true});
    let stop: () => void = () => {};
    const cancel = () => { stop();positioning.abort(); };
    for (const name of ['pointerdown', 'keydown', 'wheel', 'touchstart']) window.addEventListener(name, cancel, {signal: positioning.signal, passive: true});
    const restore = () => {
      if (!readingLayout.ready) return;
      stop();requestAnimationFrame(() => {
        if (positioning.signal.aborted) return;
        if (position.scroll !== undefined) window.scrollTo({top: position.scroll});
        if (position.composer) void writingReady.then(() => {
          if (!positioning.signal.aborted) interactions.focus(position.composer!);
        }).finally(cancel);
        else cancel();
      });
    };
    stop = readingLayout.subscribe(restore);restore();
  };
  const page: Conversation = Object.assign(new PageModel(settings.page, session, options.order, lifetime), {
    session, appearance: settings.appearance, interactions,
    content, readingLayout,
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
          page.recoverWriting([saved]);
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
    initialize(data: ConversationInitialization) {
      if (lifetime.signal.aborted) return;
      initialized = true;
      if (data.position) returnPosition(data.position);
      if (data.loginError) session.fail(data.loginError);
      if (data.fetching !== undefined) { Object.assign(policy, fetchPolicy(data.fetching));page.replyPrefetch = policy.replyPrefetch; }
      if (data.availableWriting) { savedWritingRecords = recoveredWriting(data.availableWriting);page.notify(); }
      if (data.writing) {
        const {records, selected, available, error} = data.writing;
        savedWritingRecords = available;recoveryError = error || '';
        page.recoverWriting(records, selected);
        recovered();page.notify();
      }
      if (data.session !== undefined) session.setSession(data.session);
      if (data.handoff) void session.adopt(data.handoff);
      if (!page.acquisition() && !page.ready) void page.start();
    },
    dispose() {
      if (!lifetime.signal.aborted) try { saveWriting(); } finally { lifetime.abort(); }
    },
  });
  try {
    page.own(() => interactions.clear());
    page.replyPrefetch = policy.replyPrefetch;
    page.contentSource = options.content.delivery;
    const counts = createCounts({service: options.service, repo: settings.page.repo, origin: settings.page.origin, registration: settings.page.registration});
    page.own(() => counts.dispose());
    let revision = page.writingRevision;
    page.own(page.subscribe((_page, writing, observation) => {
      if (observation) content.observe(observation, page.document.nodes);
      for (const window of [page.document.roots, ...Object.values(page.document.replies)]) if (window.count) counts.observe(window.count);
      for (const invalidation of observation?.invalidatedCounts || []) void counts.invalidate(invalidation).then(value => { if (value) page.observeCount(value); }).catch(() => {});
      if (revision !== page.writingRevision) { revision = page.writingRevision;saveWriting(writing); }
    }));
    if (options.bootstrap && options.bootstrap.expires > Date.now()) page.bootstrap(options.bootstrap.view);
    const fresh = (event: Event) => {
      if (initialized && !document.hidden && navigator.onLine !== false && session.signedIn && !session.principal) void session.verify();
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
      const returned = persistence.returning();
      page.initialize({session: persistence.session(), handoff: returned?.handoff, position: returned?.position});
      void persistence.recover().then(state => { if (!lifetime.signal.aborted) page.initialize({writing: state});else recovered(); }, cause => { recoveryError = cause instanceof Error ? cause.message : 'Unable to restore writing.';recovered();page.notify(); });
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
    const page = active();view?.abort();page.readingLayout.reset();
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
