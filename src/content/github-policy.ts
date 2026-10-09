export const allowed = new Set('a p br strong b em i s del blockquote pre code ul ol li table thead tbody tfoot tr th td h1 h2 h3 h4 h5 h6 hr img span div details summary sub sup kbd samp var abbr mark input'.split(' '));
export const discard = new Set('script style link meta iframe object embed form svg math textarea noscript template base head title audio video source'.split(' '));
// GitHub's code previews use these classes for their frame, line numbers and code table.
// Keep a finite list: comment HTML cannot opt into arbitrary application styles.
export const richClasses = new Set('Box Box--condensed Box-header Box-body my-2 f6 mb-0 text-bold color-fg-muted commit-tease-sha p-0 blob-wrapper blob-wrapper-embedded blob-num blob-code blob-code-inner border-0 tmp-px-3 py-0 color-bg-default tab-size js-file-line-container snippet-clipboard-content'.split(' '));

export function safeURL(value: string): string {
  try { const url = new URL(value, 'https://github.com'); return ['https:', 'http:', 'mailto:'].includes(url.protocol) && !url.username && !url.password ? url.toString() : ''; }
  catch { return ''; }
}
