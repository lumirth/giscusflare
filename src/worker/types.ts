import type { ConfigBindings, PublicConfig } from '../contracts/config.js';
import type { RepositoryEngine } from '../domain/repository.js';
import type { Result } from '../domain/errors.js';
import type { Input, Operation } from '../contracts/rpc.js';
export type RPCOutput<K extends Operation> = Result<Awaited<ReturnType<RepositoryEngine[K]>>>;
export interface RepositoryRPC {
  execute<K extends Operation>(operation: K, input: Input<K>, repositoryID: string): Promise<RPCOutput<K>>;
}
export interface Env extends ConfigBindings {
  ASSETS: { fetch(request: Request): Promise<Response> };
  REPOSITORY_STORE: { idFromName(name: string): unknown; get(id: unknown): RepositoryRPC };
  READ_LIMITER: RateLimiter;
  WRITE_LIMITER: RateLimiter;
  AUTH_LIMITER: RateLimiter;
}
export interface RateLimiter { limit(input: { key: string }): Promise<{ success: boolean }> }
export type AppEnv = { Bindings: Env; Variables: { config: PublicConfig; session: string; input: unknown } };
