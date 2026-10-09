import type { ContentPreparer } from '../dist/types/contracts/content.js';
export type { ContentPreparer, PreparedContent, ContentInputData, ContentSource, ContentPreview } from '../dist/types/contracts/content.js';

/** Deployment-selected content producer. It interprets untrusted commenter input. */
export interface RepositoryOptions {
  content?: { revision: string; prepare: ContentPreparer };
}
/** Cloudflare constructs this class from its durable binding. */
export declare class Repository {
  constructor(state: unknown, env: unknown);
  execute(operation: string, input: unknown, repositoryID: string): Promise<unknown>;
  alarm(): Promise<void>;
}
export declare function createRepository(options?: RepositoryOptions): typeof Repository;
declare const service: {
  fetch(request: Request, env: unknown, context?: unknown): Response | Promise<Response>;
};
export default service;
