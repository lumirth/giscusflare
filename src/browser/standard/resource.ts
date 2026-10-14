import { noChange } from 'lit-html';
import { AsyncDirective } from 'lit-html/async-directive.js';
import { directive, type ElementPart } from 'lit-html/directive.js';
import type { ResourceScope } from '../presentation.js';

export abstract class OwnedDirective<T> extends AsyncDirective {
  #scope?: ResourceScope;
  #key?: unknown;
  #value?: T;
  #release?: () => void;
  protected owned(scope: ResourceScope, key: unknown, create: (signal: AbortSignal) => T): T {
    scope.signal.throwIfAborted();
    if (this.#scope !== scope || this.#key !== key) this.#release?.();
    if (!this.#release) {
      const abort = new window.AbortController(); this.#scope = scope; this.#key = key;
      this.#release = scope.own(() => { this.#release = undefined; this.#value = undefined; abort.abort(); });
      try { this.#value = create(abort.signal); }
      catch (error) { this.disconnected(); throw error; }
    }
    return this.#value!;
  }
  override disconnected() { this.#release?.(); }
}

/** A renderer-owned element acquires one child lifetime; removal releases it. */
class Resource extends OwnedDirective<AbortSignal> {
  render(_scope: ResourceScope, _use: (element: HTMLElement, signal: AbortSignal, fresh: boolean) => void) { return noChange; }
  override update(part: ElementPart, [scope, use]: Parameters<Resource['render']>) {
    let fresh = false;
    const signal = this.owned(scope, undefined, signal => { fresh = true; return signal; });
    try { use(part.element as HTMLElement, signal, fresh); }
    catch (error) { this.disconnected(); throw error; }
    return noChange;
  }
}
export const resource = directive(Resource);
