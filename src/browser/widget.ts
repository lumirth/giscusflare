/** Iframe adapter only. All presentation and behavior are public API consumers. */
import {mountComments, conversationSettings} from './native.js';
import type {ConversationInitialization} from './runtime.js';
import {type SavedWriting} from '../conversation/writing.js';
import type {Widget} from '../contracts/requests.js';
import {isNamedTheme} from '../themes.js';
const {defaultCommentOrder, bootstrap, ...raw} = JSON.parse(document.getElementById('gw-config')!.textContent!) as Widget & {
  defaultCommentOrder?: 'oldest' | 'newest';bootstrap?: import('./runtime.js').ConversationOptions['bootstrap'];
};
const target = document.getElementById('giscusflare')!;
target.replaceChildren();
const embedded = window.parent !== window, origin = raw.origin;
const emit = (value: Record<string, unknown>) => { if (embedded) window.parent.postMessage({giscus: value}, origin); };
const restoring = new Map<string, (record: SavedWriting | undefined) => void>();
const mounted = mountComments(target, {
  service: location.origin, ...conversationSettings(raw, raw), bootstrap, order: defaultCommentOrder,
  ...(embedded ? {host: {
    emit,
    restoreWriting(id: string) {
      return new Promise<SavedWriting | undefined>(resolve => {
        restoring.get(id)?.(undefined);restoring.set(id, resolve);emit({restoreWriting: id});
      });
    },
    navigate(url: string) { emit({navigate: url}); },
  }} : {}),
});
const theme = () => {
  const sheet = document.querySelector<HTMLLinkElement>('[data-theme-sheet]');
  if (sheet) sheet.href = isNamedTheme(mounted.conversation.appearance.theme) ? '/themes/' + mounted.conversation.appearance.theme + '.css' : mounted.conversation.appearance.theme;
  document.documentElement.lang = mounted.conversation.appearance.lang;
  document.documentElement.dir = /^(ar|he|fa|ur)(-|$)/.test(mounted.conversation.appearance.lang) ? 'rtl' : 'ltr';
};
const receive = (event: MessageEvent) => {
  if (event.source !== window.parent || event.origin !== origin || !event.data?.giscus || typeof event.data.giscus !== 'object') return;
  const data = event.data.giscus as Record<string, unknown>;
  if (typeof data.restoreWritingId === 'string') {
    const complete = restoring.get(data.restoreWritingId);restoring.delete(data.restoreWritingId);
    complete?.(data.restoredWriting as SavedWriting | undefined);
  }
  if (data.init && typeof data.init === 'object') mounted.conversation.initialize(data.init as ConversationInitialization);
  if (data.setConfig && typeof data.setConfig === 'object') {
    const value = data.setConfig as Record<string, unknown>, update: Partial<Widget> = {};
    for (const key of ['theme', 'lang', 'description', 'pageURL', 'returnURL'] as const) if (typeof value[key] === 'string') update[key] = value[key];
    for (const key of ['reactionsEnabled', 'emitMetadata'] as const) if (typeof value[key] === 'boolean') update[key] = value[key];
    if (value.inputPosition === 'top' || value.inputPosition === 'bottom') update.inputPosition = value.inputPosition;
    if (value.selector && typeof value.selector === 'object') update.selector = value.selector as Widget['selector'];
    if (update.theme && !isNamedTheme(update.theme)) {
      try { if (new URL(update.theme).protocol !== 'https:') delete update.theme; } catch { delete update.theme; }
    }
    try {
      const settings = conversationSettings({...mounted.conversation.config, ...update}, {...mounted.conversation.appearance, ...update});
      const pageChanged = ['selector', 'pageURL', 'returnURL', 'description'].some(key => Object.hasOwn(update, key));
      if (pageChanged) {
        stop();mounted.replacePage(settings.page);stop = observe();
      }
      mounted.conversation.updateAppearance(settings.appearance);theme();
      if (pageChanged) emit({ready: true, context: mounted.conversation.config});
    } catch { emit({error: 'Invalid comments settings.'}); }
  }
};
window.addEventListener('message', receive);
let lastHeight = 0;
const resize = new ResizeObserver(() => {
  const height = Math.ceil(target.getBoundingClientRect().height);
  if (height !== lastHeight) { lastHeight = height;emit({resizeHeight: height}); }
});
resize.observe(target);
const observe = () => {
  const conversation = mounted.conversation;
  const layout = () => { if (conversation.readingLayout.ready) emit({rendered: true}); };
  const stopLayout = conversation.readingLayout.subscribe(layout);layout();
  const metadata = () => {
    if (conversation.ready && conversation.appearance.emitMetadata) emit({discussion: conversation.document.metadata.thread, viewer: conversation.viewer?.principal ?? null});
  };
  const stopData = conversation.subscribe(metadata);metadata();
  return () => { stopLayout();stopData(); };
};
let stop = observe();
window.addEventListener('unload', () => {
  stop();for (const complete of restoring.values()) complete(undefined);restoring.clear();resize.disconnect();window.removeEventListener('message', receive);mounted.dispose();
}, {once: true});
emit({ready: true, context: raw});
theme();
