import { html, render, nothing } from "lit-html";
import {
  bindDismissableMenu,
  type Comment,
  type Discussion,
} from "../headless.js";
import { strings } from "../i18n.js";
import { icon } from "../icons.js";
import { requestFields } from "./dialog.js";
import type { Part, StandardContext } from "./contracts.js";
/** Optional capabilities are contextual; no duplicate global GitHub links. */
export function createActions(
  { runtime, report }: StandardContext,
  host: HTMLElement,
): Part<Comment | Discussion> {
  const element = document.createElement("details");
  element.className = "gsc-actions";
  const stop = bindDismissableMenu(element);
  const act = (work: () => Promise<unknown> | void) => async () => {
    element.open = false;
    try {
      await work();
    } catch (e) {
      report(e);
    }
  };
  return {
    element,
    update(item) {
      const t = strings(runtime.config.lang),
        model = runtime.controller,
        signed = runtime.session.signedIn;
      const confirm = async (title: string) =>
        Boolean(
          await requestFields(host, title, [], {
            confirm: t.remove,
            cancel: t.cancel,
          }),
        );
      const edit = () => {
        if ("comments" in item) return;
        const name = model.beginEdit(item);
        runtime.interactions.focus(name);
      };
      const hide = async () => {
        if ("comments" in item) return;
        if (item.isMinimized) {
          await model.moderateComment(item.id, false);
          return;
        }
        const values = await requestFields(
          host,
          t.hide,
          [
            {
              kind: "select",
              name: "reason",
              label: t.reason,
              value: "OFF_TOPIC",
              options: [
                ["OFF_TOPIC", t.reasonOffTopic],
                ["ABUSE", t.reasonAbuse],
                ["DUPLICATE", t.reasonDuplicate],
                ["OUTDATED", t.reasonOutdated],
                ["RESOLVED", t.reasonResolved],
                ["SPAM", t.reasonSpam],
              ].map(([value, label]) => ({ value: value!, label: label! })),
            },
          ],
          { confirm: t.hide, cancel: t.cancel },
        );
        if (values)
          await model.moderateComment(
            item.id,
            true,
            values.reason as "OFF_TOPIC",
          );
      };
      const discussion = "comments" in item;
      render(
        html`<summary
            aria-label=${discussion ? t.discussionActions : t.actions}
            title=${discussion ? t.discussionActions : t.actions}
          >
            ${icon("kebab-horizontal")}
          </summary>
          <div class="gsc-action-menu color-bg-overlay color-border-primary">
            <a href=${item.url} target="_blank" rel="noopener noreferrer"
              >${t.onGitHub}</a
            >
            ${
              signed && item.viewerCanUpdate
                ? html`<button
                    type="button"
                    @click=${act(async () => {
                      if (!discussion) {
                        edit();
                        return;
                      }
                      const fields = await requestFields(
                        host,
                        t.editDiscussion,
                        [
                          {
                            kind: "text",
                            name: "title",
                            label: t.title,
                            value: item.title,
                          },
                          {
                            kind: "multiline",
                            name: "body",
                            label: t.body,
                            value: item.body,
                          },
                        ],
                        { confirm: t.save, cancel: t.cancel },
                      );
                      if (fields)
                        await model.changeDiscussion(item.id, "edit", fields);
                    })}
                  >
                    ${t.edit}
                  </button>`
                : nothing
            }
            ${
              signed && item.viewerCanDelete
                ? html`<button
                    type="button"
                    class="color-text-danger"
                    @click=${act(async () => {
                      if (
                        await confirm(
                          discussion
                            ? t.deleteDiscussionConfirm
                            : t.deleteConfirm,
                        )
                      ) {
                        if (discussion)
                          await model.changeDiscussion(item.id, "delete");
                        else await model.removeComment(item.id);
                      }
                    })}
                  >
                    ${t.remove}
                  </button>`
                : nothing
            }
            ${signed && !discussion && (item.viewerCanMinimize || item.viewerCanUnminimize) ? html`<button type="button" @click=${act(hide)}>${item.isMinimized ? t.unhide : t.hide}</button>` : nothing}
            ${signed && !discussion && (item.viewerCanMarkAsAnswer || item.viewerCanUnmarkAsAnswer) ? html`<button type="button" @click=${act(() => model.changeDiscussion(item.id, item.isAnswer ? "unanswer" : "answer"))}>${item.isAnswer ? t.unanswer : t.answer}</button>` : nothing}
            ${signed && discussion && (item.viewerCanClose || item.viewerCanReopen) ? html`<button type="button" @click=${act(() => model.changeDiscussion(item.id, item.closed ? "reopen" : "close"))}>${item.closed ? t.reopen : t.close}</button>` : nothing}
            ${signed && discussion && item.viewerCanLock ? html`<button type="button" @click=${act(() => model.changeDiscussion(item.id, item.locked ? "unlock" : "lock"))}>${item.locked ? t.unlock : t.lock}</button>` : nothing}
            ${
              signed && !discussion && !item.viewerDidAuthor && item.author
                ? html`<button
                    type="button"
                    @click=${act(async () => {
                      if (
                        await requestFields(
                          host,
                          t.blockConfirm.replace("{user}", item.author!.login),
                          [],
                          { confirm: t.block, cancel: t.cancel },
                        )
                      )
                        await model.blockAuthor(item.id, "account", true);
                    })}
                  >
                    ${t.block}
                  </button>`
                : nothing
            }
            <a
              href=${"https://github.com/contact/report-abuse?report=" + encodeURIComponent(item.url)}
              target="_blank"
              rel="noopener noreferrer"
              >${t.reportOnGitHub}</a
            >
          </div>`,
        element,
      );
    },
    dispose() {
      stop();
      render(nothing, element);
    },
  };
}
