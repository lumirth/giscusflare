import { createConversation, createStandardPresentation } from 'giscusflare';
import { forumPresentation } from '../examples/forum.js';

declare const DEMO_ORIGIN: string;
declare const DEMO_NUMBER: number;
const host = document.getElementById('demo-comments')!;
const runtime = createConversation({
  service: DEMO_ORIGIN,
  page: { repo: 'lumirth/giscusflare', number: DEMO_NUMBER, origin: location.href, backLink: location.href },
  appearance: { theme: 'preferred_color_scheme' },
});
host.replaceChildren();
const presentations = { standard: createStandardPresentation(), forum: forumPresentation };
let current: keyof typeof presentations = 'standard';
let view = presentations[current].mount(host, runtime);
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-design]')) {
  button.addEventListener('click', () => {
    const design = button.dataset.design as keyof typeof presentations;
    if (design === current || !(design in presentations)) return;
    const active = runtime.interactions.active;
    const textarea = host.querySelector<HTMLTextAreaElement>('textarea:focus');
    const selection = textarea ? [textarea.selectionStart, textarea.selectionEnd] as const : null;
    runtime.saveDrafts();
    view.dispose();
    current = design;
    view = presentations[current].mount(host, runtime);
    for (const tab of document.querySelectorAll('[data-design]')) tab.setAttribute('aria-pressed', String((tab as HTMLElement).dataset.design === current));
    if (active) runtime.interactions.focus(active);
    const restored = host.querySelector<HTMLTextAreaElement>('textarea:focus');
    if (restored && selection) restored.setSelectionRange(...selection);
  });
}
