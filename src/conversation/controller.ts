import type {
  ReactionRequest,
  ModerationReason,
  Widget,
} from "../contracts/requests.js";
import type { Comment, RootComment, Replies, Discussion, Person, Reactions, ActionResult as MutationResult } from "./model.js";
import * as model from "./model.js";
import type * as GitHub from "../contracts/github.js";
import type { MutationResult as WireMutation } from "../contracts/results.js";
import type { ThreadView } from "../contracts/results.js";

export interface Transport {
  request<T>(
    operation: string,
    body: unknown,
    signal?: AbortSignal,
  ): Promise<T>;
}
export type Reaction = ReactionRequest["reaction"];
/** Select an operator-defined profile; the browser never crawls a whole discussion. */
export type CommentOrder = "oldest" | "newest" | { profile:string };
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
  profiles:readonly string[];
  ranking:import("../ranking/types.js").OrderResult|null;
  ready: boolean;
  thread: Discussion | null;
  viewer: Person | null;
  archived: boolean;
  unavailable: boolean;
  canCompose: boolean;
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
const unique = <T extends { id: string }>(items: T[]) => [
  ...new Map(items.map((item) => [item.id, item])).values(),
];

/** Owns conversation continuity independently of DOM, embedding and credentials. */
export class ConversationController {
  #state: ConversationState;
  #ranked?:{profile:string;ids:string[];offset:number;view:ThreadView};
  #ownRoots=new Set<string>();
  #projected?: Readonly<ConversationState>;
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
      profiles:[],ranking:null,ready: false, thread: null, viewer: null, archived: false, unavailable: false, canCompose: false,
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
    if (this.#projected) return this.#projected;
    if (!this.#reactionIntents.size) return this.#state;
    const apply = <T extends {id:string;reactions:Reactions}>(subject:T):T => {
      const intent=this.#reactionIntents.get(subject.id) ||
        (subject.id===this.#state.thread?.id?this.#reactionIntents.get('discussion'):undefined);
      if(!intent)return subject;
      const reactions={...subject.reactions};
      for(const [key,selected] of intent.desired){
        const value=reactions[key]??{count:0,selected:false};
        reactions[key]={selected,count:Math.max(0,value.count+Number(selected)-Number(value.selected))};
      }
      return {...subject,reactions};
    };
    const comments=this.#state.comments.map(root=>{
      const changed=apply(root),items=root.replies.items.map(apply);
      return items.every((item,i)=>item===root.replies.items[i])?changed:{...changed,replies:{...root.replies,items}};
    });
    return this.#projected={...this.#state,comments,thread:this.#state.thread?apply(this.#state.thread):null};
  }
  get editors(): ReadonlyMap<string, Editor> {
    return this.#editors;
  }
  operationFor(
    kind:
      "composer" | "reaction" | "delete" | "moderate",
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
    this.#projected = undefined;
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
              ? !/^[A-Za-z0-9_.-]{1,100}$/.test(entry[1])
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
    this.#ranked=undefined;this.#ownRoots.clear();
    this.#generation++;
    this.#abort?.abort();
    this.#refreshing = undefined;
    this.#reactionIntents.clear();
    this.#pending.clear();
    this.#patch({
      profiles:[],ranking:null,ready: false, thread: null, viewer: null, archived: false, unavailable: false, canCompose: false,
      comments: [],
      loading: false,
      nextCursor: null,
      operations: new Map(),
    });
  }
  bootstrap(view:ThreadView):void{
    if(this.#state.ready||this.#state.loading)return;
    const comments=(view.discussion?.comments.nodes||[]).map(model.rootComment);
    if(view.order==='newest')comments.reverse();
    this.#patch({profiles:view.profiles??[],ready:true,thread:view.discussion?model.discussion(view.discussion):null,viewer:null,archived:view.archived,unavailable:Boolean(view.unavailable),canCompose:!view.archived&&!view.unavailable&&!view.discussion?.locked,comments,nextCursor:view.nextCursor,lastRefresh:Date.now()});
  }
  async setOrder(order: CommentOrder): Promise<void> {
    if (JSON.stringify(order) === JSON.stringify(this.#state.order)) return;
    this.#generation++;
    this.#abort?.abort();
    this.#refreshing = undefined;
    this.#ranked=undefined;
    this.#patch({order,ranking:null,...(typeof order==='string'?{comments:[],nextCursor:null}:{})});
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
      reportErrors: !background || !this.#state.ready,
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
            includeComments:typeof previous.order!=="object",
          },
          signal,
        );
      const view=more&&typeof previous.order==='object'&&this.#ranked?this.#ranked.view:await fetchPage(more&&typeof previous.order==='string'?previous.nextCursor!:"");
      const ordered = (page: ThreadView) =>
        previous.order === "newest"
          ? (page.discussion?.comments.nodes || []).map(model.rootComment).reverse()
          : (page.discussion?.comments.nodes || []).map(model.rootComment);
      let comments = more
        ? unique([...previous.comments, ...ordered(view)])
        : ordered(view);
      let nextCursor = view.nextCursor;
      const seen = new Set<string>();
      // Revalidate all loaded root pages; do not silently forget later pages.
      while (
        !more &&
        nextCursor &&
        (typeof previous.order!=="object"&&comments.length < previous.comments.length) &&
        !seen.has(nextCursor)
      ) {
        seen.add(nextCursor);
        const page = await fetchPage(nextCursor);
        comments = unique([...comments, ...ordered(page)]);
        nextCursor = page.nextCursor;
      }
      if(typeof previous.order==='object'){
        const profile=previous.order.profile;
        let traversal=this.#ranked;
        if(!traversal||traversal.profile!==profile||(!more&&!background)){
          const deadline=Date.now()+120000;
          for(;;){
            const order=await this.transport.request<import('../ranking/types.js').OrderResult>('ranking',{config:this.config,profile},signal);
            if(generation!==this.#generation||signal.aborted)return false;
            this.#patch({ranking:order});
            if(order.status==='ready'){traversal={profile,ids:order.ids,offset:0,view};break;}
            if(order.status==='paused')throw new Error('This order is unavailable right now. You can keep reading chronologically.');
            if(Date.now()>=deadline||order.retryAt>deadline)throw new Error('This order is still being prepared. Try again later.');
            await new Promise<void>((resolve,reject)=>{
              const done=()=>{signal.removeEventListener('abort',abort);resolve();};
              const timer=setTimeout(done,Math.max(1000,order.retryAt-Date.now()));
              const abort=()=>{clearTimeout(timer);reject(new Error('Cancelled'));};
              signal.addEventListener('abort',abort,{once:true});
            });
          }
        }
        const start=more?traversal.offset:0;
        const end=more?Math.min(start+20,traversal.ids.length):Math.min(Math.max(20,background?traversal.offset:0),traversal.ids.length);
        let loaded:RootComment[]=[];
        for(let offset=start;offset<end;offset+=20){
          const ids=traversal.ids.slice(offset,Math.min(offset+20,end));
          const page=await this.transport.request<{comments:GitHub.RootComment[];consumed:number}>('hydrate',{config:this.config,ids,replyPrefetch:this.replyPrefetch},signal);
          if(page.consumed!==ids.length)throw new Error('The comments service returned invalid pagination.');
          loaded.push(...page.comments.map(model.rootComment));
        }
        comments=unique([...(more?previous.comments:previous.comments.filter(c=>this.#ownRoots.has(c.id))),...loaded]);
        if(generation!==this.#generation||signal.aborted)return false;
        this.#ranked={...traversal,offset:end,view};
        nextCursor=end<traversal.ids.length?String(end):null;
      }
      // Revalidate expanded replies to their previous depth, preserving folding.
      const previousById = new Map(previous.comments.map(comment => [comment.id, comment]));
      for (let i = 0; i < comments.length; i++) {
        const item = comments[i]!,
          old = previousById.get(item.id);
        if (
          !old ||
          !previous.expanded.has(item.id) ||
          old.replies.items.length <= item.replies.items.length
        )
          continue;
        let replies = item.replies;
        const cursors = new Set<string>();
        while (
          replies.cursor &&
          replies.items.length < old.replies.items.length
        ) {
          const cursor = replies.cursor || "";
          if (cursors.has(cursor)) break;
          cursors.add(cursor);
          const page = model.replies(await this.transport.request<GitHub.Replies>(
            "replies",
            { config: this.config, parentId: item.id, cursor },
            signal,
          ));
          replies = {
            ...page,
            items: unique([...page.items, ...replies.items]),
          };
        }
        comments[i] = { ...item, replies };
      }
      if (generation !== this.#generation || this.#disposed) return false;
      this.#patch({ profiles:view.profiles??[],ready:true, thread:view.discussion?model.discussion(view.discussion):null, viewer:view.viewer, archived:view.archived, unavailable:Boolean(view.unavailable), canCompose:!view.archived&&!view.unavailable&&!view.discussion?.locked, comments, nextCursor, lastRefresh: Date.now(), error: "" });
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
    if (!root.replies.cursor) return;
    const generation = this.#generation;
    const load = (async () => {
      const page = model.replies(await this.transport.request<GitHub.Replies>("replies", {
        config: this.config,
        parentId,
        cursor: root.replies.cursor || "",
      }));
      if (this.#disposed || generation !== this.#generation) return;
      this.#patch({
        comments: this.#state.comments.map((c) =>
          c.id === parentId
            ? {
                ...c,
                replies: {
                  ...page,
                  items: unique([...page.items, ...c.replies.items]),
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
      root.replies.items.length <= visible &&
      root.replies.cursor
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
    const key = this.#keys.get(name) || Date.now() + '.' + crypto.randomUUID();
    // A recovered pre-release submission can have reached GitHub. Keep its
    // identity and text, but never silently give it a new idempotency key.
    if (!/^\d{13}\.[A-Za-z0-9_-]{16,86}$/.test(key)) {
      const error = new Error("This saved submission may already be on GitHub. Check the discussion before editing and submitting it again.");
      this.#operation("composer:" + name, {status:"uncertain", message:error.message});
      return Promise.reject(error);
    }
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
  #groups(id: string): Reactions {
    if(id==='discussion'||id===this.#state.thread?.id)return this.#state.thread?.reactions??{};
    for(const root of this.#state.comments){
      if(root.id===id)return root.reactions;
      const reply=root.replies.items.find(item=>item.id===id);if(reply)return reply.reactions;
    }
    return {};
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
                  this.#groups(id)[reaction]?.selected,
                ) !== selected,
            );
            if (!next) break;
            intent.flight = {
              reaction: next[0],
              add: next[1],
              key: Date.now() + '.' + crypto.randomUUID(),
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
      const result = model.actionResult(await this.transport.request<WireMutation>(operation, {
        ...input,
        key: input.key || Date.now() + '.' + crypto.randomUUID(),
        config: this.config,
      }));
      if (this.#disposed || identity !== this.#identity) return result;
      // A read begun before this successful write cannot overwrite the result.
      this.#generation++;
      this.#abort?.abort();
      this.#state = { ...this.#state, loading: false };
      this.#reconcile(result, operation);
      if (!this.#state.thread)
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
            (code === "WRITE_UNCERTAIN" || code === "OPERATION_EXPIRED") || !status || status >= 500
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
    let comments=this.#state.comments,thread=this.#state.thread;
    const byId=new Map(comments.map(comment=>[comment.id,comment]));
    const deletedLeaf=operation==='delete'&&result.comment?.deletedAt&&!byId.get(result.id)?.replies.count;
    if(result.removed||deletedLeaf){
      const rootsBefore=comments.length;
      comments=comments.filter(c=>c.id!==result.id).map(c=>{
        const items=c.replies.items.filter(reply=>reply.id!==result.id);
        return items.length===c.replies.items.length?c:{...c,replies:{...c.replies,items,count:Math.max(0,c.replies.count-(c.replies.items.length-items.length))}};
      }).filter(c=>!c.deletedAt||c.replies.count>0);
      if(thread)thread={...thread,commentCount:Math.max(0,thread.commentCount-(rootsBefore-comments.length))};
    }
    const comment=result.removed||deletedLeaf?undefined:result.comment;
    if(comment){
      if(comment.replyToId){
        const parent=comment.replyToId;
        comments=comments.map(c=>c.id!==parent?c:{...c,replies:{...c.replies,
          count:c.replies.count+Number(operation==='comment'&&!c.replies.items.some(r=>r.id===comment.id)),
          items:unique([...c.replies.items,comment])}});
        this.#state={...this.#state,expanded:new Set([...this.#state.expanded,parent])};
      }else{
        const old=byId.get(comment.id),root={...comment,replies:old?.replies??{count:0,items:[],cursor:null}};
        comments=old?comments.map(c=>c.id===root.id?root:c):this.#state.order==='newest'?[root,...comments]:[...comments,root];
        if(!old&&operation==='comment'&&thread)thread={...thread,commentCount:thread.commentCount+1};
      }
    }
    if(result.comment&&!result.comment.replyToId&&!this.#state.comments.some(c=>c.id===result.comment!.id))this.#ownRoots.add(result.comment.id);
    if(result.removed)this.#ownRoots.delete(result.id);
    if(result.reactions){
      const change=result.reactions;
      comments=comments.map(root=>{
        if(root.id===change.id)return {...root,reactions:change.reactions};
        const index=root.replies.items.findIndex(reply=>reply.id===change.id);
        if(index<0)return root;
        const items=[...root.replies.items];items[index]={...items[index]!,reactions:change.reactions};
        return {...root,replies:{...root.replies,items}};
      });
      if(thread?.id===change.id)thread={...thread,reactions:change.reactions};
    }
    this.#patch({comments,thread,error:''});
  }
}
