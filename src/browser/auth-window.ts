import { API_PREFIX } from '../contracts/protocol.js';
import { navigateAuthorization } from './navigation.js';
import type { AuthWindow } from '../contracts/requests.js';
import { challenge, jsonElement } from './dom.js';
// The private proof never belongs to a request URL, referrer or server-rendered data.
const proof = new URLSearchParams(location.hash.slice(1)).get('gw-proof') || '';
history.replaceState(history.state, '', location.pathname + location.search);
const config = jsonElement<AuthWindow>();
const status = document.getElementById('auth-status')!;
const back = document.getElementById('auth-return') as HTMLAnchorElement;
back.href = config.returnURL;
setTimeout(() => { back.hidden = false; }, 1800);
async function run(): Promise<void> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(proof) || await challenge(proof) !== config.attempt)
    throw new Error('Return to the page and start sign-in from the comments.');
  if (config.mode === 'popup' && !window.opener) throw new Error('Return to the page and start sign-in from the comments.');
  const { attempt: _attempt, ...context } = config;
  const response = await fetch(API_PREFIX + '/auth/prepare', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...context, proof }), credentials: 'same-origin', cache: 'no-store' });
  const data = await response.json() as { attempt?: string; authorizeURL?: string; error?: { message?: string } };
  if (!response.ok || data.attempt !== config.attempt || !data.authorizeURL) throw new Error(data.error?.message || 'Could not start sign-in.');
  const authorize = new URL(data.authorizeURL);
  if (authorize.origin !== 'https://github.com' || authorize.pathname !== '/login/oauth/authorize') throw new Error('The sign-in address is not a GitHub authorization URL.');
  const proceed=document.createElement('a');proceed.href=authorize.toString();proceed.textContent='Continue to GitHub';setTimeout(() => { status.replaceChildren(proceed); }, 1800);
  navigateAuthorization(authorize);
}
void run().catch(error => { document.querySelector('.auth-loading')?.remove(); back.hidden = false; status.textContent = error instanceof Error ? error.message : 'Sign-in failed.'; });
