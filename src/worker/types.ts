import type { ConfigBindings, PublicConfig } from '../contracts/config.js';
import type { RepositoryEngine } from '../domain/repository.js';
import type { Result } from '../domain/errors.js';
type Methods = Pick<RepositoryEngine, 'counts' | 'info' | 'thread' | 'replies' | 'comment' | 'edit' | 'remove' | 'reaction' | 'moderate' | 'discussionAction' | 'block' | 'preview' | 'authPrepare' | 'authCallback' | 'authPoll' | 'authConsume' | 'logout'>;
export type RepositoryRPC = { [K in keyof Methods]: (...args: Parameters<Methods[K]>) => Promise<Result<Awaited<ReturnType<Methods[K]>>>> };
export interface Env extends ConfigBindings {
  ASSETS: { fetch(request: Request): Promise<Response> };
  REPOSITORY_STORE: { idFromName(name: string): unknown; get(id: unknown): RepositoryRPC };
  READ_LIMITER: RateLimiter;
  WRITE_LIMITER: RateLimiter;
  AUTH_LIMITER: RateLimiter;
}
export interface RateLimiter { limit(input: { key: string }): Promise<{ success: boolean }> }
export type AppEnv = { Bindings: Env; Variables: { config: PublicConfig; session: string } };
