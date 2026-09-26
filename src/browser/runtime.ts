import { storageNamespace, draftIdentity, scopedStorage } from "./storage.js";
import { InteractionRegistry } from "./interactions.js";
import {
  fetchPolicy,
  FetchScheduler,
  type FetchPolicy,
} from "../conversation/fetch-policy.js";
import { browserDraftStore, type DraftRecovery } from "./draft-store.js";
import { ConversationController, type CommentOrder } from "../conversation/controller.js";
import type { Widget } from "../contracts/requests.js";
import { BrowserSession, type SessionHost, type Login } from "./session.js";
import { renderContent } from "./content.js";

export interface ConversationOptions {
  service: string;
  config: Widget;
  fetching?: Partial<FetchPolicy> | false;
  draftRecovery?: DraftRecovery | false;
  order?: CommentOrder;
  /** Supplied by iframe hosts. Native embedding uses first-party browser storage. */
  host?: SessionHost;
  renderContent?: typeof renderContent;
}
export interface ConversationRuntime {
  config: Widget;
  interactions: InteractionRegistry;
  controller: ConversationController;
  session: BrowserSession;
  renderContent: typeof renderContent;
  initialize(data: Record<string, unknown>): void;
  saveDrafts(): void;
  setFetching(value: Partial<FetchPolicy> | false): void;
  dispose(): void;
}
export function createConversation(
  options: ConversationOptions,
): ConversationRuntime {
  const { config, service } = options;
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
    async () => {
      await controller.refresh();
      return !controller.state.error;
    },
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
  let timer: ReturnType<typeof setInterval> | undefined;
  const setFetching = (value: Partial<FetchPolicy> | false) => {
    Object.assign(policy, fetchPolicy(value));
    controller.replyPrefetch = policy.replyPrefetch;
    clearInterval(timer);
    timer =
      policy.pollIntervalMs === false
        ? undefined
        : setInterval(
            () => void scheduler.trigger("poll"),
            policy.pollIntervalMs,
          );
  };
  setFetching(options.fetching ?? {});
  window.addEventListener("pagehide", saveDrafts);
  const runtime: ConversationRuntime = {
    config,
    interactions,
    controller,
    session,
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
      if (!controller.state.loading) void controller.refresh();
    },
    dispose() {
      saveDrafts();
      clearInterval(timer);
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
        if (controller.state.loading || !controller.state.view) return;
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
