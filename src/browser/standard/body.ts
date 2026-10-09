import { AsyncDirective } from 'lit-html/async-directive.js';
import { directive } from 'lit-html/directive.js';
import { mountContent, type ContentMount } from '../content.js';
import type { Comment } from '../../contracts/document.js';
import type { StandardContext } from './contracts.js';

class Body extends AsyncDirective {
  #element?: HTMLElement;
  #mount?: ContentMount;
  #signal?: AbortSignal;
  render({ runtime, scope, contentReady }: StandardContext, comment: Comment) {
    scope.signal.throwIfAborted();
    if (!this.#element) {
      this.#element = document.createElement('div');
      this.#element.dir = 'auto';
    }
    if (!this.#mount || this.#signal !== scope.signal) {
      this.#mount?.dispose(); this.#signal = scope.signal;
      this.#mount = mountContent(this.#element, runtime.content, { signal: scope.signal,
        onReady: ready => contentReady(comment.id, ready) });
    }
    void this.#mount.update({ markdown: comment.body, html: comment.bodyHTML, prepared: comment.prepared,
      purpose: 'comment', repo: runtime.config.repo, pageURL: runtime.config.origin,
      comment: { id: comment.id, url: comment.url, parentId: comment.parentId } }).catch(() => { /* The mount retains readable writing. */ });
    return this.#element;
  }
  override disconnected() { this.#mount?.dispose(); this.#mount = undefined; }
}
export const body = directive(Body);
