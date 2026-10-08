import type { CallbackResult } from '../domain/auth.js';
import { encode, jsonElement } from './dom.js';
const data = jsonElement<CallbackResult>(), status = document.getElementById('auth-status')!;
const back = document.getElementById('auth-return') as HTMLAnchorElement;
const url = new URL(data.returnURL);
url.hash = 'gw-auth=' + encode(new TextEncoder().encode(JSON.stringify({ repo: data.repo, attempt: data.attempt, status: data.status })));
back.href = url.toString(); back.textContent = 'Return to comments';
setTimeout(() => { back.hidden = false; }, 1800);
status.textContent = data.status === 'ready' ? 'Returning to comments…' : 'Sign-in cancelled.';
if (data.status !== 'ready') { document.querySelector('.auth-loading')?.remove(); back.hidden = false; }
if (data.mode === 'redirect') {
  location.replace(url.toString());
} else {
  if (window.opener && !window.opener.closed) window.opener.postMessage({ giscusAuthDone: { attempt: data.attempt, status: data.status } }, data.openerOrigin || location.origin);
  setTimeout(() => window.close(), 200);
}
