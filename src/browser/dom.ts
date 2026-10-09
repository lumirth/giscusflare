export { safeURL } from '../content/github-policy.js';
export function randomProof(): string {
  return encode(crypto.getRandomValues(new Uint8Array(32)));
}
export function encode(bytes: Uint8Array): string { let text = ''; for (const byte of bytes) text += String.fromCharCode(byte); return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
export async function challenge(verifier: string): Promise<string> { return encode(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)))); }
export function jsonElement<T>(id = 'gw-config'): T {
  const node = document.getElementById(id);
  if (!node?.textContent) throw new Error('Missing server configuration.');
  return JSON.parse(node.textContent) as T;
}
