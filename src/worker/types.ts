import type { ConfigBindings, PublicConfig } from '../contracts/config.js';
import type { RepositoryEngine } from '../domain/repository.js';
import type { SerializedRead } from '../contracts/rpc.js';
import type { Result } from '../domain/errors.js';
type Methods = Pick<RepositoryEngine, 'ranking'|'hydrate'|'counts'| 'info' | 'thread' | 'replies' | 'comment' | 'edit' | 'remove' | 'reaction' | 'moderate' | 'preview' | 'authPrepare' | 'authCallback' | 'authPoll' | 'authConsume' | 'logout'>;
type Reads = 'ranking'|'hydrate'|'counts'|'info'|'thread'|'replies';
export type RepositoryRPC = { [K in Exclude<keyof Methods,Reads>]: (...args: Parameters<Methods[K]>) => Promise<Result<Awaited<ReturnType<Methods[K]>>>> } & {[K in Reads]:(...args:Parameters<Methods[K]>)=>Promise<SerializedRead>} & {widget(input:Parameters<RepositoryEngine['thread']>[0] & {presentation:import('../contracts/requests.js').Widget}):Promise<SerializedRead>};
export interface Env extends ConfigBindings {
  ASSETS: { fetch(request: Request): Promise<Response> };
  REPOSITORY_STORE: { idFromName(name: string): unknown; get(id: unknown): RepositoryRPC };
  READ_LIMITER: RateLimiter;
  WRITE_LIMITER: RateLimiter;
  AUTH_LIMITER: RateLimiter;
}
export interface RateLimiter { limit(input: { key: string }): Promise<{ success: boolean }> }
export type AppEnv = { Bindings: Env; Variables: { config: PublicConfig; session: string } };
