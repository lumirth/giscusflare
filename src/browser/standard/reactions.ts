import { html, render, nothing } from "lit-html";
import { repeat } from "lit-html/directives/repeat.js";
import { bindDismissableMenu, type Reaction } from "../headless.js";
import { strings, message, reactionLabel } from "../i18n.js";
import { icon } from "../icons.js";
import type { ReactionFactory, ReactionInput } from "./contracts.js";
export const reactionEmoji: Readonly<Record<Reaction, string>> = {
  THUMBS_UP: "👍",
  THUMBS_DOWN: "👎",
  LAUGH: "😄",
  HOORAY: "🎉",
  CONFUSED: "😕",
  HEART: "❤️",
  ROCKET: "🚀",
  EYES: "👀",
};

export const createReactions: ReactionFactory = ({ runtime, report }) => {
  const element = document.createElement("div");
  element.className = "gsc-reaction-group";
  const smiley = icon("smiley");
  let input: ReactionInput = { subject: null, position: "bottom" },
    current: Reaction | undefined;
  let disposeMenu: () => void = () => {};
  let menu: HTMLDetailsElement | undefined;
  const choose = async (reaction: Reaction) => {
    if (!runtime.session.signedIn) return;
    if (menu) menu.open = false;
    const selected =
      input.subject?.reactionGroups.find((g) => g.content === reaction)
        ?.viewerHasReacted || false;
    try {
      await runtime.controller.setReaction(
        input.subject?.id || "discussion",
        reaction,
        !selected,
      );
    } catch (error) {
      report(error);
    }
  };
  const draw = () => {
    const t = strings(runtime.config.lang),
      groups = input.subject?.reactionGroups || [],
      signedIn = runtime.session.signedIn;
    // Treat the translation's link marker as a slot; never insert translation HTML.
    const [beforeSignIn = "", signInLabel = t.signIn, afterSignIn = ""] =
      message(runtime.config.lang, "signInToAddYourReaction").split(/<a>|<\/a>/);
    const id = input.subject?.id || "discussion",
      operation = runtime.controller.operationFor("reaction", id);
    const blocked =
      !signedIn ||
      Boolean(
        runtime.controller.state.view?.archived ||
        runtime.controller.state.view?.unavailable ||
        runtime.controller.state.view?.discussion?.locked,
      );
    render(
      html` <details class="gsc-reactions-menu">
          <summary
            class="link-secondary gsc-reactions-button gsc-social-reaction-summary-item"
            aria-label=${t.reactions}
            title=${t.reactions}
          >
            ${smiley}
          </summary>
          <div
            class=${"color-border-primary color-text-secondary color-bg-overlay gsc-reactions-popover text-sm open left " + input.position}
          >
            <p class=${signedIn ? "m-2 overflow-hidden text-ellipsis whitespace-nowrap" : "m-2"}>
              ${signedIn ? (current ? reactionLabel(t, current) : message(runtime.config.lang, "pickYourReaction")) : html`${beforeSignIn}<button type="button" class="color-text-link hover:underline" @click=${() => runtime.session.signIn().catch(report)}>${signInLabel}</button>${afterSignIn}`}
            </p>
            <div class="color-border-primary my-2 border-t"></div>
            <div class="m-2 gsc-emoji-grid">
              ${(Object.keys(reactionEmoji) as Reaction[]).map(
                (reaction) =>
                  html` <button
                    type="button"
                    class=${"gsc-emoji-button " + (groups.find((g) => g.content === reaction)?.viewerHasReacted ? "has-reacted color-bg-info color-border-tertiary" : "")}
                    aria-label=${reactionLabel(t, reaction)}
                    ?disabled=${blocked}
                    @click=${() => choose(reaction)}
                    @mouseenter=${() => {
                      current = reaction;
                      draw();
                    }}
                    @focus=${() => {
                      current = reaction;
                      draw();
                    }}
                    @mouseleave=${() => {
                      current = undefined;
                      draw();
                    }}
                    @blur=${() => {
                      current = undefined;
                      draw();
                    }}
                  >
                    <span class="gsc-emoji">${reactionEmoji[reaction]}</span>
                  </button>`,
              )}
            </div>
          </div>
        </details>
        <div class="gsc-direct-reaction-buttons">
          ${repeat(
            groups.filter((g) => g.users.totalCount > 0),
            (g) => g.content,
            (g) =>
              html` <button
                type="button"
                class=${"gsc-direct-reaction-button gsc-social-reaction-summary-item " + (g.viewerHasReacted ? "has-reacted" : "")}
                aria-label=${reactionLabel(t, g.content) + ": " + g.users.totalCount}
                title=${reactionLabel(t, g.content)}
                aria-pressed=${String(g.viewerHasReacted)}
                ?disabled=${blocked}
                @click=${() => choose(g.content)}
              >
                <span class="gsc-direct-reaction-button-emoji"
                  >${reactionEmoji[g.content]}</span
                ><span class="gsc-social-reaction-summary-item-count"
                  >${g.users.totalCount}</span
                >
              </button>`,
          )}
        </div>
        ${operation?.status === "uncertain" ? html`<button class="color-text-link text-xs" @click=${() => runtime.controller.retryReaction(id).catch(report)}>${t.retry}</button>` : nothing}`,
      element,
    );
    if (!menu) {
      menu = element.querySelector("details")!;
      disposeMenu = bindDismissableMenu(menu);
    }
  };
  return {
    element,
    update(value) {
      input = value;
      draw();
    },
    dispose() {
      disposeMenu();
      render(nothing, element);
    },
  };
};
