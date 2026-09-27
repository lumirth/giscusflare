import type {
  ReactionRequest,
  ModerationReason,
  DiscussionActionRequest,
  BlockRequest,
  Widget,
} from "../contracts/requests.js";
import type { Comment, RootComment, Replies } from "../contracts/github.js";
import type { MutationResult } from "../contracts/results.js";
import type { ThreadView } from "../contracts/results.js";

export interface Transport {
  request<T>(
    operation: string,
    body: unknown,
    signal?: AbortSignal,
  ): Promise<T>;
}
export type Reaction = ReactionRequest["reaction"];
/** Reaction ranking is opt-in and requires all root pages; replies remain chronological. */
export type CommentOrder = "oldest" | "newest" | { reaction: Reaction };
export type OperationState = {
  status: "pending" | "failed" | "uncertain";
  message?: string;
};
export interface ReactionIntent {
  desired: Map<Reaction, boolean>;
  flight?: { reaction: Reaction; add: boolean; key: string };
  running?: Promise<void>;
}
export interface Editor {
  kind: "reply" | "edit";
  id: string;
  initial: string;
}
export interface ConversationState {
  view: ThreadView | null;
  comments: RootComment[];
  order: CommentOrder;
  nextCursor: string | null;
  loading: boolean;
  error: string;
  lastRefresh: number;
  operations: ReadonlyMap<string, OperationState>;
  expanded: ReadonlySet<string>;
  visibleReplies: ReadonlyMap<string, number>;
  loadingReplies: ReadonlySet<string>;
}
const emptyPage = () => ({
  hasNextPage: false,
  hasPreviousPage: false,
  startCursor: null,
  endCursor: null,
});
const unique = <T extends { id: string }>(items: T[]) => [
  ...new Map(items.map((item) => [item.id, item])).values(),
];

