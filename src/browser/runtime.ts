import { hostStorage } from './host-storage.js';
import { InteractionRegistry } from './interactions.js';
import { fetchPolicy, type FetchPolicy } from '../conversation/fetch-policy.js';
import { browserWritingStore, type WritingRecovery } from './writing-store.js';
import { PageModel, type CommentOrder } from '../conversation/page.js';
import { conversationSettings, type Page, type Appearance } from './options.js';
import { BrowserSession, type SessionHost } from './session.js';
import type { ContentRenderer } from './content.js';
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
}
/** The portable page owner with its actual browser capabilities attached. */
export type Conversation = PageModel & {
  session: BrowserSession;
  appearance: Appearance;
  interactions: InteractionRegistry;
  content: ContentRenderer;
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
    : hostStorage(options.service, settings.page.repo, recovery, () => ({ composer: interactions.active }));
  persistence?.usePage(settings.page);
  let initialized = false;
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
  const saveWriting = () => {
    const state = page.saveWriting();
    if (state.length <= 240000) host.emit({ writingPresent: page.hasWriting, writingProtected: page.hasUnresolvedWriting, writingState: state });
  };
  const page: Conversation = Object.assign(new PageModel(settings.page, session, options.order, lifetime), {
    session, appearance: settings.appearance, interactions,
    content: options.content,
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
      if (typeof data.writingState === 'string') page.recoverWriting(data.writingState);
      if (typeof data.session === 'string') session.setSession(data.session);
      if (data.handoff && typeof data.handoff === 'object') {
        const login = data.handoff as Record<string, unknown>;
        if (login.version === 4 && typeof login.created === 'number' &&
            ['capability', 'attempt'].every(key => typeof login[key] === 'string' && /^[A-Za-z0-9_-]{43}$/.test(login[key] as string))) {
          void session.adopt({ capability: login.capability as string, attempt: login.attempt as string, created: login.created, version: 4, ...(login.status === 'denied' ? { status: 'denied' as const } : {}) });
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
    page.includeHTML = options.content.providerHTML === true;
    if (options.bootstrap && options.bootstrap.expires > Date.now()) page.bootstrap(options.bootstrap.view);
    let revision = page.writingRevision;
    page.own(page.subscribe(() => {
      if (revision === page.writingRevision) return;
      revision = page.writingRevision; saveWriting();
    }));
    const fresh = (event: Event) => {
      if ((event.type === 'online' ? policy.onReconnect : policy.onFocus) && initialized && !document.hidden && navigator.onLine !== false && !session.pending && !page.acquisition() && !interactions.active)
        void page.revalidate(policy.staleAfterMs);
    };
    const events = { signal: lifetime.signal };
    window.addEventListener('focus', fresh, events);
    window.addEventListener('online', fresh, events);
    document.addEventListener('visibilitychange', fresh, events);
    window.addEventListener('pagehide', saveWriting, events);
    if (persistence) {
      window.addEventListener('storage', event => { if (event.key === persistence.sessionKey) session.setSession(persistence.session(event.newValue)); }, events);
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
      page.initialize({ session: persistence.session(), writingState: persistence.writing(), handoff: returned?.handoff });
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
