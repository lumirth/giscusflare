import { DurableObject } from 'cloudflare:workers';
import { RepositoryEngine } from '../domain/repository.js';
import { Store } from '../domain/store.js';
import { result, type Result } from '../domain/errors.js';
import type { DurableState, FetchLike } from '../domain/platform.js';
import type * as C from '../contracts/rpc.js';
import type * as R from '../contracts/requests.js';
import type { Env } from './types.js';

/** The native tests provide their GitHub transport here. */
export function repositoryClass(transport?: FetchLike) {
  return class RepositoryObject extends DurableObject<Env> {
    #engine: RepositoryEngine;
    #store: Store;
    #state: DurableState;
    constructor(ctx: DurableObjectState, env: Env) {
      super(ctx, env); this.#state = ctx; this.#store = new Store(ctx.storage.sql);
      this.#engine = new RepositoryEngine(env, this.#store, transport);
    }
    async #call<T>(run: () => Promise<T>): Promise<Result<T>> {
      const output = await result(run);
      try { await this.#store.schedule(this.#state); }
      catch { console.error('giscus: expiry alarm could not be scheduled'); }
      return output;
    }
    info(input: R.InfoRequest) { return this.#call(() => this.#engine.info(input)); }
    thread(input: C.ThreadCall) { return this.#call(() => this.#engine.thread(input)); }
    replies(input: C.RepliesCall) { return this.#call(() => this.#engine.replies(input)); }
    comment(input: C.CommentCall) { return this.#call(() => this.#engine.comment(input)); }
    edit(input: C.EditCall) { return this.#call(() => this.#engine.edit(input)); }
    remove(input: C.DeleteCall) { return this.#call(() => this.#engine.remove(input)); }
    reaction(input: C.ReactionCall) { return this.#call(() => this.#engine.reaction(input)); }
    moderate(input: C.ModerateCall) { return this.#call(() => this.#engine.moderate(input)); }
    preview(input: C.PreviewCall) { return this.#call(() => this.#engine.preview(input)); }
    authPrepare(input: C.PrepareCall) { return this.#call(() => this.#engine.authPrepare(input)); }
    authCallback(input: C.CallbackCall) { return this.#call(() => this.#engine.authCallback(input)); }
    authPoll(input: R.AuthProof) { return this.#call(() => this.#engine.authPoll(input)); }
    authConsume(input: R.AuthConsume) { return this.#call(() => this.#engine.authConsume(input)); }
    logout(input: C.LogoutCall) { return this.#call(() => this.#engine.logout(input)); }
    override async alarm(): Promise<void> { this.#store.prune(); await this.#store.schedule(this.#state); }
  };
}
export class Repository extends repositoryClass() {}
