import type { CallbackResult } from '../domain/auth.js';
import { encode, jsonElement } from './dom.js';
const data = jsonElement<CallbackResult>(), status = document.getElementById('auth-status')!;
const back = document.getElementById('auth-return') as HTMLAnchorElement;
const url = new URL(data.returnURL);
if (data.status === 'ready') url.hash = 'gw-auth=' + encode(new TextEncoder().encode(JSON.stringify({ repo: data.repo, attempt: data.attempt, ticket: data.ticket, challenge: data.challenge })));
back.href = url.toString(); back.textContent = 'Return to page';
status.textContent = data.status === 'ready' ? 'Returning to comments...' : 'Sign-in cancelled.';
if (data.mode === 'redirect') {
  if (data.status === 'ready') location.replace(url.toString());
} else {
  if (window.opener && !window.opener.closed) window.opener.postMessage({ giscusAuthDone: { attempt: data.attempt, challenge: data.challenge, status: data.status, ticket: data.ticket } }, data.openerOrigin || location.origin);
  // The widget polls for completion if GitHub disconnects the opener.
  setTimeout(() => window.close(), 200);
}
