import {icon} from './icons.js';
import { markdown } from './markdown.js';
export type MathRenderer = (source: string, display: boolean, signal: AbortSignal) => Promise<DocumentFragment | null>;
export type CodeRenderer = (source: string, language: string, signal: AbortSignal) => Promise<DocumentFragment | null>;
export interface ContentProfile {
  /** Trusted application renderer; null or rejection keeps sanitized source and copy control. */
  code?: CodeRenderer;
  /** Optional lightweight renderer. Null delegates to the full lazy default. */
  math?: MathRenderer | 'source';
  codeCopy?: boolean;
  labels?: {copy:string;copied:string;copyFailed:string;mathFailed:string};
}
const defaults={copy:'Copy',copied:'Copied!',copyFailed:'Select and copy the code manually.',mathFailed:'Unable to render expression.'};
export function createContentRenderer(profile:ContentProfile={}) {
  return (html:string,fallback:string,signal:AbortSignal):DocumentFragment=>{
    signal.throwIfAborted();
    const fragment=markdown(html,fallback),labels=profile.labels||defaults;
    for(const pre of fragment.querySelectorAll('pre')){
      const source=pre.textContent||'';
      const block=document.createElement('div');block.className='code-block';pre.replaceWith(block);block.append(pre);
      if(profile.codeCopy!==false) {
      const button=document.createElement('button');button.type='button';button.className='code-copy';button.append(icon('copy'));button.title=labels.copy;button.setAttribute('aria-label',labels.copy);
      let reset: ReturnType<typeof setTimeout> | undefined;
      signal.addEventListener('abort', () => clearTimeout(reset), { once: true });
      button.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(source);if(signal.aborted)return;button.replaceChildren(icon('check'));button.title=labels.copied;button.setAttribute('aria-label',labels.copied);clearTimeout(reset);reset=setTimeout(()=>{button.replaceChildren(icon('copy'));button.title=labels.copy;button.setAttribute('aria-label',labels.copy);},2000);}catch{if(!signal.aborted){button.title=labels.copyFailed;button.setAttribute('aria-label',labels.copyFailed);}}}, { signal });
      block.append(button);
      }
      if (profile.code) {
        pre.setAttribute('aria-busy','true');
        void profile.code(source,pre.dataset.language||'text',signal).then(replacement=>{
          if(replacement&&!signal.aborted) pre.replaceWith(replacement);
        }).catch(()=>{ /* The readable source and copy control remain available. */ })
          .finally(()=>{if(!signal.aborted)pre.removeAttribute('aria-busy');});
      }
    }
    if(profile.math!=='source')for(const element of fragment.querySelectorAll<HTMLElement>('.giscus-math')){
      const source=element.textContent||'',display=element.dataset.display==='block';
      element.setAttribute('aria-busy','true');
      void (async()=>{
        try{
          const alternate=typeof profile.math==='function'?await profile.math(source,display,signal):null;
          if(signal.aborted)return;
          const renderer=alternate?null:await import('./math.js');
          if(signal.aborted)return;
          const math=alternate||renderer!.renderMath(source,display);
          element.replaceChildren(math);
        }catch{
          if(signal.aborted)return;
          element.classList.add('math-render-error');
          const message=document.createElement('span');message.className='math-render-message';message.textContent=labels.mathFailed;
          const sourceCode=document.createElement('code');sourceCode.className='math-render-source';sourceCode.textContent=element.dataset.source||source;
          element.replaceChildren(message,sourceCode);
        }
        finally{if(!signal.aborted)element.removeAttribute('aria-busy');}
      })();
    }
    return fragment;
  };
}
export const renderContent=createContentRenderer();
