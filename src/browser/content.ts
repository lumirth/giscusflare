import {icon} from './icons.js';
import { markdown } from './markdown.js';
export type MathRenderer = (source: string, display: boolean) => Promise<DocumentFragment | null>;
export interface ContentProfile {
  /** Optional lightweight renderer. Null delegates to the full lazy default. */
  math?: MathRenderer | 'source';
  codeCopy?: boolean;
  labels?: {copy:string;copied:string;copyFailed:string;mathFailed:string};
}
const defaults={copy:'Copy',copied:'Copied!',copyFailed:'Select and copy the code manually.',mathFailed:'Unable to render math; showing its source.'};
export function createContentRenderer(profile:ContentProfile={}) {
  return (html:string,fallback=''):DocumentFragment=>{
    const fragment=markdown(html,fallback),labels=profile.labels||defaults;
    if(profile.codeCopy!==false)for(const pre of fragment.querySelectorAll('pre')){
      const source=pre.textContent||'';
      const button=document.createElement('button');button.type='button';button.className='code-copy';button.append(icon('copy'));button.title=labels.copy;button.setAttribute('aria-label',labels.copy);
      button.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(source);button.replaceChildren(icon('check'));button.title=labels.copied;button.setAttribute('aria-label',labels.copied);}catch{button.title=labels.copyFailed;button.setAttribute('aria-label',labels.copyFailed);}});
      pre.append(button);
    }
    if(profile.math!=='source')for(const element of fragment.querySelectorAll<HTMLElement>('.giscus-math')){
      const source=element.textContent||'',display=element.dataset.display==='block';
      element.setAttribute('aria-busy','true');
      void (async()=>{
        try{
          const alternate=typeof profile.math==='function'?await profile.math(source,display):null;
          const math=alternate||((await import('./math.js')).renderMath(source,display));
          element.replaceChildren(math);
        }catch{element.title=labels.mathFailed;}
        finally{element.removeAttribute('aria-busy');}
      })();
    }
    return fragment;
  };
}
export const renderContent=createContentRenderer();
