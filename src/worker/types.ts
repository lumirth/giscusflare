import type { ConfigBindings, PublicConfig } from '../contracts/config.js';
import type { RepositoryEngine } from '../domain/repository.js';
export interface Env extends ConfigBindings {
  CONTENT?:{fetch(request:Request):Promise<Response>};
  ASSETS: { fetch(request: Request): Promise<Response> };
  REPOSITORY_STORE: { idFromName(name: string): unknown; get(id: unknown): Pick<RepositoryEngine,'execute'> };
  READ_LIMITER: RateLimiter;
  WRITE_LIMITER: RateLimiter;
  AUTH_LIMITER: RateLimiter;
}
export interface RateLimiter { limit(input: { key: string }): Promise<{ success: boolean }> }
export type AppEnv = { Bindings: Env; Variables: { config: PublicConfig; session: string; input: unknown } };
