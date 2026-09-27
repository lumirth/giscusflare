// Deliberately no imports from the standard presentation, CSS or private files.
import {
  bindComposer,
  type Presentation,
  type Page,
} from "giscusflare/headless";
const emojis = {
  THUMBS_UP: "👍",
  THUMBS_DOWN: "👎",
  LAUGH: "😄",
  HOORAY: "🎉",
  CONFUSED: "😕",
  HEART: "❤️",
  ROCKET: "🚀",
  EYES: "👀",
} as const;
const node = (tag: string, text = "") => {
  const el = document.createElement(tag);
  el.textContent = text;
  return el;
};
const action = (text: string, run: () => unknown) => {
  const el = node("button", text) as HTMLButtonElement;
  el.type = "button";
  el.onclick = () => {
    void run();
  };
  return el;
};
export const forumPresentation: Presentation = {
  mount(target, runtime) {
    const controller = runtime;
    target.classList.add("forum");
    const heading = node("h3", "Discussion"),
      status = node("p"),
      list = node("div"),
      editorHost = node("div");
    const refresh = action("Refresh", () => controller.refresh()),
      sort = action("Reverse order", () =>
        controller.setOrder(
          controller.state.order === "oldest" ? "newest" : "oldest",
        ),
      );
    const auth = action("Sign in", () =>
      runtime.signedIn ? runtime.signOut() : runtime.signIn(),
    );
    const toolbar = node("div"); toolbar.className = "forum-toolbar";
    toolbar.append(heading, auth, refresh, sort);
    status.setAttribute("role", "status");
    list.className = "forum-list"; editorHost.className = "forum-editors";
    target.append(toolbar, status, list, editorHost);
    const editors = new Map<
      string,
      { form: HTMLFormElement; dispose: () => void }
    >();
    const composer = (name: string) => {
      if (editors.has(name)) return editors.get(name)!.form;
      const form = document.createElement("form"),
        textarea = document.createElement("textarea"),
        preview = node("div"),
        feedback = node("p");
      textarea.rows = 5;
      form.dataset.composer = name;
      form.className = "forum-composer";
      textarea.setAttribute("aria-label", "Your comment");
      const binding = bindComposer(runtime, name, { form, textarea });
      const write = action("Write", () => binding.write()),
        show = action("Preview", () => binding.preview());
      const submit = document.createElement("button");
      submit.type = "submit";
      submit.textContent = "Publish";
      const cancel = action("Cancel", () => binding.cancel());
      form.append(write, show, textarea, preview, feedback, submit);
      if (name !== "main") form.append(cancel);
      let previewKey = "";
      const update = () => {
        const state = binding.state;
        textarea.hidden = state.mode === "preview";
        preview.hidden = state.mode === "write";
        const key = JSON.stringify([state.previewPending, state.previewHTML, state.previewBody]);
        if (key !== previewKey) {
          previewKey = key;
          preview.replaceChildren(state.previewPending ? "Loading preview..." : runtime.renderContent(state.previewHTML, state.previewBody));
        }
        if (feedback.textContent !== state.error) feedback.textContent = state.error;
        submit.disabled = state.pending;
        const label = runtime.signedIn ? "Publish" : "Sign in with GitHub";
        if (submit.textContent !== label) submit.textContent = label;
      };
      binding.subscribe(update);
      update();
      editors.set(name, { form, dispose: () => binding.dispose() });
      return form;
    };
    const articles = new Map<string, HTMLElement>();
    const render = () => {
      auth.textContent = runtime.signedIn ? "Sign out" : "Sign in";
      status.textContent = controller.state.error || runtime.authenticationError;
      // Keep editorHost and its forms mounted while the surrounding data changes.
      for (const [name, item] of editors)
        if (name !== "main" && !controller.editors.has(name)) {
          item.form.remove(); item.dispose(); editors.delete(name);
        }
      if (!editors.has("main")) editorHost.append(composer("main"));
      for (const name of controller.editors.keys()) {
        const form = composer(name);
        if (form.parentElement !== editorHost) editorHost.append(form);
      }
      const live = new Set<string>();
      const comment = (
        c:
          | (typeof controller.state.comments)[number]
          | (typeof controller.state.comments)[number]["replies"]["items"][number],
      ) => {
        live.add(c.id);
        let article = articles.get(c.id);
        if (!article) {
          article = node("article");
          article.className = "forum-post";
          article.dataset.comment = c.id;
          articles.set(c.id, article);
        }
        const author = node("strong", c.author?.login || "Deleted"),
          date = node(
            "a",
            new Date(c.createdAt).toLocaleString(),
          ) as HTMLAnchorElement;
        date.href = c.url;
        const controls = node("div");
        controls.className = "forum-actions";
        for (const [reaction, emoji] of Object.entries(emojis)) {
          const group = c.reactions[reaction];
          const button = action(
            `${emoji} ${group?.count || 0}`,
            async () => {
              try {
                await controller.setReaction(
                  c.id,
                  reaction as keyof typeof emojis,
                  !group?.selected,
                );
              } catch (error) {
                status.textContent = String(error);
              }
            },
          );
          button.disabled = !runtime.signedIn;
          button.setAttribute(
            "aria-pressed",
            String(Boolean(group?.selected)),
          );
          controls.append(button);
        }
        controls.append(
          action("Reply", () => {
            controller.beginReply(c.replyToId || c.id);
            runtime.interactions.focus("reply:" + (c.replyToId || c.id));
          }),
        );
        if (c.viewerCanUpdate)
          controls.append(
            action("Edit", () => {
              runtime.interactions.focus(controller.beginEdit(c));
            }),
          );
        const byline = node("header"); byline.className = "forum-byline";
        const avatar = node("span", (c.author?.login || "?").slice(0, 1).toUpperCase()); avatar.className = "forum-avatar"; avatar.setAttribute("aria-hidden", "true");
        byline.append(avatar, author, date);
        const content = node("div"); content.className = "forum-body";
        if (c.deletedAt) content.textContent = "Comment deleted.";
        else if (c.isMinimized) {
          const hidden = document.createElement("details");
          hidden.append(node("summary", "Hidden comment"), runtime.renderContent(c.bodyHTML, c.body)); content.append(hidden);
        } else content.append(runtime.renderContent(c.bodyHTML, c.body));
        article.replaceChildren(byline, content, controls);
        if ("replies" in c) {
          const visible = controller.state.visibleReplies.get(c.id) || 5;
          const replies = node("div");
          replies.className = "replies";
          if (c.replies.count > Math.min(visible, c.replies.items.length))
            replies.append(
              action("Earlier replies", () => controller.revealReplies(c.id)),
            );
          replies.append(...c.replies.items.slice(-visible).map(comment));
          article.append(replies);
        }
        return article;
      };
      list.replaceChildren(...controller.state.comments.map(comment));
      if (controller.state.nextCursor)
        list.append(action("More comments", () => controller.loadMore()));
      for (const id of articles.keys()) if (!live.has(id)) articles.delete(id);
    };
    const stop = controller.subscribe(render);
    render();
    return {
      update() {
        render();
      },
      dispose() {
        stop();
        for (const item of editors.values()) item.dispose();
        target.classList.remove("forum");
        target.replaceChildren();
      },
    };
  },
};
