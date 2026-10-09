import { preparedHTML, copyControl, type ContentProfile } from './content.js';
import { stockResourceRevision } from '../content/stock-resources.js';
export interface StockContentOptions {
  service: string;
  /** Complete required styles; standard presentations already provide these and pass an empty list. */
  styles?: string[];
  copy?: boolean;
  labels?: { copy: string; copied: string; copyFailed: string };
}
/** The stock capability's provider delivery, required styles and controls are selected together. */
export function stockContent(options: StockContentOptions): ContentProfile {
  const labels = options.labels || { copy: 'Copy', copied: 'Copied!', copyFailed: 'Select and copy the code manually.' };
  return { delivery: 'stock', render: preparedHTML({
    resources: {revision: stockResourceRevision, styles: options.styles ?? [new URL('/content.css', options.service).href], scripts: []},
    enhance(root, _input, context) {
      if (options.copy === false) return;
      for (const block of root.querySelectorAll<HTMLElement>('.code-block'))
        copyControl(block, block.querySelector('pre')?.textContent || '', labels, context.lifetime);
    },
  }) };
}
