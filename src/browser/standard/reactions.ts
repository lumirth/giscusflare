import { html, nothing } from "lit-html";
import { repeat } from "lit-html/directives/repeat.js";
import { bindDismissableMenu, type Reaction } from "../headless.js";
import { strings, message, reactionLabel } from "../i18n.js";
import { icon } from "./icon.js";
import { resource } from "./resource.js";
import type { ReactionSlot } from "./contracts.js";

export const reactionEmoji: Readonly<Record<Reaction, string>> = {
  THUMBS_UP: '👍',
  THUMBS_DOWN: '👎',
  LAUGH: '😄',
  HOORAY: '🎉',
  CONFUSED: '😕',
  HEART: '❤️',
  ROCKET: '🚀',
  EYES: '👀',
};
export const reactions: ReactionSlot = ({ runtime, report, scope }, { subject, position }) => {
  let lifetime = scope.signal;
  const lang = runtime.appearance.lang, t = strings(lang), groups = subject ? runtime.reactions(subject.id) : {},
    id = subject?.id || 'discussion', blocked = !subject || !runtime.session.signedIn || !runtime.canCompose,
    uncertain = Object.keys(reactionEmoji).some(reaction => runtime.reactionIntent(id, reaction as Reaction)?.error?.status === 'uncertain');
  const [before = '', signIn = t.signIn, after = ''] = message(lang, 'signInToAddYourReaction').split(/<a>|<\/a>/);
  const choose = async (reaction: Reaction, event: Event) => {
    if (lifetime.aborted || !runtime.session.signedIn) return;
    const menu = (event.currentTarget as HTMLElement).closest('.gsc-reaction-group')?.querySelector('details');
    if (menu) menu.open = false;
    try { await runtime.setReaction(id, reaction, !groups[reaction]?.selected); }
    catch (error) { if (!lifetime.aborted) report(error); }
  };
  return html`<div class="gsc-reaction-group">
    <details class="gsc-reaction-picker" ${resource(scope, (menu, signal, fresh) => { lifetime = signal;if (fresh) bindDismissableMenu(menu as HTMLDetailsElement, signal); })}>
      <summary aria-label=${t.reactions} title=${t.reactions}>${icon('smiley')}</summary>
      <div class="gsc-reactions-popover" data-position=${position}>
        <p>${runtime.session.signedIn ? message(lang, 'pickYourReaction') : html`${before}<button type="button"
          @click=${() => { if (!lifetime.aborted) void runtime.session.signIn().catch(report); }}>${signIn}</button>${after}`}</p>
        <div class="gsc-emoji-grid">
          ${(Object.keys(reactionEmoji) as Reaction[]).map(reaction => html`<button type="button"
            aria-label=${reactionLabel(t, reaction)} title=${reactionLabel(t, reaction)}
            aria-pressed=${String(Boolean(groups[reaction]?.selected))} ?disabled=${blocked}
            @click=${(event: Event) => choose(reaction, event)}>${reactionEmoji[reaction]}</button>`)}
        </div>
      </div>
    </details>
    ${repeat(Object.entries(groups).filter(([, group]) => group.count > 0), ([reaction]) => reaction, ([reaction, group]) => html`<button
      class="gsc-reaction-chip" type="button" aria-label=${reactionLabel(t, reaction) + ': ' + group.count} title=${reactionLabel(t, reaction)}
      aria-pressed=${String(group.selected)} ?disabled=${blocked}
      @click=${(event: Event) => choose(reaction as Reaction, event)}>
      ${reactionEmoji[reaction as Reaction]}<span>${group.count}</span>
    </button>`)}
    ${uncertain ? html`<button type="button"
      @click=${() => { if (!lifetime.aborted) void runtime.retryReaction(id).catch(report); }}>${t.retry}</button>` : nothing}
  </div>`;
};
