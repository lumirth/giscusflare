import { html, nothing } from "lit-html";
import { repeat } from "lit-html/directives/repeat.js";
import { bindDismissableMenu, type Reaction } from "../headless.js";
import { strings, message, reactionLabel } from "../i18n.js";
import { icon } from "./icon.js";
import { resource } from "./resource.js";
import type { ReactionSlot } from "./contracts.js";

export const reactionEmoji: Readonly<Record<Reaction, string>> = {
  THUMBS_UP: '👍', THUMBS_DOWN: '👎', LAUGH: '😄', HOORAY: '🎉',
  CONFUSED: '😕', HEART: '❤️', ROCKET: '🚀', EYES: '👀',
};
const contents = Object.keys(reactionEmoji) as Reaction[];

export const reactions: ReactionSlot = ({ runtime, report, scope }, { subject, position }) => {
  let lifetime = scope.signal;
  const lang = runtime.appearance.lang, t = strings(lang), id = subject?.id || 'discussion',
    groups = subject ? runtime.reactions(id) : {}, signedIn = runtime.session.signedIn,
    blocked = (reaction: Reaction) => { const state = runtime.reaction(id, reaction); return state.permission.status !== 'available' || state.recovery?.status === 'uncertain'; },
    uncertain = contents.filter(reaction => runtime.reaction(id, reaction).recovery?.status === 'uncertain');
  const [before = '', signIn = t.signIn, after = ''] = message(lang, 'signInToAddYourReaction').split(/<a>|<\/a>/);
  const choose = async (reaction: Reaction, event: Event) => {
    if (lifetime.aborted || !runtime.session.signedIn) return;
    const menu = (event.currentTarget as HTMLElement).closest('.gsc-reaction-group')?.querySelector('details');
    if (menu) menu.open = false;
    try { await runtime.setReaction(id, reaction, !runtime.reaction(id, reaction).desired); }
    catch (error) { if (!lifetime.aborted) report(error); }
  };
  const signInText = html`${before}<button type="button" class="color-text-link hover:underline"
    @click=${() => { if (!lifetime.aborted) void runtime.session.signIn().catch(report); }}>${signIn}</button>${after}`;
  return html`<div class="gsc-reaction-group">
    <details class="gsc-reactions-menu" ${resource(scope, (menu, signal, fresh) => {
      lifetime = signal; if (fresh) bindDismissableMenu(menu as HTMLDetailsElement, signal);
    })}>
      <summary class="link-secondary gsc-reactions-button gsc-social-reaction-summary-item"
        aria-label=${t.reactions} title=${t.reactions}>${icon('smiley')}</summary>
      <div class=${'color-border-primary color-text-secondary color-bg-overlay gsc-reactions-popover text-sm open left ' + position}>
        <p class=${signedIn ? 'm-2 overflow-hidden text-ellipsis whitespace-nowrap' : 'm-2'}>
          ${signedIn ? message(lang,'pickYourReaction') : signInText}
        </p>
        <div class="color-border-primary my-2 border-t"></div>
        <div class="m-2 gsc-emoji-grid">
          ${contents.map(reaction => html`<button type="button"
            class=${'gsc-emoji-button ' + (groups[reaction]?.selected ? 'has-reacted color-bg-info color-border-tertiary' : '')}
            aria-label=${reactionLabel(t, reaction)} ?disabled=${blocked(reaction)} aria-busy=${runtime.reaction(id, reaction).pending}
            @click=${(event: Event) => choose(reaction, event)}>
            <span class="gsc-emoji">${reactionEmoji[reaction]}</span>
          </button>`)}
        </div>
      </div>
    </details>
    <div class="gsc-direct-reaction-buttons">
      ${repeat(Object.entries(groups).filter(([, group]) => group.count > 0), ([reaction]) => reaction,
        ([reaction, group]) => html`<button type="button"
          class=${'gsc-direct-reaction-button gsc-social-reaction-summary-item ' + (group.selected ? 'has-reacted' : '')}
          aria-label=${reactionLabel(t, reaction) + ': ' + group.count} title=${reactionLabel(t, reaction)}
          aria-pressed=${String(group.selected)} ?disabled=${blocked(reaction as Reaction)} aria-busy=${runtime.reaction(id, reaction as Reaction).pending}
          @click=${(event: Event) => choose(reaction as Reaction, event)}>
          <span class="gsc-direct-reaction-button-emoji">${reactionEmoji[reaction as Reaction]}</span><span
            class="gsc-social-reaction-summary-item-count">${group.count}</span>
        </button>`)}
    </div>
    ${uncertain.map(reaction => html`<button type="button" class="color-text-link text-xs"
      ?disabled=${runtime.reaction(id, reaction).pending}
      @click=${() => { if (!lifetime.aborted) void (runtime.reaction(id, reaction).recover.status === 'sign-in' ? runtime.session.signIn() : runtime.retryReaction(id, reaction)).catch(report); }}>${t.retry}</button>${runtime.reaction(id, reaction).abandon ? html`<button type="button" class="ml-2 color-text-link text-xs" @click=${() => { if (window.confirm('This reaction may already be saved on GitHub. Stop trying to recover its outcome?')) runtime.abandonReaction(id, reaction); }}>${t.cancel}</button>` : nothing}`)}
  </div>`;
};
