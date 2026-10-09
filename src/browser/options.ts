import type { Selection } from '../contracts/requests.js';
/** Exact discussion identity, website authorization and independent rendering/return URLs. */
export type Page = Selection & { description?: string };
export interface Appearance {
  theme:string;
  lang:string;
  reactionsEnabled:boolean;
  inputPosition:'top'|'bottom';
  emitMetadata:boolean;
}
/** Normalize browser options without importing the service's validation stack. */
export function conversationSettings(page:Page,appearance:Partial<Appearance>={}):{page:Page & {description:string};appearance:Appearance}{
  if (!page?.repo || !page.selector || !(page.selector.kind === 'page' ? typeof page.selector.key === 'string' && page.selector.key.length <= 256 && page.selector.key.trim() : page.selector.kind === 'discussion' && Number.isSafeInteger(page.selector.number) && page.selector.number > 0 && (page.selector.id === undefined || typeof page.selector.id === 'string')))
    throw new TypeError('A conversation needs a repository and exact page key or discussion reference.');
  const origin = new URL(page.origin), pageURL = new URL(page.pageURL), returnURL = new URL(page.returnURL);
  if (origin.origin !== page.origin || returnURL.origin !== page.origin || !['https:','http:'].includes(pageURL.protocol) || pageURL.username || pageURL.password || pageURL.protocol === 'http:' && !['localhost','127.0.0.1','[::1]'].includes(pageURL.hostname))
    throw new TypeError('Use a safe canonical rendering URL and a return URL on the authorized website origin.');
  return {
    page:{...page,selector:{...page.selector},description:page.description??''},
    appearance:{theme:appearance.theme??'preferred_color_scheme',lang:appearance.lang??'en',reactionsEnabled:appearance.reactionsEnabled??true,inputPosition:appearance.inputPosition??'bottom',emitMetadata:appearance.emitMetadata??false},
  };
}
