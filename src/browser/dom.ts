export type Child = Node | string | number | null | undefined | false;
export function element<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string | boolean | number | undefined> = {}, ...children: (Child | Child[])[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    node.setAttribute(key === 'className' ? 'class' : key, value === true ? '' : String(value));
  }
  for (const child of children.flat()) if (child !== null && child !== undefined && child !== false) node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  return node;
}
export function button(text: string, action: (event: MouseEvent) => void | Promise<void>, attrs: Record<string, string | boolean> = {}): HTMLButtonElement {
  const node = element('button', { type: 'button', ...attrs }, text);
  node.addEventListener('click', event => { void action(event); }); return node;
}
export function safeURL(value: string): string {
  try { const url = new URL(value, 'https://github.com'); return ['https:', 'http:', 'mailto:'].includes(url.protocol) && !url.username && !url.password ? url.toString() : ''; }
  catch { return ''; }
}
export function link(url: string, label: string, attrs: Record<string, string> = {}): HTMLAnchorElement {
  return element('a', { ...attrs, href: safeURL(url) || 'https://github.com', target: '_blank', rel: 'noopener noreferrer', referrerpolicy: 'no-referrer' }, label);
}
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
