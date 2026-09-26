import { navigateAuthorization } from './navigation.js';
import type { AuthPrepare } from '../contracts/requests.js';
import { jsonElement } from './dom.js';
const config = jsonElement<AuthPrepare>();
const status = document.getElementById('auth-status')!;
const back = document.getElementById('auth-return') as HTMLAnchorElement;
back.href = config.origin;
setTimeout(() => { back.hidden = false; }, 1800);
async function run(): Promise<void> {
  if (config.mode === 'popup' && !window.opener) throw new Error('Return to the page and start sign-in from the comments.');
  const response = await fetch('/api/auth/prepare', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(config), credentials: 'same-origin', cache: 'no-store' });
  const data = await response.json() as { attempt?: string; authorizeURL?: string; error?: { message?: string } };
  if (!response.ok || !data.attempt || !data.authorizeURL) throw new Error(data.error?.message || 'Could not start sign-in.');
  const authorize = new URL(data.authorizeURL);
  if (authorize.origin !== 'https://github.com' || authorize.pathname !== '/login/oauth/authorize') throw new Error('The sign-in address is not a GitHub authorization URL.');
  if (config.mode === 'popup') {
    // Save the attempt ID in the opener before navigating to GitHub.
    await new Promise<void>((resolve, reject) => {
      const listener = (event: MessageEvent) => {
        if (event.origin === (config.openerOrigin || location.origin) && event.source === window.opener && event.data?.giscusAuthAck === data.attempt) {
          clearTimeout(timer); window.removeEventListener('message', listener); resolve();
        }
      };
      const timer = setTimeout(() => { window.removeEventListener('message', listener); reject(new Error('The originating widget could not be reached. Return to page and try again.')); }, 5000);
      window.addEventListener('message', listener);
      window.opener.postMessage({ giscusAuth: { attempt: data.attempt, challenge: config.challenge } }, config.openerOrigin || location.origin);
    });
  }
  const proceed=document.createElement('a');proceed.href=authorize.toString();proceed.textContent='Continue to GitHub';setTimeout(() => { status.replaceChildren(proceed); }, 1800);
  navigateAuthorization(authorize);
}
void run().catch(error => { document.querySelector('.auth-loading')?.remove(); back.hidden = false; status.textContent = error instanceof Error ? error.message : 'Sign-in failed.'; });
