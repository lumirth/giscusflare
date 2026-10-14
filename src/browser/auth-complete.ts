import type { CallbackResult } from '../domain/auth.js';
import { jsonElement } from './dom.js';
import {authReturn,retrySignIn} from './auth-page.js';
const data = jsonElement<CallbackResult|{status:'failed';message:string}>(), status = document.getElementById('auth-status')!;
const back = document.getElementById('auth-return') as HTMLAnchorElement;
// The encrypted attempt owns resumable progress; the browser needs only public state.
const callback=new URL(location.href);callback.searchParams.delete('code');callback.searchParams.delete('error');
history.replaceState(null,'',callback);
function complete():void{
if(!('returnURL' in data)){
  document.querySelector('.auth-loading')?.remove();status.textContent=data.message;return;
}
const url=authReturn(data,data.status==='waiting'?'failed':data.status);
setTimeout(() => { back.hidden = false; }, 1800);
status.textContent = data.status === 'ready' ? 'Returning to comments…' : data.status==='failed'?data.message:'Sign-in cancelled.';
if (data.status !== 'ready') { document.querySelector('.auth-loading')?.remove(); back.hidden = false; }
if(data.status==='waiting'||data.status==='failed'){
  if(data.status==='waiting')retrySignIn(data.retryAfter,()=>location.reload());
} else if (data.mode === 'redirect') {
  location.replace(url.toString());
} else {
  if (window.opener && !window.opener.closed) window.opener.postMessage({ giscusAuthDone: { attempt: data.attempt, status: data.status } }, data.openerOrigin || location.origin);
  setTimeout(() => window.close(), 200);
}
}
complete();
