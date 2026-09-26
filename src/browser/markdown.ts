import { safeURL } from './dom.js';
const allowed = new Set('a p br strong b em i s del blockquote pre code ul ol li table thead tbody tfoot tr th td h1 h2 h3 h4 h5 h6 hr img span div details summary sub sup kbd samp var abbr mark input'.split(' '));
const discard = new Set('script style link meta iframe object embed form svg math textarea noscript template base head title audio video source'.split(' '));
let sequence = 0;
/** Rebuild GitHub HTML using allowed elements and attributes. */
export function markdown(html: string, fallback = ''): DocumentFragment {
  const fragment = document.createDocumentFragment();
  if (typeof html !== 'string' || html.length > 2000000) { fragment.append(document.createTextNode(fallback)); return fragment; }
  const inert = document.createElement('template'); inert.innerHTML = html;
  const prefix = `gw-md-${++sequence}-`; let visited = 0;
  function copy(source: Node, target: Node, depth: number): void {
    if (++visited > 20000 || depth > 100) return;
    if (source.nodeType === Node.TEXT_NODE) { target.appendChild(document.createTextNode(source.textContent || '')); return; }
    if (!(source instanceof Element) || source.namespaceURI !== 'http://www.w3.org/1999/xhtml') return;
    const tag = source.localName;
    if (discard.has(tag)) return;
    if (!allowed.has(tag)) { for (const child of source.childNodes) copy(child, target, depth + 1); return; }
    if (tag === 'input' && source.getAttribute('type') !== 'checkbox') return;
    const node = document.createElement(tag);
    const title = source.getAttribute('title'); if (title) node.title = title.slice(0, 1000);
    if (source.id) node.id = prefix + source.id;
    const classes = [...source.classList].filter(c => /^(?:pl-[a-z0-9-]+|language-[a-z0-9-]+|highlight|task-list-item|contains-task-list)$/.test(c));
    if (classes.length) node.className = classes.join(' ');
    if (node instanceof HTMLAnchorElement) {
      const raw = source.getAttribute('href') || '';
      if (raw.startsWith('#')) { let id = raw.slice(1); try { id = decodeURIComponent(id); } catch { /* Keep invalid percent escapes as text. */ } node.href = '#' + prefix + encodeURIComponent(id); }
      else {
        const href = safeURL(raw); if (href) { node.href = href; node.target = '_blank'; node.rel = 'ugc nofollow noopener noreferrer'; node.referrerPolicy = 'no-referrer'; }
      }
    }
    if (node instanceof HTMLImageElement) {
      const src = safeURL(source.getAttribute('src') || ''); if (!src.startsWith('https://')) return;
      node.src = src; node.alt = (source.getAttribute('alt') || '').slice(0, 2000); node.loading = 'lazy'; node.decoding = 'async'; node.referrerPolicy = 'no-referrer';
    }
    if (node instanceof HTMLInputElement) { node.type = 'checkbox'; node.checked = source.hasAttribute('checked'); node.disabled = true; }
    if (node instanceof HTMLTableCellElement) for (const attribute of ['colspan', 'rowspan']) {
      const n = Number(source.getAttribute(attribute)); if (Number.isSafeInteger(n) && n > 0 && n <= 100) node.setAttribute(attribute, String(n));
    }
    if (node instanceof HTMLOListElement && source.hasAttribute('start')) {
      const n = Number(source.getAttribute('start')); if (Number.isSafeInteger(n) && Math.abs(n) <= 100000) node.start = n;
    }
    for (const child of source.childNodes) copy(child, node, depth + 1);
    target.appendChild(node);
  }
  for (const child of inert.content.childNodes) copy(child, fragment, 0);
  return fragment;
}
