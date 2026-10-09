/** Iframe adapter only. All presentation and behavior are public API consumers. */
import { mountComments, conversationSettings } from "./native.js";
import type { Widget } from "../contracts/requests.js";
import { isNamedTheme } from "../themes.js";
const { defaultCommentOrder, bootstrap, ...raw } = JSON.parse(
  document.getElementById("gw-config")!.textContent!,
) as Widget & { defaultCommentOrder?: "oldest" | "newest";bootstrap?:import("./runtime.js").ConversationOptions["bootstrap"] };
const target = document.getElementById("giscusflare")!;
target.replaceChildren();
const embedded = window.parent !== window,
  origin = new URL(raw.origin).origin;
const emit = (value: Record<string, unknown>) => {
  if (embedded) window.parent.postMessage({ giscus: value }, origin);
};
const restoring = new Map<string, (record: import('../conversation/writing.js').SavedWriting | undefined) => void>();
const mounted = mountComments(target, {
  service: location.origin,
  ...conversationSettings(raw,raw),
  bootstrap,
  order: defaultCommentOrder,
  ...(embedded
    ? {
        host: {
          emit,
          restoreWriting(id: string) {
            return new Promise<import('../conversation/writing.js').SavedWriting | undefined>(resolve => {
              const previous = restoring.get(id); previous?.(undefined);
              restoring.set(id, resolve); emit({ restoreWriting: id });
            });
          },
          navigate(url: string) {
            emit({ navigate: url });
          },
        },
      }
    : {}),
});
const theme = () => {
  const sheet = document.querySelector<HTMLLinkElement>("[data-theme-sheet]");
  if (sheet)
    sheet.href = isNamedTheme(mounted.conversation.appearance.theme)
      ? "/themes/" + mounted.conversation.appearance.theme + ".css"
      : mounted.conversation.appearance.theme;
  document.documentElement.lang = mounted.conversation.appearance.lang;
  document.documentElement.dir = /^(ar|he|fa|ur)(-|$)/.test(mounted.conversation.appearance.lang)
    ? "rtl"
    : "ltr";
};
const receive = (event: MessageEvent) => {
  if (
    event.source !== window.parent ||
    event.origin !== origin ||
    !event.data?.giscus
  )
    return;
  const data = event.data.giscus as Record<string, unknown>;
  if (typeof data.restoreWritingId === 'string') {
    const complete = restoring.get(data.restoreWritingId);
    restoring.delete(data.restoreWritingId);
    complete?.(data.restoredWriting as import('../conversation/writing.js').SavedWriting | undefined);
  }
  if (Array.isArray(data.savedWritingRecords)) mounted.conversation.initialize({ savedWritingRecords: data.savedWritingRecords });
  if (typeof data.loginError === 'string') mounted.conversation.initialize({ loginError: data.loginError });
  if (data.init && typeof data.init === "object")
    mounted.conversation.initialize(data.init as Record<string, unknown>);
  if (typeof data.sessionChanged === "string")
    mounted.conversation.initialize({ session: data.sessionChanged });
  if (data.setConfig && typeof data.setConfig === "object") {
    const update: Partial<Widget> = {};
    const value = data.setConfig as Record<string, unknown>;
    for (const key of [
      "theme",
      "lang",
      "term",
      "description",
      "backLink",
    ] as const)
      if (typeof value[key] === "string") update[key] = value[key];
    for (const key of ["reactionsEnabled", "emitMetadata", "strict"] as const)
      if (typeof value[key] === "boolean") update[key] = value[key];
    if (value.inputPosition === "top" || value.inputPosition === "bottom")
      update.inputPosition = value.inputPosition;
    if (
      typeof value.number === "number" &&
      Number.isSafeInteger(value.number) &&
      value.number >= 0
    )
      update.number = value.number;
    // Remote theme URLs must belong to the same origins permitted by the iframe CSP.
    if (update.theme && !isNamedTheme(update.theme)) {
      try {
        if (new URL(update.theme).protocol !== "https:") delete update.theme;
      } catch {
        delete update.theme;
      }
    }
    const settings=conversationSettings({...mounted.conversation.config,...update},{...mounted.conversation.appearance,...update});
    const pageChanged=Object.keys(update).some(key=>!["theme","lang","inputPosition","reactionsEnabled","emitMetadata"].includes(key));
    if (pageChanged) {
      stop(); mounted.replacePage(settings.page); stop = observe();
    }
    mounted.conversation.updateAppearance(settings.appearance);
    theme();
    emit({ ready: true, context: {...mounted.conversation.config,...mounted.conversation.appearance} });
  }
};
window.addEventListener("message", receive);
let lastHeight = 0;
const resize = new ResizeObserver(() => {
  const height = Math.ceil(target.getBoundingClientRect().height);
  if (height !== lastHeight) {
    lastHeight = height;
    emit({ resizeHeight: height });
  }
});
resize.observe(target);
const observe = () => {
  const conversation = mounted.conversation;
  return conversation.subscribe(() => {
    const metadata = conversation.document.metadata;
    if (conversation.ready && !conversation.acquisition()) {
      emit({ rendered: true });
      if (conversation.appearance.emitMetadata)
        emit({ discussion: metadata.thread, viewer: metadata.viewer });
    }
  });
};
let stop = observe();
window.addEventListener(
  "unload",
  () => {
    stop();
    for (const complete of restoring.values()) complete(undefined); restoring.clear();
    resize.disconnect();
    window.removeEventListener("message", receive);
    mounted.dispose();
  },
  { once: true },
);
emit({ ready: true, context: raw });
theme();
