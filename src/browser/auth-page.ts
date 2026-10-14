import type {CallbackResult} from '../domain/auth.js';
import {encode} from './dom.js';
export function authReturn(data:Pick<CallbackResult,'returnURL'|'attempt'|'repo'|'mode'|'openerOrigin'>,status:'ready'|'denied'|'failed'):URL{
  const url=new URL(data.returnURL),back=document.getElementById('auth-return') as HTMLAnchorElement;
  url.hash='gw-auth='+encode(new TextEncoder().encode(JSON.stringify({repo:data.repo,attempt:data.attempt,status})));
  back.href=url.toString();back.textContent='Return to comments';
  if(data.mode==='popup'&&window.opener&&!window.opener.closed)back.addEventListener('click',event=>{event.preventDefault();window.opener.postMessage({giscusAuthDone:{attempt:data.attempt,status}},data.openerOrigin);window.close();});
  return url;
}
/** A user retries once after the provider's deadline; no automatic request loop. */
export function retrySignIn(seconds:number,run:()=>void|Promise<void>,expires:number):void{
  const status=document.getElementById('auth-status')!,button=document.createElement('button');
  const until=Date.now()+Math.min(3600,Math.max(1,seconds))*1000;
  document.querySelector('.auth-loading')?.remove();
  if(until>=expires){status.textContent='GitHub sign-in is temporarily unavailable. Return to the comments and try again later.';return;}
  button.type='button';button.textContent='Retry sign-in';button.disabled=true;
  document.getElementById('auth-return')!.before(button);
  const update=()=>{
    if(Date.now()>=expires){button.remove();status.textContent='This sign-in expired. Return to the comments and start again.';return 0;}
    const remaining=Math.max(0,Math.ceil((until-Date.now())/1000));
    status.textContent=remaining?'GitHub sign-in is temporarily unavailable. Try again in '+(remaining<60?`${remaining} seconds.`:`${Math.ceil(remaining/60)} minutes.`):'GitHub sign-in is temporarily unavailable. You can try again now.';
    button.disabled=remaining>0;return remaining;
  };
  update();const timer=setInterval(()=>{if(!update())clearInterval(timer);},250);
  button.addEventListener('click',()=>{clearInterval(timer);if(Date.now()>=expires){update();return;}button.remove();void run();},{once:true});
}
