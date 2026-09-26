import { isNamedTheme } from '../themes.js';
import type { RepositoryPolicy } from '../contracts/config.js';
import type { Widget } from '../contracts/requests.js';
export function escape(value: string): string { return value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!)); }
export function safeJSON(value: unknown): string { return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029'); }
export function security(response: Response, ancestors = "'none'", styleOrigins: string[] = []): Response {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'no-store'); headers.set('X-Content-Type-Options', 'nosniff'); headers.set('Referrer-Policy', 'no-referrer');
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  headers.set('Cross-Origin-Resource-Policy', 'cross-origin');
  headers.set('Content-Security-Policy', `default-src 'none'; script-src 'self'; style-src 'self' ${styleOrigins.join(' ')}; img-src https:; font-src 'self' ${styleOrigins.join(' ')}; connect-src 'self'; base-uri 'none'; object-src 'none'; form-action 'self'; frame-ancestors ${ancestors}`);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
export function documentHTML(title: string, content: string, script: string, config: unknown, lang = 'en', theme = 'preferred_color_scheme', head = ''): Response {
  const html = `<!doctype html><html lang="${escape(lang)}" data-theme="${escape(theme)}"${/^(ar|he|fa|ur)(-|$)/.test(lang) ? ' dir="rtl"' : ''}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>${escape(title)}</title><link rel="stylesheet" href="/widget.css">${head}</head><body>${content}<script id="gw-config" type="application/json">${safeJSON(config)}</script><script type="module" src="${escape(script)}"></script></body></html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
export function widgetHTML(widget: Widget, policy: RepositoryPolicy): Response {
  const custom = isNamedTheme(widget.theme) ? '' : widget.theme;
  const response = documentHTML('Comments', `<div id="giscusflare"><div class="gsc-loading" role="status"><div class="gsc-loading-image" aria-hidden="true"></div><p class="gsc-loading-text">Loading comments…</p></div></div><noscript><a href="https://github.com/${escape(widget.repo)}/discussions" target="_blank" rel="noopener noreferrer">View discussions on GitHub</a></noscript>`, '/widget.js', { ...widget, defaultCommentOrder: policy.defaultCommentOrder }, widget.lang, custom ? 'preferred_color_scheme' : widget.theme, `<link data-theme-sheet rel="stylesheet" href="${custom ? escape(custom) : '/themes/'+escape(widget.theme)+'.css'}">`);
  return security(response, policy.origins.join(' '), [...policy.origins, ...policy.customThemeOrigins]);
}
export function json(value: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...Object.fromEntries(new Headers(headers)) } });
}

export function authHTML(message: string, script: string, config: unknown): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>GitHub sign-in · giscusflare</title><link rel="stylesheet" href="/auth.css"></head><body><main class="auth-page"><div class="auth-loading" aria-hidden="true"></div><p id="auth-status" role="status">${escape(message)}</p><a id="auth-return" hidden>Return to comments</a></main><noscript>JavaScript is needed to complete sign-in.</noscript><script id="gw-config" type="application/json">${safeJSON(config)}</script><script type="module" src="${escape(script)}"></script></body></html>`;
  return new Response(html, {headers: {'Content-Type': 'text/html; charset=utf-8'}});
}
