import { createConversation, type ConversationOptions, type ConversationRuntime } from './runtime.js';
import './widget.js';
import type { GiscusComments } from './widget.js';
export { createConversation, type ConversationOptions, type ConversationRuntime } from './runtime.js';
export { ConversationController, type ConversationState, type Transport } from '../conversation/controller.js';
export { BrowserSession, ApiError } from './session.js';
export type { Widget } from '../contracts/requests.js';
export type { Comment, RootComment, Discussion } from '../contracts/github.js';
export interface Presentation {
  mount(target: HTMLElement, runtime: ConversationRuntime): () => void;
}
export const standardPresentation: Presentation = {
  mount(target,runtime){
    const element=document.createElement('giscus-comments') as GiscusComments;
    element.configure(runtime);target.append(element);return ()=>element.remove();
  }
};
/** Native-page entry point. Style the presentation with its scoped stylesheet. */
export function mountComments(target: HTMLElement, options: ConversationOptions & {presentation?: Presentation}): ConversationRuntime {
  target.classList.add('giscusflare');target.dataset.theme=options.config.theme;
  const runtime=createConversation(options);
  const unmount=(options.presentation||standardPresentation).mount(target,runtime);
  const dispose=runtime.dispose.bind(runtime);let disposed=false;
  return {...runtime,dispose(){if(disposed)return;disposed=true;unmount();dispose();}};
}
