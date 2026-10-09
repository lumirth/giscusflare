import { isNamedTheme } from '../themes.js';
import type { PublicConfig, RepositoryPolicy } from '../contracts/config.js';
import type { Widget, Selection } from '../contracts/requests.js';
import type { DiscussionSummary } from '../contracts/github.js';
import { requireCondition } from './errors.js';
export function policy(config: PublicConfig, repo: string): RepositoryPolicy {
  if(!Object.hasOwn(config.repositories,repo)&&config.openHosting)return config.openHosting as RepositoryPolicy;
  requireCondition(Object.hasOwn(config.repositories, repo), 403, 'PERMISSION', 'This repository is not enabled on this service.');
  return config.repositories[repo]!;
}
export function parentOrigin(p: RepositoryPolicy, page: string): string {
  const origin = new URL(page).origin;
  requireCondition((p.origins==='*'||p.origins.includes(origin)), 403, 'ORIGIN', 'This website is not allowed to embed these comments.');
  return origin;
}
export function authorizeWidget(publicConfig: PublicConfig, widget: Selection): RepositoryPolicy {
  const p = policy(publicConfig, widget.repo);
  parentOrigin(p, widget.origin);
  return p;
}
export function authorizePresentation(publicConfig: PublicConfig, widget: Widget): RepositoryPolicy {
  const p=authorizeWidget(publicConfig,widget);
  if (!isNamedTheme(widget.theme)) {
    const origin = new URL(widget.theme).origin;
    requireCondition(origin === publicConfig.origin || (p.origins==='*'||p.origins.includes(origin)) || p.customThemeOrigins.includes(origin), 403, 'ORIGIN', 'This stylesheet URL is not allowed by the repository policy.');
  }
  return p;
}
export function discussionScope(discussion: Pick<DiscussionSummary, "repository" | "category">, repo: string, repositoryId: string, categoryId: string): void {
  requireCondition(!discussion.repository.isPrivate && discussion.repository.nameWithOwner.toLowerCase() === repo && discussion.repository.id === repositoryId,
    403, 'PUBLIC_ONLY', 'This discussion is not in the configured public repository.');
  requireCondition(discussion.category.id === categoryId, 403, 'CATEGORY', 'This discussion is in a different category.');
}
