import { mountPresentation, createStandardPresentation } from 'giscusflare';
import { stockContent } from 'giscusflare/content/stock';
import { forumPresentation } from '../examples/forum.js';

declare const DEMO_ORIGIN: string;
declare const DEMO_NUMBER: number;
const host = document.getElementById('demo-comments')!;
const presentations = { standard: createStandardPresentation(), forum: forumPresentation };
let current: keyof typeof presentations = 'standard';
host.replaceChildren();
const comments = mountPresentation(host, {
  service: DEMO_ORIGIN,
  content: stockContent({ service: DEMO_ORIGIN, styles: [] }),
  page: { repo: 'lumirth/giscusflare', selector: { kind: 'discussion', number: DEMO_NUMBER }, origin: location.origin, pageURL: location.href, returnURL: location.href },
  appearance: { theme: 'preferred_color_scheme' },
}, presentations[current]);
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-design]')) {
  button.addEventListener('click', () => {
    const design = button.dataset.design as keyof typeof presentations;
    if (design === current || !(design in presentations)) return;
    const active = comments.conversation.interactions.active;
    const textarea = host.querySelector<HTMLTextAreaElement>('textarea:focus');
    const selection = textarea ? [textarea.selectionStart, textarea.selectionEnd] as const : null;
    comments.replacePresentation(presentations[design]);
    current = design;
    for (const tab of document.querySelectorAll('[data-design]')) tab.setAttribute('aria-pressed', String((tab as HTMLElement).dataset.design === current));
    if (active) comments.conversation.interactions.focus(active);
    const restored = host.querySelector<HTMLTextAreaElement>('textarea:focus');
    if (restored && selection) restored.setSelectionRange(...selection);
  });
}
