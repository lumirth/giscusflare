import * as v from 'valibot';
import { configuration, secrets, type ConfigBindings, type RepositoryPolicy } from '../contracts/config.js';
import { parse, type Schema } from '../contracts/parse.js';
import * as R from '../contracts/requests.js';
import * as C from '../contracts/rpc.js';
import * as S from '../contracts/storage.js';
import type * as G from '../contracts/github.js';
import { RepositoryName } from '../contracts/primitives.js';
import { authorizeWidget, discussionScope, parentOrigin, policy, repositoryScope } from './authorization.js';
import { Auth } from './auth.js';
import { hash } from './crypto.js';
import { GitHub } from './github.js';
import { AppError, requireCondition } from './errors.js';
import { Store } from './store.js';
import type { FetchLike } from './platform.js';
export interface ThreadView { discussion: G.Discussion | null; viewer: S.Session['user'] | null; archived: boolean; order: 'oldest' | 'newest'; nextCursor: string | null }
interface Context { widget: R.Widget; client: GitHub; auth: Auth; appToken: string; token: string; session: S.Session | null; meta: G.Repository; categoryId: string; policy: RepositoryPolicy }
export class RepositoryEngine {
  constructor(readonly env: ConfigBindings, readonly store: Store, readonly transport?: FetchLike) {}
  #base(rawRepo: string): { repo: string; policy: RepositoryPolicy; client: GitHub; auth: Auth } {
    const repo = parse(RepositoryName, rawRepo), config = configuration(this.env), p = policy(config, repo), keys = secrets(this.env);
    const identity = this.store.get('identity', S.ActorIdentity);
    requireCondition(!identity || (identity.repo === repo && identity.appId === config.appId), 403, 'PERMISSION', 'This repository object belongs to another app or repository.');
    if (!identity) this.store.put('identity', S.ActorIdentity, { version: 2, repo, appId: config.appId });
    const client = new GitHub(repo, config, keys, this.store, this.transport);
    return { repo, policy: p, client, auth: new Auth(config, keys, repo, p, this.store, client) };
  }
  async #context(widget: R.Widget, capability: string, write = false): Promise<Context> {
    const base = this.#base(widget.repo); authorizeWidget(configuration(this.env), widget);
    const session = await base.auth.session(capability, widget.origin, write);
    const appToken = await base.client.installation(), meta = await base.client.repository(appToken);
    const categoryId = repositoryScope(meta, widget.repo, base.policy, widget);
    if (write) requireCondition(!meta.isArchived, 403, 'ARCHIVED', 'The repository is archived.');
    return { widget, client: base.client, auth: base.auth, appToken, token: session?.accessToken || appToken, session, meta, categoryId, policy: base.policy };
  }
  async #mapping(c: Context): Promise<string> { return 'mapping:' + await hash(JSON.stringify([c.meta.id, c.categoryId, c.widget.strict, c.widget.term])); }
  async #find(c: Context): Promise<number | null> {
    if (c.widget.number) return c.widget.number;
    const key = await this.#mapping(c), cached = this.store.get(key, S.Mapping);
    if (cached) return cached.number;
    const matches = await c.client.find(c.widget, c.policy.category, c.appToken);
    for (const match of matches) {
      discussionScope(match, c.widget.repo, c.meta.id, c.categoryId);
      this.store.put(key, S.Mapping, { version: 2, number: match.number }); this.store.delete('creating:' + key);
      return match.number;
    }
    return null;
  }
  async #load(c: Context, order: 'oldest' | 'newest' = 'oldest', cursor = ''): Promise<G.Discussion | null> {
    const number = await this.#find(c); if (!number) return null;
    const discussion = await c.client.thread(number, order, cursor, c.token);
    if (discussion) discussionScope(discussion, c.widget.repo, c.meta.id, c.categoryId);
    else if (!c.widget.number) this.store.delete(await this.#mapping(c));
    return discussion;
  }
  async #ensure(c: Context): Promise<G.Discussion> {
    const key = await this.#mapping(c);
    return this.store.lock(key, async () => {
      const old = await this.#load(c); if (old) return old;
      requireCondition(!c.widget.number, 404, 'NOT_FOUND', 'That discussion number does not exist.');
      requireCondition(!this.store.get('creating:' + key, S.Creation), 409, 'WRITE_UNCERTAIN', 'GitHub may have created this discussion. Check the repository before creating another.');
      requireCondition(c.session, 401, 'AUTH_REQUIRED', 'Sign in to create a discussion.');
      this.store.limit('create:' + c.session.user.login, 10, 3600000);
      this.store.put('creating:' + key, S.Creation, { version: 2, started: this.store.now() });
      try {
        const created = await c.client.create(c.widget, c.meta.id, c.categoryId, c.appToken);
        this.store.put(key, S.Mapping, { version: 2, number: created.number }); this.store.delete('creating:' + key);
        const discussion = await c.client.thread(created.number, 'oldest', '', c.token);
        requireCondition(discussion, 502, 'UPSTREAM', 'The discussion was created but could not be loaded. Refresh before posting.');
        discussionScope(discussion, c.widget.repo, c.meta.id, c.categoryId); return discussion;
      } catch (error) {
        if (error instanceof AppError && [400, 401, 403, 404, 429].includes(error.status)) this.store.delete('creating:' + key);
        throw error;
      }
    });
  }
  async #target(c: Context, discussion: G.Discussion, id: string): Promise<G.Target> {
    const target = await c.client.target(id, c.token);
    const parent = target.__typename === 'Discussion' ? target : target.discussion;
    discussionScope(parent, c.widget.repo, c.meta.id, c.categoryId);
    requireCondition(parent.id === discussion.id, 403, 'PERMISSION', 'This comment does not belong to this page.');
    return target;
  }
  async info(raw: R.InfoRequest) {
    const input = parse(R.InfoRequest, raw), base = this.#base(input.repo); parentOrigin(base.policy, input.origin);
    const token = await base.client.installation(), meta = await base.client.repository(token);
    const categoryId = repositoryScope(meta, input.repo, base.policy);
    return { repo: meta.nameWithOwner, repoId: meta.id, category: base.policy.category, categoryId, defaultCommentOrder: base.policy.defaultCommentOrder };
  }
  async thread(raw: C.ThreadCall): Promise<ThreadView> {
    const input = parse(C.ThreadCall, raw), c = await this.#context(input.request.config, input.session);
    const discussion = await this.#load(c, input.request.order, input.request.cursor), page = discussion?.comments.pageInfo;
    return { discussion, viewer: c.session?.user || null, archived: c.meta.isArchived, order: input.request.order,
      nextCursor: input.request.order === 'oldest' ? (page?.hasNextPage ? page.endCursor : null) : (page?.hasPreviousPage ? page.startCursor : null) };
  }
  async replies(raw: C.RepliesCall): Promise<G.Replies> {
    const input = parse(C.RepliesCall, raw), c = await this.#context(input.request.config, input.session), discussion = await this.#load(c);
    requireCondition(discussion, 404, 'NOT_FOUND', 'Discussion not found.');
    const target = await this.#target(c, discussion, input.request.parentId);
    requireCondition(target.__typename === 'DiscussionComment' && !target.replyTo, 400, 'BAD_INPUT', 'Use the top-level comment ID to load replies.');
    const node = await c.client.replies(input.request.parentId, input.request.cursor, c.token);
    requireCondition(node && node.id === input.request.parentId && node.discussion.id === discussion.id, 403, 'PERMISSION', 'These replies belong to another comment or discussion.');
    discussionScope(node.discussion, c.widget.repo, c.meta.id, c.categoryId); return node.replies;
  }
  async preview(raw: C.PreviewCall): Promise<{ html: string }> {
    const input = parse(C.PreviewCall, raw), c = await this.#context(input.request.config, input.session, true);
    this.store.limit('preview:' + c.session!.user.login, 30, 60000);
    return { html: await c.client.markdown(input.request.body, c.token) };
  }
  async #write(c: Context, key: string, payload: unknown, create: boolean, action: (discussion: G.Discussion) => Promise<string>): Promise<{ id: string; number: number }> {
    requireCondition(c.session, 401, 'AUTH_REQUIRED', 'Sign in to continue.');
    const receiptKey = 'receipt:' + await hash(c.session.user.login + ':' + key), fingerprint = await hash(JSON.stringify(payload));
    return this.store.lock(receiptKey, async () => {
      const receipt = this.store.get(receiptKey, S.Receipt);
      if (receipt) {
        requireCondition(receipt.fingerprint === fingerprint, 409, 'CONFLICT', 'This request ID was already used for different content.');
        requireCondition(receipt.state === 'done' && receipt.result, 409, 'WRITE_UNCERTAIN', 'GitHub may have saved this change. Check the discussion before submitting it again.');
        return receipt.result;
      }
      const discussion = create ? await this.#ensure(c) : await this.#load(c);
      requireCondition(discussion, 404, 'NOT_FOUND', 'Discussion not found.');
      this.store.limit('write:' + c.session!.user.login, 30, 60000); this.store.limit('all-writes', 180, 60000);
      this.store.put(receiptKey, S.Receipt, { version: 2, fingerprint, state: 'pending', result: null }, this.store.now() + 86400000);
      try {
        const id = await action(discussion), answer = { id, number: discussion.number };
        this.store.put(receiptKey, S.Receipt, { version: 2, fingerprint, state: 'done', result: answer }, this.store.now() + 86400000);
        return answer;
      } catch (error) {
        // Keep uncertain writes pending; only definite rejections can be retried.
        if (error instanceof AppError && [400, 401, 403, 404, 429].includes(error.status)) {
          this.store.delete(receiptKey);
          throw error;
        }
        throw new AppError(502, 'WRITE_UNCERTAIN', 'GitHub may have saved this change. Check the discussion before submitting it again.');
      }
    });
  }
  async comment(raw: C.CommentCall) {
    const input = parse(C.CommentCall, raw), request = input.request, c = await this.#context(request.config, input.session, true);
    return this.#write(c, request.key, ['comment', request], !request.replyToId, async discussion => {
      requireCondition(!discussion.locked, 403, 'LOCKED', 'This discussion is locked.');
      let replyId = request.replyToId;
      if (replyId) {
        const parent = await this.#target(c, discussion, replyId);
        requireCondition(parent.__typename === 'DiscussionComment', 400, 'BAD_INPUT', 'Replies need a comment ID.');
        replyId = parent.replyTo?.id || parent.id;
        if (parent.replyTo) { const root = await this.#target(c, discussion, replyId); requireCondition(root.__typename === 'DiscussionComment' && !root.replyTo, 403, 'PERMISSION', 'The reply does not have a valid top-level comment.'); }
      }
      return (await c.client.comment(discussion.id, request.body, replyId, c.token)).id;
    });
  }
  async edit(raw: C.EditCall) {
    const input = parse(C.EditCall, raw), r = input.request, c = await this.#context(r.config, input.session, true);
    return this.#write(c, r.key, ['edit', r], false, async discussion => {
      const target = await this.#target(c, discussion, r.id);
      requireCondition(target.__typename === 'DiscussionComment' && target.viewerCanUpdate, 403, 'PERMISSION', 'You cannot edit this comment.');
      return (await c.client.edit(r.id, r.body, c.token)).id;
    });
  }
  async remove(raw: C.DeleteCall) {
    const input = parse(C.DeleteCall, raw), r = input.request, c = await this.#context(r.config, input.session, true);
    return this.#write(c, r.key, ['delete', r], false, async discussion => {
      const target = await this.#target(c, discussion, r.id);
      requireCondition(target.__typename === 'DiscussionComment' && target.viewerCanDelete, 403, 'PERMISSION', 'You cannot delete this comment.');
      await c.client.remove(r.id, c.token); return r.id;
    });
  }
  async reaction(raw: C.ReactionCall) {
    const input = parse(C.ReactionCall, raw), r = input.request, c = await this.#context(r.config, input.session, true);
    return this.#write(c, r.key, ['reaction', r], r.id === 'discussion' && r.add, async discussion => {
      requireCondition(!discussion.locked, 403, 'LOCKED', 'This discussion is locked.');
      const id = r.id === 'discussion' ? discussion.id : r.id;
      await this.#target(c, discussion, id); await c.client.react(id, r.reaction, r.add, c.token); return id;
    });
  }
  async moderate(raw: C.ModerateCall) {
    const input = parse(C.ModerateCall, raw), r = input.request, c = await this.#context(r.config, input.session, true);
    return this.#write(c, r.key, ['moderate', r], false, async discussion => {
      const target = await this.#target(c, discussion, r.id);
      requireCondition(target.__typename === 'DiscussionComment' && target.viewerCanMinimize, 403, 'PERMISSION', 'You cannot moderate this comment.');
      await c.client.moderate(r.id, r.minimized, c.token); return r.id;
    });
  }
  async authPrepare(raw: C.PrepareCall) { const input = parse(C.PrepareCall, raw); return this.#base(input.request.repo).auth.prepare(input); }
  async authCallback(raw: C.CallbackCall) { const input = parse(C.CallbackCall, raw); return this.#base(input.repo).auth.callback(input); }
  async authPoll(raw: R.AuthProof) { const input = parse(R.AuthProof, raw); return this.#base(input.repo).auth.poll(input); }
  async authConsume(raw: R.AuthConsume) { const input = parse(R.AuthConsume, raw); return this.#base(input.repo).auth.consume(input); }
  async logout(raw: C.LogoutCall) { const input = parse(C.LogoutCall, raw); return this.#base(input.request.repo).auth.logout(input.session, input.request.origin); }
}
