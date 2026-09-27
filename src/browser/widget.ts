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
const mounted = mountComments(target, {
  service: location.origin,
  ...conversationSettings(raw,raw),
  bootstrap,
  order: defaultCommentOrder,
  ...(embedded
    ? {
        host: {
          emit,
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
    sheet.href = isNamedTheme(mounted.appearance.theme)
      ? "/themes/" + mounted.appearance.theme + ".css"
      : mounted.appearance.theme;
  document.documentElement.lang = mounted.appearance.lang;
  document.documentElement.dir = /^(ar|he|fa|ur)(-|$)/.test(mounted.appearance.lang)
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
  if (data.init && typeof data.init === "object")
    mounted.initialize(data.init as Record<string, unknown>);
  if (typeof data.sessionChanged === "string")
    mounted.initialize({ session: data.sessionChanged });
  if (data.setConfig && typeof data.setConfig === "object") {
    const update: Partial<Widget> = {};
    const value = data.setConfig as Record<string, unknown>;
    for (const key of [
      "theme",
      "lang",
      "term",
      "category",
      "categoryId",
      "repoId",
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
    stop();
    const settings=conversationSettings({...mounted.page,...update},{...mounted.appearance,...update});
    const pageChanged=Object.keys(update).some(key=>!["theme","lang","inputPosition","reactionsEnabled","emitMetadata"].includes(key));
    if(pageChanged)mounted.replacePage(settings.page);
    mounted.updateAppearance(settings.appearance);
    stop = observe();
    theme();
    emit({ ready: true, context: {...mounted.page,...mounted.appearance} });
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
const observe = () =>
  mounted.subscribe(() => {
    const state = mounted.state;
    if (state.ready && !state.loading) {
      emit({ rendered: true });
      if (mounted.appearance.emitMetadata)
        emit({ discussion: state.thread, viewer: state.viewer });
    }
  });
let stop = observe();
window.addEventListener("pagehide", () => mounted.saveDrafts());
window.addEventListener(
  "unload",
  () => {
    stop();
    resize.disconnect();
    window.removeEventListener("message", receive);
    mounted.dispose();
  },
  { once: true },
);
emit({ ready: true, context: raw });
theme();
