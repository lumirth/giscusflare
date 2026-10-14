import { directive } from 'lit-html/directive.js';
import type { Comment } from '../../contracts/document.js';
import type { StandardContext } from './contracts.js';
import { OwnedDirective } from './resource.js';

class Body extends OwnedDirective<HTMLElement> {
  render({ runtime, scope, contentReady }: StandardContext, comment: Comment) {
    return this.owned(scope, comment.id, signal => {
      const element = document.createElement('div'); element.dir = 'auto';
      const mount = runtime.content.mount(element, comment, { signal,
        onReady: ready => contentReady(comment.id, ready) });
      signal.addEventListener('abort', () => contentReady(comment.id, false, null), {once: true});
      contentReady(comment.id, mount.ready, mount);
      return element;
    });
  }
}
export const body = directive(Body);
