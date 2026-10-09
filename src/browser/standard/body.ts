import { AsyncDirective } from 'lit-html/async-directive.js';
import { directive } from 'lit-html/directive.js';
import { type OwnedContentMount } from '../content.js';
import type { Comment } from '../../contracts/document.js';
import type { StandardContext } from './contracts.js';

class Body extends AsyncDirective {
  #element?: HTMLElement;
  #mount?: OwnedContentMount;
  #signal?: AbortSignal;
  render({ runtime, scope, contentReady }: StandardContext, comment: Comment) {
    scope.signal.throwIfAborted();
    if (!this.#element) {
      this.#element = document.createElement('div');
      this.#element.dir = 'auto';
    }
    if (!this.#mount || this.#signal !== scope.signal) {
      this.#mount?.dispose(); this.#signal = scope.signal;
      this.#mount = runtime.content.mount(this.#element, comment, { signal: scope.signal,
        onReady: ready => { this.#element!.dataset.contentReady = String(ready);contentReady(comment.id, ready); } });
    }
    const mount = this.#mount;this.#element.dataset.contentReady = String(mount.ready);
    queueMicrotask(() => { if (!scope.signal.aborted && mount === this.#mount) contentReady(comment.id, mount.ready); });
    return this.#element;
  }
  override disconnected() { this.#mount?.dispose(); this.#mount = undefined; }
}
export const body = directive(Body);
