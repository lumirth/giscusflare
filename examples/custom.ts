// Deliberately no imports from the standard presentation, CSS or private files.
import {
  mountPresentation,
  bindComposer,
  type Presentation,
  type Widget,
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
const custom: Presentation = {
  mount(target, runtime) {
    const { controller, session } = runtime;
    const heading = node("h2", "Conversation"),
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
      session.signedIn ? session.signOut() : session.signIn(),
    );
    target.append(heading, auth, refresh, sort, status, list, editorHost);
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
      const update = () => {
        const state = binding.state;
        textarea.hidden = state.mode === "preview";
        preview.hidden = state.mode === "write";
        preview.replaceChildren(
          state.previewPending
            ? "Loading preview…"
            : runtime.renderContent(state.previewHTML, state.previewBody),
        );
        feedback.textContent = state.error;
        submit.disabled = state.pending;
        submit.textContent = session.signedIn
          ? "Publish"
          : "Sign in with GitHub";
      };
      binding.subscribe(update);
      update();
      editors.set(name, { form, dispose: () => binding.dispose() });
      return form;
    };
    const articles = new Map<string, HTMLElement>();
    const render = () => {
      auth.textContent = session.signedIn ? "Sign out" : "Sign in";
      status.textContent = controller.state.error || session.error;
      // Keep editorHost and its forms mounted while the surrounding data changes.
      for (const [name, item] of editors)
        if (name !== "main" && !controller.editors.has(name))
          item.form.remove();
      if (!editors.has("main")) editorHost.append(composer("main"));
      for (const name of controller.editors.keys()) {
        const form = composer(name);
        if (form.parentElement !== editorHost) editorHost.append(form);
      }
      const live = new Set<string>();
      const comment = (
        c:
          | (typeof controller.state.comments)[number]
          | (typeof controller.state.comments)[number]["replies"]["nodes"][number],
      ) => {
        live.add(c.id);
        let article = articles.get(c.id);
        if (!article) {
          article = node("article");
          articles.set(c.id, article);
        }
        const author = node("strong", c.author?.login || "Deleted"),
          date = node(
            "a",
            new Date(c.createdAt).toLocaleString(),
          ) as HTMLAnchorElement;
        date.href = c.url;
        const controls = node("div");
        for (const [reaction, emoji] of Object.entries(emojis)) {
          const group = c.reactionGroups.find((g) => g.content === reaction);
          const button = action(
            `${emoji} ${group?.users.totalCount || 0}`,
            async () => {
              try {
                await controller.setReaction(
                  c.id,
                  reaction as keyof typeof emojis,
                  !group?.viewerHasReacted,
                );
              } catch (error) {
                status.textContent = String(error);
              }
            },
          );
          button.disabled = !session.signedIn;
          button.setAttribute(
            "aria-pressed",
            String(Boolean(group?.viewerHasReacted)),
          );
          controls.append(button);
        }
        controls.append(
          action("Reply", () => {
            controller.beginReply(c.replyTo?.id || c.id);
            runtime.interactions.focus("reply:" + (c.replyTo?.id || c.id));
          }),
        );
        if (c.viewerCanUpdate)
          controls.append(
            action("Edit", () => {
              runtime.interactions.focus(controller.beginEdit(c));
            }),
          );
        article.replaceChildren(
          author,
          date,
          runtime.renderContent(c.bodyHTML, c.body),
          controls,
        );
        if ("replies" in c) {
          const visible = controller.state.visibleReplies.get(c.id) || 5;
          const replies = node("div");
          replies.className = "replies";
          if (c.replies.totalCount > Math.min(visible, c.replies.nodes.length))
            replies.append(
              action("Earlier replies", () => controller.revealReplies(c.id)),
            );
          replies.append(...c.replies.nodes.slice(-visible).map(comment));
          article.append(replies);
        }
        return article;
      };
      list.replaceChildren(...controller.state.comments.map(comment));
      if (controller.state.nextCursor)
        list.append(action("More comments", () => controller.refresh(true)));
      for (const id of articles.keys()) if (!live.has(id)) articles.delete(id);
    };
    const stop = controller.subscribe(render),
      authStop = session.subscribe(render);
    render();
    return {
      update() {
        render();
      },
      dispose() {
        stop();
        authStop();
        for (const item of editors.values()) item.dispose();
        target.replaceChildren();
      },
    };
  },
};
const params = new URLSearchParams(location.search),
  repo = params.get("repo"),
  number = Number(params.get("number"));
if (repo && number) {
  const config: Widget = {
    repo,
    number,
    term: "",
    repoId: "",
    category: params.get("category") || "Announcements",
    categoryId: "",
    strict: false,
    origin: location.href,
    backLink: "",
    description: "",
    theme: "light",
    lang: "en",
    inputPosition: "bottom",
    reactionsEnabled: true,
    emitMetadata: false,
  };
  mountPresentation(
    document.getElementById("conversation")!,
    { service: location.origin, config },
    custom,
  );
} else
  document.getElementById("conversation")!.textContent =
    "Supply ?repo=owner/repository&number=1 for an allowed public discussion.";
