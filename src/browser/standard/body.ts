import { AsyncDirective } from 'lit-html/async-directive.js';
import { directive } from 'lit-html/directive.js';
import type { Comment } from '../../contracts/document.js';
import type { StandardContext } from './contracts.js';

/** The keyed body owns only its current enhancement generation. */
class Body extends AsyncDirective {
  #element?: HTMLElement;
  #html?: string;
  #body?: string;
  #release?: () => void;
  render({ runtime, scope }: StandardContext, comment: Comment) {
    scope.signal.throwIfAborted();
    if (!this.#element) {
      this.#element = document.createElement('div');
      this.#element.className = 'markdown';this.#element.dir = 'auto';
    }
    const element = this.#element;
    if (this.#html !== comment.bodyHTML || this.#body !== comment.body) {
      this.#release?.();
      const abort = new window.AbortController();
      this.#release = scope.own(() => { abort.abort();this.#html = undefined; });
      try { element.replaceChildren(runtime.renderContent(comment.bodyHTML, comment.body, abort.signal)); }
      catch (error) { this.#release();throw error; }
      this.#html = comment.bodyHTML;this.#body = comment.body;
    }
    return element;
  }
  override disconnected() { this.#release?.(); }
}
export const body = directive(Body);
