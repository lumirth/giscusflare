import { html, render, nothing } from "lit-html";
import { repeat } from "lit-html/directives/repeat.js";
import type { Presentation, Comment, RootComment } from "../headless.js";
import { strings, message } from "../i18n.js";
import { icon } from "../icons.js";
import { createComposer } from "./composer.js";
import { createReactions } from "./reactions.js";
import { createHeader } from "./header.js";
import { createActions } from "./actions.js";
import type { Part, StandardParts, StandardContext } from "./contracts.js";

/** The default UI is a consumer of the same public runtime as replacement UIs. */
export function createStandardPresentation(
  parts: StandardParts = {},
): Presentation {
  return {
    mount(target, runtime) {
      const root = document.createElement("main");
      root.className = "gsc-main";
      target.append(root);
      const hadClass = target.classList.contains("giscusflare");
      target.classList.add("giscusflare");
      const previousTheme = target.getAttribute("data-theme"),
        previousDir = target.getAttribute("dir");
      const model = runtime.controller;
      let error = "",
        disposed = false,
        drawing = false;
      const context: StandardContext = {
        runtime,
        report(e) {
          error = e instanceof Error ? e.message : String(e);
          draw();
        },
      };
      const composers = new Map<string, Part<void>>();
      const headers = new Map<string, ReturnType<typeof createHeader>>();
      const reactions = new Map<string, ReturnType<typeof createReactions>>();
      const actions = new Map<string, ReturnType<typeof createActions>>();
      const bodies = new Map<
        string,
        { signature: string; node: HTMLElement }
      >();
      let used = new Set<string>();
      function composer(name: string) {
        used.add("composer:" + name);
        let p = composers.get(name);
        if (!p) {
          p = (parts.composer || createComposer)(context, name);
          composers.set(name, p);
        }
        p.update();
        return p.element;
      }
      function header(comment: Comment, reply: boolean) {
        used.add("header:" + comment.id);
        let p = headers.get(comment.id);
        if (!p) {
          p = (parts.header || createHeader)(context);
          headers.set(comment.id, p);
        }
        p.update({ comment, reply });
        return p.element;
      }
      function react(
        subject: Parameters<
          ReturnType<typeof createReactions>["update"]
        >[0]["subject"],
        position: "top" | "bottom",
      ) {
        const id =
          position === "bottom" ? "discussion" : subject?.id || "discussion";
        used.add("reaction:" + id);
        let p = reactions.get(id);
        if (!p) {
          p = (parts.reactions || createReactions)(context);
          reactions.set(id, p);
        }
        p.update({ subject, position });
        return p.element;
      }
      function menu(
        item: Parameters<ReturnType<typeof createActions>["update"]>[0],
      ) {
        used.add("action:" + item.id);
        let p = actions.get(item.id);
        if (!p) {
          p = createActions(context, target);
          actions.set(item.id, p);
        }
        p.update(item);
        return p.element;
      }
      function body(comment: Comment) {
        used.add("body:" + comment.id);
        const signature = JSON.stringify([comment.body, comment.bodyHTML]);
        let old = bodies.get(comment.id);
        if (!old || old.signature !== signature) {
          const node = document.createElement("div");
          node.className = "markdown";
          node.append(runtime.renderContent(comment.bodyHTML, comment.body));
          old = { signature, node };
          bodies.set(comment.id, old);
        }
        return old.node;
      }
      const attempt = (work: () => Promise<unknown>) => () => {
        void work().catch(context.report);
      };
      const replyTo = (id: string) => () => {
        const name = model.beginReply(id);
        runtime.interactions.focus(name);
      };
      function content(c: Comment, reply: boolean) {
        const t = strings(runtime.config.lang);
        return html` ${
          model.editors.has("edit:" + c.id)
            ? composer("edit:" + c.id)
            : html`<div
                dir="auto"
                class=${"markdown " + (reply ? "gsc-reply-content" : "gsc-comment-content") + (c.isMinimized ? " minimized" : "")}
              >
                ${
                  c.deletedAt
                    ? html`<em class="color-text-secondary"
                        >${t.deletedComment}</em
                      >`
                    : c.isMinimized
                      ? html`<details>
                          <summary class="color-text-secondary">
                            ${t.hidden}${c.minimizedReason ? " · " + c.minimizedReason : ""}
                          </summary>
                          ${body(c)}
                        </details>`
                      : body(c)
                }
              </div>`
        }`;
      }
      function reply(c: Comment) {
        return html`<article class="gsc-reply" id=${"comment-" + c.id}>
          <div class="gsc-tl-line"></div>
          <div class="flex">
            <div class="gsc-reply-author-avatar">
              ${c.author ? html`<a href=${c.author.url} target="_blank" rel="nofollow noopener noreferrer"><img class="rounded-full" src=${c.author.avatarUrl} width="30" height="30" loading="lazy" alt=${"@" + c.author.login} /></a>` : nothing}
            </div>
            <div class="w-full min-w-0 ml-2">
              <div class="gsc-header-with-actions">
                ${header(c, true)}${menu(c)}
              </div>
              ${content(c, true)}
              ${
                !c.deletedAt && !c.isMinimized
                  ? html`<div class="gsc-reply-footer">
                      <div class="gsc-reply-reactions">${react(c, "top")}</div>
                      ${c.isAnswer ? html`<span class="color-text-success">${icon("check")}${strings(runtime.config.lang).answered}</span>` : nothing}
                    </div>`
                  : nothing
              }
            </div>
          </div>
        </article>`;
      }
      function comment(c: RootComment) {
        const state = model.state,
          t = strings(runtime.config.lang),
          visible = state.visibleReplies.get(c.id) || 5,
          replies = c.replies.nodes.slice(-visible),
          hidden = Math.max(0, c.replies.totalCount - replies.length),
          replying = model.editors.has("reply:" + c.id);
        return html`<article class="gsc-comment" id=${"comment-" + c.id}>
          <div
            class=${"w-full min-w-0 rounded-md border " + (c.viewerDidAuthor ? "gsc-comment-author-is-viewer" : "")}
          >
            <div class="gsc-header-with-actions">
              ${header(c, false)}${menu(c)}
            </div>
            ${content(c, false)}
            ${
              !c.deletedAt && !c.isMinimized
                ? html`<div class="gsc-comment-footer">
                    <div class="gsc-comment-reactions">${react(c, "top")}</div>
                    <div class="gsc-comment-replies-count color-text-secondary">
                      ${message(runtime.config.lang, "replies", c.replies.totalCount)}
                    </div>
                  </div>`
                : nothing
            }
            ${
              c.replies.totalCount
                ? html`<div class="gsc-replies color-bg-inset">
                    ${
                      hidden
                        ? html`<div
                            class="flex h-8 items-center mb-2 pl-4 gsc-replies-more"
                          >
                            <div
                              class="flex w-[29px] shrink-0 content-center mr-[9px] gsc-replies-more-icon"
                            >
                              ${icon("kebab-horizontal")}
                            </div>
                            <button
                              class="color-text-link underline"
                              type="button"
                              ?disabled=${state.loadingReplies.has(c.id)}
                              @click=${attempt(() => model.revealReplies(c.id))}
                            >
                              ${state.loadingReplies.has(c.id) ? t.loadingReplies : message(runtime.config.lang, "showPreviousReplies", hidden)}
                            </button>
                          </div>`
                        : nothing
                    }
                    ${repeat(replies, (r) => r.id, reply)}
                  </div>`
                : nothing
            }
            ${replying ? composer("reply:" + c.id) : !state.view?.discussion?.locked && !state.view?.archived && !state.view?.unavailable ? html`<div class="gsc-reply-box color-bg-tertiary"><button type="button" class="form-control color-text-secondary color-border-primary w-full cursor-text rounded border px-2 py-1 text-left focus:border-transparent" @click=${replyTo(c.id)}>${t.writeReply}</button></div>` : nothing}
          </div>
        </article>`;
      }
      function sweep<T>(map: Map<string, Part<T>>, prefix: string) {
        for (const [id, p] of map)
          if (!used.has(prefix + id)) {
            p.dispose();
            map.delete(id);
          }
      }
      function draw() {
        if (disposed || drawing) return;
        drawing = true;
        try {
          used = new Set();
          const state = model.state,
            t = strings(runtime.config.lang),
            discussion = state.view?.discussion;
          target.dataset.theme = runtime.config.theme;
          target.dir = /^(ar|he|fa|ur)(-|$)/.test(runtime.config.lang)
            ? "rtl"
            : "ltr";
          const writable =
            !state.view?.archived &&
            !state.view?.unavailable &&
            !discussion?.locked;
          const total =
            discussion?.reactionGroups.reduce(
              (sum, g) => sum + g.users.totalCount,
              0,
            ) || 0;
          const comments = html`<section class="gsc-comments">
            <div class="gsc-header">
              <div class="gsc-left-header">
                <a
                  class="gsc-comments-count link-primary"
                  href=${discussion?.url || "https://github.com/" + runtime.config.repo + "/discussions"}
                  target="_blank"
                  rel="noopener noreferrer"
                  >${message(runtime.config.lang, "comments", discussion?.comments.totalCount || 0)}</a
                >${
                  state.comments.some((c) => c.replies.totalCount)
                    ? html`<span>·</span
                        ><span
                          >${message(
                            runtime.config.lang,
                            "replies",
                            state.comments.reduce(
                              (n, c) => n + c.replies.totalCount,
                              0,
                            ),
                            state.nextCursor ? "+" : "",
                          )}</span
                        >`
                    : nothing
                }<span class="text-xs color-text-secondary"
                  >– powered by
                  <a
                    href="https://github.com/lumirth/giscusflare"
                    target="_blank"
                    rel="noopener noreferrer"
                    >Giscusflare</a
                  ></span
                >
              </div>
              <div class="BtnGroup" role="group" aria-label=${t.commentOrder}>
                ${(["oldest", "newest"] as const).map((order) => html`<div class=${"BtnGroup-item " + (state.order === order ? "BtnGroup-item--selected" : "")}><button type="button" class="btn" aria-pressed=${String(state.order === order)} @click=${attempt(() => model.setOrder(order))}>${t[order]}</button></div>`)}
              </div>
              ${discussion ? menu(discussion) : nothing}
            </div>
            <div class="gsc-timeline">
              ${repeat(state.comments, (c) => c.id, comment)}
            </div>
            ${state.nextCursor ? html`<div class="gsc-pagination"><button type="button" class="gsc-pagination-button" ?disabled=${state.loading} @click=${attempt(() => model.refresh(true))}>${t.more}</button></div>` : nothing}
          </section>`;
          render(
            html` ${
              runtime.config.reactionsEnabled
                ? html`<section class="gsc-reactions">
                    <div class="gsc-reactions-count">
                      ${message(runtime.config.lang, "reactions", total)}
                    </div>
                    <div class="gsc-discussion-reactions">
                      ${react(discussion || null, "bottom")}
                    </div>
                  </section>`
                : nothing
            }
            ${
              error || state.error || runtime.session.error
                ? html`<div class="flash flash-error" role="alert">
                    ${error || state.error || runtime.session.error}<button
                      class="ml-2 color-text-link"
                      type="button"
                      @click=${() => {
                        error = "";
                        void model.refresh();
                      }}
                    >
                      ${t.retry}
                    </button>
                  </div>`
                : nothing
            }
            ${state.loading && !state.view ? html`<p class="gsc-loading-text" role="status">${t.loading}</p>` : nothing}
            ${!writable ? html`<p class="flash">${state.view?.unavailable ? t.discussionUnavailable : state.view?.archived ? t.archived : t.locked}</p>` : nothing}
            ${runtime.config.inputPosition === "top" && writable ? composer("main") : nothing}
            ${comments}
            ${runtime.config.inputPosition === "bottom" && writable ? composer("main") : nothing}`,
            root,
          );
          sweep(composers, "composer:");
          sweep(headers, "header:");
          sweep(reactions, "reaction:");
          sweep(actions, "action:");
          for (const id of bodies.keys())
            if (!used.has("body:" + id)) bodies.delete(id);
        } finally {
          drawing = false;
        }
      }
      const stop = model.subscribe(draw),
        auth = runtime.session.subscribe(draw);
      draw();
      return {
        update() {
          draw();
        },
        dispose() {
          disposed = true;
          stop();
          auth();
          for (const map of [composers, headers, reactions, actions])
            for (const p of map.values()) p.dispose();
          root.remove();
          if (!hadClass) target.classList.remove("giscusflare");
          if (previousTheme === null) delete target.dataset.theme;
          else target.setAttribute("data-theme", previousTheme);
          if (previousDir === null) target.removeAttribute("dir");
          else target.setAttribute("dir", previousDir);
        },
      };
    },
  };
}