/** Owns conversation continuity independently of DOM, embedding and credentials. */
export class ConversationController {
  #state: ConversationState;
  #listeners = new Set<() => void>();
  #generation = 0;
  #identity = 0;
  #abort?: AbortController;
  #disposed = false;
  #replyLoads = new Map<string, Promise<void>>();
  #pending = new Map<string, Promise<MutationResult>>();
  #drafts = new Map<string, string>();
  #keys = new Map<string, string>();
  #editors = new Map<string, Editor>();
  #reactionIntents = new Map<string, ReactionIntent>();
  #draftListeners = new Set<() => void>();
  #refreshing?: { work: Promise<boolean>; reportErrors: boolean };
  replyPrefetch = 5;
  subscribeDrafts(listener: () => void): () => void {
    this.#draftListeners.add(listener);
    return () => this.#draftListeners.delete(listener);
  }
  #draftChanged(): void {
    for (const listener of this.#draftListeners) listener();
  }
  #operation(scope: string, value?: OperationState): void {
    const operations = new Map(this.#state.operations);
    if (value) operations.set(scope, value);
    else operations.delete(scope);
    this.#patch({ operations });
  }
  constructor(
    readonly config: Widget,
    readonly transport: Transport,
    order: CommentOrder = "oldest",
  ) {
    this.#state = {
      view: null,
      comments: [],
      order,
      nextCursor: null,
      loading: false,
      error: "",
      lastRefresh: 0,
      expanded: new Set(),
      visibleReplies: new Map(),
      loadingReplies: new Set(),
      operations: new Map(),
    };
  }
  /** Consumers must treat the snapshot as immutable. Mutations go through actions. */
  get state(): Readonly<ConversationState> {
    if (!this.#reactionIntents.size) return this.#state;
    const apply = <
      T extends { id: string; reactionGroups: Comment["reactionGroups"] },
    >(
      subject: T,
    ): T => {
      const intent =
        this.#reactionIntents.get(subject.id) ||
        (subject.id === this.#state.view?.discussion?.id
          ? this.#reactionIntents.get("discussion")
          : undefined);
      if (!intent) return subject;
      const groups = new Map(
        subject.reactionGroups.map((group) => [group.content, group]),
      );
      for (const [content, selected] of intent.desired) {
        const group = groups.get(content) || {
          content,
          viewerHasReacted: false,
          users: { totalCount: 0 },
        };
        groups.set(content, {
          ...group,
          viewerHasReacted: selected,
          users: {
            ...group.users,
            totalCount: Math.max(
              0,
              group.users.totalCount +
                Number(selected) -
                Number(group.viewerHasReacted),
            ),
          },
        });
      }
      return { ...subject, reactionGroups: [...groups.values()] };
    };
    return {
      ...this.#state,
      comments: this.#state.comments.map((c) => ({
        ...apply(c),
        replies: { ...c.replies, nodes: c.replies.nodes.map(apply) },
      })),
      view: this.#state.view?.discussion
        ? {
            ...this.#state.view,
            discussion: apply(this.#state.view.discussion),
          }
        : this.#state.view,
    };
  }
  get editors(): ReadonlyMap<string, Editor> {
    return this.#editors;
  }
  operationFor(
    kind:
      "composer" | "reaction" | "delete" | "moderate" | "discussion" | "block",
    id: string,
  ): OperationState | undefined {
    return this.#state.operations.get(kind + ":" + id);
  }
  get hasDrafts(): boolean {
    return [...this.#drafts.values()].some(Boolean);
  }
  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
  #emit(): void {
    if (!this.#disposed) for (const listener of this.#listeners) listener();
  }
  #patch(patch: Partial<ConversationState>): void {
    this.#state = { ...this.#state, ...patch };
    this.#emit();
  }
  #live(): void {
    if (this.#disposed) throw new Error("This conversation has been disposed.");
  }
  dispose(): void {
    this.#disposed = true;
    this.#generation++;
    this.#abort?.abort();
    this.#listeners.clear();
    this.#draftListeners.clear();
  }
  draft(name = "main"): string {
    return this.#drafts.get(name) ?? this.#editors.get(name)?.initial ?? "";
  }
  setDraft(name: string, value: string): void {
    this.#live();
    if (this.#pending.has("composer:" + name))
      throw new Error(
        "Wait for the pending submission before changing its draft.",
      );
    if (this.draft(name) !== value) this.#keys.delete(name);
    this.#drafts.set(name, value);
    this.#draftChanged();
  }
  #openEditor(name: string, editor: Editor): void {
    this.#editors.set(name, editor);
    if (!this.#drafts.has(name)) this.#drafts.set(name, editor.initial);
    this.#draftChanged();
    this.#emit();
  }
  beginReply(id: string): string {
    const name = "reply:" + id;
    this.#openEditor(name, { kind: "reply", id, initial: "" });
    return name;
  }
  beginEdit(comment: Comment): string {
    const name = "edit:" + comment.id;
    this.#openEditor(name, {
      kind: "edit",
      id: comment.id,
      initial: comment.body,
    });
    return name;
  }
  closeEditor(name: string): void {
    if (this.#pending.has("composer:" + name)) return;
    this.#editors.delete(name);
    this.#draftChanged();
    this.#emit();
  }
  serializeDrafts(): string {
    return JSON.stringify({
      drafts: [...this.#drafts],
      keys: [...this.#keys],
      editors: [...this.#editors],
    });
  }
  restoreDrafts(raw: string): void {
    if (raw.length > 240000) return;
    try {
      const saved = JSON.parse(raw);
      for (const [field, target] of [
        ["drafts", this.#drafts],
        ["keys", this.#keys],
      ] as const) {
        if (!Array.isArray(saved[field])) continue;
        for (const entry of saved[field].slice(0, 10)) {
          if (
            !Array.isArray(entry) ||
            typeof entry[0] !== "string" ||
            typeof entry[1] !== "string" ||
            entry[0].length > 300
          )
            continue;
          if (
            field === "keys"
              ? !/^[A-Za-z0-9_-]{16,100}$/.test(entry[1])
              : entry[1].length > 60000
          )
            continue;
          target.set(entry[0], entry[1]);
        }
      }
      if (Array.isArray(saved.editors))
        for (const entry of saved.editors.slice(0, 10)) {
          const editor = entry?.[1];
          if (
            typeof entry?.[0] === "string" &&
            entry[0].length <= 300 &&
            editor &&
            ["reply", "edit"].includes(editor.kind) &&
            typeof editor.id === "string" &&
            /^[A-Za-z0-9_+=:/.-]{1,256}$/.test(editor.id)
          ) {
            this.#editors.set(entry[0], {
              kind: editor.kind,
              id: editor.id,
              initial: "",
            });
          }
        }
    } catch {
      /* Browser storage is untrusted; invalid saved state is ignored. */
    }
  }
  /** Invalidate personalized snapshots when authentication changes. */
  changeIdentity(): void {
    this.#identity++;
    this.#generation++;
    this.#abort?.abort();
    this.#refreshing = undefined;
    this.#reactionIntents.clear();
    this.#pending.clear();
    this.#patch({
      view: null,
      comments: [],
      loading: false,
      nextCursor: null,
      operations: new Map(),
    });
  }
  async setOrder(order: CommentOrder): Promise<void> {
    if (JSON.stringify(order) === JSON.stringify(this.#state.order)) return;
    this.#generation++;
    this.#abort?.abort();
    this.#refreshing = undefined;
    this.#state = { ...this.#state, order, comments: [], nextCursor: null };
    await this.refresh();
  }
  async refresh(more = false): Promise<void> {
    await this.#startRefresh(more, false);
  }
  /** Refresh retained content quietly; false lets the scheduler back off on failure. */
  revalidate(): Promise<boolean> {
    return this.#startRefresh(false, true);
  }
  #startRefresh(more: boolean, background: boolean): Promise<boolean> {
    if (this.#refreshing && !more) {
      if (!background) this.#refreshing.reportErrors = true;
      return this.#refreshing.work;
    }
    const flight = {
      work: Promise.resolve(false),
      reportErrors: !background || !this.#state.view,
    };
    flight.work = this.#refresh(more, background, () => flight.reportErrors);
    this.#refreshing = flight;
    void flight.work
      .finally(() => {
        if (this.#refreshing === flight) this.#refreshing = undefined;
      })
      .catch(() => {});
    return flight.work;
  }
  async #refresh(more: boolean, background: boolean, reportErrors: () => boolean): Promise<boolean> {
    this.#live();
    if (more && (!this.#state.nextCursor || this.#state.loading)) return false;
    const generation = ++this.#generation,
      previous = this.#state;
    this.#abort?.abort();
    this.#abort = new AbortController();
    const signal = this.#abort.signal;
    this.#patch({ loading: true, ...(!background ? { error: "" } : {}) });
    try {
      const fetchPage = (cursor: string) =>
        this.transport.request<ThreadView>(
          "thread",
          {
            config: this.config,
            order: typeof previous.order === "object" ? "oldest" : previous.order,
            cursor,
            replyPrefetch: this.replyPrefetch,
          },
          signal,
        );
      const view = await fetchPage(more ? previous.nextCursor! : "");
      const ordered = (page: ThreadView) =>
        previous.order === "newest"
          ? [...(page.discussion?.comments.nodes || [])].reverse()
          : page.discussion?.comments.nodes || [];
      let comments = more
        ? unique([...previous.comments, ...ordered(view)])
        : ordered(view);
      let nextCursor = view.nextCursor;
      const seen = new Set<string>();
      // Revalidate all loaded root pages; do not silently forget later pages.
      while (
        !more &&
        nextCursor &&
        (typeof previous.order === "object" || comments.length < previous.comments.length) &&
        !seen.has(nextCursor)
      ) {
        seen.add(nextCursor);
        const page = await fetchPage(nextCursor);
        comments = unique([...comments, ...ordered(page)]);
        nextCursor = page.nextCursor;
      }
      if (typeof previous.order === "object") {
        if (nextCursor) throw new Error("Unable to load the complete discussion for reaction ranking. Please retry.");
        const reaction = previous.order.reaction;
        const count = (c: RootComment) => c.reactionGroups.find(g => g.content === reaction)?.users.totalCount || 0;
        comments.sort((a,b) => count(b)-count(a) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
      }
      // Revalidate expanded replies to their previous depth, preserving folding.
      for (let i = 0; i < comments.length; i++) {
        const item = comments[i]!,
          old = previous.comments.find((c) => c.id === item.id);
        if (
          !old ||
          !previous.expanded.has(item.id) ||
          old.replies.nodes.length <= item.replies.nodes.length
        )
          continue;
        let replies = item.replies;
        const cursors = new Set<string>();
        while (
          replies.pageInfo.hasPreviousPage &&
          replies.nodes.length < old.replies.nodes.length
        ) {
          const cursor = replies.pageInfo.startCursor || "";
          if (cursors.has(cursor)) break;
          cursors.add(cursor);
          const page = await this.transport.request<Replies>(
            "replies",
            { config: this.config, parentId: item.id, cursor },
            signal,
          );
          replies = {
            ...page,
            nodes: unique([...page.nodes, ...replies.nodes]),
          };
        }
        comments[i] = { ...item, replies };
      }
      if (generation !== this.#generation || this.#disposed) return false;
      this.#patch({ view, comments, nextCursor, lastRefresh: Date.now(), error: "" });
      return true;
    } catch (error) {
      if (generation === this.#generation && !signal.aborted && reportErrors())
        this.#patch({
          error:
            error instanceof Error ? error.message : "Unable to load comments.",
        });
      return false;
    } finally {
      if (generation === this.#generation && !this.#disposed)
        this.#patch({ loading: false });
    }
  }
  async loadReplies(parentId: string): Promise<void> {
    this.#live();
    const pending = this.#replyLoads.get(parentId);
    if (pending) return pending;
    const root = this.#state.comments.find((c) => c.id === parentId);
    if (!root) return;
    this.#patch({ expanded: new Set([...this.#state.expanded, parentId]) });
    if (!root.replies.pageInfo.hasPreviousPage) return;
    const generation = this.#generation;
    const load = (async () => {
      const page = await this.transport.request<Replies>("replies", {
        config: this.config,
        parentId,
        cursor: root.replies.pageInfo.startCursor || "",
      });
      if (this.#disposed || generation !== this.#generation) return;
      this.#patch({
        comments: this.#state.comments.map((c) =>
          c.id === parentId
            ? {
                ...c,
                replies: {
                  ...page,
                  nodes: unique([...page.nodes, ...c.replies.nodes]),
                },
              }
            : c,
        ),
      });
    })();
    this.#replyLoads.set(parentId, load);
    this.#patch({ loadingReplies: new Set(this.#replyLoads.keys()) });
    try {
      await load;
    } finally {
      this.#replyLoads.delete(parentId);
      this.#patch({ loadingReplies: new Set(this.#replyLoads.keys()) });
    }
  }
  async revealReplies(parentId: string): Promise<void> {
    const root = this.#state.comments.find((c) => c.id === parentId);
    if (!root || this.#replyLoads.has(parentId)) return;
    const visible = this.#state.visibleReplies.get(parentId) || 5;
    if (
      root.replies.nodes.length <= visible &&
      root.replies.pageInfo.hasPreviousPage
    )
      await this.loadReplies(parentId);
    const counts = new Map(this.#state.visibleReplies);
    counts.set(parentId, visible + 50);
    this.#patch({
      visibleReplies: counts,
      expanded: new Set([...this.#state.expanded, parentId]),
    });
  }
  async preview(body: string): Promise<string> {
    return (
      await this.transport.request<{ html: string }>("preview", {
        config: this.config,
        body,
      })
    ).html;
  }
  submit(name = "main"): Promise<MutationResult> {
    this.#live();
    const existing = this.#pending.get("composer:" + name);
    if (existing) return existing;
    const identity = this.#identity;
    const body = this.draft(name),
      editor = this.#editors.get(name);
    if (!body.trim())
      return Promise.reject(new Error("Write a comment before submitting."));
    const key = this.#keys.get(name) || crypto.randomUUID();
    this.#keys.set(name, key);
    this.#draftChanged();
    const operation = editor?.kind === "edit" ? "edit" : "comment";
    const input =
      editor?.kind === "edit"
        ? { id: editor.id, body, key }
        : { body, replyToId: editor?.id || "", key };
    const request = this.#mutate(operation, input, "composer:" + name).then(
      (result) => {
        if (identity !== this.#identity) return result;
        this.#drafts.delete(name);
        this.#keys.delete(name);
        this.#editors.delete(name);
        this.#draftChanged();
        this.#emit();
        return result;
      },
    );
    return request;
  }
  removeComment(id: string): Promise<MutationResult> {
    return this.#mutate("delete", { id });
  }
  moderateComment(
    id: string,
    minimized: boolean,
    reason: ModerationReason = "OFF_TOPIC",
  ): Promise<MutationResult> {
    return this.#mutate("moderate", { id, minimized, reason });
  }
  changeDiscussion(
    id: string,
    action: DiscussionActionRequest["action"],
    fields: Pick<DiscussionActionRequest, "title" | "body"> = {},
  ): Promise<MutationResult> {
    return this.#mutate("discussion", { id, action, ...fields });
  }
  blockAuthor(
    id: string,
    scope: BlockRequest["scope"],
    add: boolean,
  ): Promise<MutationResult> {
    return this.#mutate("block", { id, scope, add });
  }
  #groups(id: string): Comment["reactionGroups"] {
    if (id === "discussion" || id === this.#state.view?.discussion?.id)
      return this.#state.view?.discussion?.reactionGroups || [];
    return (
      this.#state.comments
        .flatMap((c) => [c, ...c.replies.nodes])
        .find((c) => c.id === id)?.reactionGroups || []
    );
  }
  setReaction(
    id: string,
    reaction: Reaction,
    selected: boolean,
  ): Promise<void> {
    this.#live();
    let intent = this.#reactionIntents.get(id);
    if (!intent) {
      intent = { desired: new Map() };
      this.#reactionIntents.set(id, intent);
    }
    intent.desired.set(reaction, selected);
    this.#emit();
    return this.#drainReactions(id, intent);
  }
  retryReaction(id: string): Promise<void> {
    const intent = this.#reactionIntents.get(id);
    return intent ? this.#drainReactions(id, intent) : Promise.resolve();
  }
  #drainReactions(id: string, intent: ReactionIntent): Promise<void> {
    if (intent.running) return intent.running;
    const run = async () => {
      try {
        while (!this.#disposed && this.#reactionIntents.get(id) === intent) {
          if (!intent.flight) {
            const next = [...intent.desired].find(
              ([reaction, selected]) =>
                Boolean(
                  this.#groups(id).find((g) => g.content === reaction)
                    ?.viewerHasReacted,
                ) !== selected,
            );
            if (!next) break;
            intent.flight = {
              reaction: next[0],
              add: next[1],
              key: crypto.randomUUID(),
            };
          }
          await this.#mutate(
            "reaction",
            { id, ...intent.flight },
            "reaction:" + id,
          );
          intent.flight = undefined;
        }
        if (this.#reactionIntents.get(id) === intent)
          this.#reactionIntents.delete(id);
      } catch (error) {
        // A definite rejection rolls back. An uncertain result retains both the
        // receipt identity and latest intent for explicit recovery, never a new write.
        if (this.operationFor("reaction", id)?.status !== "uncertain")
          if (this.#reactionIntents.get(id) === intent)
            this.#reactionIntents.delete(id);
        throw error;
      } finally {
        intent.running = undefined;
        this.#emit();
      }
    };
    intent.running = run();
    return intent.running;
  }
  async #mutate(
    operation: string,
    input: Record<string, unknown>,
    scope = operation + ":" + String(input.id || "discussion"),
  ): Promise<MutationResult> {
    this.#live();
    const old = this.#pending.get(scope);
    if (old) return old;
    const identity = this.#identity;
    const run = (async () => {
      const result = await this.transport.request<MutationResult>(operation, {
        ...input,
        key: input.key || crypto.randomUUID(),
        config: this.config,
      });
      if (this.#disposed || identity !== this.#identity) return result;
      // A read begun before this successful write cannot overwrite the result.
      this.#generation++;
      this.#abort?.abort();
      this.#state = { ...this.#state, loading: false };
      this.#reconcile(result, operation);
      if (!this.#state.view?.discussion && result.discussion === undefined)
        await this.refresh();
      return result;
    })();
    this.#pending.set(scope, run);
    this.#operation(scope, { status: "pending" });
    try {
      const result = await run;
      if (identity === this.#identity) this.#operation(scope);
      return result;
    } catch (error) {
      const status =
        error && typeof error === "object" && "status" in error
          ? Number(error.status)
          : 0;
      const code =
        error && typeof error === "object" && "code" in error
          ? String(error.code)
          : "";
      if (identity === this.#identity)
        this.#operation(scope, {
          status:
            code === "WRITE_UNCERTAIN" || !status || status >= 500
              ? "uncertain"
              : "failed",
          message:
            error instanceof Error
              ? error.message
              : "Unable to complete the action.",
        });
      throw error;
    } finally {
      if (this.#pending.get(scope) === run) this.#pending.delete(scope);
      this.#emit();
    }
  }
  #reconcile(result: MutationResult, operation: string): void {
    let comments = this.#state.comments,
      view = this.#state.view;
    if (result.discussion !== undefined && view) {
      view = {
        ...view,
        discussion: result.discussion,
        unavailable: result.discussion === null,
      };
      if (!result.discussion) comments = [];
      else
        comments = comments.map((c) => ({
          ...c,
          isAnswer: c.id === result.discussion?.answer?.id,
        }));
    }
    // A delete can return the deleted record. Only a parent with surviving
    // replies needs that placeholder; retaining deleted leaves creates ghosts.
    const deletedLeaf = operation === "delete" && result.comment?.deletedAt &&
      !comments.find(c => c.id === result.id)?.replies.totalCount;
    if (result.removed || deletedLeaf) {
      const rootsBefore = comments.length;
      comments = comments
        .filter((c) => c.id !== result.id)
        .map((c) => ({
          ...c,
          replies: {
            ...c.replies,
            totalCount:
              c.replies.totalCount -
              Number(c.replies.nodes.some((r) => r.id === result.id)),
            nodes: c.replies.nodes.filter((r) => r.id !== result.id),
          },
        }))
        .filter(c => !c.deletedAt || c.replies.totalCount > 0);
      const rootsRemoved = rootsBefore - comments.length;
      if (rootsRemoved && view?.discussion)
        view = {
          ...view,
          discussion: {
            ...view.discussion,
            comments: {
              ...view.discussion.comments,
              totalCount: Math.max(0, view.discussion.comments.totalCount - rootsRemoved),
            },
          },
        };
    }
    const comment = result.removed || deletedLeaf ? undefined : result.comment;
    if (comment) {
      if (comment.replyTo) {
        const parent = comment.replyTo.id;
        comments = comments.map((c) =>
          c.id !== parent
            ? c
            : {
                ...c,
                replies: {
                  ...c.replies,
                  totalCount:
                    c.replies.totalCount +
                    Number(
                      operation === "comment" &&
                        !c.replies.nodes.some((r) => r.id === comment.id),
                    ),
                  nodes: unique([...c.replies.nodes, comment]),
                },
              },
        );
        this.#state = {
          ...this.#state,
          expanded: new Set([...this.#state.expanded, parent]),
        };
      } else {
        const old = comments.find((c) => c.id === comment.id);
        const root = {
          ...comment,
          replies: old?.replies || {
            totalCount: 0,
            nodes: [],
            pageInfo: emptyPage(),
          },
        };
        comments = old
          ? comments.map((c) => (c.id === root.id ? root : c))
          : this.#state.order === "newest"
            ? [root, ...comments]
            : [...comments, root];
        if (!old && operation === "comment" && view?.discussion)
          view = {
            ...view,
            discussion: {
              ...view.discussion,
              comments: {
                ...view.discussion.comments,
                totalCount: view.discussion.comments.totalCount + 1,
              },
            },
          };
      }
    }
    const reaction = result.reactions;
    if (reaction) {
      const update = <T extends Comment>(c: T): T =>
        c.id === reaction.id
          ? { ...c, reactionGroups: reaction.reactionGroups }
          : c;
      comments = comments.map((c) => ({
        ...update(c),
        replies: { ...c.replies, nodes: c.replies.nodes.map(update) },
      }));
      if (view?.discussion?.id === reaction.id)
        view = {
          ...view,
          discussion: {
            ...view.discussion,
            reactionGroups: reaction.reactionGroups,
          },
        };
    }
    this.#patch({ comments, view, error: "" });
  }
}
