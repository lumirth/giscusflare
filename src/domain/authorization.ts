import { isNamedTheme } from '../themes.js';
import type { PublicConfig, RepositoryPolicy } from '../contracts/config.js';
import type { Widget } from '../contracts/requests.js';
import type { DiscussionSummary, Repository } from '../contracts/github.js';
import { requireCondition } from './errors.js';
export function policy(config: PublicConfig, repo: string): RepositoryPolicy {
  if(!Object.hasOwn(config.repositories,repo)&&config.openHosting)return config.openHosting;
  requireCondition(Object.hasOwn(config.repositories, repo), 403, 'PERMISSION', 'This repository is not enabled on this service.');
  return config.repositories[repo]!;
}
export function parentOrigin(p: RepositoryPolicy, page: string): string {
  const origin = new URL(page).origin;
  requireCondition((p.origins==='*'||p.origins.includes(origin)), 403, 'ORIGIN', 'This website is not allowed to embed these comments.');
  return origin;
}
export function authorizeWidget(publicConfig: PublicConfig, widget: Widget): RepositoryPolicy {
  const p = policy(publicConfig, widget.repo);
  parentOrigin(p, widget.origin);
  requireCondition(!widget.category || widget.category === p.category, 403, 'CATEGORY', 'The selected category is not enabled.');
  requireCondition(!widget.categoryId || !p.categoryId || widget.categoryId === p.categoryId, 403, 'CATEGORY', 'The category ID does not match the configured category.');
  if (!isNamedTheme(widget.theme)) {
    const origin = new URL(widget.theme).origin;
    requireCondition(origin === publicConfig.origin || (p.origins==='*'||p.origins.includes(origin)) || p.customThemeOrigins.includes(origin), 403, 'ORIGIN', 'This stylesheet URL is not allowed by the repository policy.');
  }
  return p;
}
export function repositoryScope(meta: Repository, repo: string, p: RepositoryPolicy, widget?: Widget): string {
  requireCondition(!meta.isPrivate && meta.nameWithOwner.toLowerCase() === repo, 403, 'PUBLIC_ONLY', 'Only the configured public repository is available.');
  const category = meta.discussionCategories.nodes.find(x => x.name === p.category);
  requireCondition(category && (!p.categoryId || category.id === p.categoryId), 403, 'CATEGORY', 'The configured category name or ID does not match GitHub.');
  if (widget) {
    requireCondition(!widget.repoId || widget.repoId === meta.id, 400, 'BAD_INPUT', 'The repository ID does not match.');
    requireCondition(!widget.categoryId || widget.categoryId === category.id, 400, 'BAD_INPUT', 'The category ID does not match.');
  }
  return category.id;
}
export function discussionScope(discussion: Pick<DiscussionSummary, "repository" | "category">, repo: string, repositoryId: string, categoryId: string): void {
  requireCondition(!discussion.repository.isPrivate && discussion.repository.nameWithOwner.toLowerCase() === repo && discussion.repository.id === repositoryId,
    403, 'PUBLIC_ONLY', 'This discussion is not in the configured public repository.');
  requireCondition(discussion.category.id === categoryId, 403, 'CATEGORY', 'This discussion is in a different category.');
}
