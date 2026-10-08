export interface Page {
  repo:string;
  /** Full website URL, used for the GitHub sign-in return and embed policy. */
  origin:string;
  term?:string;
  number?:number;
  strict?:boolean;
  backLink?:string;
  description?:string;
}
export interface Appearance {
  theme:string;
  lang:string;
  reactionsEnabled:boolean;
  inputPosition:'top'|'bottom';
  emitMetadata:boolean;
}
/** Normalize browser options without importing the service's validation stack. */
export function conversationSettings(page:Page,appearance:Partial<Appearance>={}):{page:Required<Page>;appearance:Appearance}{
  if(!page||!page.repo||!page.origin||(!page.number&&!page.term?.trim()))throw new TypeError('A conversation needs a repository, website URL, and term or discussion number.');
  new URL(page.origin);
  return {
    page:{repo:page.repo,origin:page.origin,term:page.term??'',number:page.number??0,strict:page.strict??false,backLink:page.backLink??'',description:page.description??''},
    appearance:{theme:appearance.theme??'preferred_color_scheme',lang:appearance.lang??'en',reactionsEnabled:appearance.reactionsEnabled??true,inputPosition:appearance.inputPosition??'bottom',emitMetadata:appearance.emitMetadata??false},
  };
}
