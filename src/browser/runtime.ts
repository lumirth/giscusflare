import { storageNamespace, draftIdentity, scopedStorage } from "./storage.js";
import { InteractionRegistry } from "./interactions.js";
import {
  fetchPolicy,
  FetchScheduler,
  type FetchPolicy,
} from "../conversation/fetch-policy.js";
import { browserDraftStore, type DraftRecovery } from "./draft-store.js";
import { ConversationController, type CommentOrder } from "../conversation/controller.js";
import { conversationSettings,type Page,type Appearance } from "./options.js";
import { BrowserSession, type SessionHost, type Login } from "./session.js";
import { renderContent } from "./content.js";

export interface ConversationOptions {
  service: string;
  page:Page;
  appearance?:Partial<Appearance>;
  fetching?: Partial<FetchPolicy> | false;
  draftRecovery?: DraftRecovery | false;
  order?: CommentOrder;
  /** Server-rendered first page; no second anonymous fetch is needed. */
  bootstrap?:{view:import('../contracts/results.js').ThreadView;expires:number};
  /** Supplied by iframe hosts. Native embedding uses first-party browser storage. */
  host?: SessionHost;
  renderContent?: typeof renderContent;
}
export interface Conversation {
  readonly page:Readonly<Page>;
  appearance:Appearance;
  interactions: InteractionRegistry;
  readonly state: Readonly<import('../conversation/controller.js').ConversationState>;
  readonly editors: ConversationController['editors'];
  readonly signedIn: boolean;
  readonly signingIn: boolean;
  readonly authenticationError: string;
  subscribe(listener: (state: Readonly<import("../conversation/controller.js").ConversationState>) => void): () => void;
  subscribeDrafts: ConversationController['subscribeDrafts'];
  load(): Promise<void>;
  refresh(): Promise<void>;
  loadMore(): Promise<void>;
  setOrder: ConversationController['setOrder'];
  loadReplies: ConversationController['loadReplies'];
  revealReplies: ConversationController['revealReplies'];
  draft: ConversationController['draft'];
  setDraft: ConversationController['setDraft'];
  beginReply: ConversationController['beginReply'];
  beginEdit: ConversationController['beginEdit'];
  closeEditor: ConversationController['closeEditor'];
  operationFor: ConversationController['operationFor'];
  submit: ConversationController['submit'];
  preview: ConversationController['preview'];
  removeComment: ConversationController['removeComment'];
  moderateComment: ConversationController['moderateComment'];
  setReaction: ConversationController['setReaction'];
  retryReaction: ConversationController['retryReaction'];
  signIn: BrowserSession['signIn'];
  signOut: BrowserSession['signOut'];
  renderContent: typeof renderContent;
  initialize(data: Record<string, unknown>): void;
  saveDrafts(): void;
  setFetching(value: Partial<FetchPolicy> | false): void;
  dispose(): void;
}
export function createConversation(
  options: ConversationOptions,
): Conversation {
  const {service}=options;
  const settings=conversationSettings(options.page,options.appearance);
  const config={...settings.page,...settings.appearance};
  const prefix = storageNamespace(service, config.repo);
  const draftKey = draftIdentity(config);
  const interactions = new InteractionRegistry();
  const policy = fetchPolicy(options.fetching);
  const recovery =
    options.draftRecovery === false
      ? null
      : options.draftRecovery?.store ||
        browserDraftStore(options.draftRecovery?.retentionMs);
  const recoveryKey = prefix + draftKey;
  const { read, write } = scopedStorage(prefix);
  const nativeHost: SessionHost = {
    emit(value) {
      if (typeof value.session === "string")
        write("session", value.session, true);
      if (value.signOut) {
        write("session", null, true);
        recovery?.remove(recoveryKey);
      }
      if (value.pending && typeof value.pending === "object") {
        const login = value.pending as Login;
        write("pending:" + login.challenge, {
          ...login,
          fragment: location.hash,
          scroll: window.scrollY,
          composer: interactions.active,
        });
      }
      if (typeof value.clearPending === "string")
        write("pending:" + value.clearPending, null);
      if (typeof value.draftState === "string") {
        if (value.draftsPresent) recovery?.save(recoveryKey, value.draftState);
        else recovery?.remove(recoveryKey);
      }
    },
    navigate(url) {
      const target = new URL(url),
        proof = target.searchParams.get("challenge");
      if (
        target.origin !== service ||
        target.pathname !== "/auth/window" ||
        !proof
      )
        throw new Error("Invalid sign-in destination.");
      // Full-page return requires the verifier to survive navigation.
      if (!sessionStorage.getItem(prefix + "pending:" + proof))
        throw new Error(
          "Allow popups to sign in when browser storage is unavailable.",
        );
      location.assign(url);
    },
  };
  let recoveryPaused = false;
  const delegate = options.host || nativeHost;
  const host: SessionHost = {
    emit(value) {
      if (value.signOut) recoveryPaused = true;
      delegate.emit(value);
    },
    navigate(url) {
      delegate.navigate(url);
    },
  };
  const session = new BrowserSession(service, config, host);
  const controller = new ConversationController(config, session, options.order);
  controller.replyPrefetch = policy.replyPrefetch;
  if(options.bootstrap&&options.bootstrap.expires>Date.now())controller.bootstrap(options.bootstrap.view);
  let initialized = false;
  let revision = session.revision;
  const unsubscribe = session.subscribe(() => {
    if (session.revision !== revision) {
      revision = session.revision;
      controller.changeIdentity();
      void controller.refresh();
    }
  });
  const saveDrafts = () => {
    const state = controller.serializeDrafts();
    if (state.length <= 240000)
      host.emit({
        draftsPresent: !recoveryPaused && controller.hasDrafts,
        draftState: state,
      });
  };
  const unsubscribeDrafts = controller.subscribeDrafts(() => {
    recoveryPaused = false;
    saveDrafts();
  });
  const storage = (event: StorageEvent) => {
    if (!options.host && event.key === prefix + "session") {
      const token = read("session", true);
      session.setSession(typeof token === "string" ? token : "");
    }
  };
  if (!options.host) window.addEventListener("storage", storage);
  const scheduler = new FetchScheduler(
    policy,
    () => controller.revalidate(),
    () => controller.state.lastRefresh,
    () =>
      initialized &&
      !document.hidden &&
      navigator.onLine !== false &&
      !session.pending &&
      !controller.state.loading &&
      !interactions.active,
  );
  const onFocus = () => {
    void scheduler.trigger("focus");
  };
  const onReconnect = () => {
    void scheduler.trigger("reconnect");
  };
  window.addEventListener("focus", onFocus);
  window.addEventListener("online", onReconnect);
  document.addEventListener("visibilitychange", onFocus);
  const setFetching = (value: Partial<FetchPolicy> | false) => {
    Object.assign(policy, fetchPolicy(value));
    controller.replyPrefetch = policy.replyPrefetch;

  };
  setFetching(options.fetching ?? {});
  window.addEventListener("pagehide", saveDrafts);
  const runtime: Conversation = {
    page:settings.page,
    appearance:settings.appearance,
    interactions,
    get state() { return controller.state; },
    get editors() { return controller.editors; },
    get signedIn() { return session.signedIn; },
    get signingIn() { return session.pending; },
    get authenticationError() { return session.error; },
    subscribe(listener) {
      const notify = () => listener(controller.state);
      const state = controller.subscribe(notify), identity = session.subscribe(notify);
      return () => { state(); identity(); };
    },
    subscribeDrafts: controller.subscribeDrafts.bind(controller),
    load: () => controller.refresh(),
    refresh: () => controller.refresh(),
    loadMore: () => controller.refresh(true),
    setOrder: controller.setOrder.bind(controller),
    loadReplies: controller.loadReplies.bind(controller),
    revealReplies: controller.revealReplies.bind(controller),
    draft: controller.draft.bind(controller),
    setDraft: controller.setDraft.bind(controller),
    beginReply: controller.beginReply.bind(controller),
    beginEdit: controller.beginEdit.bind(controller),
    closeEditor: controller.closeEditor.bind(controller),
    operationFor: controller.operationFor.bind(controller),
    submit: controller.submit.bind(controller),
    preview: controller.preview.bind(controller),
    removeComment: controller.removeComment.bind(controller),
    moderateComment: controller.moderateComment.bind(controller),
    setReaction: controller.setReaction.bind(controller),
    retryReaction: controller.retryReaction.bind(controller),
    signIn: session.signIn.bind(session),
    signOut: session.signOut.bind(session),
    renderContent: options.renderContent || renderContent,
    saveDrafts,
    setFetching,
    initialize(data) {
      initialized = true;
      if (
        data.fetching === false ||
        (data.fetching && typeof data.fetching === "object")
      )
        try {
          setFetching(data.fetching as Partial<FetchPolicy> | false);
        } catch {
          /* Invalid embed policy keeps validated defaults. */
        }
      if (typeof data.draftState === "string")
        controller.restoreDrafts(data.draftState);
      if (typeof data.session === "string") session.setSession(data.session);
      if (data.handoff && typeof data.handoff === "object") {
        const h = data.handoff as Record<string, unknown>;
        if (
          ["ticket", "verifier", "attempt", "challenge"].every(
            (k) =>
              typeof h[k] === "string" &&
              /^[A-Za-z0-9_-]{43}$/.test(h[k] as string),
          )
        ) {
          void session.finish(h.ticket as string, {
            verifier: h.verifier as string,
            attempt: h.attempt as string,
            challenge: h.challenge as string,
            created: Date.now(),
          });
          return;
        }
      }
      if (!controller.state.loading&&!controller.state.ready) void controller.refresh();
    },
    dispose() {
      saveDrafts();
      window.removeEventListener("pagehide", saveDrafts);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onReconnect);
      document.removeEventListener("visibilitychange", onFocus);
      interactions.clear();
      unsubscribe();
      unsubscribeDrafts();
      window.removeEventListener("storage", storage);
      controller.dispose();
      session.dispose();
    },
  };
  if (!options.host) {
    let handoff: Record<string, unknown> | undefined;
    let returnPosition: { scroll?: number; composer?: string } | null = null;
    if (location.hash.startsWith("#gw-auth="))
      try {
        const bytes = Uint8Array.from(
          atob(location.hash.slice(9).replace(/-/g, "+").replace(/_/g, "/")),
          (c) => c.charCodeAt(0),
        );
        const value = JSON.parse(new TextDecoder().decode(bytes));
        const pending = read("pending:" + value.challenge) as
          | (Login & { fragment?: string; scroll?: number; composer?: string })
          | null;
        if (
          value.repo === config.repo &&
          pending &&
          Date.now() - pending.created < 600000
        ) {
          returnPosition = pending;
          handoff = { ...value, verifier: pending.verifier };
          const url = new URL(location.href);
          url.hash = pending.fragment || "";
          history.replaceState(history.state, "", url);
        }
      } catch {
        /* Invalid return fragments do not grant a session. */
      }
    if (returnPosition) {
      const position = returnPosition;
      const stop = controller.subscribe(() => {
        if (controller.state.loading || !controller.state.ready) return;
        stop();
        requestAnimationFrame(() => {
          window.scrollTo({ top: position.scroll || 0 });
          if (position.composer) interactions.focus(position.composer);
        });
      });
    }
    runtime.initialize({
      session: read("session", true),
      draftState: recovery?.load(recoveryKey),
      handoff,
    });
  }
  return runtime;
}
