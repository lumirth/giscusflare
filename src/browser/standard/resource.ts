import { noChange } from 'lit-html';
import { AsyncDirective } from 'lit-html/async-directive.js';
import { directive, type ElementPart } from 'lit-html/directive.js';
import type { ResourceScope } from '../presentation.js';

/** A renderer-owned element acquires one child lifetime; removal releases it. */
class Resource extends AsyncDirective {
  #abort?: AbortController;
  #release?: () => void;
  render(_scope: ResourceScope, _use: (element: HTMLElement, signal: AbortSignal, fresh: boolean) => void) { return noChange; }
  override update(part: ElementPart, [scope, use]: Parameters<Resource['render']>) {
    scope.signal.throwIfAborted();
    const fresh = !this.#abort;
    if (fresh) {
      const abort = this.#abort = new window.AbortController();
      this.#release = scope.own(() => { this.#abort = undefined;abort.abort(); });
    }
    try { use(part.element as HTMLElement, this.#abort!.signal, fresh); }
    catch (error) { this.#release?.();throw error; }
    return noChange;
  }
  override disconnected() { this.#release?.(); }
}
export const resource = directive(Resource);
