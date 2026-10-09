import { DurableObject } from 'cloudflare:workers';
import { RepositoryEngine, type RepositoryOptions } from '../domain/repository.js';
import { Store } from '../domain/store.js';
import type * as C from '../contracts/rpc.js';
import type { Env, RPCOutput } from './types.js';

/** One canonical repository owns durable coordination and its next native alarm. */
export function createRepository(options: RepositoryOptions = {}) {
  return class Repository extends DurableObject<Env> {
    #engine: RepositoryEngine;
    #store: Store;
    constructor(ctx: DurableObjectState, env: Env) {
      super(ctx, env);
      const transactionSync = <T>(action: () => T) => ctx.storage.transactionSync(action);
      this.#store = new Store(ctx.storage.sql, Date.now, transactionSync);
      this.#engine = new RepositoryEngine(env, this.#store, { sql: ctx.storage.sql, transactionSync }, options);
    }
    async execute<K extends C.Operation>(operation: K, input: C.Input<K>, repositoryID: string): Promise<RPCOutput<K>> {
      const output = await this.#engine.execute(operation, input, repositoryID);
      this.ctx.waitUntil(Promise.resolve().then(() => this.#store.schedule(this.ctx, this.#engine.rankingAlarm()))
        .catch(error => console.error('Repository alarm maintenance failed.', error)));
      return output;
    }
    override async alarm(): Promise<void> {
      this.#store.prune();
      await this.#engine.continueRanking();
      await this.#store.schedule(this.ctx, this.#engine.rankingAlarm());
    }
  }

}
export const Repository = createRepository();
export type { RepositoryOptions } from '../domain/repository.js';
export type { ContentPreparer, PreparedContent, ContentInputData } from '../contracts/content.js';
